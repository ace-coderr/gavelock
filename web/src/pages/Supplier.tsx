import { Link, useParams } from 'react-router';
import { isAddress, type Address } from 'viem';
import { supplierPassport, deployed } from '../lib/records.ts';
import { useAsync } from '../lib/useAsync.ts';

export function Supplier() {
  const { address } = useParams();
  const ok = isAddress(address ?? '');
  const data = useAsync(() => (ok && deployed() ? supplierPassport(address as Address) : Promise.resolve(null)), [address]);

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Supplier Passport</span>
        <h1 className="title mono" style={{ fontSize: 'var(--text-xl)', overflowWrap: 'anywhere' }}>{address}</h1>
        <p className="lede">A bidder’s record on Gavelock, exactly as the contract holds it. It says nothing about work delivered.</p>
      </header>
      {!ok ? <p className="notice notice--danger">That is not an address.</p> : !deployed() ? <p className="notice">The tender contract has not been deployed yet, so there are no records.</p> : data.state === 'loading' ? <span className="skeleton" /> : data.state === 'error' && !data.data ? (
        <div className="notice notice--danger" role="alert"><span>Could not read the record: {data.error}</span><div><button type="button" className="button" onClick={data.reload}>Try again</button></div></div>
      ) : data.data!.length === 0 ? <p className="empty">This address has not placed a bid.</p> : (
        <>
          <section className="card">
            <dl className="facts">
              <div className="fact"><dt className="fact__label">Bids</dt><dd className="fact__value mono">{data.data!.length}</dd></div>
              <div className="fact"><dt className="fact__label">Opened</dt><dd className="fact__value mono">{data.data!.filter((e) => e.state !== 'sealed').length}</dd></div>
              <div className="fact"><dt className="fact__label">Awards won</dt><dd className="fact__value mono">{data.data!.filter((e) => e.won).length}</dd></div>
              <div className="fact"><dt className="fact__label">Disqualified</dt><dd className="fact__value mono">{data.data!.filter((e) => e.state === 'disqualified').length}</dd></div>
              <div className="fact"><dt className="fact__label">Deposits forfeited</dt><dd className="fact__value mono">{data.data!.filter((e) => e.forfeited).length}</dd></div>
            </dl>
          </section>
          <ul className="stack">
            {data.data!.map((e) => (
              <li key={`${e.tenderId}-${e.bid}`} className="card card__head">
                <Link to={`/t/${e.tenderId}`}>Tender {e.tenderId.toString()}, bid {e.bid}</Link>
                <span>{e.phase} · {e.state}{e.won ? ' · won' : ''}{e.forfeited ? ' · deposit forfeited' : ''}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
