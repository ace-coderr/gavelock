// Reference award computation. This is the specification the tender contract's finalize() is tested
// against, and what the app and the MCP server use to re-derive an award independently.
//
// 1. The compliant bids are those that were opened, are not disqualified and claim every mandatory item.
// 2. If the tender's abnormally-low rule is on and there are at least three compliant bids, the median
//    compliant price is taken, and every compliant bid below `floor` of it is flagged abnormally low.
// 3. The reference price is the lowest compliant price that is not abnormally low. A bid that fails the
//    checklist, or a single absurd lowball, cannot drag everyone else's price band.
// 4. Each opened, non-disqualified bid is banded and scored by the tender's rule. An abnormally low
//    bid stays eligible and gets price band 0.
// 5. Eligible bids are ranked by score (higher first), then price (lower first), then bid index
//    (earlier first). The index is unique, so the order is total and no tie is left to anyone's choice.
//
// Every step is a function of the set of bids, never of the order they are processed in. That is what
// makes a paged finalize() safe.

import { abnormalRuleApplies, bandBid, isAbnormallyLow, medianPrice, meetsMandatory, validateAbnormalFloor, type Checklist, type Ladders } from './banding.ts';
import { INPUT_SPACE, packBanded, unpackOutcome, type Banded, type Outcome } from './rule/layout.ts';
import type { TruthTable } from './rule/spec.ts';

export interface OpenedBid {
  /** Position in the tender's bid list: the order commitments arrived in. */
  index: number;
  price: bigint;
  deliveryDays: number;
  compliance: number;
  /** Set by an upheld challenge. */
  disqualified: boolean;
  /** Median of revealed panel scores, 0..100. Null in Quick Quote. */
  panelMedian: number | null;
}

export interface ScoredBid {
  index: number;
  price: bigint;
  banded: Banded;
  /** The 11-bit word given to the rule. */
  input: number;
  outcome: Outcome;
  /** Compliant, and priced below the tender's floor of the median compliant price. */
  abnormallyLow: boolean;
}

export interface Award {
  /** Number of opened, non-disqualified bids that claim every mandatory item. */
  compliantBids: number;
  /** Median compliant price, or null when the abnormally-low rule did not apply. */
  medianPrice: bigint | null;
  /** The reference for price bands. Null when no bid is compliant. */
  lowestValidPrice: bigint | null;
  /** Every opened, non-disqualified bid, in bid order. */
  scored: ScoredBid[];
  /** Bid indices of eligible bids, best first. */
  ranking: number[];
  /** Null when no bid is eligible. */
  winner: number | null;
}

/** Is `a` ranked ahead of `b`? */
export function ranksAhead(a: Pick<ScoredBid, 'outcome' | 'price' | 'index'>, b: Pick<ScoredBid, 'outcome' | 'price' | 'index'>): boolean {
  if (a.outcome.score !== b.outcome.score) return a.outcome.score > b.outcome.score;
  if (a.price !== b.price) return a.price < b.price;
  return a.index < b.index;
}

export function isCompliant(bid: OpenedBid, checklist: Checklist): boolean {
  return !bid.disqualified && meetsMandatory(bid.compliance, checklist);
}

/**
 * The compliant bids in the order the contract keeps them: by price, then by bid index.
 * The contract maintains exactly this list as bids are opened.
 */
export function compliantOrder(bids: readonly OpenedBid[], checklist: Checklist): OpenedBid[] {
  return bids.filter((b) => isCompliant(b, checklist)).sort((a, b) => (a.price !== b.price ? (a.price < b.price ? -1 : 1) : a.index - b.index));
}

/**
 * The hint to pass when opening a compliant bid: the index + 1 of the compliant bid that comes
 * immediately before it in price order, or 0 if it becomes the first. The contract accepts any
 * earlier position and walks forward, so a slightly stale hint only costs gas; a wrong one reverts.
 */
export function openingHint(alreadyOpened: readonly OpenedBid[], bid: Pick<OpenedBid, 'index' | 'price'>, checklist: Checklist): number {
  let hint = 0;
  for (const other of compliantOrder(alreadyOpened, checklist)) {
    if (other.price < bid.price || (other.price === bid.price && other.index < bid.index)) hint = other.index + 1;
    else break;
  }
  return hint;
}

export interface PriceReference {
  compliantBids: number;
  medianPrice: bigint | null;
  lowestValidPrice: bigint | null;
  /** Indices of the abnormally low bids. */
  abnormallyLow: Set<number>;
}

/** Steps 1 to 3: the median, the flags and the reference price. */
export function priceReference(bids: readonly OpenedBid[], checklist: Checklist, abnormalFloorBps: number): PriceReference {
  const problems = validateAbnormalFloor(abnormalFloorBps);
  if (problems.length > 0) throw new RangeError(problems.join(' '));
  const order = compliantOrder(bids, checklist);
  const abnormallyLow = new Set<number>();
  if (order.length === 0) return { compliantBids: 0, medianPrice: null, lowestValidPrice: null, abnormallyLow };
  if (!abnormalRuleApplies(order.length, abnormalFloorBps)) {
    return { compliantBids: order.length, medianPrice: null, lowestValidPrice: order[0]!.price, abnormallyLow };
  }
  const median = medianPrice(order.map((b) => b.price));
  for (const b of order) if (isAbnormallyLow(b.price, median, abnormalFloorBps)) abnormallyLow.add(b.index);
  // The upper half of the bids is at or above the median, so at least one bid is never flagged.
  const reference = order.find((b) => !abnormallyLow.has(b.index))!;
  return { compliantBids: order.length, medianPrice: median, lowestValidPrice: reference.price, abnormallyLow };
}

export function computeAward(bids: readonly OpenedBid[], ladders: Ladders, checklist: Checklist, rule: TruthTable, abnormalFloorBps: number): Award {
  if (rule.length !== INPUT_SPACE) throw new RangeError('a rule table has 2,048 entries');
  const indices = new Set(bids.map((b) => b.index));
  if (indices.size !== bids.length) throw new Error('duplicate bid index');

  const reference = priceReference(bids, checklist, abnormalFloorBps);
  const scored: ScoredBid[] = [];
  for (const bid of [...bids].sort((a, b) => a.index - b.index)) {
    if (bid.disqualified) continue;
    const abnormallyLow = reference.abnormallyLow.has(bid.index);
    const banded = bandBid(bid, reference.lowestValidPrice ?? 0n, ladders, checklist, abnormallyLow);
    const input = packBanded(banded);
    scored.push({ index: bid.index, price: bid.price, banded, input, outcome: unpackOutcome(rule[input]!), abnormallyLow });
  }
  const eligible = scored.filter((s) => s.outcome.eligible).sort((a, b) => (ranksAhead(a, b) ? -1 : 1));
  const ranking = eligible.map((s) => s.index);
  return {
    compliantBids: reference.compliantBids,
    medianPrice: reference.medianPrice,
    lowestValidPrice: reference.lowestValidPrice,
    scored,
    ranking,
    winner: ranking[0] ?? null,
  };
}
