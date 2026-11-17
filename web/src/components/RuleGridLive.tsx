import { useEffect, useState } from 'react';
import { INPUT_SPACE } from '@gavelock/core';
import { live } from '../lib/tender.ts';
import { ruleTable } from '../lib/ruleTable.ts';
import { GRID_W, RuleGridPic } from './Pictures.tsx';

/**
 * Every outcome of a tender's rule, read from the chain, with a marker on the cell a particular bid landed in.
 * While it reads it shows how far it has got; if the read fails it says so.
 */
export function RuleGridLive({ ruleId, marker, label }: { ruleId: number; marker?: number; label: string }) {
  const [words, setWords] = useState<(number | null)[] | null>(null);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    ruleTable(live().processor, ruleId, (n) => on && setDone(n))
      .then((t) => on && setWords(t.words))
      .catch((e: unknown) => on && setError((e as Error).message.split('\n')[0] ?? 'failed'));
    return () => {
      on = false;
    };
  }, [ruleId]);
  if (error) return <p className="notice notice--danger" role="alert">Could not read the rule: {error}</p>;
  if (!words) return <p className="notice">Reading the rule from the chain: {done} of {INPUT_SPACE}…</p>;
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: '18rem', aspectRatio: '2 / 1' }}>
      <RuleGridPic words={words} label={label} />
      {marker !== undefined && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', left: `${((marker % GRID_W) / GRID_W) * 100}%`, top: `${(Math.floor(marker / GRID_W) / 32) * 100}%`, width: `${100 / GRID_W}%`, height: `${100 / 32}%`, outline: '2px solid var(--color-cream)', outlineOffset: '1px', borderRadius: '2px' }}
        />
      )}
    </div>
  );
}
