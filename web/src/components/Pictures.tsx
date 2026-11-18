import { useEffect, useRef, useState } from 'react';
import { useReveal } from '../lib/motion.ts';

/** Eight bits per byte of a hex string or number, as a flat list of 0..15 nibbles. */
function nibbles(seed: string | number): number[] {
  const hex = typeof seed === 'number' ? seed.toString(16) : seed.replace(/^0x/, '');
  return Array.from(hex.padStart(32, '0')).map((c) => parseInt(c, 16) || 0);
}

/**
 * A wax-seal-like picture drawn from a real value (a bid's commitment, or the current drand round): a ring of
 * wedges whose lengths come from the value's digits. The same value always draws the same seal.
 */
export function SealPic({ seed, label }: { seed: string | number; label: string }) {
  const n = nibbles(seed);
  const wedges = 24;
  return (
    <svg viewBox="-50 -24 100 48" role="img" aria-label={label}>
      <g>
        {Array.from({ length: wedges }, (_, i) => {
          const len = 6 + (n[i % n.length]! / 15) * 12;
          return <line key={i} x1="0" y1="-9" x2="0" y2={-9 - len} transform={`rotate(${(i * 360) / wedges})`} stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" opacity={0.45 + (n[(i * 3) % n.length]! / 15) * 0.55} />;
        })}
        <circle r="7" fill="none" stroke="var(--color-cream)" strokeWidth="1.4" />
        <circle r="2.4" fill="var(--color-cream)" />
      </g>
    </svg>
  );
}

export const GRID_W = 64;
export const GRID_H = 32;

/**
 * Every outcome of a rule at once: 2,048 cells, one per possible input, dark when the bid would be
 * ineligible and brighter with a higher score. `words` are the rule's outputs in input order.
 */
export function RuleGridPic({ words, label, scale = 1 }: { words: readonly (number | null)[]; label: string; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = ctx.createImageData(GRID_W, GRID_H);
    for (let i = 0; i < GRID_W * GRID_H; i++) {
      const w = words[i];
      const o = i * 4;
      if (w === null || w === undefined) {
        image.data.set([60, 54, 46, 255], o); // unanswered
      } else if ((w & 1) === 0) {
        image.data.set([23, 21, 18, 255], o); // not eligible
      } else {
        const score = w >> 1; // 0..15
        const t = 0.25 + (score / 15) * 0.75;
        image.data.set([Math.round(197 * t), Math.round(161 * t), Math.round(90 * t), 255], o);
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [words]);
  return <canvas ref={ref} width={GRID_W} height={GRID_H} role="img" aria-label={label} style={{ width: '100%', height: '100%', imageRendering: 'pixelated', display: 'block', minWidth: scale > 1 ? `${GRID_W * scale}px` : undefined }} />;
}

