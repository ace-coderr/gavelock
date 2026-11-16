// Spike-grade rule compiler: scoring function -> truth table -> shared decision diagram -> NAND netlist
// in the TapeOut wire format (TAP-02), plus a local simulator for exhaustive equivalence checks.
// The production version of this lives in the core library (Task 2); this one exists to size circuits.

// ---- input layout (11 bits, LSB first; input i is signal 2 + i)
//  0..2  price band P      0 = lowest valid price ... 7 = furthest above it
//  3..4  delivery band D   0 = fastest ladder step ... 3 = slowest
//  5     mandatory M       1 = every mandatory checklist item claimed
//  6..7  preferred A, B    two optional checklist groups
//  8..10 panel band Q      0 = lowest median score ... 7 = highest
// ---- output layout (5 bits): bit 0 eligible, bits 1..4 score 0..15
export const N_IN = 11;
export const N_OUT = 5;

export const fields = (x) => ({ P: x & 7, D: (x >> 3) & 3, M: (x >> 5) & 1, A: (x >> 6) & 1, B: (x >> 7) & 1, Q: (x >> 8) & 7 });
const pack = (eligible, score) => (eligible ? 1 : 0) | ((eligible ? Math.max(0, Math.min(15, Math.round(score))) : 0) << 1);

export const RULES = {
  lowestPrice: { name: 'Lowest compliant price', fn: ({ P, M }) => pack(M, 15 - 2 * P) },
  price60quality40: { name: 'Price 60 / Quality 40', fn: ({ P, M, Q }) => pack(M, 15 * (0.6 * (7 - P) / 7 + 0.4 * Q / 7)) },
  quality70price30: { name: 'Quality 70 / Price 30', fn: ({ P, M, Q }) => pack(M && Q >= 3, 15 * (0.7 * Q / 7 + 0.3 * (7 - P) / 7)) },
  fastestDelivery: { name: 'Fastest compliant delivery', fn: ({ P, D, M }) => pack(M, 15 * (0.75 * (3 - D) / 3 + 0.25 * (7 - P) / 7)) },
  // Not shipped: a custom rule that reads every input, to size what the rule builder can produce.
  customAllInputs: { name: 'Custom: every input weighted', fn: ({ P, D, M, A, B, Q }) => pack(M && Q >= 2, 15 * (0.4 * (7 - P) / 7 + 0.3 * Q / 7 + 0.15 * (3 - D) / 3 + 0.075 * A + 0.075 * B)) },
};

export const truthTable = (fn) => Uint8Array.from({ length: 1 << N_IN }, (_, x) => fn(fields(x)));

// Deterministic pseudo-random table: the worst case for any 11-in / 5-out rule.
export function randomTable(seed = 1) {
  let s = seed >>> 0;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s; };
  return Uint8Array.from({ length: 1 << N_IN }, () => next() & 31);
}

// ---- netlist builder with constant folding and structural sharing
class Builder {
  constructor(nIn) { this.nIn = nIn; this.gates = []; this.hash = new Map(); this.inv = new Map(); }
  sig(i) { return 2 + this.nIn + i; }
  raw(a, b) { this.gates.push([a, b]); return this.sig(this.gates.length - 1); }
  not(a) {
    if (a === 0) return 1;
    if (a === 1) return 0;
    if (this.inv.has(a)) return this.inv.get(a);
    const g = this.raw(a, a);
    this.inv.set(a, g); this.inv.set(g, a);
    return g;
  }
  nand(a, b) {
    if (a === 0 || b === 0) return 1;
    if (a === 1) return this.not(b);
    if (b === 1) return this.not(a);
    if (a === b) return this.not(a);
    if (this.inv.get(a) === b) return 1; // x NAND not-x
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (this.hash.has(k)) return this.hash.get(k);
    const g = this.raw(a, b);
    this.hash.set(k, g);
    return g;
  }
  mux(s, hi, lo) { // s ? hi : lo
    if (hi === lo) return hi;
    if (hi === 1 && lo === 0) return s;
    if (hi === 0 && lo === 1) return this.not(s);
    return this.nand(this.nand(s, hi), this.nand(this.not(s), lo));
  }
}

// Compile a truth table (Uint8Array of 2^nIn output words) with a given variable order (first = root).
export function compile(table, order, nIn = N_IN, nOut = N_OUT) {
  const b = new Builder(nIn);
  const memo = new Map();
  // A sub-function is identified by its column of the truth table restricted to the remaining variables.
  const build = (bit, depth, rows) => {
    if (depth === order.length) return (table[rows[0]] >> bit) & 1;
    let key = '';
    let all0 = true; let all1 = true;
    for (const r of rows) { const v = (table[r] >> bit) & 1; key += v; if (v) all0 = false; else all1 = false; }
    if (all0) return 0;
    if (all1) return 1;
    key = `${depth}:${key}`;
    if (memo.has(key)) return memo.get(key);
    const v = order[depth];
    const lo = []; const hi = [];
    for (const r of rows) ((r >> v) & 1 ? hi : lo).push(r);
    const l = build(bit, depth + 1, lo);
    const h = build(bit, depth + 1, hi);
    const out = b.mux(2 + v, h, l);
    memo.set(key, out);
    return out;
  };
  const all = Array.from({ length: 1 << nIn }, (_, i) => i);
  const outs = [];
  for (let bit = 0; bit < nOut; bit++) outs.push(build(bit, 0, all));
  // The chain reads outputs as the last nOut element signals, in order: finish with one buffer per output.
  const pre = outs.map((o) => b.not(o));
  for (const p of pre) b.raw(p, p);
  return { nIn, nOut, gates: b.gates, order };
}

// Try a handful of variable orders and keep the smallest circuit.
export function compileBest(table, nIn = N_IN, nOut = N_OUT) {
  const groups = [[0, 1, 2], [3, 4], [5], [6, 7], [8, 9, 10]];
  const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
  let best = null;
  for (const p of perms(groups)) {
    for (const flip of [false, true]) {
      const order = p.flatMap((g) => (flip ? [...g].reverse() : g));
      const c = compile(table, order, nIn, nOut);
      if (!best || c.gates.length < best.gates.length) best = c;
    }
  }
  return best;
}

export function simulate(c, x) {
  const s = new Uint8Array(2 + c.nIn + c.gates.length);
  s[1] = 1;
  for (let i = 0; i < c.nIn; i++) s[2 + i] = (x >> i) & 1;
  let k = 2 + c.nIn;
  for (const [a, b] of c.gates) s[k++] = 1 - (s[a] & s[b]);
  let out = 0;
  for (let i = 0; i < c.nOut; i++) out |= s[s.length - c.nOut + i] << i;
  return out;
}

export function equivalent(c, table) {
  for (let x = 0; x < table.length; x++) if (simulate(c, x) !== table[x]) return { ok: false, at: x, got: simulate(c, x), want: table[x] };
  return { ok: true };
}

export function encode(c) {
  const bytes = new Uint8Array(c.gates.length * 7);
  c.gates.forEach(([a, b], i) => {
    const o = i * 7;
    bytes[o] = 0;
    bytes[o + 1] = a >> 16; bytes[o + 2] = (a >> 8) & 255; bytes[o + 3] = a & 255;
    bytes[o + 4] = b >> 16; bytes[o + 5] = (b >> 8) & 255; bytes[o + 6] = b & 255;
  });
  return `0x${Buffer.from(bytes).toString('hex')}`;
}

// Pack an 11-bit input the way eval reads it: bit i is bit (i mod 8) of byte floor(i / 8).
export const packInput = (x) => `0x${(x & 255).toString(16).padStart(2, '0')}${((x >> 8) & 255).toString(16).padStart(2, '0')}`;
