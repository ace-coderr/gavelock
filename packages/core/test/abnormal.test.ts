import { describe, expect, it } from 'vitest';
import {
  ABNORMAL_FLOOR_DEFAULT_BPS,
  DEFAULT_LADDERS,
  STARTER_RULES,
  abnormalRuleApplies,
  compliantOrder,
  computeAward,
  isAbnormallyLow,
  medianPrice,
  openingHint,
  priceReference,
  truthTable,
  validateAbnormalFloor,
  type Checklist,
  type OpenedBid,
} from '../src/index.ts';

const checklist: Checklist = { items: 5, mandatoryMask: 0b00011, preferredAMask: 0b00100, preferredBMask: 0b11000 };
const [lowestPrice, price60] = STARTER_RULES.map((r) => truthTable(r.spec)) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
const FLOOR = ABNORMAL_FLOOR_DEFAULT_BPS;

const bid = (index: number, price: bigint, over: Partial<OpenedBid> = {}): OpenedBid => ({
  index,
  price,
  deliveryDays: 10,
  compliance: 0b00011,
  disqualified: false,
  panelMedian: 50,
  ...over,
});
const bands = (award: ReturnType<typeof computeAward>) => Object.fromEntries(award.scored.map((s) => [s.index, s.banded.price]));
const flagged = (award: ReturnType<typeof computeAward>) => award.scored.filter((s) => s.abnormallyLow).map((s) => s.index);

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

describe('median price and the floor', () => {
  it('takes the median the same way as the panel median', () => {
    expect(medianPrice([700n])).toBe(700n);
    expect(medianPrice([1100n, 900n, 1000n])).toBe(1000n);
    expect(medianPrice([900n, 1000n])).toBe(950n);
    expect(medianPrice([900n, 1001n])).toBe(950n); // rounds down
    expect(medianPrice([5n, 5n, 5n, 5n])).toBe(5n);
    expect(medianPrice([2n ** 127n, 2n ** 127n + 3n])).toBe(2n ** 127n + 1n); // no overflow, no float
    expect(() => medianPrice([])).toThrow(RangeError);
  });

  it('flags strictly below the floor, never on it', () => {
    expect(isAbnormallyLow(700n, 1000n, 7000)).toBe(false); // exactly 70%
    expect(isAbnormallyLow(699n, 1000n, 7000)).toBe(true); // one unit below
    expect(isAbnormallyLow(701n, 1000n, 7000)).toBe(false);
    // The comparison is exact where a division would round: 70% of 1001 is 700.7.
    expect(isAbnormallyLow(700n, 1001n, 7000)).toBe(true);
    expect(isAbnormallyLow(701n, 1001n, 7000)).toBe(false);
    expect(isAbnormallyLow(1n, 1000n, 0)).toBe(false);
  });

  it('applies from three compliant bids and only when switched on', () => {
    expect(abnormalRuleApplies(1, FLOOR)).toBe(false);
    expect(abnormalRuleApplies(2, FLOOR)).toBe(false);
    expect(abnormalRuleApplies(3, FLOOR)).toBe(true);
    expect(abnormalRuleApplies(50, 0)).toBe(false);
    expect(validateAbnormalFloor(0)).toEqual([]);
    expect(validateAbnormalFloor(7000)).toEqual([]);
    expect(validateAbnormalFloor(10_000)).toEqual([]);
    expect(validateAbnormalFloor(10_001)).toHaveLength(1);
    expect(validateAbnormalFloor(-1)).toHaveLength(1);
    expect(validateAbnormalFloor(70.5)).toHaveLength(1);
    expect(() => computeAward([], DEFAULT_LADDERS, checklist, lowestPrice, 10_001)).toThrow(RangeError);
  });
});

describe('the abnormally low bid rule', () => {
  const real = [bid(0, 100_000n, { panelMedian: 30 }), bid(1, 105_000n, { panelMedian: 60 }), bid(2, 130_000n, { panelMedian: 95 })];
  const fake = bid(3, 1n, { panelMedian: 0 });

  it('without the rule, one fake lowball flattens every real price band and changes the winner', () => {
    const honest = computeAward(real, DEFAULT_LADDERS, checklist, price60, 0);
    const attacked = computeAward([...real, fake], DEFAULT_LADDERS, checklist, price60, 0);
    expect(honest.winner).toBe(0);
    expect(bands(honest)).toEqual({ 0: 0, 1: 2, 2: 6 });
    expect(bands(attacked)).toMatchObject({ 0: 7, 1: 7, 2: 7 }); // price no longer distinguishes the real bids
    expect(attacked.ranking.filter((i) => i !== 3)[0]).toBe(2); // among the real bids the expensive one now leads
  });

  it('with the rule, the fake lowball changes neither the real bids’ bands nor the winner', () => {
    const honest = computeAward(real, DEFAULT_LADDERS, checklist, price60, FLOOR);
    const defended = computeAward([...real, fake], DEFAULT_LADDERS, checklist, price60, FLOOR);
    expect(defended.medianPrice).toBe(102_500n);
    expect(flagged(defended)).toEqual([3]);
    expect(defended.lowestValidPrice).toBe(100_000n);
    expect(defended.lowestValidPrice).toBe(honest.lowestValidPrice);
    for (const s of honest.scored) {
      const after = defended.scored.find((d) => d.index === s.index)!;
      expect(after.banded).toEqual(s.banded);
      expect(after.outcome).toEqual(s.outcome);
    }
    expect(defended.winner).toBe(honest.winner);
    expect(defended.winner).toBe(0);
  });

  it('does not remove the flagged bid: it stays eligible, in price band 0, with a public flag', () => {
    const award = computeAward([...real, fake], DEFAULT_LADDERS, checklist, price60, FLOOR);
    const low = award.scored.find((s) => s.index === 3)!;
    expect(low.abnormallyLow).toBe(true);
    expect(low.outcome.eligible).toBe(true);
    expect(low.banded.price).toBe(0);
    expect(award.ranking).toContain(3);
    // On a pure price rule it ties the best real bid on score and wins the tie on price: flagged, not excluded.
    expect(computeAward([...real, fake], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR).winner).toBe(3);
  });

  it('lets a genuinely cheaper bid just above the floor set the reference price', () => {
    const bids = [bid(0, 1000n), bid(1, 1000n), bid(2, 1100n), bid(3, 720n)];
    const award = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(award.medianPrice).toBe(1000n);
    expect(flagged(award)).toEqual([]);
    expect(award.lowestValidPrice).toBe(720n);
    expect(award.winner).toBe(3);
    expect(bands(award)[0]).toBe(6); // 1000 is 38.9% above 720
  });

  it('draws the line exactly on the floor', () => {
    const on = computeAward([bid(0, 1000n), bid(1, 1000n), bid(2, 1000n), bid(3, 700n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(flagged(on)).toEqual([]);
    expect(on.lowestValidPrice).toBe(700n);
    const below = computeAward([bid(0, 1000n), bid(1, 1000n), bid(2, 1000n), bid(3, 699n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(flagged(below)).toEqual([3]);
    expect(below.lowestValidPrice).toBe(1000n);
  });

  it('is skipped with one or two compliant bids', () => {
    const one = computeAward([bid(0, 1n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(one).toMatchObject({ compliantBids: 1, medianPrice: null, lowestValidPrice: 1n });
    const two = computeAward([bid(0, 1n), bid(1, 1000n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(two).toMatchObject({ compliantBids: 2, medianPrice: null, lowestValidPrice: 1n });
    expect(flagged(two)).toEqual([]);
    // A third bid that is not compliant does not count towards the three.
    const twoPlus = computeAward([bid(0, 1n), bid(1, 1000n), bid(2, 1000n, { compliance: 0 })], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(twoPlus).toMatchObject({ compliantBids: 2, medianPrice: null, lowestValidPrice: 1n });
  });

  it('applies with three bids, and with even and odd counts', () => {
    const three = computeAward([bid(0, 1n), bid(1, 1000n), bid(2, 1100n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(three).toMatchObject({ compliantBids: 3, medianPrice: 1000n, lowestValidPrice: 1000n });
    expect(flagged(three)).toEqual([0]);
    const four = computeAward([bid(0, 1n), bid(1, 1000n), bid(2, 1100n), bid(3, 1200n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(four).toMatchObject({ compliantBids: 4, medianPrice: 1050n, lowestValidPrice: 1000n });
    const five = computeAward([bid(0, 1n), bid(1, 2n), bid(2, 1100n), bid(3, 1200n), bid(4, 1300n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(five).toMatchObject({ compliantBids: 5, medianPrice: 1100n, lowestValidPrice: 1100n });
    expect(flagged(five)).toEqual([0, 1]);
  });

  it('flags nothing when every price is equal', () => {
    const award = computeAward([bid(0, 500n), bid(1, 500n), bid(2, 500n), bid(3, 500n)], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(flagged(award)).toEqual([]);
    expect(award).toMatchObject({ medianPrice: 500n, lowestValidPrice: 500n, winner: 0 });
  });

  it('is off when the floor is 0, and strictest at 10,000', () => {
    const bids = [bid(0, 1n), bid(1, 1000n), bid(2, 1100n), bid(3, 1200n)];
    const off = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, 0);
    expect(off).toMatchObject({ medianPrice: null, lowestValidPrice: 1n });
    expect(flagged(off)).toEqual([]);
    const strict = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, 10_000);
    expect(strict.medianPrice).toBe(1050n);
    expect(flagged(strict)).toEqual([0, 1]); // everything below the median
    expect(strict.lowestValidPrice).toBe(1100n);
  });

  it('never flags a bid that fails the checklist, and never counts it', () => {
    const bids = [bid(0, 1n, { compliance: 0b00001 }), bid(1, 1000n), bid(2, 1050n), bid(3, 1100n)];
    const award = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(award).toMatchObject({ compliantBids: 3, medianPrice: 1050n, lowestValidPrice: 1000n });
    expect(flagged(award)).toEqual([]);
    expect(award.scored[0]!.outcome.eligible).toBe(false);
  });

  it('recomputes the median, the flags and the reference when a bid is disqualified', () => {
    const bids = [bid(0, 650n), bid(1, 900n), bid(2, 1000n), bid(3, 1100n)];
    const before = computeAward(bids, DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(before).toMatchObject({ medianPrice: 950n, lowestValidPrice: 900n });
    expect(flagged(before)).toEqual([0]); // 650 < 70% of 950 = 665
    const after = computeAward([bids[0]!, bids[1]!, bids[2]!, { ...bids[3]!, disqualified: true }], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(after).toMatchObject({ compliantBids: 3, medianPrice: 900n, lowestValidPrice: 650n });
    expect(flagged(after)).toEqual([]); // 650 >= 70% of 900 = 630
    expect(bands(after)[1]).toBe(6); // 900 is now 38% above the reference
    // Dropping to two compliant bids switches the rule off altogether.
    const two = computeAward([bids[0]!, bids[1]!, { ...bids[2]!, disqualified: true }, { ...bids[3]!, disqualified: true }], DEFAULT_LADDERS, checklist, lowestPrice, FLOOR);
    expect(two).toMatchObject({ compliantBids: 2, medianPrice: null, lowestValidPrice: 650n });
  });

  it('always leaves a reference price: the upper half is never flagged', () => {
    const next = rng(99);
    for (let trial = 0; trial < 300; trial++) {
      const count = 3 + (next() % 10);
      const bids = Array.from({ length: count }, (_, i) => bid(i, BigInt(1 + (next() % 5000))));
      for (const floor of [1, 5000, 7000, 9999, 10_000]) {
        const ref = priceReference(bids, checklist, floor);
        expect(ref.lowestValidPrice).not.toBeNull();
        expect(ref.abnormallyLow.size).toBeLessThanOrEqual(Math.floor(count / 2));
        // The reference is the cheapest unflagged compliant bid, and every flagged bid is cheaper than it.
        const unflagged = bids.filter((b) => !ref.abnormallyLow.has(b.index)).map((b) => b.price);
        expect(ref.lowestValidPrice).toBe(unflagged.reduce((a, b) => (a < b ? a : b)));
        for (const i of ref.abnormallyLow) expect(bids[i]!.price).toBeLessThan(ref.lowestValidPrice!);
      }
    }
  });

  it('gives the same award whatever order the bids are processed in', () => {
    const next = rng(4242);
    for (let trial = 0; trial < 200; trial++) {
      const count = 1 + (next() % 12);
      const bids = Array.from({ length: count }, (_, i) =>
        bid(i, BigInt(next() % 7 === 0 ? 1 + (next() % 50) : 900 + (next() % 8) * 50), {
          compliance: next() % 6 === 0 ? 0b00001 : 0b00011,
          disqualified: next() % 10 === 0,
          panelMedian: next() % 101,
        }),
      );
      const floor = [0, 5000, 7000, 10_000][next() % 4]!;
      const reference = computeAward(bids, DEFAULT_LADDERS, checklist, price60, floor);
      const shuffled = [...bids].sort(() => (next() % 2 === 0 ? 1 : -1));
      expect(computeAward(shuffled, DEFAULT_LADDERS, checklist, price60, floor)).toEqual(reference);
    }
  });
});

describe('the price order the contract keeps', () => {
  const bids = [bid(0, 1000n), bid(1, 900n), bid(2, 1000n), bid(3, 5n, { compliance: 0 }), bid(4, 950n, { disqualified: true }), bid(5, 1200n)];

  it('lists compliant bids by price, then by bid index', () => {
    expect(compliantOrder(bids, checklist).map((b) => b.index)).toEqual([1, 0, 2, 5]);
  });

  it('gives the predecessor as the opening hint', () => {
    const opened = [bids[0]!, bids[1]!, bids[5]!];
    expect(openingHint(opened, { index: 2, price: 1000n }, checklist)).toBe(1); // after bid 0 (same price, lower index)
    expect(openingHint(opened, { index: 7, price: 800n }, checklist)).toBe(0); // becomes the first
    expect(openingHint(opened, { index: 7, price: 900n }, checklist)).toBe(2); // after bid 1
    expect(openingHint(opened, { index: 7, price: 5000n }, checklist)).toBe(6); // after bid 5
    expect(openingHint([], { index: 0, price: 1n }, checklist)).toBe(0);
  });
});
