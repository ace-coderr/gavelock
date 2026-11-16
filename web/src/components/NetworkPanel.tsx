import { useEffect, useState } from 'react';
import { TAPEOUT, explorerAddress } from '@gavelock/core';
import { formatAge, formatGwei, formatInteger, shortAddress } from '../lib/format.ts';
import { useNetworkStatus } from '../lib/useNetworkStatus.ts';

/** Seconds since a unix timestamp, re-rendered every second. */
function useAge(unixSeconds: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return unixSeconds === null ? null : now / 1000 - unixSeconds;
}

/** Live facts read from X Layer in the visitor's browser. Nothing here comes from a server of ours. */
export function NetworkPanel() {
  const { state, snapshot, error, refresh } = useNetworkStatus();
  const age = useAge(snapshot ? snapshot.blockTimestamp : null);
  const value = (render: () => React.ReactNode) => (snapshot ? render() : <span className="skeleton" aria-label="Loading" />);
  const codeOk = snapshot ? snapshot.circuitCodeUnchanged && snapshot.circuitBeaconOwnerless : null;

  return (
    <section className="card" aria-labelledby="network-title">
      <div className="card__head">
        <h2 className="card__title" id="network-title">
          X Layer, read live
        </h2>
        {state === 'loading' && <span className="status status--pending">Connecting</span>}
        {state === 'ok' && <span className="status status--ok">Connected</span>}
        {state === 'error' && <span className="status status--danger">Node unreachable</span>}
      </div>

      {state === 'error' && (
        <div className="notice notice--danger" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          <span>
            Could not read X Layer: {error}.{' '}
            {snapshot ? 'The figures below are the last ones that loaded.' : 'No figures have loaded yet.'}
          </span>
          <div>
            <button type="button" className="button" onClick={refresh}>
              Try again
            </button>
          </div>
        </div>
      )}

      {(state !== 'error' || snapshot) && (
        <dl className="facts">
          <div className="fact">
            <dt className="fact__label">Latest block</dt>
            <dd className="fact__value mono">
              {value(() => (
                <>
                  {formatInteger(snapshot!.blockNumber)}
                  {age !== null && <span style={{ color: 'var(--color-text-faint)' }}> · {formatAge(age)}</span>}
                </>
              ))}
            </dd>
          </div>
          <div className="fact">
            <dt className="fact__label">Gas price</dt>
            <dd className="fact__value mono">{value(() => `${formatGwei(snapshot!.gasPrice)} gwei`)}</dd>
          </div>
          <div className="fact">
            <dt className="fact__label">TapeOut processors</dt>
            <dd className="fact__value mono">{value(() => formatInteger(snapshot!.processors))}</dd>
          </div>
          <div className="fact">
            <dt className="fact__label">Circuit code</dt>
            <dd className="fact__value">
              {value(() =>
                codeOk ? (
                  <span className="status status--ok">Unchanged, no owner</span>
                ) : (
                  <span className="status status--warn">Changed since design</span>
                ),
              )}
            </dd>
          </div>
          <div className="fact">
            <dt className="fact__label">TapeOut factory</dt>
            <dd className="fact__value mono">
              <a href={explorerAddress(TAPEOUT.factory)} target="_blank" rel="noopener noreferrer">
                {shortAddress(TAPEOUT.factory)}
              </a>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
