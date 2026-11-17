import { useRef, useState, type ReactNode } from 'react';

/** A choice among a few options. A struck-through option is unavailable and says why in its title. */
export function Chips<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string; unavailable?: string }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" className="chip" aria-checked={value === o.value} aria-disabled={Boolean(o.unavailable)} title={o.unavailable} onClick={() => !o.unavailable && onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} onClick={() => onChange(!checked)} style={{ background: 'none', border: 0, color: 'inherit', font: 'inherit', padding: 0, textAlign: 'left' }}>
      <span className="switch__track" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

/**
 * A horizontal row of cards. The mouse can drag it like a touch screen; touch and the keyboard use the
 * browser's own scrolling, so nothing here replaces those.
 */
export function DragRow({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  return (
    <div
      ref={ref}
      className={`dragrow${dragging ? ' is-dragging' : ''}`}
      role="group"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') return;
        start.current = { x: e.clientX, left: ref.current!.scrollLeft, moved: false };
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = e.clientX - s.x;
        if (!s.moved && Math.abs(dx) > 4) {
          s.moved = true;
          setDragging(true);
          ref.current!.setPointerCapture(e.pointerId);
        }
        if (s.moved) ref.current!.scrollLeft = s.left - dx;
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onClickCapture={(e) => {
        // A drag that ended on a link must not also follow it.
        if (start.current?.moved) e.preventDefault();
      }}
    >
      {children}
    </div>
  );
}
