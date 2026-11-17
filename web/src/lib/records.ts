// Per-address records and independent award verification, read from the contract.
import type { Address } from 'viem';
import { DEPLOYMENT, computeAward, gavelockAbi, isDeployed, medianScore, tenderPanelAbi, type OpenedBid } from '@gavelock/core';
import { hexToBytes } from 'viem';
import { publicClient } from './client.ts';
import { readTruthTable } from './rules.ts';
import { readTender, live } from './tender.ts';

export interface PassportEntry {
  tenderId: bigint;
  bid: number;
  phase: string;
  state: 'sealed' | 'opened' | 'disqualified';
  won: boolean;
  forfeited: boolean;
}

export async function supplierPassport(address: Address) {
  const d = live();
  const count = Number(await publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'bidsOf', args: [address] }));
  const rows = (await publicClient.multicall({ allowFailure: false, contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'bidOfBidder', args: [address, BigInt(i)] }) as const) })) as readonly (readonly [bigint, bigint])[];
  const entries: PassportEntry[] = [];
  for (const [tenderId, bidIndex] of rows) {
    const t = await readTender(tenderId);
    if (!t) continue;
    const b = t.bids[Number(bidIndex)]!;
    const settled = t.raw.closed || t.raw.cancelled;
    entries.push({
      tenderId,
      bid: Number(bidIndex) + 1,
      phase: t.phase,
      state: b.disqualified ? 'disqualified' : b.opened ? 'opened' : 'sealed',
      won: t.raw.closed && t.raw.best !== 0 && t.raw.best - 1 === Number(bidIndex),
      forfeited: settled && !b.opened && t.raw.openedCount > 0,
    });
  }
  return entries;
}

export async function buyerRecord(address: Address) {
  const d = live();
  const count = Number(await publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'tendersOf', args: [address] }));
  const ids = (await publicClient.multicall({ allowFailure: false, contracts: Array.from({ length: count }, (_, i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'tenderOfBuyer', args: [address, BigInt(i)] }) as const) })) as bigint[];
  const tenders = (await Promise.all(ids.map((id) => readTender(id)))).filter((t): t is NonNullable<typeof t> => t !== null);
  const upheld = tenders.reduce((n, t) => n + t.challenges.filter((c) => c.ruling === 1).length, 0);
  const rejected = tenders.reduce((n, t) => n + t.challenges.filter((c) => c.ruling === 2).length, 0);
  return {
    tenders,
    totals: {
      tenders: tenders.length,
      final: tenders.filter((t) => t.raw.closed).length,
      cancelledByBuyer: tenders.filter((t) => t.raw.cancelled && t.raw.cancelledBy.toLowerCase() === address.toLowerCase()).length,
      endedByContract: tenders.filter((t) => t.raw.cancelled && t.raw.cancelledBy === '0x0000000000000000000000000000000000000000').length,
      challengesUpheld: upheld,
      challengesRejected: rejected,
    },
  };
}

export interface Verification {
  verified: boolean | null;
  reason?: string;
  differences: string[];
  reference?: { winner: number | null; ranking: number[]; flagged: number[]; median: bigint | null; referencePrice: bigint | null };
}

/** Re-derive a tender's award in the browser and compare it with what the contract stored. */
export async function verifyAward(tenderId: bigint, onProgress?: (done: number) => void): Promise<Verification | null> {
  const t = await readTender(tenderId);
  if (!t) return null;
  const r = t.raw;
  if (r.awardedAt === 0n && !r.closed) return { verified: null, reason: 'No award has been computed for this tender yet.', differences: [] };
  const d = live();
  const table = await readTruthTable(d.processor, r.ruleId, onProgress);
  if (table.failures.length > 0) return { verified: false, reason: 'The rule circuit did not answer every input, so the award cannot be re-derived.', differences: [] };

  let scores: number[][] = [];
  if (r.panelSize > 0) {
    const members = await publicClient.readContract({ address: d.panel, abi: tenderPanelAbi, functionName: 'panelOf', args: [tenderId] });
    const rows = await publicClient.multicall({ allowFailure: false, contracts: members.map((m) => ({ address: d.panel, abi: tenderPanelAbi, functionName: 'memberOf', args: [tenderId, m] }) as const) });
    scores = rows.filter((m) => m.revealedBlock !== 0n).map((m) => [...hexToBytes(m.scores)]);
  }
  const opened: OpenedBid[] = t.bids.filter((b) => b.opened).map((b) => ({ index: b.index, price: b.price, deliveryDays: b.deliveryDays, compliance: b.compliance, disqualified: b.disqualified, panelMedian: scores.length ? medianScore(scores.map((s) => s[b.index]!)) : null }));
  const award = computeAward(opened, { priceBps: r.priceLadderBps.map(Number), deliveryDays: r.deliveryLadderDays.map(Number) }, { items: r.checklistItems, mandatoryMask: r.mandatoryMask, preferredAMask: r.preferredAMask, preferredBMask: r.preferredBMask }, Uint8Array.from(table.words as number[]), r.abnormalFloorBps);

  const differences: string[] = [];
  const chainWinner = r.best === 0 ? null : r.best - 1;
  if (chainWinner !== award.winner) differences.push(`Winner: the contract says ${chainWinner === null ? 'none' : `bid ${chainWinner + 1}`}; the reference computes ${award.winner === null ? 'none' : `bid ${award.winner + 1}`}.`);
  if (r.lowestValidPrice !== (award.lowestValidPrice ?? 0n)) differences.push(`Reference price: contract ${r.lowestValidPrice}, reference ${award.lowestValidPrice ?? 0n}.`);
  if (r.medianPrice !== (award.medianPrice ?? 0n)) differences.push(`Median price: contract ${r.medianPrice}, reference ${award.medianPrice ?? 0n}.`);
  for (const s of award.scored) {
    const c = t.bids[s.index]!;
    if (c.ruleInput !== s.input) differences.push(`Bid ${s.index + 1}: the contract used rule input ${c.ruleInput}; the reference computes ${s.input}.`);
    else if (c.score !== s.outcome.score || c.eligible !== s.outcome.eligible) differences.push(`Bid ${s.index + 1}: the outcome differs.`);
    if (c.abnormallyLow !== s.abnormallyLow) differences.push(`Bid ${s.index + 1}: the abnormally-low flag differs.`);
  }
  return {
    verified: differences.length === 0,
    differences,
    reference: { winner: award.winner === null ? null : award.winner + 1, ranking: award.ranking.map((i) => i + 1), flagged: award.scored.filter((s) => s.abnormallyLow).map((s) => s.index + 1), median: award.medianPrice, referencePrice: award.lowestValidPrice },
  };
}

export const deployed = () => isDeployed(DEPLOYMENT);
