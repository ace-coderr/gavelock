// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IPanelGate {
    function panelGateOf(uint256 id) external view returns (uint64 openingEnd, uint64 commitEnd, uint64 revealEnd, bool cancelled, uint256 bidCount);
}

/// @title TenderPanel
/// @notice The evaluation panels of Gavelock tenders. Each member commits a hidden score for every bid,
/// then reveals it. Nobody can see another member's scores before the reveal, nobody can change a score
/// after committing, and a member who does not reveal is simply left out of the median.
///
/// The panel of a tender is fixed when the tender is created and can only be set by the tender contract.
/// The commit and reveal windows are read from the tender contract. No owner, no upgrade path.
contract TenderPanel {
    uint256 public constant MAX_PANEL = 15;
    uint256 public constant SCORE_MAX = 100;

    /// The tender contract. The only address that can register a panel.
    address public immutable tenders;

    struct Member {
        uint8 seat; // position in the panel + 1; 0 = not a member
        uint64 committedBlock;
        uint64 revealedBlock;
        bytes32 commitment;
        /// One byte per bid, 0..100, in bid order. Entries for bids that were never opened are ignored.
        bytes scores;
    }

    mapping(uint256 => address[]) private _panel;
    mapping(uint256 => mapping(address => Member)) private _members;
    /// Number of members who revealed, per tender.
    mapping(uint256 => uint256) public revealedCount;

    event ScoresCommitted(uint256 indexed tenderId, address indexed member, bytes32 commitment);
    event ScoresRevealed(uint256 indexed tenderId, address indexed member);

    error NotTenderContract();
    error BadPanel();
    error WrongPhase();
    error NotPanelMember();
    error AlreadyDone();
    error BadScores();
    error CommitmentMismatch();
    error NoScores();

    constructor(address tenders_) {
        tenders = tenders_;
    }

    /// Called once per tender by the tender contract when the tender is created.
    function register(uint256 id, address buyer, address[] calldata members) external {
        if (msg.sender != tenders) revert NotTenderContract();
        if (members.length == 0 || members.length > MAX_PANEL || _panel[id].length != 0) revert BadPanel();
        for (uint256 i = 0; i < members.length; i++) {
            address member = members[i];
            if (member == address(0) || member == buyer || _members[id][member].seat != 0) revert BadPanel();
            _members[id][member].seat = uint8(i + 1);
            _panel[id].push(member);
        }
    }

    /// @notice Commit hidden scores for every bid at once:
    /// keccak256(abi.encode(chainId, tender contract, tenderId, member, scores, salt)), scores being one byte per bid.
    function commitScores(uint256 id, bytes32 commitment) external {
        (uint64 openingEnd, uint64 commitEnd, , bool cancelled, ) = IPanelGate(tenders).panelGateOf(id);
        if (cancelled || block.timestamp < openingEnd || block.timestamp >= commitEnd) revert WrongPhase();
        Member storage m = _members[id][msg.sender];
        if (m.seat == 0) revert NotPanelMember();
        if (m.committedBlock != 0) revert AlreadyDone();
        m.commitment = commitment;
        m.committedBlock = uint64(block.number);
        emit ScoresCommitted(id, msg.sender, commitment);
    }

    function revealScores(uint256 id, bytes calldata scores, bytes32 salt) external {
        (, uint64 commitEnd, uint64 revealEnd, bool cancelled, uint256 bidCount) = IPanelGate(tenders).panelGateOf(id);
        if (cancelled || block.timestamp < commitEnd || block.timestamp >= revealEnd) revert WrongPhase();
        Member storage m = _members[id][msg.sender];
        if (m.seat == 0) revert NotPanelMember();
        if (m.committedBlock == 0 || m.revealedBlock != 0) revert AlreadyDone();
        if (scores.length != bidCount) revert BadScores();
        for (uint256 i = 0; i < scores.length; i++) {
            if (uint8(scores[i]) > SCORE_MAX) revert BadScores();
        }
        if (keccak256(abi.encode(block.chainid, tenders, id, msg.sender, scores, salt)) != m.commitment) revert CommitmentMismatch();
        m.scores = scores;
        m.revealedBlock = uint64(block.number);
        revealedCount[id]++;
        emit ScoresRevealed(id, msg.sender);
    }

    /// @notice Median of the revealed scores for one bid. An even count takes the mean of the two middle
    /// scores, rounded down. Reverts when nobody has revealed.
    function medianOf(uint256 id, uint256 bidIndex) external view returns (uint256) {
        address[] storage panel = _panel[id];
        uint256 size = panel.length;
        uint256[] memory values = new uint256[](size);
        uint256 count = 0;
        for (uint256 i = 0; i < size; i++) {
            Member storage m = _members[id][panel[i]];
            if (m.revealedBlock == 0) continue;
            uint256 v = uint8(m.scores[bidIndex]);
            uint256 j = count++;
            while (j > 0 && values[j - 1] > v) {
                values[j] = values[j - 1];
                j--;
            }
            values[j] = v;
        }
        if (count == 0) revert NoScores();
        uint256 mid = count / 2;
        return count % 2 == 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
    }

    /// @notice A member's seat (position + 1) in a tender's panel, or 0 if they are not on it.
    function seatOf(uint256 id, address member) external view returns (uint8) {
        return _members[id][member].seat;
    }

    function panelOf(uint256 id) external view returns (address[] memory) {
        return _panel[id];
    }

    function memberOf(uint256 id, address member) external view returns (Member memory) {
        return _members[id][member];
    }
}
