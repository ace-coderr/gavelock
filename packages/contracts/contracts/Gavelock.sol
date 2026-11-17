// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Blob} from "./Blob.sol";
import {ITapeOutCircuits} from "./interfaces/ITapeOut.sol";
import {AwardEngine} from "./AwardEngine.sol";
import {Tender, Bid} from "./Types.sol";
import {TenderPanel} from "./TenderPanel.sol";
import {TenderRecords} from "./TenderRecords.sol";

interface IRuleStock {
    function isRule(uint256 id) external view returns (bool);
    function circuits() external view returns (address);
}

/// @title Gavelock
/// @notice Tamper-proof tenders and quote requests. The contract enforces the whole lifecycle:
/// documents and rules freeze before bids arrive, bids are sealed until the deadline, anyone can open
/// them afterwards, and the award is computed by calling the tender's rule circuit on TapeOut.
///
/// There is no owner, no admin function and no upgrade path. The fee and its recipient are fixed at
/// deployment. Every record stores the block it was written in, and every piece of text, document or
/// ciphertext is kept as contract code, so the full history can be rebuilt from views alone.
///
/// The arithmetic here (commitment, banding, median, ranking) is specified by the TypeScript in
/// packages/core; the tests compare the two on every path.
contract Gavelock {
    enum Phase {
        Published, // created; the buyer is posting documents
        Clarifications, // questions, answers and addenda
        Bidding, // everything frozen; sealed bids arrive
        Opening, // anyone opens any bid
        Evaluation, // panel commit and reveal, then scoring
        Awarded, // the block in which the award was computed
        Standstill, // challenges and rulings
        Final,
        Cancelled
    }

    uint8 public constant KIND_FALSE_COMPLIANCE = 0;
    uint8 public constant KIND_SEAL_MISMATCH = 1;
    uint8 public constant RULING_PENDING = 0;
    uint8 public constant RULING_UPHELD = 1;
    uint8 public constant RULING_REJECTED = 2;

    /// Shortest and longest allowed length of any phase, in seconds.
    uint256 public constant MIN_WINDOW = 60;
    uint256 public constant MAX_WINDOW = 365 days;
    uint256 public constant MAX_PANEL = 15;
    uint256 public constant NOTE_MAX = 280;
    uint256 public constant TEXT_MAX = 2048;
    uint256 public constant CIPHERTEXT_MAX = 2048;
    uint256 public constant TERMS_MAX = 16384;
    uint256 public constant PRICE_STEP_MAX = 1_000_000;
    uint256 public constant DELIVERY_STEP_MAX = 3650;
    /// Largest abnormally-low floor: 100% of the median compliant price. 0 switches the rule off.
    uint256 public constant ABNORMAL_FLOOR_MAX = 10_000;
    uint256 private constant DRAND_GENESIS = 1692803367;
    uint256 private constant DRAND_PERIOD = 3;

    IRuleStock public immutable ruleStock;
    /// The Gavelock processor: the TapeOut circuits contract holding the rule circuits.
    ITapeOutCircuits public immutable circuits;
    /// Evaluation panels: commit and reveal of hidden scores. Deployed by this contract.
    TenderPanel public immutable panel;
    /// Documents and clarifications. Deployed by this contract.
    TenderRecords public immutable records;
    address public immutable feeRecipient;
    /// Flat fee for a full tender, in OKB. A Quick Quote is free. Bidding is always free.
    uint256 public immutable tenderFee;

    struct TenderParams {
        bool quick;
        uint32 ruleId;
        /// 0 = now. Before this moment only the buyer can act (posting documents).
        uint64 clarificationsStart;
        uint64 biddingStart;
        uint64 deadline;
        uint32 openingWindow;
        uint32 commitWindow;
        uint32 revealWindow;
        uint32 standstill;
        uint96 bidDeposit;
        uint8 checklistItems;
        uint32 mandatoryMask;
        uint32 preferredAMask;
        uint32 preferredBMask;
        uint24[7] priceLadderBps;
        uint16[3] deliveryLadderDays;
        /// A compliant bid priced below this share (in basis points) of the median compliant price is
        /// abnormally low: flagged, and never the reference for price bands. 0 = off.
        uint16 abnormalFloorBps;
        address[] panel;
        uint8 quorum;
        /// Title, description, currency and checklist labels as UTF-8 JSON. Shown to people; never read by the contract.
        bytes terms;
    }

    struct Challenge {
        address challenger;
        uint32 bidIndex;
        uint8 kind;
        uint8 ruling;
        uint64 filedBlock;
        uint64 ruledBlock;
        address reason;
        address rulingReason;
    }

    Tender[] private _tenders;
    mapping(uint256 => Bid[]) private _bids;
    mapping(uint256 => mapping(address => uint256)) private _bidOf; // index + 1
    mapping(uint256 => Challenge[]) private _challenges;
    mapping(address => uint256[]) private _byBuyer;
    mapping(address => uint256[]) private _byBidder; // tenderId << 32 | bidIndex

    uint256 public feesAccrued;
    uint256 private _entered = 1;

    event TenderCreated(uint256 indexed tenderId, address indexed buyer, bool quick, uint32 ruleId);
    event BidSealed(uint256 indexed tenderId, uint256 indexed index, address indexed bidder, bytes32 commitment);
    event BidOpened(uint256 indexed tenderId, uint256 indexed index, uint256 price, uint32 deliveryDays, uint32 compliance);
    event AwardProgress(uint256 indexed tenderId, uint8 stage, uint32 scoreCursor);
    event Awarded(uint256 indexed tenderId, uint256 indexed winner, uint8 score, uint32 generation);
    event Challenged(uint256 indexed tenderId, uint256 indexed index, uint256 indexed bidIndex, uint8 kind, address challenger);
    event Ruled(uint256 indexed tenderId, uint256 indexed index, bool upheld);
    event Finalized(uint256 indexed tenderId, uint256 indexed winner);
    event Cancelled(uint256 indexed tenderId, address indexed by);
    event DepositClaimed(uint256 indexed tenderId, uint256 indexed index, address indexed to, uint256 amount);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

    error NoSuchTender();
    error NoSuchRecord();
    error NotBuyer();
    error WrongPhase();
    error BadTimes();
    error BadPanel();
    error BadChecklist();
    error BadLadder();
    error BadRule();
    error BadLength();
    error WrongValue(uint256 expected);
    error ConflictOfInterest();
    error AlreadyBid();
    error AlreadyDone();
    error CommitmentMismatch();
    error BadBid();
    error BadHint();
    error NotEnoughGas();
    error ChallengesOpen();
    error NothingToDo();
    error PaymentFailed();
    error Reentered();

    modifier nonReentrant() {
        if (_entered != 1) revert Reentered();
        _entered = 2;
        _;
        _entered = 1;
    }

    constructor(address ruleStock_, address feeRecipient_, uint256 tenderFee_) {
        address c = IRuleStock(ruleStock_).circuits();
        require(c != address(0) && feeRecipient_ != address(0), "not ready");
        ruleStock = IRuleStock(ruleStock_);
        circuits = ITapeOutCircuits(c);
        feeRecipient = feeRecipient_;
        tenderFee = tenderFee_;
        panel = new TenderPanel(address(this));
        records = new TenderRecords(address(this));
    }

    // ================================================================== create

    function createTender(TenderParams calldata p) external payable returns (uint256 id) {
        uint64 nowTs = uint64(block.timestamp);
        uint64 clarStart = p.clarificationsStart == 0 ? nowTs : p.clarificationsStart;
        if (clarStart < nowTs || p.biddingStart < clarStart || p.biddingStart - nowTs > MAX_WINDOW) revert BadTimes();
        if (p.deadline <= p.biddingStart) revert BadTimes();
        _window(p.deadline - p.biddingStart);
        _window(p.openingWindow);
        _window(p.standstill);

        uint256 panelSize = p.panel.length;
        if (p.quick) {
            if (msg.value != 0) revert WrongValue(0);
            if (panelSize != 0) revert BadPanel();
        } else if (msg.value != tenderFee) {
            revert WrongValue(tenderFee);
        }
        if (panelSize == 0) {
            if (p.quorum != 0 || p.commitWindow != 0 || p.revealWindow != 0) revert BadPanel();
        } else {
            if (panelSize > MAX_PANEL || p.quorum == 0 || p.quorum > panelSize) revert BadPanel();
            _window(p.commitWindow);
            _window(p.revealWindow);
        }
        if (!ruleStock.isRule(p.ruleId)) revert BadRule();
        _checkChecklist(p.checklistItems, p.mandatoryMask, p.preferredAMask, p.preferredBMask);
        _checkLadders(p.priceLadderBps, p.deliveryLadderDays);
        if (p.abnormalFloorBps > ABNORMAL_FLOOR_MAX) revert BadLadder();
        if (p.terms.length == 0 || p.terms.length > TERMS_MAX) revert BadLength();

        id = _tenders.length;
        Tender storage t = _tenders.push();
        t.buyer = msg.sender;
        t.quick = p.quick;
        t.panelSize = uint8(panelSize);
        t.quorum = p.quorum;
        t.checklistItems = p.checklistItems;
        t.ruleId = p.ruleId;
        t.createdAt = nowTs;
        t.clarificationsStart = clarStart;
        t.biddingStart = p.biddingStart;
        t.deadline = p.deadline;
        t.openingEnd = p.deadline + p.openingWindow;
        t.commitEnd = t.openingEnd + p.commitWindow;
        t.revealEnd = t.commitEnd + p.revealWindow;
        t.standstill = p.standstill;
        // First drand round published at or after the deadline: ceil((deadline - genesis) / period) + 1.
        t.drandRound = uint64((p.deadline - DRAND_GENESIS + DRAND_PERIOD - 1) / DRAND_PERIOD + 1);
        t.bidDeposit = p.bidDeposit;
        t.mandatoryMask = p.mandatoryMask;
        t.preferredAMask = p.preferredAMask;
        t.preferredBMask = p.preferredBMask;
        t.priceLadderBps = p.priceLadderBps;
        t.deliveryLadderDays = p.deliveryLadderDays;
        t.abnormalFloorBps = p.abnormalFloorBps;
        t.terms = Blob.put(p.terms);
        t.createdBlock = uint64(block.number);

        if (panelSize != 0) panel.register(id, msg.sender, p.panel);
        _byBuyer[msg.sender].push(id);
        feesAccrued += msg.value;
        emit TenderCreated(id, msg.sender, p.quick, p.ruleId);
    }

    function _window(uint256 seconds_) private pure {
        if (seconds_ < MIN_WINDOW || seconds_ > MAX_WINDOW) revert BadTimes();
    }

    function _checkChecklist(uint8 items, uint32 mandatory, uint32 a, uint32 b) private pure {
        if (items > 32) revert BadChecklist();
        uint256 all = (uint256(1) << items) - 1;
        if ((uint256(mandatory) | a | b) & ~all != 0) revert BadChecklist();
        if (mandatory & a != 0 || mandatory & b != 0 || a & b != 0) revert BadChecklist();
    }

    function _checkLadders(uint24[7] calldata price, uint16[3] calldata delivery) private pure {
        for (uint256 i = 0; i < 7; i++) {
            if (price[i] > PRICE_STEP_MAX || (i > 0 && price[i] <= price[i - 1])) revert BadLadder();
        }
        for (uint256 i = 0; i < 3; i++) {
            if (delivery[i] > DELIVERY_STEP_MAX || (i > 0 && delivery[i] <= delivery[i - 1])) revert BadLadder();
        }
    }

    // ================================================================== text

    function _text(string calldata text) private returns (address) {
        if (bytes(text).length == 0 || bytes(text).length > TEXT_MAX) revert BadLength();
        return Blob.put(bytes(text));
    }

    // ================================================================== bidding and opening

    /// @notice Submit a sealed bid. `commitment` is
    /// keccak256(abi.encode(chainId, this contract, tenderId, bidder, price, deliveryDays, compliance, note, salt)).
    /// `ciphertext` is the same bid, time-locked to the tender's drand round. Send exactly the bid deposit.
    function submitBid(uint256 id, bytes32 commitment, bytes calldata ciphertext) external payable returns (uint256 index) {
        Tender storage t = _tender(id);
        if (t.cancelled || block.timestamp < t.biddingStart || block.timestamp >= t.deadline) revert WrongPhase();
        if (msg.value != t.bidDeposit) revert WrongValue(t.bidDeposit);
        if (msg.sender == t.buyer || (t.panelSize != 0 && panel.seatOf(id, msg.sender) != 0)) revert ConflictOfInterest();
        if (_bidOf[id][msg.sender] != 0) revert AlreadyBid();
        if (ciphertext.length == 0 || ciphertext.length > CIPHERTEXT_MAX) revert BadLength();

        Bid[] storage bids = _bids[id];
        index = bids.length;
        Bid storage b = bids.push();
        b.bidder = msg.sender;
        b.sealedBlock = uint64(block.number);
        b.commitment = commitment;
        b.ciphertext = Blob.put(ciphertext);
        _bidOf[id][msg.sender] = index + 1;
        _byBidder[msg.sender].push((id << 32) | index);
        emit BidSealed(id, index, msg.sender, commitment);
    }

    /// @notice Open a bid after the deadline. Anyone may call: the plaintext is recovered by decrypting the
    /// on-chain ciphertext once the drand round is published. The contract checks it against the commitment.
    /// @param hint Where a compliant bid goes in the price-ordered list: the index + 1 of any listed bid
    /// that sorts before it (lower price, or same price and earlier), or 0 to search from the cheapest.
    /// A hint only saves gas. One that does not sort before the bid reverts; none can change the order.
    function openBid(uint256 id, uint256 index, uint256 price, uint32 deliveryDays, uint32 compliance, string calldata note, bytes32 salt, uint256 hint)
        external
    {
        Tender storage t = _tender(id);
        if (t.cancelled || block.timestamp < t.deadline || block.timestamp >= t.openingEnd) revert WrongPhase();
        if (index >= _bids[id].length) revert NoSuchRecord();
        Bid storage b = _bids[id][index];
        if (b.opened) revert AlreadyDone();
        if (price == 0 || price > type(uint128).max || bytes(note).length > NOTE_MAX) revert BadBid();
        if (keccak256(abi.encode(block.chainid, address(this), id, b.bidder, price, deliveryDays, compliance, note, salt)) != b.commitment) {
            revert CommitmentMismatch();
        }
        if (compliance & t.mandatoryMask == t.mandatoryMask) AwardEngine.link(t, _bids[id], index, uint128(price), hint);
        b.opened = true;
        b.openedBlock = uint64(block.number);
        b.price = uint128(price);
        b.deliveryDays = deliveryDays;
        b.compliance = compliance;
        b.salt = salt;
        if (bytes(note).length != 0) b.note = Blob.put(bytes(note));
        t.openedCount++;
        emit BidOpened(id, index, price, deliveryDays, compliance);
    }

    // ================================================================== award

    /// @notice Compute the award. Anyone may call, as often as needed: each call makes at most `maxBids`
    /// bid visits, and the result is the same however the work is split and whoever does it.
    /// The computation itself lives in the AwardEngine library.
    function finalize(uint256 id, uint256 maxBids) external {
        AwardEngine.finalize(_tender(id), _bids[id], id, maxBids, circuits, panel);
    }


    // ================================================================== standstill

    function challenge(uint256 id, uint256 bidIndex, uint8 kind, string calldata reason) external returns (uint256 index) {
        Tender storage t = _tender(id);
        if (t.cancelled || t.closed || t.awardedAt == 0 || block.timestamp >= t.standstillEnd) revert WrongPhase();
        if (bidIndex >= _bids[id].length || kind > KIND_SEAL_MISMATCH) revert NoSuchRecord();
        Bid storage b = _bids[id][bidIndex];
        if (!b.opened || b.disqualified) revert BadBid();
        index = _challenges[id].length;
        _challenges[id].push(Challenge(msg.sender, uint32(bidIndex), kind, RULING_PENDING, uint64(block.number), 0, _text(reason), address(0)));
        t.openChallenges++;
        emit Challenged(id, index, bidIndex, kind, msg.sender);
    }

    /// @notice The buyer's ruling on a challenge, with a reason. Upholding it disqualifies the bid and
    /// resets the award, which is then computed again through finalize().
    function rule(uint256 id, uint256 index, bool upheld, string calldata reason) external {
        Tender storage t = _tender(id);
        if (msg.sender != t.buyer) revert NotBuyer();
        if (t.cancelled || t.closed) revert WrongPhase();
        if (index >= _challenges[id].length) revert NoSuchRecord();
        Challenge storage c = _challenges[id][index];
        if (c.ruling != RULING_PENDING) revert AlreadyDone();
        c.ruling = upheld ? RULING_UPHELD : RULING_REJECTED;
        c.ruledBlock = uint64(block.number);
        c.rulingReason = _text(reason);
        t.openChallenges--;
        if (upheld) {
            AwardEngine.disqualify(t, _bids[id], c.bidIndex);
        }
        emit Ruled(id, index, upheld);
    }

    /// @notice Make the award final once the standstill has passed with no challenge left open.
    function close(uint256 id) external {
        Tender storage t = _tender(id);
        if (t.cancelled || t.closed || t.awardedAt == 0 || block.timestamp < t.standstillEnd) revert WrongPhase();
        if (t.openChallenges != 0) revert ChallengesOpen();
        t.closed = true;
        t.endedAt = uint64(block.timestamp);
        t.endedBlock = uint64(block.number);
        emit Finalized(id, t.best - 1);
    }

    /// @notice The buyer may cancel a tender at any time before it is final, with a public reason.
    function cancel(uint256 id, string calldata reason) external {
        Tender storage t = _tender(id);
        if (msg.sender != t.buyer) revert NotBuyer();
        if (t.cancelled || t.closed) revert WrongPhase();
        _cancel(id, t, msg.sender, _text(reason));
    }

    /// @notice If the buyer leaves a challenge unruled for a whole standstill period after the window
    /// closed, anyone can end the tender so deposits are not locked forever.
    function cancelStalled(uint256 id) external {
        Tender storage t = _tender(id);
        if (t.cancelled || t.closed || t.standstillEnd == 0) revert WrongPhase();
        if (t.openChallenges == 0 || block.timestamp < uint256(t.standstillEnd) + t.standstill) revert NothingToDo();
        _end(id, t, "The buyer did not rule on a challenge in time.");
    }

    function _end(uint256 id, Tender storage t, string memory reason) private {
        _cancel(id, t, address(0), Blob.put(bytes(reason)));
    }

    function _cancel(uint256 id, Tender storage t, address by, address reason) private {
        t.cancelled = true;
        t.cancelledBy = by;
        t.cancelReason = reason;
        t.endedAt = uint64(block.timestamp);
        t.endedBlock = uint64(block.number);
        emit Cancelled(id, by);
    }

    // ================================================================== money

    /// @notice Pay a bid's deposit to whoever it belongs to, once the tender is final or cancelled.
    /// It returns to the bidder, except for a bid left unopened through a completed opening window in
    /// which at least one other bid was opened: that deposit is forfeited to the buyer.
    function claimDeposit(uint256 id, uint256 index) external nonReentrant {
        Tender storage t = _tender(id);
        if (!t.cancelled && !t.closed) revert WrongPhase();
        if (index >= _bids[id].length) revert NoSuchRecord();
        Bid storage b = _bids[id][index];
        if (b.claimed) revert AlreadyDone();
        b.claimed = true;
        address to = depositRecipient(id, index);
        uint256 amount = t.bidDeposit;
        if (amount != 0) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert PaymentFailed();
        }
        emit DepositClaimed(id, index, to, amount);
    }

    function depositRecipient(uint256 id, uint256 index) public view returns (address) {
        Tender storage t = _tender(id);
        Bid storage b = _bids[id][index];
        bool windowCompleted = !t.cancelled || t.endedAt >= t.openingEnd;
        return (!b.opened && windowCompleted && t.openedCount != 0) ? t.buyer : b.bidder;
    }

    function withdrawFees() external nonReentrant {
        uint256 amount = feesAccrued;
        if (amount == 0) revert NothingToDo();
        feesAccrued = 0;
        (bool ok, ) = feeRecipient.call{value: amount}("");
        if (!ok) revert PaymentFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    // ================================================================== views

    function _tender(uint256 id) private view returns (Tender storage) {
        if (id >= _tenders.length) revert NoSuchTender();
        return _tenders[id];
    }

    function phaseOf(uint256 id) external view returns (Phase) {
        Tender storage t = _tender(id);
        if (t.cancelled) return Phase.Cancelled;
        if (t.closed) return Phase.Final;
        if (t.awardedAt != 0) return block.timestamp == t.awardedAt ? Phase.Awarded : Phase.Standstill;
        if (t.recomputing) return Phase.Standstill;
        if (block.timestamp < t.clarificationsStart) return Phase.Published;
        if (block.timestamp < t.biddingStart) return Phase.Clarifications;
        if (block.timestamp < t.deadline) return Phase.Bidding;
        if (block.timestamp < t.openingEnd) return Phase.Opening;
        return Phase.Evaluation;
    }

    /// @notice What the records contract needs to know to gate documents and clarifications.
    function gateOf(uint256 id) external view returns (address buyer, uint64 clarificationsStart, uint64 biddingStart, bool cancelled) {
        Tender storage t = _tender(id);
        return (t.buyer, t.clarificationsStart, t.biddingStart, t.cancelled);
    }

    /// @notice What the panel contract needs to know to gate commits and reveals.
    function panelGateOf(uint256 id) external view returns (uint64 openingEnd, uint64 commitEnd, uint64 revealEnd, bool cancelled, uint256 bids) {
        Tender storage t = _tender(id);
        return (t.openingEnd, t.commitEnd, t.revealEnd, t.cancelled, _bids[id].length);
    }

    function tenderCount() external view returns (uint256) {
        return _tenders.length;
    }

    function getTender(uint256 id) external view returns (Tender memory) {
        return _tender(id);
    }

    function bidCount(uint256 id) external view returns (uint256) {
        return _bids[id].length;
    }

    function getBid(uint256 id, uint256 index) external view returns (Bid memory) {
        if (index >= _bids[id].length) revert NoSuchRecord();
        return _bids[id][index];
    }

    /// @notice A bidder's bid index + 1 in a tender, or 0 if they have not bid.
    function bidOf(uint256 id, address bidder) external view returns (uint256) {
        return _bidOf[id][bidder];
    }

    function challengeCount(uint256 id) external view returns (uint256) {
        return _challenges[id].length;
    }

    function getChallenge(uint256 id, uint256 index) external view returns (Challenge memory) {
        if (index >= _challenges[id].length) revert NoSuchRecord();
        return _challenges[id][index];
    }

    function tendersOf(address buyer) external view returns (uint256) {
        return _byBuyer[buyer].length;
    }

    function tenderOfBuyer(address buyer, uint256 position) external view returns (uint256) {
        return _byBuyer[buyer][position];
    }

    function bidsOf(address bidder) external view returns (uint256) {
        return _byBidder[bidder].length;
    }

    /// @return tenderId and bidIndex of a bidder's n-th bid across all tenders.
    function bidOfBidder(address bidder, uint256 position) external view returns (uint256 tenderId, uint256 bidIndex) {
        uint256 packed = _byBidder[bidder][position];
        return (packed >> 32, packed & 0xffffffff);
    }

    /// @notice Read text, a document chunk or a ciphertext stored by this contract.
    function read(address pointer) external view returns (bytes memory) {
        return Blob.get(pointer);
    }
}
