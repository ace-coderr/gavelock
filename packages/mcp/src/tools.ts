// The five read-only tools. Each takes a Reader and returns plain JSON, so they can be tested with a
// stand-in reader and reused by anything else that wants the same answers.
import { isAddress, type Address } from 'viem';
import { computeAward, medianScore, unpackBanded, unpackOutcome, type OpenedBid } from '@gavelock/core';
import { PHASES, type Reader } from './reader.ts';

/** JSON cannot carry bigint: whole numbers beyond 2^53 go out as decimal strings. */
export function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
}

const ZERO = '0x0000000000000000000000000000000000000000';

function summary(id: bigint, raw: any, phase: string) {
  return {
    id,
    phase,
    kind: raw.quick ? 'quick quote' : 'full tender',
    buyer: raw.buyer,
    ruleCircuit: raw.ruleId,
    biddingStart: Number(raw.biddingStart),
    deadline: Number(raw.deadline),
    bidsOpened: raw.openedCount,
    winnerBid: raw.awardedAt !== 0n && raw.best !== 0 ? raw.best : null,
  };
}

export async function listTenders(reader: Reader, offset: number, limit: number) {
  const total = await reader.tenderCount();
  const items = [];
  for (let i = BigInt(offset); i < BigInt(offset + limit) && i < total; i++) {
    const id = total - 1n - i;
    const { raw, phase } = await reader.tender(id);
    let title: string | null = null;
    try {
      title = (JSON.parse(await reader.text(raw.terms)) as { title?: string }).title ?? null;
    } catch {
      title = null;
    }
    items.push({ ...summary(id, raw, phase), title });
  }
  return plain({ total, offset, items });
}

export async function getTender(reader: Reader, id: bigint) {
  if (id >= (await reader.tenderCount())) return plain({ found: false });
  const { raw, phase } = await reader.tender(id);
  const [bids, challenges, terms] = await Promise.all([reader.bids(id), reader.challenges(id), reader.text(raw.terms).catch(() => null)]);
  let parsedTerms: unknown = null;
  try {
    parsedTerms = terms ? JSON.parse(terms) : null;
  } catch {
    parsedTerms = null;
  }
  return plain({
    found: true,
    ...summary(id, raw, phase),
    terms: parsedTerms,
    drandRound: raw.drandRound,
    bidDepositWei: raw.bidDeposit,
    abnormalFloorBps: raw.abnormalFloorBps,
    checklist: { items: raw.checklistItems, mandatoryMask: raw.mandatoryMask, preferredAMask: raw.preferredAMask, preferredBMask: raw.preferredBMask },
    ladders: { priceBps: raw.priceLadderBps, deliveryDays: raw.deliveryLadderDays },
    cancelled: raw.cancelled,
    final: raw.closed,
    award: raw.awardedAt === 0n ? null : { winnerBid: raw.best, score: raw.bestScore, medianCompliantPrice: raw.medianPrice, referencePrice: raw.lowestValidPrice, awardedBlock: raw.awardedBlock, recomputedTimes: raw.generation },
    bids: bids.map((b, i) => ({
      bid: i + 1,
      bidder: b.bidder,
      commitment: b.commitment,
      sealedBlock: b.sealedBlock,
      state: b.disqualified ? 'disqualified' : b.opened ? 'opened' : 'sealed',
      ...(b.opened ? { price: b.price, deliveryDays: b.deliveryDays, complianceMask: b.compliance, ruleInput: b.ruleInput, eligible: b.eligible, abnormallyLowPrice: b.abnormallyLow, score: b.score, panelMedian: b.panelMedian } : {}),
    })),
    challenges: challenges.map((c, i) => ({ challenge: i + 1, bid: c.bidIndex + 1, kind: c.kind === 0 ? 'false compliance claim' : 'seal mismatch', ruling: ['pending', 'upheld', 'rejected'][c.ruling] })),
  });
}

export async function getRuleTruthTable(reader: Reader, circuitId: number) {
  const [shape, words] = await Promise.all([reader.circuitShape(circuitId), reader.truthTable(circuitId)]);
  const answered = words.filter((w) => w !== null).length;
  let eligible = 0;
  for (const w of words) if (w !== null && unpackOutcome(w).eligible) eligible++;
  return plain({
    circuit: circuitId,
    shape,
    inputsAnswered: answered,
    inputsTotal: words.length,
    eligibleCases: eligible,
    layout: 'input bit 0-2 price band, 3-4 delivery band, 5 mandatory met, 6 first preferred group, 7 second preferred group, 8-10 panel band; output bit 0 eligible, bits 1-4 score',
    // One hex digit pair per input in input order: byte i is the output for input i, or "ff" where the chain gave no valid answer.
    table: words.map((w) => (w === null ? 'ff' : w.toString(16).padStart(2, '0'))).join(''),
  });
}

/**
 * Re-derive an award from the chain's own opened bids and revealed panel scores, with the reference
 * implementation, and compare it with what the contract stored. Only meaningful once an award exists.
 */
export async function verifyAward(reader: Reader, id: bigint) {
  if (id >= (await reader.tenderCount())) return plain({ found: false });
  const { raw, phase } = await reader.tender(id);
  if (raw.awardedAt === 0n && !raw.closed) return plain({ found: true, phase, verified: null, reason: 'No award has been computed for this tender yet.' });
  const [bids, scores, words] = await Promise.all([reader.bids(id), reader.revealedScores(id, raw.panelSize), reader.truthTable(raw.ruleId)]);
  if (words.some((w) => w === null)) return plain({ found: true, phase, verified: false, reason: 'The rule circuit did not answer every input, so the award cannot be re-derived.' });

  const opened: OpenedBid[] = bids
    .map((b, index) => ({ b, index }))
    .filter(({ b }) => b.opened)
    .map(({ b, index }) => ({ index, price: b.price, deliveryDays: b.deliveryDays, compliance: b.compliance, disqualified: b.disqualified, panelMedian: scores.length ? medianScore(scores.map((s) => s[index]!)) : null }));
  const award = computeAward(
    opened,
    { priceBps: raw.priceLadderBps.map(Number), deliveryDays: raw.deliveryLadderDays.map(Number) },
    { items: raw.checklistItems, mandatoryMask: raw.mandatoryMask, preferredAMask: raw.preferredAMask, preferredBMask: raw.preferredBMask },
    Uint8Array.from(words as number[]),
    raw.abnormalFloorBps,
  );

  const differences: string[] = [];
  const chainWinner = raw.best === 0 ? null : raw.best - 1;
  if (chainWinner !== award.winner) differences.push(`winner: the contract says ${chainWinner === null ? 'none' : `bid ${chainWinner + 1}`}, the reference computes ${award.winner === null ? 'none' : `bid ${award.winner + 1}`}`);
  if (raw.lowestValidPrice !== (award.lowestValidPrice ?? 0n)) differences.push(`reference price: contract ${raw.lowestValidPrice}, reference ${award.lowestValidPrice ?? 0n}`);
  if (raw.medianPrice !== (award.medianPrice ?? 0n)) differences.push(`median price: contract ${raw.medianPrice}, reference ${award.medianPrice ?? 0n}`);
  for (const s of award.scored) {
    const c = bids[s.index];
    if (c.ruleInput !== s.input) differences.push(`bid ${s.index + 1}: rule input ${c.ruleInput} on chain, ${s.input} computed`);
    else if (c.score !== s.outcome.score || c.eligible !== s.outcome.eligible) differences.push(`bid ${s.index + 1}: outcome differs`);
    if (c.abnormallyLow !== s.abnormallyLow) differences.push(`bid ${s.index + 1}: abnormally-low flag differs`);
  }
  return plain({
    found: true,
    phase,
    verified: differences.length === 0,
    differences,
    reference: { winnerBid: award.winner === null ? null : award.winner + 1, ranking: award.ranking.map((i) => i + 1), compliantBids: award.compliantBids, medianCompliantPrice: award.medianPrice, referencePrice: award.lowestValidPrice, flaggedAbnormallyLow: award.scored.filter((s) => s.abnormallyLow).map((s) => s.index + 1), bandedInputs: award.scored.map((s) => ({ bid: s.index + 1, banded: unpackBanded(s.input) })) },
    note: 'Computed locally from the chain’s opened bids, revealed panel scores and the rule circuit’s own truth table. A bid that was never opened takes no part.',
  });
}

export async function getSupplierPassport(reader: Reader, address: string) {
  if (!isAddress(address)) throw new Error(`${address} is not an address.`);
  const entries = await reader.bidsBy(address as Address);
  const history = [];
  const totals = { bids: entries.length, opened: 0, won: 0, disqualified: 0, unopenedForfeits: 0 };
  for (const { tenderId, bidIndex } of entries) {
    const { raw, phase } = await reader.tender(tenderId);
    const bids = await reader.bids(tenderId);
    const b = bids[Number(bidIndex)]!;
    const won = raw.awardedAt !== 0n && raw.best !== 0 && raw.best - 1 === Number(bidIndex) && raw.closed;
    if (b.opened) totals.opened++;
    if (won) totals.won++;
    if (b.disqualified) totals.disqualified++;
    if (!b.opened && (raw.closed || raw.cancelled) && raw.openedCount > 0) totals.unopenedForfeits++;
    history.push({ tender: tenderId, bid: Number(bidIndex) + 1, phase, state: b.disqualified ? 'disqualified' : b.opened ? 'opened' : 'sealed', won, ...(b.opened ? { price: b.price, deliveryDays: b.deliveryDays, score: b.score } : {}) });
  }
  return plain({ address, totals, history, note: 'Only what the contract records: bids, openings, disqualifications and final awards. It says nothing about work delivered.' });
}

export const _internal = { ZERO, PHASES };
