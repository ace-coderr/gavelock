import { STAGE_TEXT } from '../lib/stages.ts';
import { nibbles } from './Pictures.tsx';

/** Real values the stage pictures are drawn from: every outcome of a rule, and the current drand round. */
export interface DialData {
  words: readonly number[];
  round: number;
}

const eligible = (w: number) => (w & 1) === 1;
const score = (w: number) => w >> 1;
const TEXT_WORDS = Object.values(STAGE_TEXT).join(' ').split(/\s+/);
const style = (vars: Record<string, string | number>) => vars as React.CSSProperties;

function Lock({ open, y = 0 }: { open?: boolean; y?: number }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <path className={open ? 'dial-shackle dial-shackle--open' : 'dial-shackle'} d="M-17 -2 V-20 a17 17 0 0 1 34 0 V-2" />
      <rect className="dial-lockbody" x="-26" y="-2" width="52" height="38" rx="7" />
      <circle className="dial-keyhole" cx="0" cy="14" r="5" />
    </g>
  );
}

/** I. The rule table appears, then locks. A 16 by 8 sample of the rule's real outcomes. */
function Published({ words }: DialData) {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 16; c++) {
      const k = r * 16 + c;
      const w = words[k * 16 + ((k * 7) % 16)] ?? 0;
      const o = eligible(w) ? 0.3 + (score(w) / 15) * 0.7 : 0.1;
      cells.push(<rect key={`${r}-${c}`} className="dial-cell" x={-104 + c * 13} y={-84 + r * 13} width="11" height="11" rx="2" style={style({ '--d': `${(r + c) * 38}ms`, '--o': o })} />);
    }
  }
  return (
    <g>
      {cells}
      <g className="dial-lockwrap" transform="translate(0 56) scale(0.7)">
        <Lock />
      </g>
    </g>
  );
}

/** II. Question and answer lines type in; their lengths are the words of the stage descriptions. */
function Clarifications() {
  const lines = [0, 1, 2, 3].map((k) => {
    const bars: { x: number; w: number }[] = [];
    let x = -84;
    for (let i = k * 6; ; i++) {
      const w = Math.max(10, (TEXT_WORDS[i % TEXT_WORDS.length]!.length) * 5.4);
      if (x + w > 104) break;
      bars.push({ x, w });
      x += w + 5;
    }
    return bars;
  });
  return (
    <g>
      {lines.map((bars, k) => (
        <g key={k} transform={`translate(0 ${-60 + k * 30})`}>
          <text className="dial-qa" x="-104" y="5">{k % 2 === 0 ? 'Q' : 'A'}</text>
          <g className="dial-type" style={style({ '--d': `${k * 700}ms` })}>
            {bars.map((b, i) => (
              <rect key={i} className={k % 2 === 0 ? 'dial-bar dial-bar--q' : 'dial-bar'} x={b.x} y="-4" width={b.w} height="8" rx="4" />
            ))}
          </g>
        </g>
      ))}
    </g>
  );
}

/** III. The seal closes with a click, and a countdown ring runs. The wedges are the current drand round. */
function Bidding({ round }: DialData) {
  const n = nibbles(round);
  return (
    <g>
      <circle className="dial-countdown-track" r="118" />
      <circle className="dial-countdown" r="118" transform="rotate(-90)" />
      <g className="dial-seal">
        {Array.from({ length: 24 }, (_, i) => (
          <line key={i} x1="0" y1="-30" x2="0" y2={-30 - (8 + (n[i % n.length]! / 15) * 34)} transform={`rotate(${i * 15})`} className="dial-wedge" style={style({ '--o': 0.5 + (n[(i * 3) % n.length]! / 15) * 0.5 })} />
        ))}
      </g>
      <circle className="dial-seal-ring" r="26" />
      <circle className="dial-seal-core" r="9" />
      <circle className="dial-click" r="30" />
    </g>
  );
}

/** IV. Frosted glass clears and sealed receipts split open. Their text is the current drand round, in hex. */
function Opening({ round }: DialData) {
  const hex = round.toString(16).padStart(24, '0');
  const rows = [-52, -8, 36];
  return (
    <g>
      <defs>
        <filter id="dial-frost" x="-10%" y="-40%" width="120%" height="180%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
        <clipPath id="dial-clip-top" clipPathUnits="objectBoundingBox">
          <rect x="-1" y="-1" width="3" height="1.5" />
        </clipPath>
        <clipPath id="dial-clip-bottom" clipPathUnits="objectBoundingBox">
          <rect x="-1" y="0.5" width="3" height="2" />
        </clipPath>
      </defs>
      {rows.map((y, k) => {
        const text = `0x${hex.slice(k * 6, k * 6 + 12)}`;
        const body = (
          <>
            <rect className="dial-receipt" x="-88" y={y} width="176" height="34" rx="7" />
            <text className="dial-receipt-text" x="-76" y={y + 21}>{text}</text>
          </>
        );
        return (
          <g key={y} style={style({ '--d': `${k * 260}ms` })}>
            <g className="dial-frosted" filter="url(#dial-frost)">{body}</g>
            <g className="dial-top" clipPath="url(#dial-clip-top)">{body}</g>
            <g className="dial-bottom" clipPath="url(#dial-clip-bottom)">{body}</g>
            <line className="dial-seam" x1="-88" y1={y + 17} x2="88" y2={y + 17} />
          </g>
        );
      })}
    </g>
  );
}

/** V. Panel seats light up one by one; each shows a score read from the rule. */
function Evaluation({ words, round }: DialData) {
  const seats = [-62, -31, 0, 31, 62].map((deg, k) => {
    const a = (deg * Math.PI) / 180;
    const w = words[(round * (k + 3) * 97) % words.length] ?? 0;
    return { x: 96 * Math.sin(a), y: 52 - 96 * Math.cos(a) + (k === 2 ? 0 : 0), s: score(w), k };
  });
  return (
    <g>
      {seats.map((s) => (
        <g key={s.k} transform={`translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`}>
          <g className="dial-seat" style={style({ '--d': `${s.k * 480}ms` })}>
            <circle r="19" className="dial-seat-disc" />
            <text className="dial-seat-no" textAnchor="middle" dominantBaseline="central">{s.s}</text>
          </g>
        </g>
      ))}
      <text className="dial-hint" x="0" y="72" textAnchor="middle">scores revealed one by one</text>
    </g>
  );
}

/** VI. A gavel strikes, the scene shakes, and the winning row lights up. Scores are read from the rule. */
function Awarded({ words, round }: DialData) {
  const picks: number[] = [];
  for (let t = 1; picks.length < 4 && t < 400; t++) {
    const w = words[(round * t * 131) % words.length] ?? 0;
    if (eligible(w)) picks.push(score(w));
  }
  while (picks.length < 4) picks.push(0);
  picks.sort((a, b) => b - a);
  return (
    <g className="dial-shake">
      {picks.map((s, k) => (
        <g key={k} transform={`translate(-106 ${-48 + k * 26})`}>
          <rect className={k === 0 ? 'dial-row dial-row--win' : 'dial-row'} x="0" y="-9" width={30 + s * 6} height="18" rx="9" />
          <text className="dial-row-no" x={36 + s * 6} y="1" dominantBaseline="central">{s}</text>
        </g>
      ))}
      <rect className="dial-block" x="26" y="12" width="56" height="11" rx="3" />
      <g transform="translate(124 -10)"><g className="dial-gavel">
        <line className="dial-handle" x1="0" y1="0" x2="-66" y2="0" />
        <rect className="dial-head" x="-82" y="-22" width="18" height="44" rx="4" />
      </g></g>
    </g>
  );
}

/** VII. A timer ring, with a notch where challenges are still open. */
function Standstill() {
  const notch = (-90 + 0.72 * 360) * (Math.PI / 180);
  return (
    <g>
      <circle className="dial-countdown-track" r="98" />
      <circle className="dial-timer" r="98" transform="rotate(-90)" />
      <g className="dial-hand">
        <line x1="0" y1="0" x2="0" y2="-82" />
      </g>
      <g transform={`translate(${(98 * Math.cos(notch)).toFixed(1)} ${(98 * Math.sin(notch)).toFixed(1)}) rotate(${(0.72 * 360).toFixed(0)})`}>
        <rect className="dial-notch" x="-3" y="-14" width="6" height="28" rx="2" />
      </g>
      <text className="dial-hint" x="0" y="10" textAnchor="middle">challenge window</text>
    </g>
  );
}

/** VIII. The lock opens and the shackle lifts. */
function Final() {
  return (
    <g transform="scale(1.7)">
      <Lock open y={-6} />
    </g>
  );
}

const CAPTIONS = ['Rule locked', 'Questions, answered on chain', 'Sealed until the deadline', 'The glass clears, bids open', 'Panel scores, revealed', 'Gavel: the award', 'Open for challenges', 'Final: the lock is open'];

/** The picture inside the dial for one stage. Remounted on every stage change, so it plays from the start. */
export function DialScene({ stage, data }: { stage: number; data: DialData }) {
  const body = [<Published key="0" {...data} />, <Clarifications key="1" />, <Bidding key="2" {...data} />, <Opening key="3" {...data} />, <Evaluation key="4" {...data} />, <Awarded key="5" {...data} />, <Standstill key="6" />, <Final key="7" />][stage];
  return (
    <g className="dial-scene" key={stage}>
      {body}
      <text className="dial-caption" x="0" y="118" textAnchor="middle">{CAPTIONS[stage]}</text>
    </g>
  );
}
