import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { roman, useReducedMotion } from '../lib/motion.ts';
import { STAGES, STAGE_TEXT, stageIndex } from '../lib/stages.ts';
import type { PhaseName } from '../lib/tenders.ts';
import { DialScene, type DialData } from './DialScenes.tsx';

// The sound module is fetched the first time the visitor switches sound on; until then it costs nothing.
type SoundModule = typeof import('../lib/sound.ts');
let sound: SoundModule | null = null;

const N = STAGES.length;
const STEP = 360 / N;
const BASE = 420; // the dial is laid out at this many pixels and scaled to wherever it sits
const NUMERAL_R = 172;

export interface LiveStage {
  id: bigint;
  phase: PhaseName;
}

type Mode = 'hero' | 'transit' | 'dock' | 'final' | 'hidden';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The blur-out / blur-in swap of the stage title and text. */
function StageText({ stage }: { stage: number }) {
  const [shown, setShown] = useState(stage);
  const [leaving, setLeaving] = useState(false);
  const latest = useRef(stage);
  const timer = useRef(0);
  latest.current = stage;
  useEffect(() => {
    if (stage === shown || timer.current) return;
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

/** The anchor the dial settles into at the end of the page. Put it just above the footer. */
export function WheelFinalSlot() {
  return (
    <section className="wheel-final" aria-labelledby="wheel-final-title">
      <h2 className="display wheel-final__title" id="wheel-final-title">
        And then it is <em>final.</em>
      </h2>
      <div className="wheel-final__slot" data-wheel-final="" />
      <p className="wheel-final__text">The lock is open. Deposits can be claimed, and everything that happened can be re-derived from the chain.</p>
    </section>
  );
}

/**
 * The one wheel on the landing page. It is a single fixed element driven by one scroll position:
 * large in the pinned hero, docked as a small dial while the reader scrolls, and back to full size in
 * the final slot above the footer. Scrolling, dragging, keys and buttons all turn the same dial.
 * `live` marks a real tender's stage; without it the page says the wheel is an explainer.
 */
export function LandingWheel({ live, sectionStage, data }: { live?: LiveStage | null; sectionStage: number; data: DialData }) {
  const reduced = useReducedMotion();
  const hero = useRef<HTMLElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const ring = useRef<SVGGElement>(null);
  const slow = useRef<SVGGElement>(null);
  const orientG = useRef<SVGGElement>(null);
  const glyphs = useRef<(SVGTextElement | null)[]>([]);
  const needle = useRef<SVGPathElement>(null);
  const flash = useRef<SVGCircleElement>(null);
  const [stage, setStage] = useState(0);
  const [mode, setMode] = useState<Mode>('hero');
  const [hint, setHint] = useState<number | null>(null);
  const [soundState, setSoundState] = useState(false);
  const liveIndex = live ? stageIndex(live.phase) : null;

  // Everything that changes on every frame lives in one ref, so a frame never waits for React.
  const sim = useRef({ cur: 0, vel: 0, manual: 0, lastScroll: 0, dockTarget: N - 1, shown: 0, mode: 'hero' as Mode, raf: 0, last: 0, timer: 0, transform: '', dragging: false, fling: 0, pinned: false, side: false, orient: 0, range: 1, heroTop: 0 });
  const sectionRef = useRef(sectionStage);
  sectionRef.current = sectionStage;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const hintTimer = useRef(0);

  const kick = useCallback(() => {
    if (reducedRef.current) return;
    needle.current?.animate([{ transform: 'rotate(-16deg)' }, { transform: 'rotate(7deg)', offset: 0.55 }, { transform: 'rotate(0deg)' }], { duration: 200, easing: 'ease-out' });
    flash.current?.animate([{ opacity: 0.85, transform: 'scale(0.6)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 320, easing: 'ease-out' });
  }, []);

  const frame = useCallback((now: number) => {
    const s = sim.current;
    s.raf = 0;
    const el = box.current;
    const slotEl = slot.current;
    const copyEl = copy.current;
    const stickEl = stick.current;
    const heroEl = hero.current;
    if (!el || !slotEl || !stickEl || !heroEl || !copyEl) return;
    const reducedNow = reducedRef.current;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const navH = document.querySelector<HTMLElement>('.nav')?.offsetHeight ?? 64;
    const phone = vw < 768;
    const slotR = slotEl.getBoundingClientRect();
    const finalEl = document.querySelector<HTMLElement>('[data-wheel-final]');
    const finalR = finalEl?.getBoundingClientRect() ?? null;
    const splitR = document.querySelector<HTMLElement>('[data-wheel-split]')?.getBoundingClientRect() ?? null;

    let hs = Math.min(slotR.width, slotR.height);
    let x = slotR.left + (slotR.width - hs) / 2;
    let y = slotR.top + (slotR.height - hs) / 2;
    let size = hs;
    let next: Mode = 'hero';
    let target = 0;
    let p = 0;
    let e1v = 0;
    let e2v = 0;

    if (reducedNow) {
      // No pinning, no docking: the dial sits in its hero slot, then in the final slot, and nowhere in between.
      target = s.manual;
      if (slotR.bottom > navH && slotR.top < vh) {
        next = 'hero';
      } else if (finalR && finalR.bottom > navH && finalR.top < vh) {
        next = 'final';
        size = Math.min(finalR.width, finalR.height);
        x = finalR.left + (finalR.width - size) / 2;
        y = finalR.top + (finalR.height - size) / 2;
        target = N - 1;
      } else {
        next = 'hidden';
      }
    } else {
      const stickR = stickEl.getBoundingClientRect();
      const heroR = heroEl.getBoundingClientRect();
      const range = Math.max(1, heroR.height - stickR.height);
      s.range = range;
      s.heroTop = heroR.top + window.scrollY;
      p = clamp((navH - heroR.top) / range, 0, 1);
      const d = clamp((vh - heroR.bottom) / (0.7 * stickR.height), 0, 1);
      const u = finalR ? clamp((vh - finalR.top) / (finalR.height + 0.15 * vh), 0, 1) : 0;
      // The big dial. Beside the copy (wide screens) its active stage sits at its left edge and the far side of the ring
      // bleeds off the right edge and the bottom. Under the copy (narrow screens) the active stage sits at its top and the
      // ring bleeds off the bottom. The needle, the active numeral and the picture in the middle are always on screen.
      const copyR = copyEl.getBoundingClientRect();
      const pinnedTop = navH; // where the hero's pinned area starts
      const shift = pinnedTop - stickR.top; // copy and slot rects, as they will be once pinned
      const side = vw >= 1024;
      let R: number;
      let cx: number;
      let cy: number;
      if (side) {
        const left = copyR.right + 28;
        R = clamp(Math.min(0.625 * vh, (vw - left - 16) / 1.56), 150, 2000);
        cx = left + R;
        cy = pinnedTop + stickR.height / 2;
      } else {
        const below = copyR.bottom + shift + 18;
        R = clamp((vh - below - 8) / 1.64, 110, 0.625 * vh);
        cx = vw / 2;
        cy = below + R;
      }
      s.side = side;
      hs = (2 * R * 210) / 204;
      x = cx - hs / 2;
      y = cy - hs / 2;
      const ds = phone ? 40 : 96;
      const dx = vw - ds - (phone ? 10 : 24);
      const dy = phone ? (navH - ds) / 2 : vh - ds - 24;
      const e1 = ease(d);
      x = lerp(x, dx, e1);
      y = lerp(y, dy, e1);
      size = lerp(hs, ds, e1);
      if (finalR && u > 0) {
        const fs = Math.min(finalR.width, finalR.height);
        const e2 = ease(u);
        e2v = e2;
        x = lerp(x, finalR.left + (finalR.width - fs) / 2, e2);
        y = lerp(y, finalR.top + (finalR.height - fs) / 2, e2);
        size = lerp(size, fs, e2);
      }
      e1v = e1;
      next = u >= 0.999 ? 'final' : u > 0 || (d > 0 && d < 1) ? 'transit' : d >= 1 ? 'dock' : 'hero';
      if (splitR) s.dockTarget = splitR.top >= vh * 0.8 ? N - 1 : sectionRef.current;
      target = u > 0.35 ? N - 1 : d === 0 ? p * (N - 1) : s.dockTarget;
    }
    s.pinned = !reducedNow;

    // The active stage sits at the left of the dial in the side layout, and turns to the top as the dial docks.
    const orient = reducedNow || !s.side ? 0 : -90 * (1 - Math.max(e1v, e2v));
    if (orient !== s.orient) {
      s.orient = orient;
      orientG.current?.setAttribute('transform', `rotate(${orient.toFixed(2)})`);
      glyphs.current.forEach((g) => g?.setAttribute('transform', `rotate(${(-orient).toFixed(2)} 0 ${-NUMERAL_R})`));
    }

    // Position and size: one transform on one element.
    const transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(size / BASE).toFixed(4)})`;
    if (transform !== s.transform) {
      s.transform = transform;
      el.style.setProperty('--dial-transform', transform);
    }
    if (next !== s.mode) {
      s.mode = next;
      setMode(next);
    }

    // Physics: a lightly underdamped spring toward the target. When scrolling stops the dial settles on a stage.
    const dt = s.last ? Math.min(64, now - s.last) : 16.7;
    s.last = now;
    const scrolling = now - s.lastScroll < 150 || s.dragging;
    const goal = scrolling && !reducedNow ? target : Math.round(target);
    if (reducedNow) {
      s.cur = goal;
      s.vel = 0;
    } else {
      for (let i = 0; i < Math.max(1, Math.round(dt / 16.7)); i++) {
        s.vel += (goal - s.cur) * 0.14;
        s.vel *= 0.78;
        s.cur += s.vel;
      }
      if (Math.abs(goal - s.cur) < 0.0015 && Math.abs(s.vel) < 0.0015) {
        s.cur = goal;
        s.vel = 0;
      }
    }
    ring.current?.setAttribute('transform', `rotate(${(-s.cur * STEP).toFixed(2)})`);
    const total = document.documentElement.scrollHeight - vh;
    slow.current?.setAttribute('transform', `rotate(${((total > 0 ? window.scrollY / total : 0) * 540).toFixed(1)})`);

    const shown = clamp(Math.round(s.cur), 0, N - 1);
    if (shown !== s.shown) {
      s.shown = shown;
      setStage(shown);
      kick();
      sound?.playTick();
      if (shown === 5) sound?.playThud();
    }
    if (s.vel !== 0 || s.cur !== goal || scrolling) s.raf = requestAnimationFrame(frame);
  }, [kick]);

  const run = useCallback(() => {
    const s = sim.current;
    if (!s.raf) s.raf = requestAnimationFrame(frame);
  }, [frame]);

  useEffect(() => {
    const s = sim.current;
    const onScroll = () => {
      s.lastScroll = performance.now();
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(run, 170); // one more frame after the scroll stops, to settle on a stage
      run();
    };
    run();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', run);
    const late = window.setTimeout(run, 400);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', run);
      window.clearTimeout(s.timer);
      window.clearTimeout(late);
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      cancelAnimationFrame(s.fling);
    };
  }, [run, reduced]);

  // The dock reserves room in the phone navbar.
  useEffect(() => {
    if (reduced) return;
    document.documentElement.dataset.dock = 'nav';
    return () => {
      delete document.documentElement.dataset.dock;
    };
  }, [reduced]);

  /** Scroll position that shows stage `f` while the hero is pinned. */
  const scrollFor = (f: number) => sim.current.heroTop - (document.querySelector<HTMLElement>('.nav')?.offsetHeight ?? 64) + (clamp(f, 0, N - 1) / (N - 1)) * sim.current.range;

  const goal = useRef<{ n: number; at: number } | null>(null);
  const go = (i: number) => {
    const n = clamp(i, 0, N - 1);
    goal.current = { n, at: performance.now() };
    if (reducedRef.current) {
      sim.current.manual = n;
      run();
    } else {
      cancelAnimationFrame(sim.current.fling);
      window.scrollTo({ top: scrollFor(n), behavior: 'auto' });
    }
  };
  const step = (delta: number) => go((goal.current && performance.now() - goal.current.at < 1000 ? goal.current.n : stage) + delta);

  // Dragging: the angle the pointer sweeps becomes the number of stages turned; letting go flings the dial.
  const dragState = useRef<{ angle: number; start: number; moved: number; samples: { t: number; f: number }[]; target: Element | null } | null>(null);
  const angleOf = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const fractional = () => (reducedRef.current ? sim.current.manual : clamp(((window.scrollY + (document.querySelector<HTMLElement>('.nav')?.offsetHeight ?? 64) - sim.current.heroTop) / sim.current.range) * (N - 1), 0, N - 1));
  const onDown = (e: React.PointerEvent) => {
    if (mode !== 'hero') return;
    cancelAnimationFrame(sim.current.fling);
    dragState.current = { angle: angleOf(e), start: fractional(), moved: 0, samples: [], target: e.target as Element };
    sim.current.dragging = true;
    svg.current?.setPointerCapture(e.pointerId);
  };
  const turnTo = (f: number) => {
    if (reducedRef.current) {
      sim.current.manual = f;
      run();
    } else {
      window.scrollTo({ top: scrollFor(f), behavior: 'auto' });
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragState.current;
    if (!d) return;
    let delta = angleOf(e) - d.angle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    d.moved = Math.max(d.moved, Math.abs(delta));
    const f = clamp(d.start - delta / STEP, 0, N - 1);
    d.samples.push({ t: performance.now(), f });
    if (d.samples.length > 6) d.samples.shift();
    turnTo(f);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = dragState.current;
    dragState.current = null;
    sim.current.dragging = false;
    if (!d) return;
    if (d.moved < 4) {
      // A tap or a click: show what the numeral under the pointer means.
      const hit = (e.target as Element | null)?.closest?.('[data-stage]') ?? d.target?.closest?.('[data-stage]');
      if (hit) showHint(Number(hit.getAttribute('data-stage')), 3200);
      return;
    }
    const a = d.samples[0];
    const b = d.samples[d.samples.length - 1];
    let v = a && b && b.t > a.t ? ((b.f - a.f) / (b.t - a.t)) * 1000 : 0; // stages per second
    let f = fractional();
    if (reducedRef.current) {
      turnTo(Math.round(f));
      return;
    }
    // Momentum with friction, then a short ease onto the nearest stage.
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      if (Math.abs(v) > 0.35) {
        v *= Math.exp(-dt / 0.28);
        f = clamp(f + v * dt, 0, N - 1);
      } else {
        const to = Math.round(f);
        f += (to - f) * 0.25;
        if (Math.abs(to - f) < 0.004) {
          turnTo(to);
          return;
        }
      }
      turnTo(f);
      sim.current.fling = requestAnimationFrame(loop);
    };
    sim.current.fling = requestAnimationFrame(loop);
  };

  const showHint = (i: number, ms: number) => {
    window.clearTimeout(hintTimer.current);
    setHint(i);
    hintTimer.current = window.setTimeout(() => setHint(null), ms);
  };
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  const toTop = () => window.scrollTo({ top: 0, behavior: reducedRef.current ? 'auto' : 'smooth' });
  const onKey = (e: React.KeyboardEvent) => {
    if (mode === 'dock') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toTop();
      }
      return;
    }
    if (mode !== 'hero') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      go(e.key === 'Home' ? 0 : N - 1);
    }
  };

  const name = STAGES[stage]!;
  const roleProps =
    mode === 'hero'
      ? ({ role: 'slider', tabIndex: 0, 'aria-label': 'Tender stage', 'aria-orientation': 'horizontal', 'aria-valuemin': 1, 'aria-valuemax': N, 'aria-valuenow': stage + 1, 'aria-valuetext': `Stage ${stage + 1} of ${N}: ${name}` } as const)
      : mode === 'dock'
        ? ({ role: 'button', tabIndex: 0, 'aria-label': `Back to the top. The stage wheel is at stage ${stage + 1}, ${name}` } as const)
        : mode === 'final'
          ? ({ role: 'img', 'aria-label': 'The stage wheel at its last stage: the lock is open' } as const)
          : ({ 'aria-hidden': true } as const);

  const wheel = (
    <div ref={box} className="dial" data-mode={mode} data-reduced={reduced ? '' : undefined}>
      <svg
        ref={svg}
        className="dial__svg"
        viewBox="-210 -210 420 420"
        {...roleProps}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
        onClick={mode === 'dock' ? toTop : undefined}
      >
        <title>{mode === 'dock' ? `Stage ${stage + 1}: ${name}. Back to the top` : `Stage ${stage + 1}: ${name}`}</title>
        <circle r="204" className="dial__rim" />
        <g ref={orientG}>
        <g ref={slow} className="dial__slow">
          {Array.from({ length: 96 }, (_, k) => (
            <line key={k} x1="0" y1="-197" x2="0" y2={k % 8 === 0 ? -190 : -194} transform={`rotate(${k * 3.75})`} className="dial__tick" />
          ))}
        </g>
        <circle r="186" className="dial__hair" />
        <circle r="148" className="dial__face" />
        <g ref={ring}>
          {STAGES.map((s, i) => {
            const sep = ((-90 + (i + 0.5) * STEP) * Math.PI) / 180;
            return (
              <g key={s}>
                <line x1={150 * Math.cos(sep)} y1={150 * Math.sin(sep)} x2={186 * Math.cos(sep)} y2={186 * Math.sin(sep)} className="dial__spoke" />
                <g transform={`rotate(${i * STEP})`} data-stage={i} onPointerEnter={(e) => e.pointerType === 'mouse' && showHint(i, 1600)} onPointerLeave={(e) => e.pointerType === 'mouse' && setHint(null)}>
                  <title>{`${roman(i + 1)}. ${s}: ${STAGE_TEXT[s]}`}</title>
                  <circle cx="0" cy={-NUMERAL_R} r="19" className="dial__hit" />
                  <text ref={(t) => { glyphs.current[i] = t; }} x="0" y={-NUMERAL_R} className={`dial__glyph${i === stage ? ' is-active' : ''}`} textAnchor="middle" dominantBaseline="central">
                    {roman(i + 1)}
                  </text>
                  {liveIndex === i && <circle cx="0" cy="-156" r="4" className="dial__live" />}
                </g>
              </g>
            );
          })}
        </g>
        <circle ref={flash} cx="0" cy={-NUMERAL_R} r="22" className="dial__flash" />
        <path ref={needle} d="M0 -188 L-9 -209 H9 Z" className="dial__needle" />
        </g>
        <g className="dial__scene">
          <DialScene stage={stage} data={data} />
        </g>
        <text className="dial__dockno" x="0" y="8" textAnchor="middle" dominantBaseline="central">
          {roman(stage + 1)}
        </text>
      </svg>
      {hint !== null && (mode === 'hero' || mode === 'final') && (
        <p className="dial__tip" role="status">
          <strong>{roman(hint + 1)}. {STAGES[hint]}.</strong> {STAGE_TEXT[STAGES[hint]!]}
        </p>
      )}
    </div>
  );

  return (
    <>
      <section ref={hero} className={`hero ${reduced ? 'hero--static' : 'hero--pinned'}`} aria-label="The eight stages of a tender">
        <div ref={stick} className="hero__stick container">
          <div ref={copy} className="hero__copy">
            <p className="eyebrow">
              {live && liveIndex !== null
                ? `Live: tender ${live.id.toString()} is at stage ${liveIndex + 1}, ${live.phase}`
                : live
                  ? `Live: tender ${live.id.toString()} is ${live.phase.toLowerCase()}`
                  : 'An explainer: how every tender moves. No tender is on chain yet.'}
            </p>
            <h1 className="display wheel__headline">
              Tenders nobody can <em>quietly bend.</em>
            </h1>
            <div className="wheel__counter">
              <span>
                Stage {stage + 1} of {N}
              </span>
              <svg className="wheel__line" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
                <line x1="0" y1="2" x2="100" y2="2" className="wheel__line-track" />
                <line x1="0" y1="2" x2={(stage / (N - 1)) * 100} y2="2" className="wheel__line-fill" />
              </svg>
            </div>
            <StageText stage={stage} />
            <div className="wheel__controls">
              <button type="button" className="button" onClick={() => step(-1)} disabled={stage === 0} aria-label="Previous stage">
                Back
              </button>
              <button type="button" className="button button--solid" onClick={() => step(1)} disabled={stage === N - 1} aria-label="Next stage">
                Next stage
              </button>
              <button
                type="button"
                className="button wheel__sound"
                aria-pressed={soundState}
                onClick={async () => {
                  sound ??= await import('../lib/sound.ts');
                  setSoundState(sound.setSound(!sound.soundOn()));
                }}
                title="A soft tick at every stage and a thud for the gavel. Off by default."
              >
                Sound {soundState ? 'on' : 'off'}
              </button>
            </div>
          </div>
          <div ref={slot} className="hero__slot" aria-hidden="true" />
        </div>
      </section>
      {typeof document !== 'undefined' && createPortal(wheel, document.body)}
    </>
  );
}
