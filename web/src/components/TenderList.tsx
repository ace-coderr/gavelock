import { useState } from 'react';
import { shortAddress, formatInteger } from '../lib/format.ts';
import { PHASE_HELP, listTenders } from '../lib/tenders.ts';
import { useAsync } from '../lib/useAsync.ts';

const PAGE = 20;

function when(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Every tender on the contract, newest first, read from the chain a page at a time. */
export function TenderList() {
  const [offset, setOffset] = useState(0);
  const result = useAsync(() => listTenders(offset, PAGE), [offset]);

  if (result.state === 'loading') {
    return (
      <div className="card" aria-busy="true">
        <span className="skeleton" /> <span className="skeleton" />
      </div>
    );
  }
  if (result.state === 'error' && !result.data) {
    return (
      <div className="notice notice--danger" role="alert">
        <span>Could not read the tender list: {result.error}</span>
        <div>
          <button type="button" className="button" onClick={result.reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const { total, items } = result.data!;
  if (total === 0n) {
    return (
      <section className="empty">
        <h2 className="empty__title">No tenders yet</h2>
        <p>The tender contract is live and holds no tenders.</p>
      </section>
    );
  }

  return (
    <section className="stack" aria-label="Tenders">
      {result.state === 'error' && (
        <div className="notice notice--danger" role="alert">
          Could not refresh: {result.error}. Showing the last list that loaded.
        </div>
      )}
      <ul className="stack stagger">
        {items.map((t) => (
          <li key={t.id.toString()} className="card">
            <div className="card__head">
              <h2 className="card__title">{t.title ?? `Tender ${t.id}`}</h2>
              <span className={`status ${t.phase === 'Cancelled' ? 'status--danger' : t.phase === 'Final' ? 'status--ok' : 'status--pending'}`} title={PHASE_HELP[t.phase]}>
                {t.phase}
              </span>
            </div>
            <dl className="facts">
              <div className="fact">
                <dt className="fact__label">Kind</dt>
                <dd className="fact__value">{t.quick ? 'Quick Quote' : 'Full tender'}</dd>
              </div>
              <div className="fact">
                <dt className="fact__label">Bidding closes</dt>
                <dd className="fact__value">{when(t.deadline)}</dd>
              </div>
              <div className="fact">
                <dt className="fact__label">Bids opened</dt>
                <dd className="fact__value mono">{formatInteger(t.openedCount)}</dd>
              </div>
              <div className="fact">
                <dt className="fact__label">Buyer</dt>
                <dd className="fact__value mono">{shortAddress(t.buyer)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="card__head">
        <button type="button" className="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          Newer
        </button>
        <span className="eyebrow">
          {offset + 1}–{offset + items.length} of {formatInteger(total)}
        </span>
        <button type="button" className="button" disabled={BigInt(offset + PAGE) >= total} onClick={() => setOffset(offset + PAGE)}>
          Older
        </button>
      </div>
    </section>
  );
}
