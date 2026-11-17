// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Blob} from "./Blob.sol";
import {Tender, Bid} from "./Types.sol";
import {ITapeOutCircuits} from "./interfaces/ITapeOut.sol";
import {TenderPanel} from "./TenderPanel.sol";

/// @title AwardEngine
/// @notice How a Gavelock award is computed. A library, run in the tender contract's own storage, so
/// that the tender contract stays under the code size limit. It holds no state and has no owner.
///
/// The arithmetic is specified by packages/core (award.ts, banding.ts). In short:
///  - the compliant bids (opened, not disqualified, every mandatory item claimed) are kept in a list
///    ordered by price, then bid index, built as bids are opened;
///  - if the tender's abnormally-low rule applies, the median compliant price is read from the middle
///    of that list and every compliant bid below the floor is flagged;
///  - the reference price is the cheapest compliant bid that is not flagged;
///  - each bid is banded against it, scored by the rule circuit, and the best is kept:
///    higher score, then lower price, then earlier bid.
/// Every step is a function of the set of bids, so the result does not depend on how the work is paged
/// or on who calls.
library AwardEngine {
    /// A Quick Quote needs at least this many opened quotes to be awarded.
    uint256 internal constant MIN_QUOTES = 3;
    /// The abnormally-low rule needs at least this many compliant bids.
    uint256 internal constant ABNORMAL_MIN_BIDS = 3;
    uint256 internal constant PANEL_SCORE_MAX = 100;
    /// Gas given to one rule evaluation. The largest rule the stock accepts needs about 3.5M.
    uint256 internal constant EVAL_GAS = 5_000_000;

    event AwardProgress(uint256 indexed tenderId, uint8 stage, uint32 scoreCursor);
    event Awarded(uint256 indexed tenderId, uint256 indexed winner, uint8 score, uint32 generation);
    event Cancelled(uint256 indexed tenderId, address indexed by);

    error WrongPhase();
    error NothingToDo();
    error NotEnoughGas();
    error BadHint();

    // ================================================================== price order

    function _sortsBefore(uint128 priceA, uint256 indexA, uint128 priceB, uint256 indexB) private pure returns (bool) {
        return priceA < priceB || (priceA == priceB && indexA < indexB);
    }

    /// @notice Insert a newly opened compliant bid into the price-ordered list.
    /// @param hint The index + 1 of any listed bid that sorts before the new one, or 0 to search from the
    /// cheapest. The position found is the same whatever the hint; a hint that does not sort before the
    /// bid, or is not in the list, reverts.
    function link(Tender storage t, Bid[] storage bids, uint256 index, uint128 price, uint256 hint) external {
        uint256 prev = hint;
        uint256 next;
        if (prev == 0) {
            next = t.head;
        } else {
            if (prev > bids.length) revert BadHint();
            Bid storage h = bids[prev - 1];
            // In the list means opened and compliant; nothing is disqualified before the award.
            if (!h.opened || h.compliance & t.mandatoryMask != t.mandatoryMask || !_sortsBefore(h.price, prev - 1, price, index)) revert BadHint();
            next = h.next;
        }
        while (next != 0) {
            Bid storage n = bids[next - 1];
            if (!_sortsBefore(n.price, next - 1, price, index)) break;
            prev = next;
            next = n.next;
        }
        Bid storage b = bids[index];
        b.prev = uint32(prev);
        b.next = uint32(next);
        if (prev == 0) t.head = uint32(index + 1);
        else bids[prev - 1].next = uint32(index + 1);
        if (next != 0) bids[next - 1].prev = uint32(index + 1);
        t.compliantCount++;
    }

    /// @notice Disqualify a bid after an upheld challenge: take it out of the price order and reset the
    /// award, so that the median, the flags, the reference price and the winner are all computed again.
    function disqualify(Tender storage t, Bid[] storage bids, uint256 index) external {
        Bid storage b = bids[index];
        if (b.disqualified) return;
        b.disqualified = true;
        if (b.compliance & t.mandatoryMask == t.mandatoryMask) {
            uint32 prev = b.prev;
            uint32 next = b.next;
            if (prev == 0) t.head = next;
            else bids[prev - 1].next = next;
            if (next != 0) bids[next - 1].prev = prev;
            t.compliantCount--;
        }
        t.recomputing = true;
        t.generation++;
        t.stage = 0;
        t.medianPrice = 0;
        t.lowestValidPrice = 0;
        t.scoreCursor = 0;
        t.best = 0;
        t.bestScore = 0;
        t.awardedAt = 0;
        t.awardedBlock = 0;
    }

    // ================================================================== award

    /// What one call needs besides the tender's own storage.
    struct Context {
        uint256 id;
        ITapeOutCircuits circuits;
        TenderPanel panel;
    }

    /// @notice One page of the award computation: at most `maxBids` bid visits.
    ///
    /// Stage 1 (only when the abnormally-low rule applies) walks the price order to its middle for the
    /// median. Stage 2 skips the bids below the floor; the first that is not below it is the reference
    /// price. Stage 3 bands each bid, asks the rule circuit for its score and keeps the best.
    function finalize(Tender storage t, Bid[] storage bids, uint256 id, uint256 maxBids, ITapeOutCircuits circuits, TenderPanel panel) external {
        if (t.cancelled || t.closed || t.awardedAt != 0) revert WrongPhase();
        if (!t.recomputing && block.timestamp < t.revealEnd) revert WrongPhase();
        if (maxBids == 0) revert NothingToDo();

        Context memory ctx = Context(id, circuits, panel);
        uint256 budget = maxBids;
        uint256 stage = t.stage;
        if (stage == 0) {
            stage = _start(t, bids, ctx);
            if (stage == 0) return; // the tender ended itself
        }
        if (stage == 1) (stage, budget) = _walkToMedian(t, bids, budget);
        if (stage == 2) (stage, budget) = _skipAbnormallyLow(t, bids, budget);
        if (stage == 3 && _scoreBids(t, bids, ctx, budget)) return; // awarded, or the tender ended itself
        t.stage = uint8(stage);
        emit AwardProgress(id, uint8(stage), t.scoreCursor);
    }

    /// Checks made once, then the choice of path. Returns the next stage, or 0 if the tender was ended.
    function _start(Tender storage t, Bid[] storage bids, Context memory ctx) private returns (uint256) {
        if (!t.recomputing) {
            if (t.openedCount == 0) return _end(ctx.id, t, "No bid was opened.");
            if (t.quick && t.openedCount < MIN_QUOTES) return _end(ctx.id, t, "Fewer than three quotes were opened.");
            if (t.panelSize != 0 && ctx.panel.revealedCount(ctx.id) < t.quorum) return _end(ctx.id, t, "The evaluation panel did not reach its quorum.");
        }
        uint256 head = t.head;
        if (t.abnormalFloorBps != 0 && t.compliantCount >= ABNORMAL_MIN_BIDS) {
            t.walkNode = uint32(head);
            t.walkPos = 0;
            return 1;
        }
        // Rule off, or too few compliant bids for a median to mean anything: the cheapest compliant bid is the reference.
        t.lowestValidPrice = head == 0 ? 0 : bids[head - 1].price;
        return 3;
    }

    /// Stage 1: walk the price order to its middle and take the median compliant price.
    function _walkToMedian(Tender storage t, Bid[] storage bids, uint256 budget) private returns (uint256 stage, uint256 left) {
        uint256 count = t.compliantCount;
        uint256 middle = (count - 1) / 2;
        uint256 node = t.walkNode;
        uint256 pos = t.walkPos;
        while (pos < middle && budget != 0) {
            node = bids[node - 1].next;
            pos++;
            budget--;
        }
        stage = 1;
        if (pos == middle) {
            // An even count takes the mean of the two middle prices, rounded down.
            uint256 median = bids[node - 1].price;
            if (count % 2 == 0) median = (median + bids[bids[node - 1].next - 1].price) / 2;
            t.medianPrice = uint128(median);
            node = t.head;
            stage = 2;
        }
        t.walkNode = uint32(node);
        t.walkPos = uint32(pos);
        left = budget;
    }

    /// Stage 2: bids below the floor form a prefix of the price order. The first bid that is not below
    /// it is the reference price. The upper half is never below the floor, so this always finds one.
    function _skipAbnormallyLow(Tender storage t, Bid[] storage bids, uint256 budget) private returns (uint256 stage, uint256 left) {
        uint256 threshold = uint256(t.medianPrice) * t.abnormalFloorBps;
        uint256 node = t.walkNode;
        stage = 2;
        while (budget != 0) {
            uint128 price = bids[node - 1].price;
            if (uint256(price) * 10_000 >= threshold) {
                t.lowestValidPrice = price;
                stage = 3;
                break;
            }
            node = bids[node - 1].next;
            budget--;
        }
        t.walkNode = uint32(node);
        left = budget;
    }

    /// Stage 3: score bids in bid order and keep the best. Returns true once the tender is awarded or ended.
    function _scoreBids(Tender storage t, Bid[] storage bids, Context memory ctx, uint256 budget) private returns (bool) {
        uint256 total = bids.length;
        uint256 cursor = t.scoreCursor;
        while (cursor < total && budget != 0) {
            Bid storage b = bids[cursor];
            if (b.opened && !b.disqualified) {
                if (!_score(t, b, cursor, ctx)) {
                    _end(ctx.id, t, "The rule circuit did not return a valid result.");
                    return true;
                }
                if (b.eligible) {
                    uint256 best = t.best;
                    // Bids are visited in order, so an equal score and price never displaces an earlier bid.
                    if (best == 0 || b.score > t.bestScore || (b.score == t.bestScore && b.price < bids[best - 1].price)) {
                        t.best = uint32(cursor + 1);
                        t.bestScore = b.score;
                    }
                }
            }
            cursor++;
            budget--;
        }
        t.scoreCursor = uint32(cursor);
        if (cursor < total) return false;
        if (t.best == 0) {
            _end(ctx.id, t, "No bid was eligible.");
            return true;
        }
        t.stage = 0;
        t.recomputing = false;
        t.awardedAt = uint64(block.timestamp);
        t.awardedBlock = uint64(block.number);
        t.standstillEnd = uint64(block.timestamp) + t.standstill;
        emit Awarded(ctx.id, t.best - 1, t.bestScore, t.generation);
        return true;
    }

    /// Band one bid, ask the rule circuit for its outcome and store it. Returns false if the circuit
    /// did not answer with a valid result.
    function _score(Tender storage t, Bid storage b, uint256 index, Context memory ctx) private returns (bool) {
        uint256 input = _band(t, b, index, ctx);
        b.ruleInput = uint16(input);
        (bool ok, uint256 word) = _ask(ctx.circuits, t.ruleId, input);
        if (!ok) return false;
        bool eligible = word & 1 == 1;
        b.eligible = eligible;
        b.score = eligible ? uint8(word >> 1) : 0;
        b.scoredIn = t.generation + 1;
        return true;
    }

    /// The 11 bits a rule circuit sees for one bid.
    function _band(Tender storage t, Bid storage b, uint256 index, Context memory ctx) private returns (uint256 input) {
        uint32 c = b.compliance;
        bool mandatory = c & t.mandatoryMask == t.mandatoryMask;
        // medianPrice is non-zero only when the abnormally-low rule applied to this computation.
        bool low = mandatory && t.medianPrice != 0 && uint256(b.price) * 10_000 < uint256(t.medianPrice) * t.abnormalFloorBps;
        b.abnormallyLow = low;
        // An abnormally low bid is not penalised: it gets price band 0. It is just not the reference.
        input = low ? 0 : _priceBand(b.price, t.lowestValidPrice, t.priceLadderBps);
        uint256 delivery = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (b.deliveryDays > t.deliveryLadderDays[i]) delivery++;
        }
        input |= delivery << 3;
        if (mandatory) input |= 1 << 5;
        if (t.preferredAMask != 0 && c & t.preferredAMask == t.preferredAMask) input |= 1 << 6;
        if (t.preferredBMask != 0 && c & t.preferredBMask == t.preferredBMask) input |= 1 << 7;
        if (t.panelSize != 0) {
            uint256 median = ctx.panel.medianOf(ctx.id, index);
            b.panelMedian = uint8(median);
            input |= ((median * 8) / (PANEL_SCORE_MAX + 1)) << 8;
        }
    }

    /// Call the rule circuit with a fixed amount of gas and accept only a well-formed answer:
    /// exactly one byte holding five bits.
    function _ask(ITapeOutCircuits circuits, uint256 ruleId, uint256 input) private view returns (bool ok, uint256 word) {
        // Refuse to start without the gas, so a caller cannot make a healthy circuit look broken by sending too little.
        if (gasleft() < EVAL_GAS + EVAL_GAS / 32 + 60_000) revert NotEnoughGas();
        bytes memory packed = new bytes(2);
        packed[0] = bytes1(uint8(input));
        packed[1] = bytes1(uint8(input >> 8));
        (bool success, bytes memory ret) = address(circuits).staticcall{gas: EVAL_GAS}(abi.encodeCall(ITapeOutCircuits.eval, (ruleId, packed)));
        // ABI-encoded bytes of length 1: offset 32, length 1, one data word.
        if (!success || ret.length != 96) return (false, 0);
        uint256 offset;
        uint256 length;
        assembly {
            offset := mload(add(ret, 32))
            length := mload(add(ret, 64))
            word := byte(0, mload(add(ret, 96)))
        }
        ok = offset == 32 && length == 1 && word <= 31;
    }

    function _priceBand(uint128 price, uint128 lowest, uint24[7] storage ladder) private view returns (uint256 band) {
        if (lowest == 0) return 7;
        uint256 scaled = uint256(price) * 10_000;
        for (uint256 i = 0; i < 7; i++) {
            if (scaled > uint256(lowest) * (10_000 + ladder[i])) band++;
        }
    }

    /// End the tender from inside the computation, with a public reason and no canceller.
    function _end(uint256 id, Tender storage t, string memory reason) private returns (uint256) {
        t.cancelled = true;
        t.cancelledBy = address(0);
        t.cancelReason = Blob.put(bytes(reason));
        t.endedAt = uint64(block.timestamp);
        t.endedBlock = uint64(block.number);
        emit Cancelled(id, address(0));
        return 0;
    }
}
