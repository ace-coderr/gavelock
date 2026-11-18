import { useState, type ReactNode } from 'react';
import { roman } from '../lib/motion.ts';

export interface SplitRow {
  key: string;
  name: string;
  sub?: string;
  /** What appears beside the list while this row is hovered, focused or chosen. */
  detail: ReactNode;
}

/**
 * A fixed summary on the left and a numbered list on the right. Hovering (or focusing, or tapping) a row pulls
 * its detail up beside the list. On a phone the summary and detail stack above the list.
 */
export function SplitSection({ side, rows, title, onActive }: { side: ReactNode; rows: SplitRow[]; title: ReactNode; onActive?: (index: number) => void }) {
  const [active, setActive0] = useState(0);
  const setActive = (i: number) => {
    setActive0(i);
    onActive?.(i);
  };
  const row = rows[Math.min(active, rows.length - 1)];
  return (
    <div className="split" data-wheel-split="">
      <aside className="split__side" aria-label="Summary">
        <h2 className="display split__title">{title}</h2>
        {side}
        {row && (
          <div className="detail" key={row.key} aria-live="polite">
            {row.detail}
          </div>
        )}
      </aside>
      <ol className="split__list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r, i) => (
          <li key={r.key}>
            <button type="button" className={`split__row${i === active ? ' is-active' : ''}`} onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={() => setActive(i)} aria-pressed={i === active}>
              <span className="split__numeral" aria-hidden="true">{roman(i + 1)}</span>
              <span>
                <span className="split__name">{r.name}</span>
                {r.sub && <span className="split__sub" style={{ display: 'block' }}>{r.sub}</span>}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
