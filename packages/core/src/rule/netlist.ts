// TapeOut netlists (TAP-02), restricted to what a Gavelock rule may contain: NAND records only.
// No LATCH (a rule has no memory) and no REF (a rule must not depend on any other circuit).
//
// Signals: 0 is constant 0, 1 is constant 1, input i is signal 2 + i, then each NAND appends one signal.
// A NAND record is 7 bytes: 00, a (3 bytes, big-endian), b (3 bytes, big-endian). Inputs point backwards.
// The outputs are the last nOut signals, in order.

import type { TruthTable } from './spec.ts';

export interface Netlist {
  nIn: number;
  nOut: number;
  /** One [a, b] pair of signal indices per NAND gate, in record order. */
  gates: ReadonlyArray<readonly [number, number]>;
}

const NAND_RECORD = 7;
const MAX_SIGNAL = 0xffffff;

export class NetlistError extends Error {
  override name = 'NetlistError';
}

/** Check the rules the chain enforces at tape-out, plus Gavelock's own (NAND only). Throws NetlistError. */
export function assertWellFormed(n: Netlist): void {
  if (!Number.isInteger(n.nIn) || n.nIn < 0) throw new NetlistError('nIn must be a non-negative integer');
  if (!Number.isInteger(n.nOut) || n.nOut < 1) throw new NetlistError('a circuit needs at least one output');
  if (n.gates.length < n.nOut) throw new NetlistError('too few gates: every output must be produced by a gate');
  const first = 2 + n.nIn;
  if (first + n.gates.length - 1 > MAX_SIGNAL) throw new NetlistError('too many signals');
  n.gates.forEach(([a, b], i) => {
    const self = first + i;
    for (const s of [a, b]) {
      if (!Number.isInteger(s) || s < 0) throw new NetlistError(`gate ${i}: bad signal index`);
      if (s >= self) throw new NetlistError(`gate ${i}: a NAND may only read earlier signals`);
    }
  });
}

/** The bytes submitted to `tapeout`. */
export function encodeNetlist(n: Netlist): Uint8Array {
  assertWellFormed(n);
  const bytes = new Uint8Array(n.gates.length * NAND_RECORD);
  n.gates.forEach(([a, b], i) => {
    const o = i * NAND_RECORD;
    bytes[o] = 0x00;
    bytes[o + 1] = a >>> 16;
    bytes[o + 2] = (a >>> 8) & 0xff;
    bytes[o + 3] = a & 0xff;
    bytes[o + 4] = b >>> 16;
    bytes[o + 5] = (b >>> 8) & 0xff;
    bytes[o + 6] = b & 0xff;
  });
  return bytes;
}

/** Parse bytes read from `netlist(id)`. Rejects anything that is not a flat NAND netlist. */
export function decodeNetlist(bytes: Uint8Array, nIn: number, nOut: number): Netlist {
  const gates: Array<readonly [number, number]> = [];
  let o = 0;
  while (o < bytes.length) {
    const opcode = bytes[o]!;
    if (opcode === 0x01) throw new NetlistError('LATCH record: a Gavelock rule must be stateless');
    if (opcode === 0x02) throw new NetlistError('REF record: a Gavelock rule must not depend on another circuit');
    if (opcode !== 0x00) throw new NetlistError(`unknown opcode 0x${opcode.toString(16).padStart(2, '0')}`);
    if (o + NAND_RECORD > bytes.length) throw new NetlistError('truncated NAND record');
    const a = (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!;
    const b = (bytes[o + 4]! << 16) | (bytes[o + 5]! << 8) | bytes[o + 6]!;
    gates.push([a, b]);
    o += NAND_RECORD;
  }
  const netlist: Netlist = { nIn, nOut, gates };
  assertWellFormed(netlist);
  return netlist;
}

/** One evaluation, exactly as the chain computes it. `input` and the result are bit-packed, bit 0 first. */
export function simulate(n: Netlist, input: number): number {
  const first = 2 + n.nIn;
  const signals = new Uint8Array(first + n.gates.length);
  signals[1] = 1;
  for (let i = 0; i < n.nIn; i++) signals[2 + i] = (input >>> i) & 1;
  let k = first;
  for (const [a, b] of n.gates) signals[k++] = 1 - (signals[a]! & signals[b]!);
  let out = 0;
  const base = signals.length - n.nOut;
  for (let i = 0; i < n.nOut; i++) out |= signals[base + i]! << i;
  return out;
}

/** The complete behaviour of a netlist: one output word per input. Only for circuits with few inputs. */
export function tableOf(n: Netlist): TruthTable {
  if (n.nIn > 16) throw new RangeError('too many inputs to enumerate');
  if (n.nOut > 8) throw new RangeError('too many outputs for a byte table');
  const size = 1 << n.nIn;
  const table = new Uint8Array(size);
  for (let input = 0; input < size; input++) table[input] = simulate(n, input);
  return table;
}

export interface Mismatch {
  input: number;
  expected: number;
  actual: number;
}

/** Exhaustive equivalence: the first input on which the netlist and the table differ, or null if none. */
export function firstMismatch(n: Netlist, table: TruthTable): Mismatch | null {
  if (table.length !== 1 << n.nIn) throw new RangeError('table size does not match the number of inputs');
  for (let input = 0; input < table.length; input++) {
    const actual = simulate(n, input);
    if (actual !== table[input]) return { input, expected: table[input]!, actual };
  }
  return null;
}

/** First input on which two tables differ, or null when they are identical. */
export function firstDifference(a: TruthTable, b: TruthTable): number | null {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return null;
}
