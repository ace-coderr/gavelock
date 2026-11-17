// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// Storage layouts shared by the tender contract and its award library.

struct Tender {
    address buyer;
    bool quick;
    bool cancelled;
    bool closed;
    /// An upheld challenge removed a bid and the award is being computed again.
    bool recomputing;
    uint8 panelSize;
    uint8 quorum;
    uint8 checklistItems;
    uint32 ruleId;
    uint64 createdAt;
    uint64 clarificationsStart;
    uint64 biddingStart;
    uint64 deadline;
    uint64 openingEnd;
    uint64 commitEnd;
    uint64 revealEnd;
    uint32 standstill;
    /// drand quicknet round every bid must be sealed to: the first round at or after the deadline.
    uint64 drandRound;
    uint96 bidDeposit;
    uint32 mandatoryMask;
    uint32 preferredAMask;
    uint32 preferredBMask;
    uint24[7] priceLadderBps;
    uint16[3] deliveryLadderDays;
    uint16 abnormalFloorBps;
    address terms;
    uint64 createdBlock;
    uint32 openedCount;
    /// Opened, non-disqualified bids that claim every mandatory item. They are kept in a list sorted
    /// by price, then bid index; `head` is the cheapest (bid index + 1, 0 when empty).
    uint32 compliantCount;
    uint32 head;
    uint32 openChallenges;
    /// Number of times the award has been reset by an upheld challenge.
    uint32 generation;
    // ---- award computation (see finalize)
    /// 0 not started, 1 walking to the median, 2 skipping abnormally low bids, 3 scoring.
    uint8 stage;
    /// Position reached in the price-ordered list: a bid index + 1, and how many steps from the head.
    uint32 walkNode;
    uint32 walkPos;
    /// Median compliant price; 0 when the abnormally-low rule did not apply.
    uint128 medianPrice;
    /// Reference for price bands: the lowest compliant price that is not abnormally low.
    uint128 lowestValidPrice;
    uint32 scoreCursor;
    /// Winning bid index + 1, or 0.
    uint32 best;
    uint8 bestScore;
    uint64 awardedAt;
    uint64 awardedBlock;
    /// End of the latest standstill window. Kept across a recompute.
    uint64 standstillEnd;
    // ---- end
    uint64 endedAt;
    uint64 endedBlock;
    /// Zero when the contract itself cancelled the tender (no bids, no quorum, ...).
    address cancelledBy;
    address cancelReason;
    /// The tender ended because the buyer left a challenge unruled for a whole standstill.
    bool stalled;
}

struct Bid {
    address bidder;
    uint64 sealedBlock;
    bool opened;
    bool disqualified;
    bool claimed;
    bool eligible;
    bytes32 commitment;
    address ciphertext;
    uint64 openedBlock;
    uint32 deliveryDays;
    uint128 price;
    uint32 compliance;
    uint8 score;
    /// The 11 bits given to the rule circuit.
    uint16 ruleInput;
    uint8 panelMedian;
    /// generation + 1 of the award computation that produced score and eligible; 0 = never scored.
    uint32 scoredIn;
    address note;
    /// Neighbours in the price-ordered list of compliant bids (bid index + 1, 0 = none).
    uint32 next;
    uint32 prev;
    /// Compliant, but priced below the tender's floor of the median compliant price.
    bool abnormallyLow;
    bytes32 salt;
}
