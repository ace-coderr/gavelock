import { useMemo, useState } from 'react';
import { encodeFunctionData, toHex, type Hex } from 'viem';
import { XLAYER, commitmentOf, encodeBid, gavelockAbi, randomSalt, validateBid, type Bid } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { live, type TenderDetail } from '../../lib/tender.ts';
import { useWallet } from '../../lib/wallet.tsx';
import { TxButton } from '../../components/TxButton.tsx';

const storageKey = (tenderId: bigint, account: string) => `gavelock:bid:${tenderId}:${account.toLowerCase()}`;

function remembered(tenderId: bigint, account: string | null): (Omit<Bid, 'price'> & { price: string }) | null {
  if (!account) return null;
  try {
    const raw = localStorage.getItem(storageKey(tenderId, account));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function SubmitBid({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const checklist = tender.terms?.checklist ?? [];
  const decimals = tender.terms?.decimals ?? 2;
  const [price, setPrice] = useState('');
  const [days, setDays] = useState('');
  const [claimed, setClaimed] = useState<boolean[]>(() => checklist.map(() => false));
  const [note, setNote] = useState('');
  const [prepared, setPrepared] = useState<{ bid: Bid; commitment: Hex; ciphertext: Hex } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const compliance = claimed.reduce((mask, on, i) => (on ? mask | (1 << i) : mask), 0) >>> 0;

  // Prices are typed in major units ("1250.50") and become whole minor units ("125050").
  function minorUnits(text: string): bigint | null {
    const m = /^(\d+)(?:\.(\d*))?$/.exec(text.trim());
    if (!m) return null;
    const fraction = (m[2] ?? '').padEnd(decimals, '0');
    if (fraction.length > decimals) return null;
    return BigInt(m[1]! + fraction);
  }

  async function prepare() {
    setError(null);
    if (!wallet.account) return;
    const p = minorUnits(price);
    if (p === null) return setError(`Enter the price in ${tender.terms?.currency ?? 'the tender currency'} with at most ${decimals} decimal places.`);
    const bid: Bid = { price: p, deliveryDays: Number(days), compliance, note: note.trim(), salt: randomSalt() };
    const problems = validateBid(bid);
    if (problems.length) return setError(problems.join(' '));
    setBusy(true);
    try {
      // Sealing is loaded on demand: it carries the time-lock cryptography.
      const { seal } = await import('@gavelock/core/seal');
      const ciphertext = await seal(encodeBid(bid), Number(tender.raw.drandRound));
      const commitment = commitmentOf({ chainId: XLAYER.id, contract: live().tenders, tenderId: tender.id, bidder: wallet.account }, bid);
      // Keep the bid on this device: the salt cannot be recovered, and opening needs it.
      localStorage.setItem(storageKey(tender.id, wallet.account), JSON.stringify({ ...bid, price: bid.price.toString() }));
      setPrepared({ bid, commitment, ciphertext: toHex(ciphertext) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const request = prepared
    ? { to: live().tenders, value: tender.raw.bidDeposit, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'submitBid', args: [tender.id, prepared.commitment, prepared.ciphertext] }) }
    : null;

  return (
    <section className="card stack">
      <h3 className="card__title">Place a sealed bid</h3>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Your bid is encrypted in this browser so that nobody, including the buyer, can read it until the deadline. Deposit: {tender.raw.bidDeposit.toString()} wei, returned after the tender.
      </p>
      <label className="fact"><span className="fact__label">Price ({tender.terms?.currency ?? 'tender currency'})</span><input className="button" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} disabled={Boolean(prepared)} /></label>
      <label className="fact"><span className="fact__label">Delivery time (days)</span><input className="button" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={Boolean(prepared)} /></label>
      {checklist.length > 0 && (
        <fieldset className="fact" disabled={Boolean(prepared)}>
          <legend className="fact__label">Checklist items you meet (claims can be challenged)</legend>
          {checklist.map((item, i) => (
            <label key={i} style={{ display: 'block' }}>
              <input type="checkbox" checked={claimed[i] ?? false} onChange={(e) => setClaimed(claimed.map((v, k) => (k === i ? e.target.checked : v)))} /> {item}
            </label>
          ))}
        </fieldset>
      )}
      <label className="fact"><span className="fact__label">Short note (optional, 280 bytes)</span><textarea className="button" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={Boolean(prepared)} /></label>
      {error && <p className="notice notice--danger" role="alert">{error}</p>}
      {!prepared ? (
        <div>
          <button type="button" className="button" onClick={prepare} disabled={busy || !wallet.account}>
            {busy ? 'Sealing…' : wallet.account ? 'Seal my bid' : 'Connect a wallet first'}
          </button>
          {!wallet.account && <button type="button" className="button" onClick={wallet.connect} style={{ marginLeft: 'var(--space-3)' }}>Connect wallet</button>}
        </div>
      ) : (
        <>
          <p className="notice">Sealed. A copy of your bid and its secret salt is kept in this browser; you need it to open the bid after the deadline. Anyone can open it for you, but only with these exact values.</p>
          <TxButton label="Submit sealed bid" request={request} onConfirmed={onChanged} />
        </>
      )}
    </section>
  );
}

export function BidRoom({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const mine = useMemo(() => tender.bids.find((b) => b.bidder.toLowerCase() === wallet.account?.toLowerCase()), [tender.bids, wallet.account]);
  const saved = remembered(tender.id, wallet.account);
  const bidding = tender.phase === 'Bidding';
  const isBuyer = wallet.account?.toLowerCase() === tender.raw.buyer.toLowerCase();

  return (
    <div className="stack">
      {bidding && !mine && !isBuyer && <SubmitBid tender={tender} onChanged={onChanged} />}
      {bidding && mine && <p className="notice">You have a sealed bid in this tender (bid {mine.index + 1}). One bid per wallet.</p>}
      {mine && saved && (
        <p className="notice">
          Your bid is saved in this browser. <button type="button" className="button" onClick={() => {
            const blob = new Blob([JSON.stringify({ tender: tender.id.toString(), ...saved }, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `gavelock-bid-${tender.id}.json`;
            a.click();
          }}>Download a copy</button>
        </p>
      )}

      {tender.bids.length === 0 ? (
        <p className="empty">No bid has been sealed yet.</p>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['#', 'Bidder', 'Sealed in block', 'Commitment', 'State'].map((h) => <th key={h} className="fact__label" style={{ textAlign: 'left', padding: 'var(--space-2)' }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {tender.bids.map((b) => (
                <tr key={b.index}>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.index + 1}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{shortAddress(b.bidder)}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.sealedBlock.toString()}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.commitment.slice(0, 10)}…</td>
                  <td style={{ padding: 'var(--space-2)' }}>{b.disqualified ? 'Disqualified' : b.opened ? 'Opened' : 'Sealed'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ color: 'var(--color-text-faint)' }}>Prices, delivery times and claims are not on this page because they are encrypted until the deadline.</p>
    </div>
  );
}
