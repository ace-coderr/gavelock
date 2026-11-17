import { useState } from 'react';
import { Link } from '../lib/router.tsx';
import { INPUT_SPACE } from '@gavelock/core';
import { deployed, verifyAward, type Verification } from '../lib/records.ts';

export function Verify() {
  const [id, setId] = useState('');
  const [progress, setProgress] = useState(0);
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'missing' | 'error'>('idle');
  const [result, setResult] = useState<Verification | null>(null);
  const [error, setError] = useState('');
  const valid = /^\d+$/.test(id.trim());

  async function run() {
    setState('working');
    setProgress(0);
    try {
      const out = await verifyAward(BigInt(id.trim()), setProgress);
      if (!out) return setState('missing');
      setResult(out);
      setState('done');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Verify</span>
        <h1 className="title">Check an award yourself.</h1>
        <p className="lede">This page re-derives a tender’s award in your browser from what is on X Layer: the opened bids, the panel’s revealed scores and the rule circuit’s own answers. It does not trust this website or the contract’s stored result.</p>
      </header>
      {!deployed() ? <p className="notice">The tender contract has not been deployed yet, so there is nothing to verify.</p> : (
        <section className="card stack">
          <label className="fact"><span className="fact__label">Tender number</span><input className="button" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} /></label>
          <div><button type="button" className="button" disabled={!valid || state === 'working'} onClick={run}>{state === 'working' ? `Reading the rule: ${progress} of ${INPUT_SPACE}…` : 'Verify'}</button></div>
          {state === 'missing' && <p className="notice">There is no tender {id}.</p>}
          {state === 'error' && <p className="notice notice--danger" role="alert">{error}</p>}
          {state === 'done' && result && (
            result.verified === null ? <p className="notice">{result.reason}</p> : result.verified ? (
              <div className="stack" role="status">
                <p><span className="status status--ok">Verified</span> The award matches the independent computation.</p>
                <p>Winner: bid {result.reference!.winner ?? 'none'}. Ranking: {result.reference!.ranking.join(', ') || 'none'}.{result.reference!.flagged.length ? ` Abnormally low prices: bid ${result.reference!.flagged.join(', ')}.` : ''} <Link to={`/t/${id.trim()}`}>Open the tender</Link></p>
              </div>
            ) : (
              <div className="notice notice--danger" role="alert"><strong>The award does not match.</strong>{result.reason && <span>{result.reason}</span>}<ul>{result.differences.map((d) => <li key={d}>{d}</li>)}</ul></div>
            )
          )}
        </section>
      )}
    </div>
  );
}
