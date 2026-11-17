import { roman } from '../lib/motion.ts';
import { shortAddress } from '../lib/format.ts';

export type SeatState = 'empty' | 'committed' | 'revealed';

/** The evaluation panel as seats on an arc. A seat shows a gold ring once its member commits and fills when they reveal. */
export function PanelSeats({ seats }: { seats: { address: string; state: SeatState; you?: boolean }[] }) {
  const n = seats.length;
  const label = seats.map((s, i) => `Seat ${i + 1}, ${shortAddress(s.address)}: ${s.state === 'empty' ? 'has not committed' : s.state === 'committed' ? 'committed, not yet revealed' : 'revealed'}`).join('. ');
  return (
    <svg className="seats" viewBox="-130 -90 260 110" role="img" aria-label={label}>
      {seats.map((s, i) => {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const a = Math.PI * (1 - t);
        const x = 105 * Math.cos(a);
        const y = -75 * Math.sin(a);
        return (
          <g key={s.address} className={`seat is-${s.state}`} transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}>
            <circle r="15" className="seat__ring" />
            <text className="seat__text">{roman(i + 1)}</text>
            {s.you && <circle r="19" fill="none" stroke="var(--color-cream)" strokeWidth="1" strokeDasharray="2 3" />}
          </g>
        );
      })}
    </svg>
  );
}
