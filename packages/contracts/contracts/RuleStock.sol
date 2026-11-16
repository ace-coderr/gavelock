// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ITapeOutFactory, ITapeOutTransistors, ITapeOutCircuits} from "./interfaces/ITapeOut.sol";

interface IFeeToken {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

/// @title RuleStock
/// @notice Creates the Gavelock processor on TapeOut and holds its entire transistor supply, so that
/// anyone can tape out a scoring rule by paying OKB only.
///
/// Why it exists: taping out a circuit burns transistors, and minting transistors costs the TapeOut fee
/// token. A buyer who only wants to publish a rule should not have to acquire a second token first.
///
/// What it guarantees:
///  - `open()` creates the processor with mint price 0 and mints the whole supply to this contract in one
///    transaction. The supply cap is then reached, so nobody can ever mint another transistor.
///  - This contract has no function that moves transistors out. They can only be burned by a tape-out.
///  - `tapeOut()` accepts flat NAND netlists of the Gavelock rule shape only (11 inputs, 5 outputs, at
///    most 1,500 gates). The caller pays the TapeOut fee plus a fixed rule fee and receives the circuit.
///  - No owner, no upgrade path, no way to change the fee or the recipient.
contract RuleStock {
    uint256 public constant NAND = 0;
    uint32 public constant RULE_INPUTS = 11;
    uint32 public constant RULE_OUTPUTS = 5;
    /// Largest rule, in NAND gates. Bounds what one `eval` of a Gavelock rule can cost.
    uint256 public constant MAX_NAND = 1500;
    uint256 public constant MAX_LABEL_BYTES = 64;
    uint256 private constant RECORD_BYTES = 7;

    ITapeOutFactory public immutable factory;
    /// Receives the rule fees. Fixed at deployment.
    address public immutable feeRecipient;
    /// Paid in OKB on top of the TapeOut tape-out fee, per rule. Fixed at deployment.
    uint256 public immutable ruleFee;
    /// Transistor supply of the processor. All of it is minted to this contract.
    uint256 public immutable supply;

    string public processorName;
    string public processorSymbol;
    string public processorStory;

    /// The Gavelock processor (TapeOut circuits contract). Zero until `open()`.
    ITapeOutCircuits public circuits;
    ITapeOutTransistors public transistors;

    struct Rule {
        address author;
        uint32 gates;
        uint64 blockNumber;
        string label;
    }

    mapping(uint256 id => Rule) private _rules;
    uint256[] private _ruleIds;

    /// Rule fees collected and not yet sent to the recipient.
    uint256 public feesAccrued;
    uint256 private _entered = 1;

    event Opened(address indexed circuits, address indexed transistors, uint256 supply);
    event RuleTapedOut(uint256 indexed id, address indexed author, uint256 gates, string label);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error AlreadyOpen();
    error NotOpen();
    error Reentered();
    error FeeTokenFailed();
    error SupplyNotFullyMinted();
    error EmptyNetlist();
    error NotWholeRecords();
    error TooManyGates(uint256 gates);
    error NotNandOnly(uint256 record);
    error LabelTooLong();
    error WrongValue(uint256 expected);
    error UnexpectedCircuit();
    error UnexpectedToken();
    error NothingToWithdraw();
    error WithdrawFailed();

    modifier nonReentrant() {
        if (_entered != 1) revert Reentered();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(
        address factory_,
        address feeRecipient_,
        uint256 ruleFee_,
        uint256 supply_,
        string memory name_,
        string memory symbol_,
        string memory story_
    ) {
        require(factory_ != address(0) && feeRecipient_ != address(0), "zero address");
        require(supply_ >= MAX_NAND, "supply too small");
        factory = ITapeOutFactory(factory_);
        feeRecipient = feeRecipient_;
        ruleFee = ruleFee_;
        supply = supply_;
        processorName = name_;
        processorSymbol = symbol_;
        processorStory = story_;
    }

    // ------------------------------------------------------------------ setup

    /// @notice Create the processor and mint its whole transistor supply to this contract, in one transaction.
    /// The caller pays TapeOut's processor fee and one mint fee in the fee token, by allowance to this
    /// contract. Callable once, by anyone: the name, supply and mint price are fixed at deployment.
    function open() external nonReentrant {
        if (address(circuits) != address(0)) revert AlreadyOpen();

        IFeeToken token = IFeeToken(factory.bem());
        uint256 deployFee = factory.deployFee();
        _pull(token, deployFee);
        _approve(token, address(factory), deployFee);
        (address transistors_, address circuits_) = factory.createCPU(processorName, processorSymbol, processorStory, supply, 0);

        // Stored before minting: the mint calls back into onERC1155Received, which only accepts this token.
        circuits = ITapeOutCircuits(circuits_);
        transistors = ITapeOutTransistors(transistors_);

        uint256 mintFee = transistors.protocolFee();
        _pull(token, mintFee);
        _approve(token, transistors_, mintFee);
        transistors.mint(NAND, supply);

        // The cap is shared by every transistor type, so reaching it closes minting for good.
        if (transistors.balanceOf(address(this), NAND) != supply || transistors.minted() != transistors.supplyCap()) {
            revert SupplyNotFullyMinted();
        }
        emit Opened(circuits_, transistors_, supply);
    }

    function _pull(IFeeToken token, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IFeeToken.transferFrom, (msg.sender, address(this), amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert FeeTokenFailed();
    }

    function _approve(IFeeToken token, address spender, uint256 amount) private {
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IFeeToken.approve, (spender, amount)));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert FeeTokenFailed();
    }

    // ------------------------------------------------------------------ rules

    /// @notice What `tapeOut` costs right now, in OKB: TapeOut's fee plus the rule fee.
    function tapeOutPrice() public view returns (uint256) {
        if (address(circuits) == address(0)) revert NotOpen();
        return circuits.TAPEOUT_FEE() + ruleFee;
    }

    /// @notice Tape out a Gavelock rule. Send exactly `tapeOutPrice()`. The caller ends up owning the circuit.
    /// @param netlist NAND records only (7 bytes each), for a circuit with 11 inputs and 5 outputs.
    /// @param label A short name shown in the Rule Library. It describes the rule; it does not define it.
    function tapeOut(bytes calldata netlist, string calldata label) external payable nonReentrant returns (uint256 id) {
        ITapeOutCircuits c = circuits;
        if (address(c) == address(0)) revert NotOpen();

        uint256 length = netlist.length;
        if (length == 0) revert EmptyNetlist();
        if (length % RECORD_BYTES != 0) revert NotWholeRecords();
        uint256 gates = length / RECORD_BYTES;
        if (gates > MAX_NAND) revert TooManyGates(gates);
        // Opcode 0 is NAND. LATCH (state) and REF (another circuit's logic) are not allowed in a rule.
        for (uint256 i = 0; i < length; i += RECORD_BYTES) {
            if (netlist[i] != 0x00) revert NotNandOnly(i / RECORD_BYTES);
        }
        if (bytes(label).length > MAX_LABEL_BYTES) revert LabelTooLong();

        uint256 tapeoutFee = c.TAPEOUT_FEE();
        if (msg.value != tapeoutFee + ruleFee) revert WrongValue(tapeoutFee + ruleFee);

        id = c.tapeout{value: tapeoutFee}(netlist, RULE_INPUTS, RULE_OUTPUTS);
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount) = c.circuitInfo(id);
        if (nIn != RULE_INPUTS || nOut != RULE_OUTPUTS || nState != 0 || gateCount != gates) revert UnexpectedCircuit();

        _rules[id] = Rule({author: msg.sender, gates: uint32(gates), blockNumber: uint64(block.number), label: label});
        _ruleIds.push(id);
        feesAccrued += ruleFee;
        emit RuleTapedOut(id, msg.sender, gates, label);

        c.transferFrom(address(this), msg.sender, id);
    }

    /// @notice Send the collected rule fees to the fee recipient. Anyone may call.
    function withdrawFees() external nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert NothingToWithdraw();
        feesAccrued = 0;
        (bool ok, ) = feeRecipient.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice True for circuits taped out through this contract: flat NAND, rule-shaped, size-bounded.
    function isRule(uint256 id) public view returns (bool) {
        return _rules[id].author != address(0);
    }

    function rule(uint256 id) external view returns (address author, uint32 gates, uint64 blockNumber, string memory label) {
        Rule storage r = _rules[id];
        return (r.author, r.gates, r.blockNumber, r.label);
    }

    function ruleCount() external view returns (uint256) {
        return _ruleIds.length;
    }

    /// @notice Rule ids in tape-out order, a page at a time.
    function ruleIds(uint256 from, uint256 count) external view returns (uint256[] memory ids) {
        uint256 total = _ruleIds.length;
        if (from >= total) return new uint256[](0);
        uint256 end = from + count > total ? total : from + count;
        ids = new uint256[](end - from);
        for (uint256 i = from; i < end; i++) ids[i - from] = _ruleIds[i];
    }

    /// @notice Transistors left for future rules.
    function stockRemaining() external view returns (uint256) {
        if (address(transistors) == address(0)) return 0;
        return transistors.balanceOf(address(this), NAND);
    }

    // ------------------------------------------------------------------ token receivers

    /// Accepts only the processor's own mint to this contract.
    function onERC1155Received(address operator, address from, uint256, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(transistors) || operator != address(this) || from != address(0)) revert UnexpectedToken();
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        revert UnexpectedToken();
    }

    /// Accepts only a circuit this contract just taped out.
    function onERC721Received(address operator, address from, uint256, bytes calldata) external view returns (bytes4) {
        if (msg.sender != address(circuits) || operator != address(this) || from != address(0)) revert UnexpectedToken();
        return this.onERC721Received.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x4e2312e0 // ERC-1155 receiver
            || interfaceId == 0x150b7a02; // ERC-721 receiver
    }
}
