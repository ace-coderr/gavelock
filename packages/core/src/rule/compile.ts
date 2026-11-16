// Truth table -> NAND netlist.
//
// Each output bit is expanded one input variable at a time (Shannon expansion). Identical sub-functions
// are built once and shared across all outputs, which is a reduced ordered decision diagram. Every
// decision node becomes a multiplexer made of NAND gates, with constants folded away and identical
// gates shared. The result is never trusted: callers check it against the table on every input.

import { RULE_SHAPE } from '../chain.ts';
import { firstMismatch, type Netlist } from './netlist.ts';
import type { TruthTable } from './spec.ts';

class Builder {
  readonly gates: Array<readonly [number, number]> = [];
  private readonly shared = new Map<number, number>();
  private readonly inverse = new Map<number, number>();
  private readonly nIn: number;

  constructor(nIn: number) {
    this.nIn = nIn;
  }

  private emit(a: number, b: number): number {
    this.gates.push([a, b]);
    return 2 + this.nIn + this.gates.length - 1;
  }

  /** A gate that is always emitted, never shared: used for the final output buffers. */
  raw(a: number, b: number): number {
    return this.emit(a, b);
  }

  not(a: number): number {
    if (a === 0) return 1;
    if (a === 1) return 0;
    const known = this.inverse.get(a);
    if (known !== undefined) return known;
    const g = this.emit(a, a);
    this.inverse.set(a, g);
    this.inverse.set(g, a);
    return g;
  }

  nand(a: number, b: number): number {
    if (a === 0 || b === 0) return 1;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    if (a === b) return this.not(a);
    if (this.inverse.get(a) === b) return 1;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * 0x1000000 + hi;
    const known = this.shared.get(key);
    if (known !== undefined) return known;
    const g = this.emit(lo, hi);
    this.shared.set(key, g);
    return g;
  }

  /** select ? whenOne : whenZero */
  mux(select: number, whenOne: number, whenZero: number): number {
    if (whenOne === whenZero) return whenOne;
    if (whenOne === 1 && whenZero === 0) return select;
    if (whenOne === 0 && whenZero === 1) return this.not(select);
    return this.nand(this.nand(select, whenOne), this.nand(this.not(select), whenZero));
  }
}

/** Compile with a fixed variable order (first entry is decided first). */
export function compileWithOrder(table: TruthTable, order: readonly number[], nIn: number, nOut: number): Netlist {
  if (table.length !== 1 << nIn) throw new RangeError('table size does not match the number of inputs');
  if (order.length !== nIn || new Set(order).size !== nIn || order.some((v) => !Number.isInteger(v) || v < 0 || v >= nIn)) {
    throw new RangeError('order must list every input exactly once');
  }
  const b = new Builder(nIn);
  const memo = new Map<string, number>();

  const build = (bit: number, depth: number, rows: Uint16Array): number => {
    let key = '';
    let ones = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = (table[rows[i]!]! >>> bit) & 1;
      ones += v;
      key += v;
    }
    if (ones === 0) return 0;
    if (ones === rows.length) return 1;
    key = `${depth}:${key}`;
    const known = memo.get(key);
    if (known !== undefined) return known;
    const variable = order[depth]!;
    const zero = new Uint16Array(rows.length / 2);
    const one = new Uint16Array(rows.length / 2);
    let z = 0;
    let o = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      if ((r >>> variable) & 1) one[o++] = r;
      else zero[z++] = r;
    }
    const out = b.mux(2 + variable, build(bit, depth + 1, one), build(bit, depth + 1, zero));
    memo.set(key, out);
    return out;
  };

  const all = Uint16Array.from({ length: 1 << nIn }, (_, i) => i);
  const outputs: number[] = [];
  for (let bit = 0; bit < nOut; bit++) outputs.push(build(bit, 0, all));
  // The chain reads the outputs as the last nOut gate signals, in order, so each output ends in its own gate.
  const inverted = outputs.map((o) => b.not(o));
  for (const s of inverted) b.raw(s, s);
  return { nIn, nOut, gates: b.gates };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// Inputs that belong to one criterion stay together; the criteria are tried in every order.
const FIELD_GROUPS: readonly (readonly number[])[] = [[0, 1, 2], [3, 4], [5], [6, 7], [8, 9, 10]];

export interface CompiledRule {
  netlist: Netlist;
  /** Number of NAND gates, which is also the number of transistors burned at tape-out. */
  gates: number;
  /** False when the netlist is larger than the rule builder will tape out. */
  withinCap: boolean;
}

/**
 * Compile a Gavelock rule table (11 inputs, 5 outputs) to the smallest netlist found across variable
 * orders, and prove it equal to the table on all 2,048 inputs. Throws if the proof fails.
 */
export function compileRule(table: TruthTable): CompiledRule {
  const { inputs, outputs, maxNand } = RULE_SHAPE;
  let best: Netlist | null = null;
  for (const groups of permutations(FIELD_GROUPS)) {
    for (const reversed of [false, true]) {
      const order = groups.flatMap((g) => (reversed ? [...g].reverse() : [...g]));
      const candidate = compileWithOrder(table, order, inputs, outputs);
      if (best === null || candidate.gates.length < best.gates.length) best = candidate;
    }
  }
  const netlist = best!;
  const mismatch = firstMismatch(netlist, table);
  if (mismatch !== null) {
    throw new Error(`compiled netlist differs from the table at input ${mismatch.input}: expected ${mismatch.expected}, got ${mismatch.actual}`);
  }
  return { netlist, gates: netlist.gates.length, withinCap: netlist.gates.length <= maxNand };
}
