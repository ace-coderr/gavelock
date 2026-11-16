// Banding: how an opened bid becomes the 11 bits a rule circuit sees.
// The tender contract implements exactly these functions; the contract tests compare the two.

import { DELIVERY_BANDS, PANEL_BANDS, PRICE_BANDS, type Banded } from './rule/layout.ts';

export interface Ladders {
  /**
   * Seven ascending steps, in basis points above the lowest valid price.
   * A bid's price band is the number of steps it exceeds: with the first step at 0, band 0 means "the lowest price".
   */
  priceBps: readonly number[];
  /** Three ascending steps, in days. A bid's delivery band is the number of steps its delivery time exceeds. */
  deliveryDays: readonly number[];
}

export interface Checklist {
  /** Number of items, 0 to 32. Item i is bit i of a bid's compliance bitmask. */
  items: number;
  /** Items every eligible bid must claim. */
  mandatoryMask: number;
  /** First group of preferred items. A bid earns the group only by claiming all of it. Zero = unused. */
  preferredAMask: number;
  /** Second group of preferred items. Zero = unused. */
  preferredBMask: number;
}

export const DEFAULT_LADDERS: Ladders = {
  priceBps: [0, 250, 500, 1000, 1500, 2500, 4000],
  deliveryDays: [7, 14, 30],
};

/** Largest price step: 100 times the lowest price. */
export const PRICE_STEP_MAX_BPS = 1_000_000;
export const DELIVERY_STEP_MAX_DAYS = 3650;
export const PANEL_SCORE_MAX = 100;

function ascending(steps: readonly number[]): boolean {
  return steps.every((s, i) => i === 0 || s > steps[i - 1]!);
}

/** Problems with a tender's ladders, in plain words. */
export function validateLadders(l: Ladders): string[] {
  const problems: string[] = [];
  if (l.priceBps.length !== PRICE_BANDS - 1) problems.push(`The price ladder needs ${PRICE_BANDS - 1} steps.`);
  else if (l.priceBps.some((s) => !Number.isInteger(s) || s < 0 || s > PRICE_STEP_MAX_BPS)) problems.push('Price steps must be whole basis points from 0 to 1,000,000.');
  else if (!ascending(l.priceBps)) problems.push('Price steps must strictly increase.');
  if (l.deliveryDays.length !== DELIVERY_BANDS - 1) problems.push(`The delivery ladder needs ${DELIVERY_BANDS - 1} steps.`);
  else if (l.deliveryDays.some((s) => !Number.isInteger(s) || s < 0 || s > DELIVERY_STEP_MAX_DAYS)) problems.push('Delivery steps must be whole days from 0 to 3,650.');
  else if (!ascending(l.deliveryDays)) problems.push('Delivery steps must strictly increase.');
  return problems;
}

/** Problems with a tender's checklist, in plain words. */
export function validateChecklist(c: Checklist): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(c.items) || c.items < 0 || c.items > 32) return ['A checklist has 0 to 32 items.'];
  const all = c.items === 32 ? 0xffff_ffff : 2 ** c.items - 1;
  const masks: Array<[string, number]> = [['mandatory', c.mandatoryMask], ['first preferred', c.preferredAMask], ['second preferred', c.preferredBMask]];
  for (const [name, mask] of masks) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff_ffff) problems.push(`The ${name} group is not a 32-bit mask.`);
    else if ((mask | all) >>> 0 !== all) problems.push(`The ${name} group names an item the checklist does not have.`);
  }
  if (problems.length > 0) return problems;
  const overlap = (a: number, b: number) => (a & b) >>> 0 !== 0;
  if (overlap(c.mandatoryMask, c.preferredAMask) || overlap(c.mandatoryMask, c.preferredBMask) || overlap(c.preferredAMask, c.preferredBMask)) {
    problems.push('An item can belong to only one group.');
  }
  return problems;
}

/**
 * Price band 0..7 relative to the lowest valid price.
 * Exact integer comparison: price > lowest * (1 + step) is tested as price * 10000 > lowest * (10000 + step).
 */
export function priceBand(price: bigint, lowestValidPrice: bigint, priceBps: readonly number[]): number {
  if (lowestValidPrice <= 0n) return PRICE_BANDS - 1;
  let band = 0;
  for (const step of priceBps) if (price * 10_000n > lowestValidPrice * (10_000n + BigInt(step))) band++;
  return band;
}

/** Delivery band 0..3: the number of ladder steps the delivery time exceeds. */
export function deliveryBand(deliveryDays: number, ladderDays: readonly number[]): number {
  let band = 0;
  for (const step of ladderDays) if (deliveryDays > step) band++;
  return band;
}

/** Panel band 0..7 from a median score of 0..100. Eight equal slices. */
export function panelBand(medianScore: number): number {
  if (!Number.isInteger(medianScore) || medianScore < 0 || medianScore > PANEL_SCORE_MAX) throw new RangeError('a panel score is a whole number from 0 to 100');
  return Math.floor((medianScore * PANEL_BANDS) / (PANEL_SCORE_MAX + 1));
}

/**
 * Median of the revealed panel scores for one bid. With an even count it is the mean of the two
 * middle scores, rounded down. Throws on an empty list: no reveals means no score, which is a
 * quorum question for the contract, not a zero.
 */
export function medianScore(scores: readonly number[]): number {
  if (scores.length === 0) throw new RangeError('no scores');
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.floor((sorted[mid - 1]! + sorted[mid]!) / 2);
}

function claimsAll(compliance: number, mask: number): boolean {
  return ((compliance & mask) >>> 0) === mask >>> 0;
}

/** Does the bid claim every mandatory item? True when there are none. */
export function meetsMandatory(compliance: number, checklist: Checklist): boolean {
  return claimsAll(compliance, checklist.mandatoryMask);
}

export interface BandInput {
  price: bigint;
  deliveryDays: number;
  compliance: number;
  /** Median panel score 0..100. Ignored (band 0) for Quick Quote. */
  panelMedian: number | null;
}

/** The six facts a rule circuit sees for one bid. */
export function bandBid(bid: BandInput, lowestValidPrice: bigint, ladders: Ladders, checklist: Checklist): Banded {
  return {
    price: priceBand(bid.price, lowestValidPrice, ladders.priceBps),
    delivery: deliveryBand(bid.deliveryDays, ladders.deliveryDays),
    mandatory: meetsMandatory(bid.compliance, checklist),
    preferredA: checklist.preferredAMask !== 0 && claimsAll(bid.compliance, checklist.preferredAMask),
    preferredB: checklist.preferredBMask !== 0 && claimsAll(bid.compliance, checklist.preferredBMask),
    panel: bid.panelMedian === null ? 0 : panelBand(bid.panelMedian),
  };
}
