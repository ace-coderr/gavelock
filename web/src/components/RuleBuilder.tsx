import { useMemo, useState } from 'react';
import { bytesToHex, encodeFunctionData } from 'viem';
import { DEPLOYMENT, NO_GATES, RULE_SHAPE, compileRule, encodeNetlist, firstMismatch, gavelockAbi, isDeployed, ruleStockAbi, truthTable, validateSpec, type RuleSpec, type RuleWeights } from '@gavelock/core';
import { publicClient } from '../lib/client.ts';
import { useAsync } from '../lib/useAsync.ts';
import { TxButton } from './TxButton.tsx';

const WEIGHTS: { key: keyof RuleWeights; label: string }[] = [
  { key: 'price', label: 'Price (lower is better)' },
  { key: 'delivery', label: 'Delivery time (faster is better)' },
  { key: 'panel', label: 'Panel quality score' },
  { key: 'preferredA', label: 'First preferred group met' },
  { key: 'preferredB', label: 'Second preferred group met' },
];

type Built = { status: 'idle' } | { status: 'ok'; gates: number; bytes: Uint8Array; withinCap: boolean } | { status: 'error'; message: string };

/** Most buyers pick an existing rule. This builds a new one: weights and gates in, a proven circuit out. */
export function RuleBuilder() {
  const live = isDeployed(DEPLOYMENT) ? DEPLOYMENT : null;
  const [weights, setWeights] = useState<RuleWeights>({ price: 50, delivery: 20, panel: 30, preferredA: 0, preferredB: 0 });
  const [gates, setGates] = useState({ ...NO_GATES });
  const [label, setLabel] = useState('');
  const [built, setBuilt] = useState<Built>({ status: 'idle' });

  const spec: RuleSpec = { weights, gates };
  const problems = useMemo(() => validateSpec(spec), [weights, gates]);
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const price = useAsync(() => (live ? publicClient.readContract({ address: live.ruleStock, abi: ruleStockAbi, functionName: 'tapeOutPrice' }) : Promise.resolve(null)), []);

  function build() {
    setBuilt({ status: 'idle' });
    // Yield once so the button state paints before the compile (a second or two of work) starts.
    setTimeout(() => {
      try {
        const table = truthTable(spec);
        const compiled = compileRule(table);
        // The compiler already proves this; checking again here is what lets the page say "verified" honestly.
        if (firstMismatch(compiled.netlist, table) !== null) throw new Error('The compiled circuit differs from the rule.');
        setBuilt({ status: 'ok', gates: compiled.gates, bytes: encodeNetlist(compiled.netlist), withinCap: compiled.withinCap });
      } catch (e) {
        setBuilt({ status: 'error', message: (e as Error).message });
      }
    }, 30);
  }

  const request =
    live && built.status === 'ok' && built.withinCap && price.data
      ? { to: live.ruleStock, value: price.data, data: encodeFunctionData({ abi: ruleStockAbi, functionName: 'tapeOut', args: [bytesToHex(built.bytes), label.trim().slice(0, 64)] }) }
      : null;
  void gavelockAbi;

  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <section className="card stack" aria-labelledby="builder-title">
      <h2 className="card__title" id="builder-title">Build your own rule</h2>
      <p style={{ color: 'var(--color-text-muted)' }}>Choose weights that add up to 100 and optional gates. The form becomes a table of every outcome, then a circuit, and the circuit is checked against the table on all 2,048 inputs before you can tape it out. A bid that does not meet the mandatory checklist is never eligible, whatever the weights.</p>
      <div className="facts">
        {WEIGHTS.map((w) => (
          <label key={w.key} className="fact">
            <span className="fact__label">{w.label} (%)</span>
            <input className="button" inputMode="numeric" value={weights[w.key]} onChange={(e) => { setWeights({ ...weights, [w.key]: num(e.target.value) }); setBuilt({ status: 'idle' }); }} />
          </label>
        ))}
      </div>
      <p className={total === 100 ? '' : 'notice notice--danger'} aria-live="polite">Weights add up to {total}.</p>
      <div className="facts">
        <label className="fact"><span className="fact__label">Reject bids above price band (0 to 7)</span><input className="button" inputMode="numeric" value={gates.maxPriceBand} onChange={(e) => { setGates({ ...gates, maxPriceBand: num(e.target.value) }); setBuilt({ status: 'idle' }); }} /></label>
        <label className="fact"><span className="fact__label">Reject slower than delivery band (0 to 3)</span><input className="button" inputMode="numeric" value={gates.maxDeliveryBand} onChange={(e) => { setGates({ ...gates, maxDeliveryBand: num(e.target.value) }); setBuilt({ status: 'idle' }); }} /></label>
        <label className="fact"><span className="fact__label">Reject panel band below (0 to 7)</span><input className="button" inputMode="numeric" value={gates.minPanelBand} onChange={(e) => { setGates({ ...gates, minPanelBand: num(e.target.value) }); setBuilt({ status: 'idle' }); }} /></label>
        <label className="fact"><span className="fact__label"><input type="checkbox" checked={gates.requirePreferredA} onChange={(e) => { setGates({ ...gates, requirePreferredA: e.target.checked }); setBuilt({ status: 'idle' }); }} /> Require the first preferred group</span></label>
        <label className="fact"><span className="fact__label"><input type="checkbox" checked={gates.requirePreferredB} onChange={(e) => { setGates({ ...gates, requirePreferredB: e.target.checked }); setBuilt({ status: 'idle' }); }} /> Require the second preferred group</span></label>
      </div>
      {problems.length > 0 && <ul className="notice notice--danger" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div><button type="button" className="button" disabled={problems.length > 0} onClick={build}>Build and check the circuit</button></div>

      {built.status === 'error' && <p className="notice notice--danger" role="alert">{built.message}</p>}
      {built.status === 'ok' && (
        <div className="stack" role="status">
          <p><span className="status status--ok">Verified</span> The circuit has {built.gates} NAND gates and matches your rule on all 2,048 inputs.</p>
          {!built.withinCap && <p className="notice notice--danger">This is more than {RULE_SHAPE.maxNand} gates, the most that can be taped out. Simplify the rule: fewer criteria, or fewer gates.</p>}
          {built.withinCap && (
            <>
              <label className="fact"><span className="fact__label">Name for the Rule Library (up to 64 characters)</span><input className="button" maxLength={64} value={label} onChange={(e) => setLabel(e.target.value)} /></label>
              {!live ? <p className="notice">The Gavelock processor has not been deployed yet, so this rule cannot be taped out. Tape-out will cost the TapeOut fee plus a small rule fee, paid in OKB.</p> : price.data ? <>
                <p style={{ color: 'var(--color-text-muted)' }}>Tape-out costs {Number(price.data) / 1e18} OKB (TapeOut’s fee plus Gavelock’s rule fee). You end up owning the circuit.</p>
                <TxButton label="Tape out this rule" request={request} />
              </> : <span className="skeleton" />}
            </>
          )}
        </div>
      )}
    </section>
  );
}
