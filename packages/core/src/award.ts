// Reference award computation. This is the specification the tender contract's finalize() is tested
// against, and what the app and the MCP server use to re-derive an award independently.
//
// 1. The lowest valid price is the lowest price among bids that were opened, are not disqualified and
//    claim every mandatory item. A bid that fails the checklist cannot drag everyone else's price band.
// 2. Each opened, non-disqualified bid is banded and scored by the tender's rule.
// 3. Eligible bids are ranked by score (higher first), then price (lower first), then bid index
//    (earlier first). The index is unique, so the order is total and no tie is left to anyone's choice.
//
// Because step 3 is a total order, the winner does not depend on the order or grouping in which bids
// are processed. That is what makes a paged finalize() safe.

import { bandBid, meetsMandatory, type Checklist, type Ladders } from './banding.ts';
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
}

export interface Award {
  /** Null when no bid is valid. */
  lowestValidPrice: bigint | null;
  /** Every opened, non-disqualified bid, in bid order. */
  scored: ScoredBid[];
  /** Bid indices of eligible bids, best first. */
  ranking: number[];
  /** Null when no bid is eligible. */
  winner: number | null;
}

/** Is `a` ranked ahead of `b`? */
export function ranksAhead(a: ScoredBid, b: ScoredBid): boolean {
  if (a.outcome.score !== b.outcome.score) return a.outcome.score > b.outcome.score;
  if (a.price !== b.price) return a.price < b.price;
  return a.index < b.index;
}

export function lowestValidPrice(bids: readonly OpenedBid[], checklist: Checklist): bigint | null {
  let lowest: bigint | null = null;
  for (const bid of bids) {
    if (bid.disqualified || !meetsMandatory(bid.compliance, checklist)) continue;
    if (lowest === null || bid.price < lowest) lowest = bid.price;
  }
  return lowest;
}

export function computeAward(bids: readonly OpenedBid[], ladders: Ladders, checklist: Checklist, rule: TruthTable): Award {
  if (rule.length !== INPUT_SPACE) throw new RangeError('a rule table has 2,048 entries');
  const indices = new Set(bids.map((b) => b.index));
  if (indices.size !== bids.length) throw new Error('duplicate bid index');

  const lowest = lowestValidPrice(bids, checklist);
  const scored: ScoredBid[] = [];
  for (const bid of [...bids].sort((a, b) => a.index - b.index)) {
    if (bid.disqualified) continue;
    const banded = bandBid(bid, lowest ?? 0n, ladders, checklist);
    const input = packBanded(banded);
    scored.push({ index: bid.index, price: bid.price, banded, input, outcome: unpackOutcome(rule[input]!) });
  }
  const eligible = scored.filter((s) => s.outcome.eligible).sort((a, b) => (ranksAhead(a, b) ? -1 : 1));
  const ranking = eligible.map((s) => s.index);
  return { lowestValidPrice: lowest, scored, ranking, winner: ranking[0] ?? null };
}
