import { useCallback, useEffect, useRef, useState } from 'react';

export type Async<T> = { state: 'loading'; data: null; error: null } | { state: 'ready'; data: T; error: null } | { state: 'error'; data: T | null; error: string };

function describe(error: unknown): string {
  const e = error as { shortMessage?: string; message?: string };
  return (e.shortMessage ?? e.message ?? 'Unknown error').split('\n')[0] ?? 'Unknown error';
}

/**
 * Runs a loader and reports loading, ready or error. A failed reload keeps the last good data next to
 * the error, so a flaky node never blanks a page that was already showing something true.
 */
export function useAsync<T>(load: () => Promise<T>, deps: readonly unknown[]): Async<T> & { reload: () => void } {
  const [status, setStatus] = useState<Async<T>>({ state: 'loading', data: null, error: null });
  const last = useRef<T | null>(null);
  const run = useRef(0);

  const reload = useCallback(() => {
    const mine = ++run.current;
    load()
      .then((data) => {
        if (mine !== run.current) return;
        last.current = data;
        setStatus({ state: 'ready', data, error: null });
      })
      .catch((error: unknown) => {
        if (mine !== run.current) return;
        setStatus({ state: 'error', data: last.current, error: describe(error) });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    last.current = null;
    setStatus({ state: 'loading', data: null, error: null });
    reload();
    return () => {
      run.current++;
    };
  }, [reload]);

  return { ...status, reload };
}
