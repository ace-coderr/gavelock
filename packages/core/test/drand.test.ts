import { describe, expect, it } from 'vitest';
import { QUICKNET, latestRoundAt, roundAtOrAfter, roundTime } from '../src/index.ts';

describe('drand round arithmetic', () => {
  it('matches a round observed on the network', () => {
    // Round 34,005,040 was published at 2026-11-16T08:41:24Z (spike/out/tlock-node.json).
    const published = Date.UTC(2026, 10, 16, 8, 41, 24) / 1000;
    expect(roundTime(34_005_040)).toBe(published);
    expect(roundAtOrAfter(published)).toBe(34_005_040);
    expect(latestRoundAt(published)).toBe(34_005_040);
  });

  it('rounds a deadline up, never down', () => {
    const t = roundTime(1000);
    expect(roundAtOrAfter(t)).toBe(1000);
    expect(roundAtOrAfter(t + 1)).toBe(1001);
    expect(roundAtOrAfter(t + 2)).toBe(1001);
    expect(roundAtOrAfter(t + 3)).toBe(1001);
    expect(roundAtOrAfter(t + 4)).toBe(1002);
  });

  it('never returns a round that is already public before the deadline', () => {
    for (let t = QUICKNET.genesis + 1; t < QUICKNET.genesis + 500; t++) {
      const round = roundAtOrAfter(t);
      expect(roundTime(round)).toBeGreaterThanOrEqual(t);
      expect(roundTime(round) - t).toBeLessThan(QUICKNET.period);
      expect(latestRoundAt(t - 1)).toBeLessThan(round);
    }
  });

  it('handles the edges', () => {
    expect(roundTime(1)).toBe(QUICKNET.genesis);
    expect(roundAtOrAfter(QUICKNET.genesis)).toBe(1);
    expect(roundAtOrAfter(0)).toBe(1);
    expect(latestRoundAt(QUICKNET.genesis - 1)).toBe(0);
    expect(() => roundTime(0)).toThrow(RangeError);
    expect(() => roundAtOrAfter(1.5)).toThrow(RangeError);
  });
});
