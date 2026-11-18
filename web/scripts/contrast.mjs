// Checks the contrast of the colour pairs the interface actually uses, straight from tokens.css.
// WCAG 2.2: normal text needs 4.5:1, large text and interface outlines 3:1.
//   node web/scripts/contrast.mjs
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const token = (name) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (!m) throw new Error(`token ${name} is not a plain hex colour`);
  return m[1];
};
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [foreground, background, minimum, where it is used]
const pairs = [
  ['color-text', 'color-bg', 4.5, 'body text'],
  ['color-text', 'color-surface', 4.5, 'text on cards'],
  ['color-text', 'color-surface-raised', 4.5, 'text on raised cards and receipts'],
  ['color-text-muted', 'color-bg', 4.5, 'secondary text'],
  ['color-text-muted', 'color-surface', 4.5, 'secondary text on cards'],
  ['color-text-muted', 'color-surface-raised', 4.5, 'secondary text on receipts'],
  ['color-text-faint', 'color-bg', 4.5, 'captions, eyebrows, labels'],
  ['color-text-faint', 'color-surface', 4.5, 'labels on cards'],
  ['color-text-faint', 'color-surface-raised', 4.5, 'labels on receipts'],
  ['color-accent', 'color-bg', 4.5, 'gold italics, numerals, links'],
  ['color-accent', 'color-surface', 4.5, 'gold on cards'],
  ['color-text-inverse', 'color-cream', 4.5, 'solid pill buttons and selected chips'],
  ['color-ok', 'color-bg', 4.5, 'status text'],
  ['color-warn', 'color-bg', 4.5, 'status text'],
  ['color-danger', 'color-bg', 4.5, 'error text'],
  ['color-text', 'color-bg-deep', 4.5, 'text on the glass'],
  ['color-text-inverse', 'color-accent', 4.5, 'score numbers on the lit dial seats'],
  ['color-text-muted', 'color-bg-deep', 4.5, 'dial captions'],
  ['color-text-faint', 'color-bg-deep', 4.5, 'dial hints'],
  ['color-accent', 'color-bg-deep', 4.5, 'dial numerals and receipts text'],
  ['color-text-muted', 'color-surface', 4.5, 'footer text and links'],
  ['color-text-faint', 'color-bg', 4.5, 'footer limits note'],
  ['color-focus', 'color-bg', 3, 'focus outline'],
];
let failed = 0;
for (const [fg, bg, min, use] of pairs) {
  const r = ratio(token(fg), token(bg));
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  (needs ${min})  ${fg} on ${bg}: ${use}`);
}
// Border colours are translucent cream: composite them over the background to measure them.
console.log(failed ? `\n${failed} pair(s) below the minimum` : '\nevery pair meets its minimum');
process.exit(failed ? 1 : 0);
