import { describe, expect, it } from 'vitest';
import { buildPdf } from './pdf.ts';

const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');
const BS = String.fromCharCode(92);

describe('pdf writer', () => {
  it('writes a structurally valid file: every xref offset points at its object', () => {
    const out = text(buildPdf([{ text: 'Hello (world) test', size: 14, bold: true }, { text: 'second paragraph' }]));
    expect(out.startsWith('%PDF-1.4\n')).toBe(true);
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(out)![1]);
    expect(out.slice(start, start + 4)).toBe('xref');
    const entries = [...out.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBeGreaterThanOrEqual(5);
    entries.forEach((offset, i) => expect(out.slice(offset).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });

  it('escapes parentheses and backslashes, and replaces characters the font cannot show', () => {
    // Input: a (b) \ c ’ é 中. Output must escape ( ) and \, turn ’ into ', and show ? for é and 中.
    const input = `a (b) ${BS} c ’ é 中`;
    const expected = `(a ${BS}(b${BS}) ${BS}${BS} c ' ? ?)`;
    expect(text(buildPdf([{ text: input }]))).toContain(expected);
  });

  it('paginates long text and wraps long unbroken words', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ text: `line ${i}` }));
    const out = text(buildPdf([...many, { text: '0x' + 'ab'.repeat(200) }]));
    const pages = Number(/\/Count (\d+)/.exec(out)![1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect((out.match(/\/Type \/Page /g) ?? []).length).toBe(pages);
    // No line may run past the right margin: the long hash is split over several text lines.
    expect((out.match(/\(0x[ab]*\) Tj|\([ab]+\) Tj/g) ?? []).length).toBeGreaterThan(1);
  });
});
