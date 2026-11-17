import { useEffect, useRef, useState } from 'react';

/** True when the visitor asked for less motion. Every animation in the app checks this. */
export function useReducedMotion(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = () => setReduced(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, [query]);
  return reduced;
}

/**
 * Adds `is-in` to an element the first time it scrolls into view, which the stylesheet turns into the
 * blur-in. With reduced motion, or without IntersectionObserver, it is visible at once.
 */
export function useReveal<T extends HTMLElement>(): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-in');
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);
  return ref;
}

/**
 * Publishes the scroll position as the CSS variable `--sy` (pixels) on each `.float` card, at most once per frame,
 * so the cards drift as the page moves. The variable is set on the cards themselves, never on the root: a custom
 * property set on the root would invalidate the style of every element in the page on every frame.
 */
export function useScrollVariable(): void {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const write = () => {
      frame = 0;
      const y = String(Math.round(window.scrollY));
      document.querySelectorAll<HTMLElement>('.float').forEach((el) => el.style.setProperty('--sy', y));
    };
    const on = () => {
      if (!frame) frame = requestAnimationFrame(write);
    };
    write();
    window.addEventListener('scroll', on, { passive: true });
    // Cards appear after data loads, so pick them up shortly after navigation too.
    const late = window.setTimeout(write, 600);
    return () => {
      window.removeEventListener('scroll', on);
      window.clearTimeout(late);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);
}

const NUMERALS: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

/** 1 to 39 as Roman numerals. */
export function roman(n: number): string {
  let out = '';
  for (const [value, glyph] of NUMERALS) {
    while (n >= value) {
      out += glyph;
      n -= value;
    }
  }
  return out;
}
