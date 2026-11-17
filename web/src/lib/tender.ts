// Everything about one tender, read from the three contracts. Text, documents and ciphertexts are
// stored as contract code, so none of this depends on a node keeping old logs.
import { hexToBytes, sha256, toHex, type Address, type Hex } from 'viem';
import { DEPLOYMENT, gavelockAbi, isDeployed, tenderPanelAbi, tenderRecordsAbi, type LiveDeployment } from '@gavelock/core';
import { publicClient } from './client.ts';
import { PHASES, readTerms, type PhaseName, type TenderTerms } from './tenders.ts';

export function live(): LiveDeployment {
  if (!isDeployed(DEPLOYMENT)) throw new Error('The Gavelock contracts have not been deployed yet.');
  return DEPLOYMENT;
}

const utf8 = new TextDecoder();
const toText = (hex: Hex) => utf8.decode(hexToBytes(hex));

async function readText(pointer: Address): Promise<string> {
  const d = live();
  return toText(await publicClient.readContract({ address: d.records, abi: tenderRecordsAbi, functionName: 'read', args: [pointer] }));
}

export interface BidRecord {
  index: number;
  bidder: Address;
  sealedBlock: bigint;
  /** Block the bid was opened in; 0 while it is still sealed. */
  openedBlock: bigint;
  commitment: Hex;
  ciphertext: Address;
  opened: boolean;
  disqualified: boolean;
  claimed: boolean;
  price: bigint;
  deliveryDays: number;
  compliance: number;
  eligible: boolean;
  abnormallyLow: boolean;
  score: number;
  panelMedian: number;
  ruleInput: number;
  note: string | null;
  recipient: Address | null;
  /** Size of the sealed ciphertext stored on chain, in bytes. */
  ciphertextBytes: number;
}

export interface QuestionRecord {
  index: number;
  asker: Address;
  askedBlock: bigint;
  text: string;
  answer: string | null;
  answeredBlock: bigint;
}

export interface DocumentRecord {
  index: number;
  name: string;
  contentType: string;
  size: number;
  received: number;
  sha256Hash: Hex;
  completedBlock: bigint;
  chunks: Address[];
}

export interface ChallengeRecord {
  index: number;
  challenger: Address;
  bidIndex: number;
  kind: number;
  ruling: number;
  filedBlock: bigint;
  ruledBlock: bigint;
  reason: string;
  rulingReason: string | null;
  bondPaid: boolean;
}

export interface TenderDetail {
  id: bigint;
  phase: PhaseName;
  raw: Awaited<ReturnType<typeof readRaw>>;
  terms: TenderTerms | null;
  panel: Address[];
  /** Where each panel member is: nothing yet, committed, or revealed. In seat order. */
  panelStatus: { address: Address; committed: boolean; revealed: boolean }[];
  bids: BidRecord[];
  documents: DocumentRecord[];
  questions: QuestionRecord[];
  challenges: ChallengeRecord[];
  cancelReason: string | null;
}

async function readRaw(id: bigint) {
  const d = live();
  return publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'getTender', args: [id] });
}

export async function readTender(id: bigint): Promise<TenderDetail | null> {
  const d = live();
  const count = await publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'tenderCount' });
  if (id >= count) return null;
  const [raw, phase, bidCount, challengeCount, documentCount, questionCount] = await Promise.all([
    readRaw(id),
    publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'phaseOf', args: [id] }),
    publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'bidCount', args: [id] }),
    publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'challengeCount', args: [id] }),
    publicClient.readContract({ address: d.records, abi: tenderRecordsAbi, functionName: 'documentCount', args: [id] }),
    publicClient.readContract({ address: d.records, abi: tenderRecordsAbi, functionName: 'questionCount', args: [id] }),
  ]);
  const range = (n: bigint) => Array.from({ length: Number(n) }, (_, i) => BigInt(i));
  const [panel, bidRows, docRows, qRows, cRows, terms] = await Promise.all([
    raw.panelSize ? publicClient.readContract({ address: d.panel, abi: tenderPanelAbi, functionName: 'panelOf', args: [id] }) : Promise.resolve([] as readonly Address[]),
    publicClient.multicall({ allowFailure: false, contracts: range(bidCount).map((i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'getBid', args: [id, i] }) as const) }),
    publicClient.multicall({ allowFailure: false, contracts: range(documentCount).map((i) => ({ address: d.records, abi: tenderRecordsAbi, functionName: 'getDocument', args: [id, i] }) as const) }),
    publicClient.multicall({ allowFailure: false, contracts: range(questionCount).map((i) => ({ address: d.records, abi: tenderRecordsAbi, functionName: 'getQuestion', args: [id, i] }) as const) }),
    publicClient.multicall({ allowFailure: false, contracts: range(challengeCount).map((i) => ({ address: d.tenders, abi: gavelockAbi, functionName: 'getChallenge', args: [id, i] }) as const) }),
    readTerms(raw.terms),
  ]);

  const bids: BidRecord[] = await Promise.all(
    bidRows.map(async (b, index) => ({
      index,
      bidder: b.bidder,
      sealedBlock: b.sealedBlock,
      openedBlock: b.openedBlock,
      commitment: b.commitment,
      ciphertext: b.ciphertext,
      opened: b.opened,
      disqualified: b.disqualified,
      claimed: b.claimed,
      price: b.price,
      deliveryDays: b.deliveryDays,
      compliance: b.compliance,
      eligible: b.eligible,
      abnormallyLow: b.abnormallyLow,
      score: b.score,
      panelMedian: b.panelMedian,
      ruleInput: b.ruleInput,
      note: b.note === '0x0000000000000000000000000000000000000000' ? null : await readText(b.note).catch(() => null),
      recipient: null,
      ciphertextBytes: await publicClient.getCode({ address: b.ciphertext }).then((c) => Math.max(0, ((c?.length ?? 2) - 2) / 2 - 1)).catch(() => 0),
    })),
  );
  const documents: DocumentRecord[] = docRows.map((x, index) => ({ index, name: x.name, contentType: x.contentType, size: x.size, received: x.received, sha256Hash: x.sha256Hash, completedBlock: x.completedBlock, chunks: [...x.chunks] }));
  const questions: QuestionRecord[] = await Promise.all(
    qRows.map(async (q, index) => ({ index, asker: q.asker, askedBlock: q.askedBlock, text: await readText(q.text).catch(() => '(unreadable)'), answer: q.answeredBlock !== 0n ? await readText(q.answer).catch(() => '(unreadable)') : null, answeredBlock: q.answeredBlock })),
  );
  const challenges: ChallengeRecord[] = await Promise.all(
    cRows.map(async (c, index) => ({ index, challenger: c.challenger, bidIndex: c.bidIndex, kind: c.kind, ruling: c.ruling, bondPaid: c.bondPaid, filedBlock: c.filedBlock, ruledBlock: c.ruledBlock, reason: await readText(c.reason).catch(() => '(unreadable)'), rulingReason: c.ruling !== 0 ? await readText(c.rulingReason).catch(() => '(unreadable)') : null })),
  );
  const cancelReason = raw.cancelled ? await readText(raw.cancelReason).catch(() => null) : null;
  const memberRows = panel.length
    ? await publicClient.multicall({ allowFailure: false, contracts: panel.map((m) => ({ address: d.panel, abi: tenderPanelAbi, functionName: 'memberOf', args: [id, m] }) as const) })
    : [];
  const panelStatus = panel.map((address, i) => ({ address, committed: memberRows[i]!.committedBlock !== 0n, revealed: memberRows[i]!.revealedBlock !== 0n }));
  return { id, phase: PHASES[Number(phase)] ?? 'Published', raw, terms, panel: [...panel], panelStatus, bids, documents, questions, challenges, cancelReason };
}

/** Download every chunk of a document and check it against the SHA-256 recorded on chain. */
export async function fetchDocument(doc: DocumentRecord): Promise<{ bytes: Uint8Array; verified: boolean }> {
  const d = live();
  const parts = await Promise.all(doc.chunks.map((c) => publicClient.readContract({ address: d.records, abi: tenderRecordsAbi, functionName: 'read', args: [c] })));
  const bytes = new Uint8Array(doc.size);
  let offset = 0;
  for (const part of parts) {
    const chunk = hexToBytes(part);
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, verified: offset === doc.size && sha256(toHex(bytes)) === doc.sha256Hash };
}

/** The ciphertext bytes of a bid, as stored in contract code. */
export async function fetchCiphertext(pointer: Address): Promise<Uint8Array> {
  const d = live();
  return hexToBytes(await publicClient.readContract({ address: d.tenders, abi: gavelockAbi, functionName: 'read', args: [pointer] }));
}
