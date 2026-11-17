import { useState } from 'react';
import { Link, useParams } from '../lib/router.tsx';
import { DEPLOYMENT, isDeployed } from '@gavelock/core';
import { RuleGridLive } from '../components/RuleGridLive.tsx';
import { Countdown, NumberCard, SealReceipt } from '../components/Receipt.tsx';
import { SplitSection, type SplitRow } from '../components/SplitSection.tsx';
import { formatInteger, shortAddress } from '../lib/format.ts';
import { PHASE_HELP } from '../lib/tenders.ts';
import { readTender, type TenderDetail } from '../lib/tender.ts';
import { useAsync } from '../lib/useAsync.ts';
import { AuditPack } from './tender/AuditPack.tsx';
import { Award } from './tender/Award.tsx';
import { BidRoom } from './tender/BidRoom.tsx';
import { Clarifications } from './tender/Clarifications.tsx';
import { Documents } from './tender/Documents.tsx';
import { Opening } from './tender/Opening.tsx';
import { Panel } from './tender/Panel.tsx';

const TABS = ['Documents', 'Clarifications', 'Bid Room', 'Opening', 'Panel', 'Award and Challenge', 'Audit Pack'] as const;
type Tab = (typeof TABS)[number];

function when(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function Facts({ t }: { t: TenderDetail }) {
  const r = t.raw;
  return (
    <dl className="facts" style={{ gridTemplateColumns: '1fr' }}>
      <div className="fact"><dt className="fact__label">Kind</dt><dd className="fact__value">{r.quick ? 'Quick Quote' : 'Full tender'}</dd></div>
      <div className="fact"><dt className="fact__label">Deadline (frozen)</dt><dd className="fact__value">{when(r.deadline)} · <Countdown until={Number(r.deadline)} /></dd></div>
      <div className="fact"><dt className="fact__label">Rule circuit</dt><dd className="fact__value"><Link to={`/rules/${r.ruleId}`} className="mono">#{r.ruleId}</Link></dd></div>
      <div className="fact"><dt className="fact__label">Bid deposit</dt><dd className="fact__value mono">{r.bidDeposit.toString()} wei</dd></div>
      <div className="fact"><dt className="fact__label">Buyer</dt><dd className="fact__value"><Link to={`/buyers/${r.buyer}`} className="mono">{shortAddress(r.buyer)}</Link></dd></div>
      <div className="fact"><dt className="fact__label">Abnormally low floor</dt><dd className="fact__value">{r.abnormalFloorBps === 0 ? 'Off' : `${r.abnormalFloorBps / 100}% of the median`}</dd></div>
    </dl>
  );
}

/** The bids, one row each. A row's detail is its seal receipt while sealed, or its place in the rule's grid once opened. */
function BidsSplit({ t }: { t: TenderDetail }) {
  const r = t.raw;
  const rows: SplitRow[] = t.bids.map((b) => ({
    key: String(b.index),
    name: `Bid ${b.index + 1}`,
    sub: b.disqualified ? 'Disqualified' : b.opened ? `Opened · price ${b.price.toString()}` : 'Sealed',
    detail: b.opened ? (
      <>
        <RuleGridLive ruleId={r.ruleId} marker={b.ruleInput} label={`Every outcome of rule circuit ${r.ruleId}, with bid ${b.index + 1}'s case marked`} />
        <p style={{ marginTop: 'var(--space-3)' }}>
          {b.eligible ? `Eligible, score ${b.score} of 15.` : 'Not eligible.'}
          {b.abnormallyLow ? ' Flagged: abnormally low price.' : ''} The outlined cell is the case this bid landed in.
        </p>
      </>
    ) : (
      <SealReceipt
        title={`Bid ${b.index + 1}`}
        seed={b.commitment}
        rows={[
          ['Ciphertext', `${b.ciphertextBytes} bytes`],
          ['Commitment', `${b.commitment.slice(0, 10)}…${b.commitment.slice(-4)}`],
          ['Sealed in block', b.sealedBlock.toString()],
          ['Opens', Date.now() / 1000 < Number(r.deadline) ? <Countdown until={Number(r.deadline)} /> : 'now'],
        ]}
      />
    ),
  }));
  return <SplitSection title={<>The <em>bids</em></>} side={<Facts t={t} />} rows={rows} />;
}

export function Tender() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('Documents');
  const valid = id !== undefined && /^\d+$/.test(id);
  const detail = useAsync(() => (valid && isDeployed(DEPLOYMENT) ? readTender(BigInt(id!)) : Promise.resolve(null)), [id]);

  if (!valid) return <p className="notice notice--danger">“{id}” is not a tender number.</p>;
  if (!isDeployed(DEPLOYMENT)) return <p className="notice">The tender contract has not been deployed yet, so there are no tenders to open.</p>;
  if (detail.state === 'loading') return <span className="skeleton" aria-busy="true" />;
  if (detail.state === 'error' && !detail.data) {
    return (
      <div className="notice notice--danger" role="alert">
        <span>Could not read this tender: {detail.error}</span>
        <div>
          <button type="button" className="button" onClick={detail.reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const t = detail.data;
  if (!t) return <p className="notice">There is no tender {id} on this contract.</p>;
  const r = t.raw;
  const firstSealed = t.bids.find((b) => !b.opened) ?? t.bids[0];

  return (
    <div className="stack">
      <header className="page__head">
        <span className="eyebrow">
          <Link to="/">Tender Board</Link> · Tender {id}
        </span>
        <h1 className="title">{t.terms?.title ?? `Tender ${id}`}</h1>
        {t.terms?.description && <p className="lede">{t.terms.description}</p>}
        <p>
          <span className={`status ${t.phase === 'Cancelled' ? 'status--danger' : t.phase === 'Final' ? 'status--ok' : 'status--pending'}`}>{t.phase}</span>{' '}
          <span style={{ color: 'var(--color-text-muted)' }}>{PHASE_HELP[t.phase]}</span>
        </p>
        {t.cancelReason && <p className="notice notice--danger">Cancelled: {t.cancelReason}</p>}
      </header>

      <div className="floats" aria-label="Receipts">
        <div className="float" style={{ ['--tilt' as string]: '-3deg', ['--drift' as string]: '-0.035' }}>
          <NumberCard id={id!} rows={[['Stage', t.phase], ['Bids sealed', formatInteger(t.bids.length)], ['Bids opened', formatInteger(r.openedCount)]]} />
        </div>
        {firstSealed && (
          <div className="float" style={{ ['--tilt' as string]: '2.5deg', ['--drift' as string]: '-0.055' }}>
            <SealReceipt
              title={`Bid ${firstSealed.index + 1}`}
              seed={firstSealed.commitment}
              rows={[
                ['Ciphertext', `${firstSealed.ciphertextBytes} bytes`],
                ['Commitment', `${firstSealed.commitment.slice(0, 10)}…${firstSealed.commitment.slice(-4)}`],
                ['State', firstSealed.opened ? 'Opened' : 'Sealed'],
              ]}
            />
          </div>
        )}
      </div>

      {t.bids.length > 0 ? (
        <BidsSplit t={t} />
      ) : (
        <section className="card">
          <Facts t={t} />
        </section>
      )}

      <nav className="nav__links" style={{ marginLeft: 0, flexWrap: 'wrap' }} aria-label="Tender sections" role="tablist">
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} className="nav__link" aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      {tab === 'Documents' && <Documents tender={t} onChanged={detail.reload} />}
      {tab === 'Clarifications' && <Clarifications tender={t} onChanged={detail.reload} />}
      {tab === 'Bid Room' && <BidRoom tender={t} onChanged={detail.reload} />}
      {tab === 'Opening' && <Opening tender={t} onChanged={detail.reload} />}
      {tab === 'Panel' && <Panel tender={t} onChanged={detail.reload} />}
      {tab === 'Award and Challenge' && <Award tender={t} onChanged={detail.reload} />}
      {tab === 'Audit Pack' && <AuditPack tender={t} />}
    </div>
  );
}
