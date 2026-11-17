import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from '../lib/motion.ts';

const BRUSH = 30; // radius in CSS pixels
const MASK_SCALE = 0.5; // the mask is drawn at half size: it is only a soft stencil

/**
 * Frosted glass over some content, with a giant word behind it. Wiping (mouse, pen or touch) clears the glass
 * where you rub; "Clear the glass" and "Frost it again" do the same without dragging. With reduced motion the
 * glass is not drawn at all and the content is simply shown.
 *
 * The blurred copy is the same content, hidden from assistive technology, so what is under the glass is
 * never different from what is revealed.
 */
export function GlassWipe({ word, hint, children }: { word: string; hint: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  const wrap = useRef<HTMLDivElement>(null);
  const frost = useRef<HTMLDivElement>(null);
  const mask = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const timer = useRef(0);
  const [cleared, setCleared] = useState(false);

  const paint = useCallback(() => {
    timer.current = 0;
    const c = mask.current;
    const el = frost.current;
    if (!c || !el) return;
    const url = `url(${c.toDataURL()})`;
    el.style.maskImage = url;
    el.style.setProperty('-webkit-mask-image', url);
  }, []);

  const frostAgain = useCallback(() => {
    const w = wrap.current;
    if (!w) return;
    const c = (mask.current ??= document.createElement('canvas'));
    c.width = Math.max(1, Math.round(w.clientWidth * MASK_SCALE));
    c.height = Math.max(1, Math.round(w.clientHeight * MASK_SCALE));
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    setCleared(false);
    paint();
  }, [paint]);

  useEffect(() => {
    if (reduced) return;
    frostAgain();
    const w = wrap.current;
    if (!w || typeof ResizeObserver === 'undefined') return;
    // Rebuilding the stencil on resize frosts the glass again, which is the honest result of a new size.
    let width = w.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(w.clientWidth - width) > 2) {
        width = w.clientWidth;
        frostAgain();
      }
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, [reduced, frostAgain]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const wipe = (e: React.PointerEvent) => {
    const c = mask.current;
    const w = wrap.current;
    if (!c || !w) return;
    const r = w.getBoundingClientRect();
    const x = (e.clientX - r.left) * MASK_SCALE;
    const y = (e.clientY - r.top) * MASK_SCALE;
    const ctx = c.getContext('2d')!;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineCap = 'round';
    ctx.lineWidth = BRUSH * 2 * MASK_SCALE;
    ctx.beginPath();
    ctx.moveTo(last.current?.x ?? x, last.current?.y ?? y);
    ctx.lineTo(x, y);
    ctx.stroke();
    last.current = { x, y };
    if (!timer.current) timer.current = window.setTimeout(paint, 33); // at most about 30 repaints a second
  };

  if (reduced) {
    return (
      <div className="glass is-cleared">
        <div className="glass__word" aria-hidden="true">{word}</div>
        <div className="glass__clear">{children}</div>
      </div>
    );
  }

  return (
    <div ref={wrap} className={`glass${cleared ? ' is-cleared' : ''}`}>
      <div className="glass__word" aria-hidden="true">{word}</div>
      <div className="glass__clear">{children}</div>
      <div ref={frost} className="glass__frost" aria-hidden="true" {...{ inert: true }}>
        <div className="glass__word">{word}</div>
        <div className="glass__clear">{children}</div>
        <div className="glass__tint" />
      </div>
      <div
        className="glass__surface"
        onPointerDown={(e) => {
          last.current = null;
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          wipe(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons || e.pointerType === 'touch') wipe(e);
        }}
        onPointerUp={() => {
          last.current = null;
        }}
        onPointerCancel={() => {
          last.current = null;
        }}
      />
      <div className="glass__hint">
        <span className="glass__pill" aria-hidden="true">Wipe the glass to look inside</span>
        <button type="button" className="glass__pill" onClick={() => setCleared(true)} disabled={cleared}>
          Clear the glass
        </button>
        {cleared && (
          <button type="button" className="glass__pill" onClick={frostAgain}>
            Frost it again
          </button>
        )}
      </div>
      <span className="visually-hidden">{hint}</span>
    </div>
  );
}
