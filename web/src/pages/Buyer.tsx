import { Link, useParams } from 'react-router';
import { isAddress, type Address } from 'viem';
import { buyerRecord, deployed } from '../lib/records.ts';
import { useAsync } from '../lib/useAsync.ts';

export function Buyer() {
  const { address } = useParams();
  const ok = isAddress(address ?? '');
  const data = useAsync(() => (ok && deployed() ? buyerRecord(address as Address) : Promise.resolve(null)), [address]);

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Buyer Record</span>
        <h1 className="title mono" style={{ fontSize: 'var(--text-xl)', overflowWrap: 'anywhere' }}>{address}</h1>
        <p className="lede">How a buyer has run its tenders: what was finished, what was cancelled, and how it ruled on challenges.</p>
      </header>
      {!ok ? <p className="notice notice--danger">That is not an address.</p> : !deployed() ? <p className="notice">The tender contract has not been deployed yet, so there are no records.</p> : data.state === 'loading' ? <span className="skeleton" /> : data.state === 'error' && !data.data ? (
        <div className="notice notice--danger" role="alert"><span>Could not read the record: {data.error}</span><div><button type="button" className="button" onClick={data.reload}>Try again</button></div></div>
      ) : data.data!.tenders.length === 0 ? <p className="empty">This address has not created a tender.</p> : (
        <>
          <section className="card">
            <dl className="facts">
              <div className="fact"><dt className="fact__label">Tenders</dt><dd className="fact__value mono">{data.data!.totals.tenders}</dd></div>
              <div className="fact"><dt className="fact__label">Reached final</dt><dd className="fact__value mono">{data.data!.totals.final}</dd></div>
              <div className="fact"><dt className="fact__label">Cancelled by the buyer</dt><dd className="fact__value mono">{data.data!.totals.cancelledByBuyer}</dd></div>
              <div className="fact"><dt className="fact__label">Ended by the contract</dt><dd className="fact__value mono">{data.data!.totals.endedByContract}</dd></div>
              <div className="fact"><dt className="fact__label">Challenges upheld</dt><dd className="fact__value mono">{data.data!.totals.challengesUpheld}</dd></div>
              <div className="fact"><dt className="fact__label">Challenges rejected</dt><dd className="fact__value mono">{data.data!.totals.challengesRejected}</dd></div>
            </dl>
          </section>
          <ul className="stack">
            {data.data!.tenders.map((t) => (
              <li key={t.id.toString()} className="card card__head">
                <Link to={`/t/${t.id}`}>{t.terms?.title ?? `Tender ${t.id}`}</Link>
                <span>{t.phase}{t.cancelReason ? ` · ${t.cancelReason}` : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
