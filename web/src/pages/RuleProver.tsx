import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { DEPLOYMENT, INPUT_SPACE, isDeployed, packBanded, unpackBanded, unpackOutcome, type Banded } from '@gavelock/core';
import { explorerAddress } from '@gavelock/core';
import { readCircuitShape, readTruthTable, type TableRead } from '../lib/rules.ts';
import { useAsync } from '../lib/useAsync.ts';

const INITIAL: Banded = { price: 0, delivery: 0, mandatory: true, preferredA: false, preferredB: false, panel: 4 };

function Select({ label, value, max, onChange, names }: { label: string; value: number; max: number; onChange: (v: number) => void; names?: string[] }) {
  return (
    <label className="fact">
      <span className="fact__label">{label}</span>
      <select className="button" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {Array.from({ length: max + 1 }, (_, i) => (
          <option key={i} value={i}>
            {names?.[i] ?? i}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RuleProver() {
  const { id } = useParams();
  const circuitId = Number(id);
  const valid = Number.isInteger(circuitId) && circuitId > 0;
  const live = isDeployed(DEPLOYMENT) ? DEPLOYMENT : null;

  const shape = useAsync(() => (live && valid ? readCircuitShape(live.processor, circuitId) : Promise.resolve(null)), [circuitId]);
  const [progress, setProgress] = useState(0);
  const [table, setTable] = useState<TableRead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [banded, setBanded] = useState<Banded>(INITIAL);

  useEffect(() => {
    if (!live || !valid) return;
    const controller = new AbortController();
    setTable(null);
    setError(null);
    setProgress(0);
    readTruthTable(live.processor, circuitId, setProgress, controller.signal)
      .then(setTable)
      .catch((e: unknown) => {
        if ((e as { name?: string }).name !== 'AbortError') setError((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circuitId, attempt]);

  const summary = useMemo(() => {
    if (!table) return null;
    let eligible = 0;
    const scores = new Array<number>(16).fill(0);
    for (const w of table.words) {
      if (w === null) continue;
      const o = unpackOutcome(w);
      if (o.eligible) {
        eligible++;
        scores[o.score]!++;
      }
    }
    return { eligible, ineligible: INPUT_SPACE - eligible - table.failures.length, scores };
  }, [table]);

  const outcome = table?.words[packBanded(banded)];
  const result = outcome === null || outcome === undefined ? null : unpackOutcome(outcome);
  const set = (patch: Partial<Banded>) => setBanded({ ...banded, ...patch });

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">
          <Link to="/rules">Rule Library</Link> · Rule Prover
        </span>
        <h1 className="title">Circuit {valid ? `#${circuitId}` : ''}</h1>
        <p className="lede">Every outcome of this rule, read from X Layer one call at a time. Nothing here comes from a server.</p>
      </header>

      {!valid ? (
        <p className="notice notice--danger">“{id}” is not a circuit number.</p>
      ) : !live ? (
        <p className="notice">The Gavelock processor has not been deployed yet, so there is no circuit to read.</p>
      ) : (
        <>
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">The circuit</h2>
              <a className="button" href={explorerAddress(live.processor)} target="_blank" rel="noopener noreferrer">
                Processor on the explorer
              </a>
            </div>
            {shape.state === 'error' ? (
              <p className="notice notice--danger" role="alert">
                {shape.error}
              </p>
            ) : (
              <dl className="facts">
                <div className="fact">
                  <dt className="fact__label">Inputs / outputs</dt>
                  <dd className="fact__value mono">{shape.data ? `${shape.data.nIn} / ${shape.data.nOut}` : '…'}</dd>
                </div>
                <div className="fact">
                  <dt className="fact__label">NAND gates</dt>
                  <dd className="fact__value mono">{shape.data ? shape.data.gateCount : '…'}</dd>
                </div>
                <div className="fact">
                  <dt className="fact__label">Memory (latches)</dt>
                  <dd className="fact__value mono">{shape.data ? shape.data.nState : '…'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="card" aria-live="polite">
            <h2 className="card__title">Reading every outcome</h2>
            {error ? (
              <div className="notice notice--danger" role="alert">
                <span>Could not finish reading: {error}</span>
                <div>
                  <button type="button" className="button" onClick={() => setAttempt(attempt + 1)}>
                    Try again
                  </button>
                </div>
              </div>
            ) : !table ? (
              <p>
                {progress} of {INPUT_SPACE} inputs read…
              </p>
            ) : (
              <>
                <p>
                  {INPUT_SPACE - table.failures.length} of {INPUT_SPACE} inputs answered by the chain.
                  {table.failures.length > 0 && ` ${table.failures.length} gave no valid answer, so this is not a Gavelock rule or the circuit is broken.`}
                </p>
                {summary && (
                  <dl className="facts" style={{ marginTop: 'var(--space-4)' }}>
                    <div className="fact">
                      <dt className="fact__label">Eligible cases</dt>
                      <dd className="fact__value mono">{summary.eligible}</dd>
                    </div>
                    <div className="fact">
                      <dt className="fact__label">Ineligible cases</dt>
                      <dd className="fact__value mono">{summary.ineligible}</dd>
                    </div>
                  </dl>
                )}
              </>
            )}
          </section>

          <section className="card">
            <h2 className="card__title">What would win</h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Choose how a bid is placed. The answer is the circuit’s own, read from the chain above.
            </p>
            <div className="facts">
              <Select label="Price band" value={banded.price} max={7} onChange={(v) => set({ price: v })} names={['0 · lowest price', '1', '2', '3', '4', '5', '6', '7 · furthest above']} />
              <Select label="Delivery band" value={banded.delivery} max={3} onChange={(v) => set({ delivery: v })} names={['0 · fastest', '1', '2', '3 · slowest']} />
              <Select label="Panel band" value={banded.panel} max={7} onChange={(v) => set({ panel: v })} names={['0 · lowest', '1', '2', '3', '4', '5', '6', '7 · highest']} />
              <Select label="Mandatory checklist met" value={Number(banded.mandatory)} max={1} onChange={(v) => set({ mandatory: v === 1 })} names={['No', 'Yes']} />
              <Select label="First preferred group" value={Number(banded.preferredA)} max={1} onChange={(v) => set({ preferredA: v === 1 })} names={['Not met', 'Met']} />
              <Select label="Second preferred group" value={Number(banded.preferredB)} max={1} onChange={(v) => set({ preferredB: v === 1 })} names={['Not met', 'Met']} />
            </div>
            <p style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-bold)' }} aria-live="polite">
              {!table ? 'Waiting for the table…' : result === null ? 'The chain gave no answer for this case.' : result.eligible ? `Eligible, score ${result.score} of 15` : 'Not eligible'}
            </p>
            <p className="mono" style={{ color: 'var(--color-text-faint)' }}>
              input {packBanded(unpackBanded(packBanded(banded)))} of {INPUT_SPACE - 1}
            </p>
          </section>
        </>
      )}
    </div>
  );
}
