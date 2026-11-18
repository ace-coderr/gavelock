import { useEffect, useRef, useState } from 'react';
import { Reveal } from './Reveal.tsx';
import { useReducedMotion } from '../lib/motion.ts';

/** A padlock. Drawn closed; when it scrolls into view the shackle lifts away and snaps shut again with a click. */
function LockPic() {
  return (
    <svg viewBox="-32 -36 64 80" style={{ aspectRatio: '64 / 80' }} role="img" aria-label="A closed padlock">
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
const GAP = 1.2;
const OUT_X = 11 * CELL + 10;
const ROWS = 5;

/**
 * A rule as a small table: each row is one possible input (eleven bits, filled where the bit is 1) on the left and
 * the outcome the rule gives it on the right (eligible, then four score bits). Drawn complete; on scroll-in the
 * cells fill in one by one. The rows are real outcomes of the rule.
 */
function RuleMiniPic({ words }: { words: readonly number[] }) {
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    const input = Math.floor((r * 2047) / (ROWS - 1));
    const word = words[input] ?? 0;
    for (let b = 0; b < 11; b++) {
      cells.push(<rect key={`i${r}-${b}`} className={(input >> b) & 1 ? 'hpic-on' : 'hpic-off'} x={b * CELL} y={r * CELL} width={CELL - GAP} height={CELL - GAP} rx="1" style={{ ['--d' as string]: `${(r * 11 + b) * 18}ms` }} />);
    }
    for (let b = 0; b < 5; b++) {
      cells.push(<rect key={`o${r}-${b}`} className={(word >> b) & 1 ? 'hpic-out hpic-out--on' : 'hpic-out'} x={OUT_X + b * CELL} y={r * CELL} width={CELL - GAP} height={CELL - GAP} rx="1" style={{ ['--d' as string]: `${(ROWS * 11 + r * 5 + b) * 18}ms` }} />);
    }
  }
  const width = OUT_X + 5 * CELL - GAP;
  const height = ROWS * CELL - GAP;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ aspectRatio: `${width} / ${height}` }} role="img" aria-label="A rule as a table: five inputs on the left, the score the rule gives each on the right">
      {cells}
      <path d={`M${11 * CELL + 1.5} ${height / 2} h5.5 m-2.2 -2.2 l2.2 2.2 l-2.2 2.2`} className="hpic-arrow" />
    </svg>
  );
}

/** Adds `is-play` once the element is mostly on screen. Without it (no script, reduced motion) the picture simply stays finished. */
function usePlayOnView(ref: React.RefObject<HTMLElement | null>): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add('is-play');
          io.disconnect();
        }
      },
      { threshold: 0.7 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, reduced]);
}

/**
 * The headline with two pictures set in its line, and one caption under each in a row below. Both pictures are
 * finished by default and only play their animation as they scroll in. On a phone the captions are hidden until
 * the picture is tapped.
 */
export function PicHeadline({ words }: { words: readonly number[] }) {
  const lock = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState({ lock: false, grid: false });
  usePlayOnView(lock);
  usePlayOnView(grid);
  return (
    <>
      <Reveal as="h2" className="display band__title pichead">
        <span id="pics-title">
          A sealed{' '}
          <button ref={lock} type="button" className="hpic hpic--lock" aria-expanded={open.lock} aria-controls="cap-lock" onClick={() => setOpen((o) => ({ ...o, lock: !o.lock }))}>
            <LockPic />
          </button>{' '}
          bid, a public{' '}
          <button ref={grid} type="button" className="hpic hpic--grid" aria-expanded={open.grid} aria-controls="cap-grid" onClick={() => setOpen((o) => ({ ...o, grid: !o.grid }))}>
            <RuleMiniPic words={words} />
          </button>{' '}
          rule, a result <em>anyone can check.</em>
        </span>
      </Reveal>
      <ul className="piccaps">
        <li id="cap-lock" className={open.lock ? 'is-open' : ''}>
          <strong>Sealed bid</strong> Locked with a time-lock until the deadline.
        </li>
        <li id="cap-grid" className={open.grid ? 'is-open' : ''}>
          <strong>Public rule</strong> Anyone can see every outcome.
        </li>
      </ul>
    </>
  );
}
