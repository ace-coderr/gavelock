import { useCallback, useEffect, useRef, useState } from 'react';
import { roman, useReducedMotion } from '../lib/motion.ts';
import { STAGES, STAGE_TEXT, stageIndex } from '../lib/stages.ts';
import type { PhaseName } from '../lib/tenders.ts';

const N = STAGES.length;
const STEP = 360 / N;
/** Viewport heights of scrolling given to each stage while the hero is pinned. */
const VH_PER_STAGE = 0.7;

export interface LiveStage {
  id: bigint;
  phase: PhaseName;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The blur-out / blur-in swap of the stage title and text. */
function StageText({ stage }: { stage: number }) {
  const [shown, setShown] = useState(stage);
  const [leaving, setLeaving] = useState(false);
  const latest = useRef(stage);
  const timer = useRef(0);
  latest.current = stage;
  useEffect(() => {
    if (stage === shown || timer.current) return;
    // One blur-out, then show whichever stage is current by then: a fast scroll never starves the text.
    setLeaving(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setShown(latest.current);
      setLeaving(false);
    }, 190);
  }, [stage, shown]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const name = STAGES[shown]!;
  return (
    <div className={`wheel__swap${leaving ? ' is-leaving' : ''}`} aria-live="polite" aria-atomic="true">
      <span className="wheel__numeral" aria-hidden="true">{roman(shown + 1)}</span>
      <h2 className="display wheel__stage-title">{name}</h2>
      <p className="wheel__stage-text">{STAGE_TEXT[name]}</p>
    </div>
  );
}

/**
 * The eight tender stages on a wheel. Pinned mode keeps the hero fixed while scrolling turns the wheel;
 * compact mode turns by button, key or drag. Reduced motion always uses compact behaviour.
 * `live` marks a real tender's stage; without it the wheel says it is an explainer.
 */
export function StageWheel({ live, mode = 'pinned' }: { live?: LiveStage | null; mode?: 'pinned' | 'compact' }) {
  const reduced = useReducedMotion();
  const pinned = mode === 'pinned' && !reduced;
  const section = useRef<HTMLElement>(null);
  const disc = useRef<SVGSVGElement>(null);
  const ring = useRef<SVGGElement>(null);
  const [stage, setStage] = useState(0);
  const target = useRef(0); // fractional stage the wheel is turning to
  const current = useRef(0); // fractional stage drawn now
  const frame = useRef(0);
  const liveIndex = live ? stageIndex(live.phase) : null;

  const draw = useCallback(() => {
    frame.current = 0;
    const diff = target.current - current.current;
    current.current = Math.abs(diff) < 0.002 ? target.current : current.current + diff * (reduced ? 1 : 0.14);
    ring.current?.setAttribute('transform', `rotate(${(-current.current * STEP).toFixed(2)})`);
    section.current?.style.setProperty('--p', String(clamp(current.current / (N - 1), 0, 1).toFixed(4)));
    if (current.current !== target.current) frame.current = requestAnimationFrame(draw);
  }, [reduced]);

  const aim = useCallback(
    (f: number) => {
      target.current = clamp(f, 0, N - 1);
      setStage(Math.round(target.current));
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    },
    [draw],
  );

  // Pinned: the scroll position is the single source of truth.
  useEffect(() => {
    if (!pinned) return;
    const el = section.current;
    if (!el) return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      aim((range > 0 ? clamp(-rect.top / range, 0, 1) : 0) * (N - 1));
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [pinned, aim]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    if (!pinned) aim(stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned]);

  /** Go to a stage: scroll to it when pinned, otherwise turn directly. */
  const go = useCallback(
    (i: number) => {
      const n = clamp(i, 0, N - 1);
      const el = section.current;
      if (pinned && el) {
        const range = el.offsetHeight - window.innerHeight;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY + (n / (N - 1)) * range, behavior: reduced ? 'auto' : 'smooth' });
      } else {
        aim(n);
      }
    },
    [pinned, aim, reduced],
  );

  // Dragging the wheel: the angle the pointer sweeps becomes the number of stages turned.
  const drag = useRef<{ angle: number; start: number } | null>(null);
  const angleOf = (e: React.PointerEvent) => {
    const r = disc.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const onDown = (e: React.PointerEvent) => {
    drag.current = { angle: angleOf(e), start: target.current };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    let delta = angleOf(e) - d.angle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const f = clamp(d.start - delta / STEP, 0, N - 1);
    if (pinned && section.current) {
      const range = section.current.offsetHeight - window.innerHeight;
      window.scrollTo({ top: section.current.getBoundingClientRect().top + window.scrollY + (f / (N - 1)) * range, behavior: 'auto' });
    } else {
      aim(f);
    }
  };
  const onUp = () => {
    drag.current = null;
    if (!pinned) aim(Math.round(target.current));
  };
  const onKey = (e: React.KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowRight: stage + 1, ArrowDown: stage + 1, ArrowLeft: stage - 1, ArrowUp: stage - 1, Home: 0, End: N - 1 };
    if (e.key in keys) {
      e.preventDefault();
      go(keys[e.key]!);
    }
  };

  const name = STAGES[stage]!;
  return (
    <section
      ref={section}
      className={`wheel ${pinned ? 'wheel--pinned' : 'wheel--compact'}`}
      style={pinned ? { height: `${(1 + (N - 1) * VH_PER_STAGE) * 100}vh` } : undefined}
      aria-label="The eight stages of a tender"
    >
      <div className="wheel__stick">
        <div className="wheel__copy container">
          <p className="eyebrow">
            {live && liveIndex !== null
              ? `Live: tender ${live.id.toString()} is at stage ${liveIndex + 1}, ${live.phase}`
              : live
                ? `Live: tender ${live.id.toString()} is ${live.phase.toLowerCase()}`
                : 'An explainer: how every tender moves. No tender is on chain yet.'}
          </p>
          {mode === 'pinned' ? (
            <h1 className="display wheel__headline">
              Tenders nobody can <em>quietly bend.</em>
            </h1>
          ) : (
            <h2 className="display wheel__headline">
              Every tender takes <em>eight steps.</em>
            </h2>
          )}
          <div className="wheel__counter">
            <span>
              Stage {stage + 1} of {N}
            </span>
            <svg className="wheel__line" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" y1="2" x2="100" y2="2" className="wheel__line-track" />
              <line x1="0" y1="2" x2="100" y2="2" className="wheel__line-fill" />
            </svg>
          </div>
          <StageText stage={stage} />
          <div className="wheel__controls">
            <button type="button" className="button" onClick={() => go(stage - 1)} disabled={stage === 0} aria-label="Previous stage">
              Back
            </button>
            <button type="button" className="button button--solid" onClick={() => go(stage + 1)} disabled={stage === N - 1} aria-label="Next stage">
              Next stage
            </button>
          </div>
        </div>

        <svg
          ref={disc}
          className="wheel__disc"
          viewBox="-210 -210 420 420"
          role="slider"
          tabIndex={0}
          aria-label="Tender stage"
          aria-orientation="horizontal"
          aria-valuemin={1}
          aria-valuemax={N}
          aria-valuenow={stage + 1}
          aria-valuetext={`Stage ${stage + 1} of ${N}: ${name}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
        >
          <circle r="204" className="wheel__rim" />
          <circle r="168" className="wheel__hair" />
          <circle r="70" className="wheel__hair" />
          <g ref={ring}>
            {Array.from({ length: 96 }, (_, k) => (
              <line key={k} x1="0" y1="-168" x2="0" y2={k % 12 === 0 ? -158 : -163} transform={`rotate(${k * 3.75})`} className="wheel__tick" />
            ))}
            {STAGES.map((s, i) => {
              const phi = (180 + i * STEP) * (Math.PI / 180);
              const x = 186 * Math.cos(phi);
              const y = 186 * Math.sin(phi);
              const isLive = liveIndex === i;
              return (
                <g key={s}>
                  <line x1={70 * Math.cos(phi)} y1={70 * Math.sin(phi)} x2={168 * Math.cos(phi)} y2={168 * Math.sin(phi)} className="wheel__spoke" />
                  <text x={x} y={y} transform={`rotate(${i * STEP} ${x} ${y})`} className={`wheel__glyph${i === stage ? ' is-active' : ''}`} textAnchor="middle" dominantBaseline="central">
                    {roman(i + 1)}
                  </text>
                  {isLive && <circle cx={150 * Math.cos(phi)} cy={150 * Math.sin(phi)} r="5" className="wheel__live" />}
                </g>
              );
            })}
          </g>
          <circle r="5" className="wheel__hub" />
        </svg>
      </div>
    </section>
  );
}
