// The Audit Pack: everything a donor or auditor needs to check a tender, built in the browser from the
// chain. Transaction hashes are recovered by reading the logs of the one block each record names.
import { parseEventLogs, type Address, type Hash } from 'viem';
import { XLAYER, explorerTx, gavelockAbi, tenderRecordsAbi } from '@gavelock/core';
import { publicClient } from './client.ts';
import { live, type TenderDetail } from './tender.ts';
import { buildPdf, type PdfBlock } from './pdf.ts';

async function txHashOf(address: Address, block: bigint, abi: readonly unknown[], eventName: string, match: (args: Record<string, unknown>) => boolean): Promise<Hash | null> {
  if (block === 0n) return null;
  try {
    // The node limits log queries to 100 blocks; one block is always allowed.
    const logs = await publicClient.getLogs({ address, fromBlock: block, toBlock: block });
    const parsed = parseEventLogs({ abi: abi as never, logs, eventName: eventName as never }) as unknown as { args: Record<string, unknown>; transactionHash: Hash }[];
    return parsed.find((l) => match(l.args))?.transactionHash ?? null;
  } catch {
    return null;
  }
}

export interface AuditPack {
  generatedAt: string;
  chain: { id: number; name: string };
  contracts: { tenders: Address; panel: Address; records: Address };
  tender: Record<string, unknown>;
  documents: unknown[];
  bids: unknown[];
  challenges: unknown[];
  award: Record<string, unknown>;
  note: string;
}

export async function buildAuditPack(t: TenderDetail): Promise<AuditPack> {
  const d = live();
  const r = t.raw;
  const id = t.id;
  const [createdTx, awardedTx, endedTx] = await Promise.all([
    txHashOf(d.tenders, r.createdBlock, gavelockAbi, 'TenderCreated', (a) => a.tenderId === id),
    txHashOf(d.tenders, r.awardedBlock, gavelockAbi, 'Awarded', (a) => a.tenderId === id),
    txHashOf(d.tenders, r.endedBlock, gavelockAbi, r.cancelled ? 'Cancelled' : 'Finalized', (a) => a.tenderId === id),
  ]);
  const documents = await Promise.all(t.documents.map(async (doc) => ({ version: doc.index + 1, name: doc.name, contentType: doc.contentType, bytes: doc.size, sha256: doc.sha256Hash, block: doc.completedBlock.toString(), transaction: await txHashOf(d.records, doc.completedBlock, tenderRecordsAbi, 'DocumentPublished', (a) => a.tenderId === id && a.index === BigInt(doc.index)) })));
  const bids = await Promise.all(
    t.bids.map(async (b) => ({
      bid: b.index + 1, bidder: b.bidder, commitment: b.commitment, ciphertextContract: b.ciphertext, sealedBlock: b.sealedBlock.toString(),
      sealedTransaction: await txHashOf(d.tenders, b.sealedBlock, gavelockAbi, 'BidSealed', (a) => a.tenderId === id && a.index === BigInt(b.index)),
      opened: b.opened, disqualified: b.disqualified,
      ...(b.opened ? { price: b.price.toString(), deliveryDays: b.deliveryDays, complianceMask: b.compliance, note: b.note, ruleInput: b.ruleInput, eligible: b.eligible, abnormallyLowPrice: b.abnormallyLow, score: b.score, panelMedian: b.panelMedian } : {}),
    })),
  );
  const challenges = t.challenges.map((c) => ({ challenge: c.index + 1, bid: c.bidIndex + 1, kind: c.kind === 0 ? 'false compliance claim' : 'seal mismatch', filedBlock: c.filedBlock.toString(), reason: c.reason, ruling: ['pending', 'upheld', 'rejected'][c.ruling], rulingReason: c.rulingReason }));
  return {
    generatedAt: new Date().toISOString(),
    chain: { id: XLAYER.id, name: XLAYER.name },
    contracts: { tenders: d.tenders, panel: d.panel, records: d.records },
    tender: {
      id: id.toString(), title: t.terms?.title ?? null, phase: t.phase, buyer: r.buyer, quick: r.quick, ruleCircuit: { processor: d.processor, id: r.ruleId },
      createdBlock: r.createdBlock.toString(), createdTransaction: createdTx, biddingStart: Number(r.biddingStart), deadline: Number(r.deadline), drandRound: r.drandRound.toString(),
      bidDepositWei: r.bidDeposit.toString(), abnormalFloorBps: r.abnormalFloorBps, panel: t.panel, terms: t.terms, cancelReason: t.cancelReason,
    },
    documents, bids, challenges,
    award: { winnerBid: r.best === 0 ? null : r.best, score: r.best === 0 ? null : r.bestScore, medianCompliantPrice: r.medianPrice.toString(), referencePrice: r.lowestValidPrice.toString(), generation: r.generation, awardedBlock: r.awardedBlock.toString(), awardedTransaction: awardedTx, endedBlock: r.endedBlock.toString(), endedTransaction: endedTx },
    note: 'Built in the browser from X Layer. Check any figure yourself: every block number above can be looked up on the explorer, and every document hash is the SHA-256 the contract computed from the stored bytes.',
  };
}

export function packToPdf(p: AuditPack): Uint8Array {
  const tx = (h: unknown) => (typeof h === 'string' ? explorerTx(h) : 'not found in the block logs');
  const blocks: PdfBlock[] = [
    { text: 'Gavelock Audit Pack', size: 20, bold: true },
    { text: `${p.tender.title ?? `Tender ${p.tender.id}`}  |  tender ${p.tender.id}  |  ${p.tender.phase}`, size: 12, bold: true },
    { text: `Generated ${p.generatedAt} on ${p.chain.name} (chain ${p.chain.id}).` },
    { text: `Tender contract ${p.contracts.tenders}\nRecords contract ${p.contracts.records}\nPanel contract ${p.contracts.panel}` },
    { text: 'Tender', size: 13, bold: true },
    { text: `Buyer ${p.tender.buyer}\nRule circuit #${(p.tender.ruleCircuit as { id: number }).id} on processor ${(p.tender.ruleCircuit as { processor: string }).processor}\nCreated in block ${p.tender.createdBlock}: ${tx(p.tender.createdTransaction)}\nDeadline ${new Date(Number(p.tender.deadline) * 1000).toISOString()}, drand round ${p.tender.drandRound}\nBid deposit ${p.tender.bidDepositWei} wei. Abnormally-low floor ${p.tender.abnormalFloorBps} basis points of the median.` },
    { text: 'Documents', size: 13, bold: true },
    ...(p.documents.length === 0 ? [{ text: 'None.' }] : (p.documents as Record<string, unknown>[]).map((x) => ({ text: `Version ${x.version}: ${x.name} (${x.bytes} bytes)\nSHA-256 ${x.sha256}\nBlock ${x.block}: ${tx(x.transaction)}` }))),
    { text: 'Bids', size: 13, bold: true },
    ...(p.bids.length === 0 ? [{ text: 'None.' }] : (p.bids as Record<string, unknown>[]).map((x) => ({ text: `Bid ${x.bid} by ${x.bidder}\nCommitment ${x.commitment}\nSealed in block ${x.sealedBlock}: ${tx(x.sealedTransaction)}\n${x.opened ? `Opened: price ${x.price}, delivery ${x.deliveryDays} days, claims ${x.complianceMask}, rule input ${x.ruleInput}, eligible ${x.eligible}, score ${x.score}, panel median ${x.panelMedian}${x.abnormallyLowPrice ? ', ABNORMALLY LOW PRICE' : ''}${x.disqualified ? ', DISQUALIFIED' : ''}` : 'Not opened.'}` }))),
    { text: 'Challenges', size: 13, bold: true },
    ...(p.challenges.length === 0 ? [{ text: 'None.' }] : (p.challenges as Record<string, unknown>[]).map((x) => ({ text: `Challenge ${x.challenge} against bid ${x.bid} (${x.kind}): ${x.reason}\nRuling: ${x.ruling}${x.rulingReason ? ` - ${x.rulingReason}` : ''}` }))),
    { text: 'Award', size: 13, bold: true },
    { text: `Winner: ${p.award.winnerBid === null ? 'none' : `bid ${p.award.winnerBid} with score ${p.award.score}`}\nMedian compliant price ${p.award.medianCompliantPrice}, reference price ${p.award.referencePrice}. Recomputed ${p.award.generation} time(s).\nAwarded in block ${p.award.awardedBlock}: ${tx(p.award.awardedTransaction)}\nEnded in block ${p.award.endedBlock}: ${tx(p.award.endedTransaction)}` },
    { text: p.note, size: 9 },
  ];
  return buildPdf(blocks);
}
