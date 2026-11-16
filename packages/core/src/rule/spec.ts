// A scoring rule as a buyer writes it in the form: weights that add up to 100 and optional gates.
// The form is only a convenient way to produce a truth table. What goes on chain, and what a bidder
// should trust, is the table itself (see compile.ts and the Rule Prover).

import { DELIVERY_BANDS, INPUT_SPACE, MAX_SCORE, PANEL_BANDS, PRICE_BANDS, packOutcome, unpackBanded, type Banded, type Outcome } from './layout.ts';

export interface RuleWeights {
  /** Reward for a lower price band. */
  price: number;
  /** Reward for a faster delivery band. */
  delivery: number;
  /** Reward for a higher panel band. */
  panel: number;
  /** Reward for meeting the first preferred group. */
  preferredA: number;
  /** Reward for meeting the second preferred group. */
  preferredB: number;
}

export interface RuleGates {
  /** Bids in a higher price band are ineligible. 7 means no gate. */
  maxPriceBand: number;
  /** Bids in a slower delivery band are ineligible. 3 means no gate. */
  maxDeliveryBand: number;
  /** Bids in a lower panel band are ineligible. 0 means no gate. */
  minPanelBand: number;
  requirePreferredA: boolean;
  requirePreferredB: boolean;
}

export interface RuleSpec {
  weights: RuleWeights;
  gates: RuleGates;
}

export const NO_GATES: RuleGates = {
  maxPriceBand: PRICE_BANDS - 1,
  maxDeliveryBand: DELIVERY_BANDS - 1,
  minPanelBand: 0,
  requirePreferredA: false,
  requirePreferredB: false,
};

const WEIGHT_KEYS = ['price', 'delivery', 'panel', 'preferredA', 'preferredB'] as const;

/** Problems with a spec, in plain words. Empty when the spec is valid. */
export function validateSpec(spec: RuleSpec): string[] {
  const problems: string[] = [];
  let total = 0;
  for (const key of WEIGHT_KEYS) {
    const w = spec.weights[key];
    if (!Number.isInteger(w) || w < 0 || w > 100) problems.push(`The ${key} weight must be a whole number from 0 to 100.`);
    else total += w;
  }
  if (problems.length === 0 && total !== 100) problems.push(`The weights must add up to 100; they add up to ${total}.`);
  const g = spec.gates;
  if (!Number.isInteger(g.maxPriceBand) || g.maxPriceBand < 0 || g.maxPriceBand > PRICE_BANDS - 1) problems.push('The price gate must be a band from 0 to 7.');
  if (!Number.isInteger(g.maxDeliveryBand) || g.maxDeliveryBand < 0 || g.maxDeliveryBand > DELIVERY_BANDS - 1) problems.push('The delivery gate must be a band from 0 to 3.');
  if (!Number.isInteger(g.minPanelBand) || g.minPanelBand < 0 || g.minPanelBand > PANEL_BANDS - 1) problems.push('The panel gate must be a band from 0 to 7.');
  return problems;
}

/**
 * What a spec gives one banded bid. Integer arithmetic only, so every platform agrees.
 * A bid that does not claim every mandatory item is never eligible, whatever the weights.
 */
export function applySpec(spec: RuleSpec, b: Banded): Outcome {
  const g = spec.gates;
  const eligible =
    b.mandatory &&
    b.price <= g.maxPriceBand &&
    b.delivery <= g.maxDeliveryBand &&
    b.panel >= g.minPanelBand &&
    (!g.requirePreferredA || b.preferredA) &&
    (!g.requirePreferredB || b.preferredB);
  if (!eligible) return { eligible: false, score: 0 };

  const w = spec.weights;
  // Each criterion contributes weight * (its fraction of the best band). 21 is the common denominator of 7 and 3.
  const numerator =
    w.price * (PRICE_BANDS - 1 - b.price) * 3 +
    w.delivery * (DELIVERY_BANDS - 1 - b.delivery) * 7 +
    w.panel * b.panel * 3 +
    w.preferredA * Number(b.preferredA) * 21 +
    w.preferredB * Number(b.preferredB) * 21;
  const denominator = 100 * 21;
  // Round half up to a score out of 15.
  const score = Math.floor((2 * MAX_SCORE * numerator + denominator) / (2 * denominator));
  return { eligible: true, score };
}

/** A rule's complete behaviour: the 5-bit output for each of the 2,048 inputs. */
export type TruthTable = Uint8Array;

export function truthTable(spec: RuleSpec): TruthTable {
  const problems = validateSpec(spec);
  if (problems.length > 0) throw new Error(problems.join(' '));
  const table = new Uint8Array(INPUT_SPACE);
  for (let input = 0; input < INPUT_SPACE; input++) table[input] = packOutcome(applySpec(spec, unpackBanded(input)));
  return table;
}

export interface StarterRule {
  key: 'lowest-price' | 'price-60-quality-40' | 'quality-70-price-30' | 'fastest-delivery';
  name: string;
  /** One sentence a buyer can read. */
  summary: string;
  /** Which kind of tender the rule is meant for. */
  mode: 'full' | 'quick';
  spec: RuleSpec;
}

const weights = (w: Partial<RuleWeights>): RuleWeights => ({ price: 0, delivery: 0, panel: 0, preferredA: 0, preferredB: 0, ...w });

/** The four rules taped out with the Gavelock processor. Ties are always broken by lower price, then earlier bid. */
export const STARTER_RULES: readonly StarterRule[] = [
  {
    key: 'lowest-price',
    name: 'Lowest compliant price',
    summary: 'Every bid that meets the mandatory checklist is scored on price alone.',
    mode: 'full',
    spec: { weights: weights({ price: 100 }), gates: NO_GATES },
  },
  {
    key: 'price-60-quality-40',
    name: 'Price 60 / Quality 40',
    summary: 'Price carries 60% of the score and the panel’s median quality score carries 40%.',
    mode: 'full',
    spec: { weights: weights({ price: 60, panel: 40 }), gates: NO_GATES },
  },
  {
    key: 'quality-70-price-30',
    name: 'Quality 70 / Price 30',
    summary: 'The panel’s median quality score carries 70% of the score and price carries 30%.',
    mode: 'full',
    spec: { weights: weights({ panel: 70, price: 30 }), gates: NO_GATES },
  },
  {
    key: 'fastest-delivery',
    name: 'Fastest compliant delivery',
    summary: 'Every quote that meets the mandatory checklist is scored on delivery time alone.',
    mode: 'quick',
    spec: { weights: weights({ delivery: 100 }), gates: NO_GATES },
  },
];
