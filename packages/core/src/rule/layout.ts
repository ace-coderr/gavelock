// The wire layout of a rule circuit. The tender contract builds the same 11 input bits from a bid
// and reads the same 5 output bits back; this file and the contract must agree bit for bit.
//
// Inputs (bit i is signal 2 + i in the netlist, and bit i mod 8 of byte floor(i / 8) on the wire):
//   0..2   price band      0 = at the lowest valid price ... 7 = furthest above it
//   3..4   delivery band   0 = fastest step of the tender's ladder ... 3 = slowest
//   5      mandatory       1 = every mandatory checklist item is claimed
//   6      preferred A     1 = every item of the tender's first preferred group is claimed
//   7      preferred B     1 = every item of the second preferred group is claimed
//   8..10  panel band      0 = lowest median panel score ... 7 = highest (always 0 in Quick Quote)
//
// Outputs:
//   0      eligible
//   1..4   score 0..15 (0 when not eligible)

export const PRICE_BANDS = 8;
export const DELIVERY_BANDS = 4;
export const PANEL_BANDS = 8;
export const MAX_SCORE = 15;

/** Number of distinct inputs a rule can see: every one of them can be enumerated. */
export const INPUT_SPACE = 1 << 11;

export interface Banded {
  /** 0..7 */
  price: number;
  /** 0..3 */
  delivery: number;
  mandatory: boolean;
  preferredA: boolean;
  preferredB: boolean;
  /** 0..7 */
  panel: number;
}

export interface Outcome {
  eligible: boolean;
  /** 0..15 */
  score: number;
}

function inRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${name} must be an integer from 0 to ${max}`);
}

/** Pack banded bid facts into the 11-bit rule input. */
export function packBanded(b: Banded): number {
  inRange('price band', b.price, PRICE_BANDS - 1);
  inRange('delivery band', b.delivery, DELIVERY_BANDS - 1);
  inRange('panel band', b.panel, PANEL_BANDS - 1);
  return b.price | (b.delivery << 3) | (Number(b.mandatory) << 5) | (Number(b.preferredA) << 6) | (Number(b.preferredB) << 7) | (b.panel << 8);
}

export function unpackBanded(input: number): Banded {
  inRange('rule input', input, INPUT_SPACE - 1);
  return {
    price: input & 7,
    delivery: (input >> 3) & 3,
    mandatory: ((input >> 5) & 1) === 1,
    preferredA: ((input >> 6) & 1) === 1,
    preferredB: ((input >> 7) & 1) === 1,
    panel: (input >> 8) & 7,
  };
}

/** Pack an outcome into the 5-bit rule output. An ineligible bid always scores 0. */
export function packOutcome(o: Outcome): number {
  inRange('score', o.score, MAX_SCORE);
  return o.eligible ? 1 | (o.score << 1) : 0;
}

export function unpackOutcome(word: number): Outcome {
  inRange('rule output', word, 31);
  return { eligible: (word & 1) === 1, score: (word >> 1) & 15 };
}

/** The two bytes `eval` expects for an input. */
export function inputToBytes(input: number): Uint8Array {
  inRange('rule input', input, INPUT_SPACE - 1);
  return Uint8Array.of(input & 255, input >> 8);
}

/** Read the single byte `eval` returns. Anything else is not a Gavelock rule. */
export function outcomeFromBytes(bytes: Uint8Array): Outcome {
  if (bytes.length !== 1) throw new RangeError(`a rule returns exactly 1 byte, got ${bytes.length}`);
  const word = bytes[0]!;
  if (word > 31) throw new RangeError('a rule returns 5 bits; higher bits were set');
  return unpackOutcome(word);
}
