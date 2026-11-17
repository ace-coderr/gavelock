import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { DEPLOYMENT, isDeployed } from '@gavelock/core';
import { formatInteger, shortAddress } from '../lib/format.ts';
import { PHASE_HELP } from '../lib/tenders.ts';
import { readTender } from '../lib/tender.ts';
import { useAsync } from '../lib/useAsync.ts';
import { BidRoom } from './tender/BidRoom.tsx';
import { Clarifications } from './tender/Clarifications.tsx';
import { Documents } from './tender/Documents.tsx';

const TABS = ['Documents', 'Clarifications', 'Bid Room'] as const;
type Tab = (typeof TABS)[number];

function when(unixSeconds: bigint | number): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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

  return (
    <div className="stack stagger">
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

      <section className="card">
        <dl className="facts">
          <div className="fact"><dt className="fact__label">Kind</dt><dd className="fact__value">{r.quick ? 'Quick Quote' : 'Full tender'}</dd></div>
          <div className="fact"><dt className="fact__label">Buyer</dt><dd className="fact__value"><Link to={`/buyers/${r.buyer}`} className="mono">{shortAddress(r.buyer)}</Link></dd></div>
          <div className="fact"><dt className="fact__label">Bidding opens</dt><dd className="fact__value">{when(r.biddingStart)}</dd></div>
          <div className="fact"><dt className="fact__label">Deadline (frozen)</dt><dd className="fact__value">{when(r.deadline)}</dd></div>
          <div className="fact"><dt className="fact__label">Bid deposit</dt><dd className="fact__value mono">{r.bidDeposit.toString()} wei</dd></div>
          <div className="fact"><dt className="fact__label">Bids</dt><dd className="fact__value mono">{formatInteger(t.bids.length)} sealed · {formatInteger(r.openedCount)} opened</dd></div>
          <div className="fact"><dt className="fact__label">Rule circuit</dt><dd className="fact__value"><Link to={`/rules/${r.ruleId}`} className="mono">#{r.ruleId}</Link></dd></div>
          <div className="fact"><dt className="fact__label">Abnormally low floor</dt><dd className="fact__value">{r.abnormalFloorBps === 0 ? 'Off' : `${r.abnormalFloorBps / 100}% of the median compliant price`}</dd></div>
        </dl>
      </section>

      <nav className="nav__links" style={{ marginLeft: 0, flexWrap: 'wrap' }} aria-label="Tender sections" role="tablist">
        {TABS.map((name) => (
          <button key={name} type="button" role="tab" aria-selected={tab === name} className="nav__link" aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>

      {tab === 'Documents' && <Documents tender={t} />}
      {tab === 'Clarifications' && <Clarifications tender={t} onChanged={detail.reload} />}
      {tab === 'Bid Room' && <BidRoom tender={t} onChanged={detail.reload} />}
    </div>
  );
}
