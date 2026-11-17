import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LADDERS,
  STARTER_RULES,
  bandBid,
  computeAward,
  deliveryBand,
  priceReference,
  medianScore,
  meetsMandatory,
  panelBand,
  priceBand,
  ranksAhead,
  truthTable,
  validateChecklist,
  validateLadders,
  type Checklist,
  type OpenedBid,
} from '../src/index.ts';

const checklist: Checklist = { items: 5, mandatoryMask: 0b00011, preferredAMask: 0b00100, preferredBMask: 0b11000 };
const [lowestPrice, price60, quality70, fastest] = STARTER_RULES.map((r) => truthTable(r.spec)) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

const bid = (index: number, price: bigint, over: Partial<OpenedBid> = {}): OpenedBid => ({
  index,
  price,
  deliveryDays: 10,
  compliance: 0b00011,
  disqualified: false,
  panelMedian: 50,
  ...over,
});

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe('ladders and checklist', () => {
  it('accepts the defaults and rejects malformed ladders', () => {
    expect(validateLadders(DEFAULT_LADDERS)).toEqual([]);
    expect(validateLadders({ ...DEFAULT_LADDERS, priceBps: [0, 250, 500] })).toHaveLength(1);
    expect(validateLadders({ ...DEFAULT_LADDERS, priceBps: [0, 250, 250, 1000, 1500, 2500, 4000] })).toHaveLength(1);
    expect(validateLadders({ ...DEFAULT_LADDERS, deliveryDays: [30, 14, 7] })).toHaveLength(1);
    expect(validateLadders({ priceBps: [0, 1, 2, 3, 4, 5, 1_000_001], deliveryDays: [1, 2, 4000] })).toHaveLength(2);
  });

  it('validates checklists', () => {
    expect(validateChecklist(checklist)).toEqual([]);
    expect(validateChecklist({ items: 0, mandatoryMask: 0, preferredAMask: 0, preferredBMask: 0 })).toEqual([]);
    expect(validateChecklist({ items: 32, mandatoryMask: 0xffff_ffff, preferredAMask: 0, preferredBMask: 0 })).toEqual([]);
    expect(validateChecklist({ ...checklist, items: 33 })).toHaveLength(1);
    expect(validateChecklist({ ...checklist, mandatoryMask: 0b100000 })).toHaveLength(1); // item 5 of a 5-item list
    expect(validateChecklist({ ...checklist, preferredAMask: 0b00001 })).toHaveLength(1); // overlaps mandatory
  });
});

describe('banding', () => {
  const ladder = DEFAULT_LADDERS.priceBps;

  it('bands price relative to the lowest valid price, with exact boundaries', () => {
    expect(priceBand(1000n, 1000n, ladder)).toBe(0);
    expect(priceBand(1001n, 1000n, ladder)).toBe(1); // above the lowest
    expect(priceBand(1025n, 1000n, ladder)).toBe(1); // exactly +2.5% is not above the step
    expect(priceBand(1026n, 1000n, ladder)).toBe(2);
    expect(priceBand(1050n, 1000n, ladder)).toBe(2);
    expect(priceBand(1100n, 1000n, ladder)).toBe(3);
    expect(priceBand(1150n, 1000n, ladder)).toBe(4);
    expect(priceBand(1250n, 1000n, ladder)).toBe(5);
    expect(priceBand(1400n, 1000n, ladder)).toBe(6);
    expect(priceBand(1401n, 1000n, ladder)).toBe(7);
    expect(priceBand(10n ** 30n, 1000n, ladder)).toBe(7);
  });

  it('does not round: a one-unit difference on a huge price is seen', () => {
    const lowest = 2n ** 120n;
    expect(priceBand(lowest, lowest, ladder)).toBe(0);
    expect(priceBand(lowest + 1n, lowest, ladder)).toBe(1);
  });

  it('puts every bid in the last band when there is no valid price', () => {
    expect(priceBand(5n, 0n, ladder)).toBe(7);
  });

  it('bands delivery and panel scores', () => {
    expect([0, 7, 8, 14, 15, 30, 31, 400].map((d) => deliveryBand(d, DEFAULT_LADDERS.deliveryDays))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect([0, 12, 13, 25, 26, 50, 51, 88, 89, 100].map(panelBand)).toEqual([0, 0, 1, 1, 2, 3, 4, 6, 7, 7]);
    expect(() => panelBand(101)).toThrow(RangeError);
    expect(() => panelBand(49.5)).toThrow(RangeError);
  });

  it('takes the median of revealed scores', () => {
    expect(medianScore([70])).toBe(70);
    expect(medianScore([90, 10, 50])).toBe(50);
    expect(medianScore([10, 20])).toBe(15);
    expect(medianScore([10, 21])).toBe(15); // rounds down
    expect(medianScore([100, 0, 60, 80])).toBe(70);
    expect(() => medianScore([])).toThrow(RangeError);
  });

  it('reads the checklist groups', () => {
    expect(meetsMandatory(0b00011, checklist)).toBe(true);
    expect(meetsMandatory(0b00001, checklist)).toBe(false);
    expect(meetsMandatory(0, { items: 0, mandatoryMask: 0, preferredAMask: 0, preferredBMask: 0 })).toBe(true);
    const b = bandBid({ price: 1000n, deliveryDays: 10, compliance: 0b01111, panelMedian: 89 }, 1000n, DEFAULT_LADDERS, checklist);
    expect(b).toEqual({ price: 0, delivery: 1, mandatory: true, preferredA: true, preferredB: false, panel: 7 });
    // A group needs all of its items; an unused group is never earned; no panel means band 0.
    expect(bandBid({ price: 1000n, deliveryDays: 0, compliance: 0b11011, panelMedian: null }, 1000n, DEFAULT_LADDERS, checklist)).toMatchObject({ preferredA: false, preferredB: true, panel: 0 });
    expect(bandBid({ price: 1n, deliveryDays: 0, compliance: 0xffff_ffff, panelMedian: null }, 1n, DEFAULT_LADDERS, { items: 2, mandatoryMask: 3, preferredAMask: 0, preferredBMask: 0 })).toMatchObject({ preferredA: false, preferredB: false });
  });
});

describe('award', () => {
  it('awards the lowest compliant price', () => {
    const award = computeAward([bid(0, 1200n), bid(1, 1000n), bid(2, 1100n)], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(award.lowestValidPrice).toBe(1000n);
    expect(award.ranking).toEqual([1, 2, 0]);
    expect(award.winner).toBe(1);
  });

  it('ignores a non-compliant low price when banding everyone else', () => {
    const bids = [bid(0, 1n, { compliance: 0b00001 }), bid(1, 1000n), bid(2, 1300n)];
    const award = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(priceReference(bids, checklist, 0).lowestValidPrice).toBe(1000n);
    expect(award.winner).toBe(1);
    expect(award.ranking).toEqual([1, 2]);
    expect(award.scored.find((s) => s.index === 0)!.outcome).toEqual({ eligible: false, score: 0 });
    expect(award.scored.find((s) => s.index === 1)!.banded.price).toBe(0);
  });

  it('breaks a score tie by lower price, then by earlier bid', () => {
    // 1000 and 1020 share price band 1 relative to 990... make all three share a band: within 2.5% of the lowest.
    const sameBand = computeAward([bid(0, 1010n), bid(1, 1005n), bid(2, 1000n, { compliance: 0 })], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(sameBand.lowestValidPrice).toBe(1005n);
    expect(sameBand.scored.map((s) => s.outcome.score)).toEqual([13, 15, 0]);
    const tie = computeAward([bid(0, 1010n), bid(1, 1005n), bid(2, 1001n)], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(tie.scored.map((s) => s.outcome.score)).toEqual([13, 13, 15]);
    expect(tie.ranking).toEqual([2, 1, 0]); // 1005 beats 1010 at the same score
    const identical = computeAward([bid(4, 1000n), bid(2, 1000n), bid(9, 1000n)], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(identical.ranking).toEqual([2, 4, 9]); // same score and price: the earlier bid wins
  });

  it('weighs quality against price', () => {
    const bids = [bid(0, 1000n, { panelMedian: 30 }), bid(1, 1300n, { panelMedian: 95 })];
    expect(computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, 0).winner).toBe(0);
    expect(computeAward(bids, DEFAULT_LADDERS, checklist, price60, 0).winner).toBe(0);
    expect(computeAward(bids, DEFAULT_LADDERS, checklist, quality70, 0).winner).toBe(1);
  });

  it('awards the fastest delivery in Quick Quote, price breaking ties', () => {
    const quotes = [bid(0, 900n, { deliveryDays: 20, panelMedian: null }), bid(1, 1500n, { deliveryDays: 5, panelMedian: null }), bid(2, 1400n, { deliveryDays: 6, panelMedian: null })];
    const award = computeAward(quotes, DEFAULT_LADDERS, checklist, fastest, 0);
    expect(award.ranking).toEqual([2, 1, 0]);
  });

  it('recomputes without a disqualified bid', () => {
    const bids = [bid(0, 1000n), bid(1, 1200n), bid(2, 1210n)];
    expect(computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, 0).winner).toBe(0);
    const after = computeAward([{ ...bids[0]!, disqualified: true }, bids[1]!, bids[2]!], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(after.lowestValidPrice).toBe(1200n);
    expect(after.winner).toBe(1);
    expect(after.scored.map((s) => s.index)).toEqual([1, 2]);
    expect(after.scored[0]!.banded.price).toBe(0); // re-banded against the new lowest price
  });

  it('handles zero bids, one bid and no eligible bid', () => {
    expect(computeAward([], DEFAULT_LADDERS, checklist, lowestPrice, 0)).toEqual({ compliantBids: 0, medianPrice: null, lowestValidPrice: null, scored: [], ranking: [], winner: null });
    expect(computeAward([bid(3, 500n)], DEFAULT_LADDERS, checklist, lowestPrice, 0).winner).toBe(3);
    const none = computeAward([bid(0, 500n, { compliance: 0 }), bid(1, 600n, { compliance: 0b00010 })], DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(none.lowestValidPrice).toBeNull();
    expect(none.winner).toBeNull();
    expect(none.scored).toHaveLength(2);
    expect(computeAward([bid(0, 500n, { disqualified: true })], DEFAULT_LADDERS, checklist, lowestPrice, 0).winner).toBeNull();
  });

  it('rejects duplicate indices and wrong-sized tables', () => {
    expect(() => computeAward([bid(1, 1n), bid(1, 2n)], DEFAULT_LADDERS, checklist, lowestPrice, 0)).toThrow();
    expect(() => computeAward([], DEFAULT_LADDERS, checklist, new Uint8Array(10), 0)).toThrow(RangeError);
  });

  it('gives the same award whatever order the bids are processed in', () => {
    const next = rng(2026);
    for (let trial = 0; trial < 200; trial++) {
      const count = 1 + (next() % 12);
      const bids: OpenedBid[] = Array.from({ length: count }, (_, index) =>
        bid(index, BigInt(1000 + (next() % 6) * 40), {
          deliveryDays: next() % 40,
          compliance: next() % 5 === 0 ? 0b00001 : 0b00011 | ((next() % 8) << 2),
          disqualified: next() % 9 === 0,
          panelMedian: next() % 101,
        }),
      );
      const table = [lowestPrice, price60, quality70, fastest][next() % 4]!;
      const reference = computeAward(bids, DEFAULT_LADDERS, checklist, table, 0);
      const shuffled = [...bids].sort(() => (next() % 2 === 0 ? 1 : -1));
      expect(computeAward(shuffled, DEFAULT_LADDERS, checklist, table, 0)).toEqual(reference);
      // The ranking is a strict total order: every adjacent pair is decided, never equal.
      const byIndex = new Map(reference.scored.map((s) => [s.index, s]));
      for (let i = 1; i < reference.ranking.length; i++) {
        const a = byIndex.get(reference.ranking[i - 1]!)!;
        const b = byIndex.get(reference.ranking[i]!)!;
        expect(ranksAhead(a, b)).toBe(true);
        expect(ranksAhead(b, a)).toBe(false);
      }
      // The winner found by folding over the bids one at a time, in any order, is the same.
      let best = null as (typeof reference.scored)[number] | null;
      for (const s of [...reference.scored].sort(() => (next() % 2 === 0 ? 1 : -1))) {
        if (s.outcome.eligible && (best === null || ranksAhead(s, best))) best = s;
      }
      expect(best?.index ?? null).toBe(reference.winner);
    }
  });
});
