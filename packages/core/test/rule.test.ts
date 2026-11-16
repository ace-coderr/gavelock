import { describe, expect, it } from 'vitest';
import {
  INPUT_SPACE,
  NO_GATES,
  NetlistError,
  RULE_SHAPE,
  STARTER_RULES,
  applySpec,
  compileRule,
  compileWithOrder,
  decodeNetlist,
  encodeNetlist,
  firstDifference,
  firstMismatch,
  inputToBytes,
  outcomeFromBytes,
  packBanded,
  packOutcome,
  simulate,
  tableOf,
  truthTable,
  unpackBanded,
  unpackOutcome,
  validateSpec,
  type Netlist,
  type RuleSpec,
} from '../src/index.ts';

const spec = (weights: Partial<RuleSpec['weights']>, gates: Partial<RuleSpec['gates']> = {}): RuleSpec => ({
  weights: { price: 0, delivery: 0, panel: 0, preferredA: 0, preferredB: 0, ...weights },
  gates: { ...NO_GATES, ...gates },
});

// Small deterministic generator so failures are reproducible.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

describe('rule layout', () => {
  it('packs and unpacks every input', () => {
    for (let x = 0; x < INPUT_SPACE; x++) expect(packBanded(unpackBanded(x))).toBe(x);
  });

  it('puts each field where the contract expects it', () => {
    expect(packBanded({ price: 7, delivery: 0, mandatory: false, preferredA: false, preferredB: false, panel: 0 })).toBe(0b00000000111);
    expect(packBanded({ price: 0, delivery: 3, mandatory: false, preferredA: false, preferredB: false, panel: 0 })).toBe(0b00000011000);
    expect(packBanded({ price: 0, delivery: 0, mandatory: true, preferredA: false, preferredB: false, panel: 0 })).toBe(0b00000100000);
    expect(packBanded({ price: 0, delivery: 0, mandatory: false, preferredA: true, preferredB: false, panel: 0 })).toBe(0b00001000000);
    expect(packBanded({ price: 0, delivery: 0, mandatory: false, preferredA: false, preferredB: true, panel: 0 })).toBe(0b00010000000);
    expect(packBanded({ price: 0, delivery: 0, mandatory: false, preferredA: false, preferredB: false, panel: 7 })).toBe(0b11100000000);
  });

  it('packs inputs and outputs the way eval reads them', () => {
    expect([...inputToBytes(0x7ff)]).toEqual([0xff, 0x07]);
    expect([...inputToBytes(0x120)]).toEqual([0x20, 0x01]);
    expect(packOutcome({ eligible: true, score: 12 })).toBe(0b11001);
    expect(packOutcome({ eligible: false, score: 0 })).toBe(0);
    expect(unpackOutcome(0b11001)).toEqual({ eligible: true, score: 12 });
    expect(outcomeFromBytes(Uint8Array.of(0b11111))).toEqual({ eligible: true, score: 15 });
    expect(() => outcomeFromBytes(Uint8Array.of(1, 0))).toThrow(RangeError);
    expect(() => outcomeFromBytes(Uint8Array.of(0b100000))).toThrow(RangeError);
  });

  it('rejects out-of-range fields', () => {
    expect(() => packBanded({ price: 8, delivery: 0, mandatory: true, preferredA: false, preferredB: false, panel: 0 })).toThrow(RangeError);
    expect(() => unpackBanded(INPUT_SPACE)).toThrow(RangeError);
    expect(() => packOutcome({ eligible: true, score: 16 })).toThrow(RangeError);
  });
});

describe('rule specs', () => {
  it('validates weights and gates', () => {
    expect(validateSpec(spec({ price: 100 }))).toEqual([]);
    expect(validateSpec(spec({ price: 60, panel: 30 }))).toHaveLength(1);
    expect(validateSpec(spec({ price: 101, panel: -1 }))).toHaveLength(2);
    expect(validateSpec(spec({ price: 100 }, { maxPriceBand: 8 }))).toHaveLength(1);
    expect(() => truthTable(spec({ price: 50 }))).toThrow();
  });

  it('never makes a bid eligible without the mandatory checklist', () => {
    for (const rule of STARTER_RULES) {
      const table = truthTable(rule.spec);
      for (let x = 0; x < INPUT_SPACE; x++) {
        if (!unpackBanded(x).mandatory) expect(table[x]).toBe(0);
        else expect(table[x]! & 1).toBe(1);
      }
    }
  });

  it('scores the best bid 15 and the worst 0 on every starter rule', () => {
    const best = { price: 0, delivery: 0, mandatory: true, preferredA: true, preferredB: true, panel: 7 };
    const worst = { price: 7, delivery: 3, mandatory: true, preferredA: false, preferredB: false, panel: 0 };
    for (const rule of STARTER_RULES) {
      expect(applySpec(rule.spec, best)).toEqual({ eligible: true, score: 15 });
      expect(applySpec(rule.spec, worst)).toEqual({ eligible: true, score: 0 });
    }
  });

  it('never scores a better bid lower (monotone in every criterion)', () => {
    const next = rng(11);
    for (let trial = 0; trial < 60; trial++) {
      // Random weights adding up to 100.
      const cuts = [next() % 101, next() % 101, next() % 101, next() % 101].sort((a, b) => a - b);
      const s = spec({ price: cuts[0]!, delivery: cuts[1]! - cuts[0]!, panel: cuts[2]! - cuts[1]!, preferredA: cuts[3]! - cuts[2]!, preferredB: 100 - cuts[3]! });
      expect(validateSpec(s)).toEqual([]);
      for (let x = 0; x < INPUT_SPACE; x++) {
        const b = unpackBanded(x);
        if (!b.mandatory) continue;
        const here = applySpec(s, b).score;
        if (b.price > 0) expect(applySpec(s, { ...b, price: b.price - 1 }).score).toBeGreaterThanOrEqual(here);
        if (b.delivery > 0) expect(applySpec(s, { ...b, delivery: b.delivery - 1 }).score).toBeGreaterThanOrEqual(here);
        if (b.panel < 7) expect(applySpec(s, { ...b, panel: b.panel + 1 }).score).toBeGreaterThanOrEqual(here);
        if (!b.preferredA) expect(applySpec(s, { ...b, preferredA: true }).score).toBeGreaterThanOrEqual(here);
      }
    }
  });

  it('applies gates', () => {
    const s = spec({ price: 50, panel: 50 }, { minPanelBand: 3, maxPriceBand: 5, requirePreferredA: true });
    const ok = { price: 5, delivery: 3, mandatory: true, preferredA: true, preferredB: false, panel: 3 };
    expect(applySpec(s, ok).eligible).toBe(true);
    expect(applySpec(s, { ...ok, panel: 2 })).toEqual({ eligible: false, score: 0 });
    expect(applySpec(s, { ...ok, price: 6 }).eligible).toBe(false);
    expect(applySpec(s, { ...ok, preferredA: false }).eligible).toBe(false);
    expect(applySpec(s, { ...ok, mandatory: false }).eligible).toBe(false);
  });

  it('gives the documented scores for lowest price', () => {
    const rule = STARTER_RULES[0]!;
    const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((price) => applySpec(rule.spec, { price, delivery: 0, mandatory: true, preferredA: false, preferredB: false, panel: 0 }).score);
    expect(scores).toEqual([15, 13, 11, 9, 6, 4, 2, 0]);
  });
});

describe('netlist codec and simulator', () => {
  // XOR of two inputs from four NAND gates; inputs are signals 2 and 3.
  const xor: Netlist = { nIn: 2, nOut: 1, gates: [[2, 3], [2, 4], [3, 4], [5, 6]] };

  it('simulates NAND logic', () => {
    expect([0, 1, 2, 3].map((x) => simulate(xor, x))).toEqual([0, 1, 1, 0]);
    expect([...tableOf(xor)]).toEqual([0, 1, 1, 0]);
  });

  it('encodes to the TapeOut wire format and back', () => {
    const bytes = encodeNetlist(xor);
    expect(Buffer.from(bytes).toString('hex')).toBe('00000002000003' + '00000002000004' + '00000003000004' + '00000005000006');
    expect(decodeNetlist(bytes, 2, 1)).toEqual(xor);
  });

  it('reads constants as signals 0 and 1', () => {
    const n: Netlist = { nIn: 1, nOut: 2, gates: [[2, 1], [0, 2]] }; // NOT x, constant 1
    expect(simulate(n, 0)).toBe(0b11);
    expect(simulate(n, 1)).toBe(0b10);
  });

  it('rejects what the chain or Gavelock would reject', () => {
    expect(() => encodeNetlist({ nIn: 2, nOut: 1, gates: [[2, 4]] })).toThrow(NetlistError); // reads its own output
    expect(() => encodeNetlist({ nIn: 2, nOut: 1, gates: [[2, 5], [2, 3]] })).toThrow(NetlistError); // forward reference
    expect(() => encodeNetlist({ nIn: 2, nOut: 2, gates: [[2, 3]] })).toThrow(NetlistError); // output would be an input
    expect(() => encodeNetlist({ nIn: 2, nOut: 0, gates: [[2, 3]] })).toThrow(NetlistError);
    expect(() => decodeNetlist(Uint8Array.of(0, 0, 0, 2, 0, 0), 2, 1)).toThrow(/truncated/);
    expect(() => decodeNetlist(Uint8Array.of(1, 0, 0, 2), 2, 1)).toThrow(/LATCH/);
    expect(() => decodeNetlist(Uint8Array.of(2, 0, 0, 2), 2, 1)).toThrow(/REF/);
    expect(() => decodeNetlist(Uint8Array.of(9, 0, 0, 2, 0, 0, 3), 2, 1)).toThrow(/unknown opcode/);
    expect(() => decodeNetlist(new Uint8Array(0), 2, 1)).toThrow(NetlistError);
  });

  it('reports the first mismatch', () => {
    expect(firstMismatch(xor, Uint8Array.of(0, 1, 1, 0))).toBeNull();
    expect(firstMismatch(xor, Uint8Array.of(0, 1, 0, 0))).toEqual({ input: 2, expected: 0, actual: 1 });
    expect(firstDifference(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(1);
    expect(firstDifference(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBeNull();
  });
});

describe('rule compiler', () => {
  it('compiles every starter rule to a netlist equal to its table on all 2,048 inputs', () => {
    for (const rule of STARTER_RULES) {
      const table = truthTable(rule.spec);
      const compiled = compileRule(table);
      expect(compiled.netlist.nIn).toBe(RULE_SHAPE.inputs);
      expect(compiled.netlist.nOut).toBe(RULE_SHAPE.outputs);
      expect(firstMismatch(compiled.netlist, table)).toBeNull();
      expect(firstDifference(tableOf(compiled.netlist), table)).toBeNull();
      expect(compiled.withinCap).toBe(true);
      expect(compiled.gates).toBeLessThanOrEqual(200);
      // What goes on chain decodes back to the same circuit.
      const bytes = encodeNetlist(compiled.netlist);
      expect(bytes.length).toBe(compiled.gates * 7);
      expect(firstMismatch(decodeNetlist(bytes, RULE_SHAPE.inputs, RULE_SHAPE.outputs), table)).toBeNull();
    }
  });

  it('is deterministic', () => {
    const table = truthTable(STARTER_RULES[1]!.spec);
    expect(encodeNetlist(compileRule(table).netlist)).toEqual(encodeNetlist(compileRule(table).netlist));
  });

  it('compiles gated, mixed-weight rules correctly', () => {
    const rules = [
      spec({ price: 40, panel: 30, delivery: 15, preferredA: 8, preferredB: 7 }, { minPanelBand: 2 }),
      spec({ price: 34, delivery: 33, panel: 33 }, { maxDeliveryBand: 2, requirePreferredB: true }),
      spec({ preferredA: 50, preferredB: 50 }, { maxPriceBand: 3 }),
    ];
    for (const s of rules) {
      const table = truthTable(s);
      const compiled = compileRule(table);
      expect(firstMismatch(compiled.netlist, table)).toBeNull();
      expect(compiled.withinCap).toBe(true);
    }
  });

  it('compiles constant and degenerate tables', () => {
    for (const fill of [0, 31, 1]) {
      const table = new Uint8Array(INPUT_SPACE).fill(fill);
      const compiled = compileRule(table);
      expect(firstMismatch(compiled.netlist, table)).toBeNull();
      expect(compiled.gates).toBeLessThanOrEqual(10);
    }
  });

  it('compiles an arbitrary table correctly and reports when it is over the cap', () => {
    const next = rng(7);
    const table = Uint8Array.from({ length: INPUT_SPACE }, () => next() & 31);
    const compiled = compileRule(table);
    expect(firstMismatch(compiled.netlist, table)).toBeNull();
    expect(compiled.gates).toBeGreaterThan(RULE_SHAPE.maxNand);
    expect(compiled.withinCap).toBe(false);
  });

  it('works for any variable order on a small circuit', () => {
    const table = Uint8Array.from({ length: 16 }, (_, x) => ((x * 7 + 3) >> 1) & 7);
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0], [2, 0, 3, 1]]) {
      expect(firstMismatch(compileWithOrder(table, order, 4, 3), table)).toBeNull();
    }
    expect(() => compileWithOrder(table, [0, 1, 2], 4, 3)).toThrow(RangeError);
    expect(() => compileWithOrder(table, [0, 1, 2, 2], 4, 3)).toThrow(RangeError);
  });
});
