import { useState } from 'react';
import { Link, useNavigate } from '../lib/router.tsx';
import { encodeFunctionData, isAddress, parseEther, toHex, type Address } from 'viem';
import { ABNORMAL_FLOOR_DEFAULT_BPS, DEFAULT_LADDERS, DEPLOYMENT, STARTER_RULES, gavelockAbi, isDeployed, validateChecklist, validateLadders } from '@gavelock/core';
import { Chips, Switch } from '../components/Controls.tsx';
import { listOnChainRules } from '../lib/rules.ts';
import { publicClient } from '../lib/client.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useWallet } from '../lib/wallet.tsx';
import { TxButton } from '../components/TxButton.tsx';

const MINUTE = 60;

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="fact">
      <span className="fact__label">{label}</span>
      {children}
      {hint && <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>{hint}</span>}
    </label>
  );
}

export function Studio() {
  const wallet = useWallet();
  const navigate = useNavigate();
  const live = isDeployed(DEPLOYMENT) ? DEPLOYMENT : null;
  const rules = useAsync(() => listOnChainRules(), []);
  const fee = useAsync(() => (live ? publicClient.readContract({ address: live.tenders, abi: gavelockAbi, functionName: 'tenderFee' }) : Promise.resolve(0n)), []);

  const [quick, setQuick] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [decimals, setDecimals] = useState('2');
  const [items, setItems] = useState<{ label: string; group: 'mandatory' | 'a' | 'b' }[]>([{ label: '', group: 'mandatory' }]);
  const [ruleId, setRuleId] = useState('');
  const [clarMinutes, setClarMinutes] = useState('60');
  const [bidMinutes, setBidMinutes] = useState('60');
  const [openMinutes, setOpenMinutes] = useState('30');
  const [commitMinutes, setCommitMinutes] = useState('30');
  const [revealMinutes, setRevealMinutes] = useState('30');
  const [standMinutes, setStandMinutes] = useState('60');
  const [deposit, setDeposit] = useState('0.001');
  const [panelOn, setPanelOn] = useState(false);
  const [panelText, setPanelText] = useState('');
  const [quorum, setQuorum] = useState('1');
  const [floor, setFloor] = useState(String(ABNORMAL_FLOOR_DEFAULT_BPS / 100));
  const [frozen, setFrozen] = useState<{ biddingStart: number; deadline: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const panel = panelText.split(/[\s,]+/).filter(Boolean);
  const usePanel = !quick && panelOn && panel.length > 0;

  function build() {
    const out: string[] = [];
    const cleaned = items.filter((i) => i.label.trim());
    const mask = (g: string) => cleaned.reduce((m, it, k) => (it.group === g ? m | (1 << k) : m), 0) >>> 0;
    const checklist = { items: cleaned.length, mandatoryMask: mask('mandatory'), preferredAMask: mask('a'), preferredBMask: mask('b') };
    out.push(...validateChecklist(checklist));
    out.push(...validateLadders(DEFAULT_LADDERS));
    if (!title.trim()) out.push('Give the tender a title.');
    if (!/^\d+$/.test(decimals) || Number(decimals) > 8) out.push('Decimals must be a whole number from 0 to 8.');
    if (!/^\d+$/.test(ruleId)) out.push('Choose the scoring rule.');
    const minutes = { clarMinutes, bidMinutes, openMinutes, standMinutes, ...(usePanel ? { commitMinutes, revealMinutes } : {}) };
    for (const [name, v] of Object.entries(minutes)) if (!/^\d+$/.test(v) || Number(v) < 1) out.push(`${name.replace('Minutes', '')} needs a whole number of minutes, at least 1.`);
    if (!/^\d*\.?\d+$/.test(deposit) || Number(deposit) < 0.001) out.push('The deposit must be an amount in OKB of at least 0.001. It also sets the bond for challenges, and it keeps anyone from filling the tender with junk bids.');
    if (!/^\d+(\.\d+)?$/.test(floor) || Number(floor) > 100) out.push('The abnormally-low floor must be a percentage from 0 to 100.');
    for (const a of panel) if (!isAddress(a)) out.push(`${a} is not an address.`);
    if (new Set(panel.map((a) => a.toLowerCase())).size !== panel.length) out.push('A panel member is listed twice.');
    if (wallet.account && panel.some((a) => a.toLowerCase() === wallet.account!.toLowerCase())) out.push('The buyer cannot sit on the panel.');
    if (usePanel && (!/^\d+$/.test(quorum) || Number(quorum) < 1 || Number(quorum) > panel.length)) out.push('The quorum must be between 1 and the number of panel members.');
    setProblems(out);
    if (out.length > 0) return setFrozen(null);
    const now = Math.floor(Date.now() / 1000);
    const biddingStart = now + Number(clarMinutes) * MINUTE + 120; // two minutes to sign
    setFrozen({ biddingStart, deadline: biddingStart + Number(bidMinutes) * MINUTE });
  }

  const mins = (v: string) => Number.parseInt(v, 10) || 0;
  const timeline = [
    { label: 'Questions', minutes: mins(clarMinutes) },
    { label: 'Bidding', minutes: mins(bidMinutes) },
    { label: 'Opening', minutes: mins(openMinutes) },
    ...(!quick && panelOn ? [{ label: 'Commit', minutes: mins(commitMinutes) }, { label: 'Reveal', minutes: mins(revealMinutes) }] : []),
    { label: 'Standstill', minutes: mins(standMinutes) },
  ];

  const request = (() => {
    if (!live || !frozen) return null;
    const cleaned = items.filter((i) => i.label.trim());
    const mask = (g: string) => cleaned.reduce((m, it, k) => (it.group === g ? m | (1 << k) : m), 0) >>> 0;
    const terms = { title: title.trim(), description: description.trim() || undefined, currency: currency.trim(), decimals: Number(decimals), checklist: cleaned.map((i) => i.label.trim()) };
    const params = {
      quick,
      ruleId: Number(ruleId),
      clarificationsStart: 0n,
      biddingStart: BigInt(frozen.biddingStart),
      deadline: BigInt(frozen.deadline),
      openingWindow: Number(openMinutes) * MINUTE,
      commitWindow: usePanel ? Number(commitMinutes) * MINUTE : 0,
      revealWindow: usePanel ? Number(revealMinutes) * MINUTE : 0,
      standstill: Number(standMinutes) * MINUTE,
      bidDeposit: parseEther(deposit),
      checklistItems: cleaned.length,
      mandatoryMask: mask('mandatory'),
      preferredAMask: mask('a'),
      preferredBMask: mask('b'),
      priceLadderBps: [...DEFAULT_LADDERS.priceBps],
      deliveryLadderDays: [...DEFAULT_LADDERS.deliveryDays],
      abnormalFloorBps: Math.round(Number(floor) * 100),
      panel: (usePanel ? panel : []) as Address[],
      quorum: usePanel ? Number(quorum) : 0,
      terms: toHex(new TextEncoder().encode(JSON.stringify(terms))),
    };
    return { to: live.tenders, value: quick ? 0n : (fee.data ?? 0n), data: encodeFunctionData({ abi: gavelockAbi, functionName: 'createTender', args: [params as never] }) };
  })();

  const when = (s: number) => new Date(s * 1000).toLocaleString();
  const text = (value: string, set: (v: string) => void, props: object = {}) => <input className="button" value={value} onChange={(e) => { set(e.target.value); setFrozen(null); }} {...props} />;

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Tender Studio</span>
        <h1 className="title">Create a tender or a quote request.</h1>
        <p className="lede">Everything you set here, including the deadline, is frozen when bidding starts. Nothing can be changed afterwards, by you or anyone.</p>
      </header>

      {!live && <p className="notice">The Gavelock contracts have not been deployed to X Layer yet, so a tender cannot be created. You can fill in this form to see the fee and the timeline; creating is switched off until they are.</p>}

      <section className="card stack">
        <h2 className="card__title">Kind</h2>
        <Switch checked={quick} onChange={(v) => { setQuick(v); setFrozen(null); }}>
          <strong>Quick Quote</strong> — free, at least three quotes, short windows, no panel.
        </Switch>
        <p aria-live="polite" style={{ color: 'var(--color-text-muted)' }}>
          Fee: <strong style={{ color: 'var(--color-text)' }}>{quick ? 'free' : fee.data !== undefined && live ? `${Number(fee.data) / 1e18} OKB` : 'a flat fee, set when the contracts are deployed'}</strong>
          {quick ? '. A Quick Quote has no panel and needs three opened quotes.' : ', paid once when the tender is created.'}
        </p>
      </section>

      <section className="card stack">
        <h2 className="card__title">What you are buying</h2>
        <Field label="Title">{text(title, setTitle)}</Field>
        <Field label="Description (optional)"><textarea className="button" rows={3} value={description} onChange={(e) => { setDescription(e.target.value); setFrozen(null); }} /></Field>
        <div className="facts">
          <Field label="Currency of prices">{text(currency, setCurrency)}</Field>
          <Field label="Decimal places" hint="2 for dollars and cents">{text(decimals, setDecimals, { inputMode: 'numeric' })}</Field>
        </div>
      </section>

      <section className="card stack">
        <h2 className="card__title">Checklist</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>A bidder claims the items it meets. Mandatory items are required for a bid to be eligible. Preferred items add to the score when the rule uses them (a group counts only if all of it is met).</p>
        {items.map((item, k) => (
          <div key={k} className="card__head">
            <input className="button" style={{ flex: 1 }} placeholder="e.g. Valid tax clearance certificate" value={item.label} onChange={(e) => { setItems(items.map((x, i) => (i === k ? { ...x, label: e.target.value } : x))); setFrozen(null); }} />
            <select className="button" value={item.group} onChange={(e) => { setItems(items.map((x, i) => (i === k ? { ...x, group: e.target.value as 'mandatory' | 'a' | 'b' } : x))); setFrozen(null); }}>
              <option value="mandatory">Mandatory</option><option value="a">Preferred, group 1</option><option value="b">Preferred, group 2</option>
            </select>
            <button type="button" className="button" onClick={() => { setItems(items.filter((_, i) => i !== k)); setFrozen(null); }}>Remove</button>
          </div>
        ))}
        {items.length < 32 && <div><button type="button" className="button" onClick={() => setItems([...items, { label: '', group: 'mandatory' }])}>Add an item</button></div>}
      </section>

      <section className="card stack">
        <h2 className="card__title">How bids are scored</h2>
        <Chips
          label="Scoring rule"
          value={ruleId || null}
          onChange={(v) => { setRuleId(v); setFrozen(null); }}
          options={[
            ...STARTER_RULES.map((r) => {
              const onChain = rules.data?.find((c) => c.label === r.name);
              const wrongKind = quick !== (r.mode === 'quick');
              return {
                value: onChain ? String(onChain.id) : `missing-${r.key}`,
                label: r.name,
                unavailable: onChain ? (wrongKind ? (quick ? 'Made for full tenders: it uses the panel' : 'Made for a Quick Quote') : undefined) : live ? 'Not taped out on this processor yet' : 'The processor is not deployed yet',
              };
            }),
            ...(rules.data ?? []).filter((c) => !STARTER_RULES.some((r) => r.name === c.label)).map((c) => ({ value: String(c.id), label: `${c.label || 'Circuit'} #${c.id}` })),
          ]}
        />
        <p style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>A struck-through rule cannot be chosen, and the reason shows on hover. Read every outcome of a rule in the Rule Library before choosing it.</p>
        <Field label="Abnormally low price floor (% of the median compliant price)" hint="A compliant bid below this share of the median cannot set the price reference for others. 0 switches it off.">{text(floor, setFloor, { inputMode: 'decimal' })}</Field>
        <p><Link to="/rules">Open the Rule Library</Link></p>
      </section>

      <section className="card stack">
        <h2 className="card__title">Schedule (minutes)</h2>
        <div className="facts">
          <Field label="Questions and documents, before bidding">{text(clarMinutes, setClarMinutes, { inputMode: 'numeric' })}</Field>
          <Field label="Bidding open">{text(bidMinutes, setBidMinutes, { inputMode: 'numeric' })}</Field>
          <Field label="Opening window">{text(openMinutes, setOpenMinutes, { inputMode: 'numeric' })}</Field>
          {usePanel && <Field label="Panel commit window">{text(commitMinutes, setCommitMinutes, { inputMode: 'numeric' })}</Field>}
          {usePanel && <Field label="Panel reveal window">{text(revealMinutes, setRevealMinutes, { inputMode: 'numeric' })}</Field>}
          <Field label="Standstill (challenges)">{text(standMinutes, setStandMinutes, { inputMode: 'numeric' })}</Field>
        </div>
        <Field label="Bid deposit (OKB)" hint="At least 0.001. Returned to every bidder who opens their bid; forfeited to you if a bid is never opened. Also the bond for challenges. A tender takes at most 200 bids.">{text(deposit, setDeposit, { inputMode: 'decimal' })}</Field>
      </section>

      {!quick && (
        <section className="card stack">
          <h2 className="card__title">Evaluation panel</h2>
          <Switch checked={panelOn} onChange={(v) => { setPanelOn(v); setFrozen(null); }}>
            <strong>Use a panel</strong> — hidden scores, then revealed; adds a commit and a reveal window.
          </Switch>
          {panelOn && (
            <>
              <Field label="Panel member addresses" hint="One per line. The rule's panel band comes from their median score."><textarea className="button" rows={3} value={panelText} onChange={(e) => { setPanelText(e.target.value); setFrozen(null); }} /></Field>
              {panel.length > 0 && <Field label="Members who must reveal (quorum)">{text(quorum, setQuorum, { inputMode: 'numeric' })}</Field>}
            </>
          )}
        </section>
      )}

      <section className="card stack" aria-label="Timeline">
        <h2 className="card__title">Timeline</h2>
        <div className="timeline" role="img" aria-label={timeline.map((p) => `${p.label} ${p.minutes} minutes`).join(', ')}>
          {timeline.map((p) => <span key={p.label} className="timeline__part" style={{ flexGrow: Math.max(1, p.minutes) }} title={`${p.label}: ${p.minutes} min`} />)}
        </div>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }} aria-live="polite">
          {timeline.map((p) => `${p.label} ${p.minutes} min`).join(' · ')} — <strong style={{ color: 'var(--color-text)' }}>{timeline.reduce((a, p) => a + p.minutes, 0)} minutes in all</strong>
        </p>
      </section>

      <section className="card stack">
        <button type="button" className="button" onClick={build}>Review the schedule</button>
        {problems.length > 0 && <ul className="notice notice--danger" role="alert">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        {frozen && (
          <>
            <p className="notice">Bidding will open {when(frozen.biddingStart)} and close {when(frozen.deadline)}. These times become permanent once the transaction is confirmed. If you take longer than two minutes to sign, review again.</p>
            {!wallet.account && <p className="notice">Connect a wallet to continue.</p>}
            <TxButton label="Create on X Layer" request={request} onConfirmed={() => navigate('/')} />
          </>
        )}
      </section>
    </div>
  );
}
