import { useState } from 'react';
import { useReveal } from '../lib/motion.ts';

/**
 * A picture set inside a line of a headline, with its caption underneath. On a wide screen the caption is
 * always shown; on a phone it appears when the picture is tapped. The picture plays when it scrolls into view.
 */
export function HeadlinePic({ caption, children }: { caption: string; children: React.ReactNode }) {
  const ref = useReveal<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  return (
    <button ref={ref} type="button" className={`hpic${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
      <span className="hpic__art">{children}</span>
      <span className="hpic__cap">{caption}</span>
    </button>
  );
}

/** A padlock that closes with a click when it scrolls into view. */
export function LockPic() {
  return (
    <svg viewBox="-32 -36 64 80" style={{ aspectRatio: '64 / 80' }} role="img" aria-label="A padlock closing">
      <path className="hpic-shackle" d="M-13 0 V-14 a13 13 0 0 1 26 0 V0" />
      <rect className="hpic-body" x="-20" y="0" width="40" height="30" rx="6" />
      <circle className="hpic-key" cx="0" cy="15" r="4" />
      <g className="hpic-click">
        <line x1="-26" y1="-6" x2="-30" y2="-10" />
        <line x1="26" y1="-6" x2="30" y2="-10" />
        <line x1="0" y1="-34" x2="0" y2="-30" />
      </g>
    </svg>
  );
}

const CELL = 6;
const OUT_X = 11 * CELL + 9;

/**
 * A rule laid out small and readable: each row is one possible input (eleven bits) and the outcome the rule
 * gives for it (eligible, then four score bits). Cells fill in one by one. The rows are real outcomes of the rule.
 */
export function RuleMiniPic({ words }: { words: readonly number[] }) {
  const rows = 6;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    const input = Math.floor((r * 2047) / (rows - 1));
    const word = words[input] ?? 0;
    for (let b = 0; b < 11; b++) {
      cells.push(
        <rect key={`i${r}-${b}`} className={(input >> b) & 1 ? 'hpic-on' : 'hpic-off'} x={b * CELL} y={r * CELL} width={CELL - 1.2} height={CELL - 1.2} rx="1" style={{ ['--d' as string]: `${(r * 11 + b) * 22}ms` }} />,
      );
    }
    for (let b = 0; b < 5; b++) {
      cells.push(
        <rect key={`o${r}-${b}`} className={(word >> b) & 1 ? 'hpic-out hpic-out--on' : 'hpic-out'} x={OUT_X + b * CELL} y={r * CELL} width={CELL - 1.2} height={CELL - 1.2} rx="1" style={{ ['--d' as string]: `${(rows * 11 + r * 5 + b) * 22}ms` }} />,
      );
    }
  }
  const width = OUT_X + 5 * CELL;
  const mid = (rows * CELL) / 2;
  return (
    <svg viewBox={`-1 -1 ${width + 1} ${rows * CELL + 1}`} style={{ aspectRatio: `${width + 1} / ${rows * CELL + 1}` }} role="img" aria-label="Six inputs of a rule on the left and the score the rule gives each on the right">
      {cells}
      <path d={`M${11 * CELL + 1} ${mid} h6 m-2.5 -2.5 l2.5 2.5 l-2.5 2.5`} className="hpic-arrow" />
    </svg>
  );
}
