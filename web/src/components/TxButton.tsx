import { explorerTx } from '@gavelock/core';
import { useTransaction, useWallet, type TxRequest } from '../lib/wallet.tsx';

/**
 * A button that sends one transaction in clear steps: it first shows what the call will cost, and
 * only a second press asks the wallet to sign. Pending, confirmed and failed states stay on screen.
 */
export function TxButton({ label, request, onConfirmed }: { label: string; request: TxRequest | null; onConfirmed?: () => void }) {
  const wallet = useWallet();
  const { state, quote, send, reset } = useTransaction();

  if (!wallet.available) return <p className="notice">No wallet was found in this browser. Install a wallet that supports X Layer to send transactions.</p>;
  if (!wallet.account) {
    return (
      <div className="stack">
        <button type="button" className="button" onClick={wallet.connect}>
          Connect wallet
        </button>
        {wallet.error && <p className="notice notice--danger">{wallet.error}</p>}
      </div>
    );
  }
  if (!wallet.onXLayer) {
    return (
      <button type="button" className="button" onClick={wallet.switchToXLayer}>
        Switch the wallet to X Layer
      </button>
    );
  }

  return (
    <div className="stack" aria-live="polite">
      {state.step === 'idle' && (
        <button type="button" className="button" disabled={!request} onClick={() => request && quote(request)}>
          {label}
        </button>
      )}
      {state.step === 'quote' && (
        <>
          <p className="notice">This will cost {state.feeText}.</p>
          <div className="card__head">
            <button type="button" className="button" onClick={() => request && send(request)}>
              Sign in wallet
            </button>
            <button type="button" className="button" onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      )}
      {state.step === 'signing' && <p className="notice">Waiting for you to approve in the wallet…</p>}
      {state.step === 'pending' && (
        <p className="notice">
          Sent. Waiting for confirmation…{' '}
          <a href={explorerTx(state.hash)} target="_blank" rel="noopener noreferrer" className="mono">
            {state.hash.slice(0, 10)}…
          </a>
        </p>
      )}
      {state.step === 'confirmed' && (
        <div className="notice">
          <span className="status status--ok">Confirmed in block {state.blockNumber.toString()}</span>
          <a href={explorerTx(state.hash)} target="_blank" rel="noopener noreferrer" className="mono">
            {state.hash}
          </a>
          <div>
            <button
              type="button"
              className="button"
              onClick={() => {
                reset();
                onConfirmed?.();
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
      {state.step === 'failed' && (
        <div className="notice notice--danger" role="alert">
          <span>{state.message}</span>
          <div>
            <button type="button" className="button" onClick={reset}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
