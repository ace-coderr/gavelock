// Reads tenders straight from the Gavelock contract, a page at a time. No server, no index.
import type { Address } from 'viem';
import { DEPLOYMENT, gavelockAbi, isDeployed } from '@gavelock/core';
import { publicClient } from './client.ts';

export const PHASES = ['Published', 'Clarifications', 'Bidding', 'Opening', 'Evaluation', 'Awarded', 'Standstill', 'Final', 'Cancelled'] as const;
export type PhaseName = (typeof PHASES)[number];

/** What each phase means, in one line, for people who have not read the docs. */
export const PHASE_HELP: Record<PhaseName, string> = {
  Published: 'Posted by the buyer; questions open soon.',
  Clarifications: 'Questions and answers. Documents can still be added.',
  Bidding: 'Everything is frozen. Sealed bids are being accepted.',
  Opening: 'The deadline has passed. Anyone can open a bid.',
  Evaluation: 'The panel scores the opened bids; then the award is computed.',
  Awarded: 'The award has just been computed.',
  Standstill: 'Open for challenges before the award becomes final.',
  Final: 'Final. Deposits can be claimed.',
  Cancelled: 'Cancelled, with a public reason.',
};

export interface TenderSummary {
  id: bigint;
  buyer: Address;
  quick: boolean;
  phase: PhaseName;
  ruleId: number;
  biddingStart: number;
  deadline: number;
  openedCount: number;
  bidDeposit: bigint;
  /** Winning bid index, or null while there is no award. */
  winner: number | null;
  termsPointer: Address;
  createdBlock: bigint;
  title: string | null;
}

export interface TenderTerms {
  title?: string;
  description?: string;
  currency?: string;
  decimals?: number;
  checklist?: string[];
}

const utf8 = new TextDecoder();

function hexToText(hex: string): string {
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return utf8.decode(bytes);
}

function liveAddress(): Address | null {
  return isDeployed(DEPLOYMENT) ? DEPLOYMENT.tenders : null;
}

/** Terms are stored as UTF-8 JSON in contract code. A tender whose terms do not parse still lists, untitled. */
export async function readTerms(pointer: Address): Promise<TenderTerms | null> {
  const address = liveAddress();
  if (!address) return null;
  try {
    const raw = await publicClient.readContract({ address, abi: gavelockAbi, functionName: 'read', args: [pointer] });
    const parsed: unknown = JSON.parse(hexToText(raw));
    return parsed && typeof parsed === 'object' ? (parsed as TenderTerms) : null;
  } catch {
    return null;
  }
}

export async function tenderCount(): Promise<bigint> {
  const address = liveAddress();
  if (!address) return 0n;
  return publicClient.readContract({ address, abi: gavelockAbi, functionName: 'tenderCount' });
}

/** Newest first. `offset` counts back from the latest tender. */
export async function listTenders(offset: number, limit: number): Promise<{ total: bigint; items: TenderSummary[] }> {
  const address = liveAddress();
  if (!address) return { total: 0n, items: [] };
  const total = await tenderCount();
  const ids: bigint[] = [];
  for (let i = BigInt(offset); i < BigInt(offset + limit) && i < total; i++) ids.push(total - 1n - i);
  if (ids.length === 0) return { total, items: [] };

  const calls = ids.flatMap((id) => [
    { address, abi: gavelockAbi, functionName: 'getTender', args: [id] } as const,
    { address, abi: gavelockAbi, functionName: 'phaseOf', args: [id] } as const,
  ]);
  const results = await publicClient.multicall({ contracts: calls, allowFailure: false });
  const items = ids.map((id, k): TenderSummary => {
    const t = results[k * 2] as {
      buyer: Address; quick: boolean; ruleId: number; biddingStart: bigint; deadline: bigint; openedCount: number;
      bidDeposit: bigint; best: number; awardedAt: bigint; terms: Address; createdBlock: bigint;
    };
    const phase = PHASES[Number(results[k * 2 + 1])] ?? 'Published';
    return {
      id,
      buyer: t.buyer,
      quick: t.quick,
      phase,
      ruleId: t.ruleId,
      biddingStart: Number(t.biddingStart),
      deadline: Number(t.deadline),
      openedCount: t.openedCount,
      bidDeposit: t.bidDeposit,
      winner: t.awardedAt !== 0n && t.best !== 0 ? t.best - 1 : null,
      termsPointer: t.terms,
      createdBlock: t.createdBlock,
      title: null,
    };
  });
  // Titles live in the terms blobs: read them in parallel; a failure leaves the tender untitled.
  const terms = await Promise.all(items.map((item) => readTerms(item.termsPointer)));
  items.forEach((item, k) => {
    item.title = terms[k]?.title ?? null;
  });
  return { total, items };
}
