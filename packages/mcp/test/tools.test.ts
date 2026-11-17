import { describe, expect, it } from 'vitest';
import { DEFAULT_LADDERS, STARTER_RULES, computeAward, truthTable, type OpenedBid } from '@gavelock/core';
import { getSupplierPassport, getTender, getRuleTruthTable, listTenders, plain, verifyAward } from '../src/tools.ts';
import type { Reader } from '../src/reader.ts';

const ruleTable = truthTable(STARTER_RULES[0]!.spec); // lowest compliant price
const CHECKLIST = { items: 5, mandatoryMask: 0b00011, preferredAMask: 0b00100, preferredBMask: 0b11000 };
const bidder = (n: number) => `0x${(n + 1).toString(16).padStart(40, '0')}` as `0x${string}`;

// Four opened bids and one fake lowball. The "chain" values are produced by the reference award, then optionally tampered with.
const plan: OpenedBid[] = [
  { index: 0, price: 100_000n, deliveryDays: 10, compliance: 0b00011, disqualified: false, panelMedian: null },
  { index: 1, price: 105_000n, deliveryDays: 10, compliance: 0b00011, disqualified: false, panelMedian: null },
  { index: 2, price: 130_000n, deliveryDays: 10, compliance: 0b00011, disqualified: false, panelMedian: null },
  { index: 3, price: 1n, deliveryDays: 10, compliance: 0b00011, disqualified: false, panelMedian: null },
];

function fakeReader(tamper?: (raw: any, bids: any[]) => void): Reader {
  const award = computeAward(plan, DEFAULT_LADDERS, CHECKLIST, ruleTable, 7000);
  const bids = plan.map((p) => {
    const s = award.scored.find((x) => x.index === p.index)!;
    return { bidder: bidder(p.index), commitment: '0x' + '11'.repeat(32), sealedBlock: 5n, opened: true, disqualified: false, price: p.price, deliveryDays: p.deliveryDays, compliance: p.compliance, ruleInput: s.input, eligible: s.outcome.eligible, abnormallyLow: s.abnormallyLow, score: s.outcome.score, panelMedian: 0 };
  });
  const raw: any = {
    buyer: bidder(99), quick: false, ruleId: 1, biddingStart: 1000n, deadline: 2000n, openedCount: 4, awardedAt: 3000n, best: (award.winner ?? 0) + 1, bestScore: 15, closed: true, cancelled: false,
    terms: bidder(50), drandRound: 7n, bidDeposit: 5n, abnormalFloorBps: 7000, checklistItems: 5, mandatoryMask: 3, preferredAMask: 4, preferredBMask: 24,
    priceLadderBps: [...DEFAULT_LADDERS.priceBps], deliveryLadderDays: [...DEFAULT_LADDERS.deliveryDays], medianPrice: award.medianPrice ?? 0n, lowestValidPrice: award.lowestValidPrice ?? 0n,
    awardedBlock: 9n, generation: 0, panelSize: 0,
  };
  tamper?.(raw, bids);
  return {
    deployed: () => true,
    deployment: {} as never,
    tenderCount: async () => 1n,
    tender: async () => ({ raw, phase: 'Final' }),
    text: async () => JSON.stringify({ title: 'Solar lanterns', currency: 'USD' }),
    bids: async () => bids,
    revealedScores: async () => [],
    challenges: async () => [],
    bidsBy: async () => [{ tenderId: 0n, bidIndex: 3n }],
    tendersBy: async () => [0n],
    truthTable: async () => [...ruleTable],
    circuitShape: async () => ({ nIn: 11, nOut: 5, nState: 0, gateCount: 15 }),
  } as unknown as Reader;
}

describe('read-only tools', () => {
  it('lists tenders with their titles', async () => {
    const out = (await listTenders(fakeReader(), 0, 10)) as any;
    expect(out.total).toBe('1');
    expect(out.items[0]).toMatchObject({ id: '0', title: 'Solar lanterns', phase: 'Final', winnerBid: 4 });
  });

  it('describes one tender, and says when there is none', async () => {
    const out = (await getTender(fakeReader(), 0n)) as any;
    expect(out).toMatchObject({ found: true, abnormalFloorBps: 7000, final: true });
    expect(out.bids).toHaveLength(4);
    expect(out.bids[3]).toMatchObject({ state: 'opened', abnormallyLowPrice: true });
    expect(out.terms.title).toBe('Solar lanterns');
    expect(await getTender(fakeReader(), 5n)).toEqual({ found: false });
  });

  it('serialises a rule truth table every client can read', async () => {
    const out = (await getRuleTruthTable(fakeReader(), 1)) as any;
    expect(out.inputsTotal).toBe(2048);
    expect(out.inputsAnswered).toBe(2048);
    expect(out.table).toHaveLength(4096);
    expect(parseInt(out.table.slice(2 * 0x120, 2 * 0x120 + 2), 16)).toBe(ruleTable[0x120]);
  });

  it('verifies an award that is correct', async () => {
    const out = (await verifyAward(fakeReader(), 0n)) as any;
    expect(out).toMatchObject({ verified: true, differences: [] });
    expect(out.reference.winnerBid).toBe(4); // the abnormally low bid ties the best real one on score and wins on price
    expect(out.reference.flaggedAbnormallyLow).toEqual([4]);
  });

  it('catches an award that was tampered with', async () => {
    const wrongWinner = (await verifyAward(fakeReader((raw) => { raw.best = 3; }), 0n)) as any;
    expect(wrongWinner.verified).toBe(false);
    expect(wrongWinner.differences[0]).toMatch(/winner/);
    const wrongBand = (await verifyAward(fakeReader((_, bids) => { bids[1].ruleInput = 0; }), 0n)) as any;
    expect(wrongBand.verified).toBe(false);
    expect(wrongBand.differences.join(' ')).toMatch(/bid 2/);
    const wrongReference = (await verifyAward(fakeReader((raw) => { raw.lowestValidPrice = 1n; }), 0n)) as any;
    expect(wrongReference.verified).toBe(false);
  });

  it('does not pretend to verify a tender with no award', async () => {
    const out = (await verifyAward(fakeReader((raw) => { raw.awardedAt = 0n; raw.closed = false; }), 0n)) as any;
    expect(out.verified).toBeNull();
  });

  it('builds a supplier passport from the contract’s own records', async () => {
    const out = (await getSupplierPassport(fakeReader(), bidder(3))) as any;
    expect(out.totals).toMatchObject({ bids: 1, opened: 1, won: 1 });
    expect(out.history[0]).toMatchObject({ tender: '0', bid: 4, won: true });
    await expect(getSupplierPassport(fakeReader(), 'not an address')).rejects.toThrow(/not an address/);
  });

  it('turns bigint into strings and leaves everything else alone', () => {
    expect(plain({ a: 1n, b: [2n, 'x', null], c: { d: true } })).toEqual({ a: '1', b: ['2', 'x', null], c: { d: true } });
  });
});
