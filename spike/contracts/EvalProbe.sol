// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Spike-only contract. It measures the primitives the tender contract will be built from:
/// a contract calling a TapeOut circuit's eval inside a transaction, publishing document bytes
/// in an event with an on-chain SHA-256, and keeping a sealed bid's ciphertext readable from a view.
interface ICircuits {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function circuitInfo(uint256 id) external view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
}

contract EvalProbe {
    ICircuits public immutable circuits;

    struct Bid {
        bytes32 commitment;
        address pointer; // contract whose code is the ciphertext
        uint64 blockNumber;
        uint96 deposit;
    }

    mapping(uint256 => uint8) public scoreOf;
    mapping(uint256 => bool) public eligibleOf;
    Bid[] public bids;
    bytes32 public lastDocHash;
    uint64 public lastDocBlock;

    event Document(uint256 indexed version, bytes32 sha256Hash, bytes data);
    event BidSealed(uint256 indexed index, address indexed bidder, bytes32 commitment);

    constructor(address circuits_) {
        circuits = ICircuits(circuits_);
    }

    /// One circuit call: 11 banded input bits in, eligible + 4-bit score out.
    function score(uint256 id, uint16 banded) public view returns (bool eligible, uint8 points) {
        bytes memory input = new bytes(2);
        input[0] = bytes1(uint8(banded));
        input[1] = bytes1(uint8(banded >> 8));
        bytes memory out = circuits.eval(id, input);
        require(out.length == 1, "unexpected width");
        uint8 word = uint8(out[0]);
        eligible = word & 1 == 1;
        points = (word >> 1) & 15;
    }

    /// The same call guarded the way the tender contract must guard it: gas cap, no trust in the callee.
    function scoreGuarded(uint256 id, uint16 banded, uint256 gasCap) public view returns (bool ok, bool eligible, uint8 points) {
        bytes memory input = new bytes(2);
        input[0] = bytes1(uint8(banded));
        input[1] = bytes1(uint8(banded >> 8));
        (bool success, bytes memory ret) = address(circuits).staticcall{gas: gasCap}(abi.encodeCall(ICircuits.eval, (id, input)));
        if (!success || ret.length < 96) return (false, false, 0);
        bytes memory out = abi.decode(ret, (bytes));
        if (out.length != 1) return (false, false, 0);
        uint8 word = uint8(out[0]);
        return (true, word & 1 == 1, (word >> 1) & 15);
    }

    /// Score a batch inside a transaction and store the results, as finalize() will.
    function scoreAndStore(uint256 id, uint16[] calldata banded) external {
        for (uint256 i = 0; i < banded.length; i++) {
            (bool eligible, uint8 points) = score(id, banded[i]);
            eligibleOf[i] = eligible;
            scoreOf[i] = points;
        }
    }

    function publishDocument(uint256 version, bytes calldata data) external {
        bytes32 h = sha256(data);
        lastDocHash = h;
        lastDocBlock = uint64(block.number);
        emit Document(version, h, data);
    }

    function sealBid(bytes32 commitment, bytes calldata ciphertext) external payable {
        address pointer = _write(ciphertext);
        bids.push(Bid(commitment, pointer, uint64(block.number), uint96(msg.value)));
        emit BidSealed(bids.length - 1, msg.sender, commitment);
    }

    function ciphertextOf(uint256 index) external view returns (bytes memory data) {
        address pointer = bids[index].pointer;
        uint256 size = pointer.code.length - 1;
        data = new bytes(size);
        assembly {
            extcodecopy(pointer, add(data, 32), 1, size)
        }
    }

    /// Store bytes as the code of a tiny contract (a leading STOP makes it uncallable).
    function _write(bytes calldata data) private returns (address pointer) {
        bytes memory runtime = abi.encodePacked(hex"00", data);
        // 0x61 size 0x80 0x600a 0x3d 0x39 0x3d 0xf3 : copy the runtime that follows this 10-byte prefix and return it
        bytes memory creation = abi.encodePacked(hex"61", uint16(runtime.length), hex"80600a3d393df3", runtime);
        assembly {
            pointer := create(0, add(creation, 32), mload(creation))
        }
        require(pointer != address(0), "store failed");
    }
}
