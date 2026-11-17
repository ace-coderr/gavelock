import { useState } from 'react';
import { encodeFunctionData } from 'viem';
import { gavelockAbi, openingHint, QUICKNET, roundTime, type Bid, type Checklist, type OpenedBid } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { fetchCiphertext, live, type BidRecord, type TenderDetail } from '../../lib/tender.ts';
import { TxButton } from '../../components/TxButton.tsx';

function checklistOf(t: TenderDetail): Checklist {
  return { items: t.raw.checklistItems, mandatoryMask: t.raw.mandatoryMask, preferredAMask: t.raw.preferredAMask, preferredBMask: t.raw.preferredBMask };
}

/** Result of decrypting a bid's on-chain ciphertext in this browser. */
type Unsealed = { state: 'working' } | { state: 'ready'; bid: Bid } | { state: 'failed'; reason: string };

function BidRow({ tender, bid, onChanged }: { tender: TenderDetail; bid: BidRecord; onChanged: () => void }) {
  const [unsealed, setUnsealed] = useState<Unsealed | null>(null);
  const roundIsPublic = Date.now() / 1000 >= roundTime(Number(tender.raw.drandRound));

  async function unseal() {
    setUnsealed({ state: 'working' });
    try {
      const [{ open }, ciphertext, { decodeBid }] = await Promise.all([import('@gavelock/core/seal'), fetchCiphertext(bid.ciphertext), import('@gavelock/core')]);
      setUnsealed({ state: 'ready', bid: decodeBid(await open(ciphertext)) });
    } catch (e) {
      setUnsealed({ state: 'failed', reason: (e as Error).message });
    }
  }

  // Seal check: does the on-chain ciphertext decrypt to exactly the values that were opened?
  const matches = unsealed?.state === 'ready' && bid.opened && unsealed.bid.price === bid.price && unsealed.bid.deliveryDays === bid.deliveryDays && unsealed.bid.compliance === bid.compliance && unsealed.bid.note === (bid.note ?? '');

  const opened: OpenedBid[] = tender.bids.filter((b) => b.opened).map((b) => ({ index: b.index, price: b.price, deliveryDays: b.deliveryDays, compliance: b.compliance, disqualified: b.disqualified, panelMedian: null }));
  const request =
    unsealed?.state === 'ready' && !bid.opened
      ? {
          to: live().tenders,
          data: encodeFunctionData({
            abi: gavelockAbi,
            functionName: 'openBid',
            args: [tender.id, BigInt(bid.index), unsealed.bid.price, unsealed.bid.deliveryDays, unsealed.bid.compliance, unsealed.bid.note, unsealed.bid.salt, BigInt(openingHint(opened, { index: bid.index, price: unsealed.bid.price }, checklistOf(tender)))],
          }),
        }
      : null;

  return (
    <li className="card stack">
      <div className="card__head">
        <h3 className="card__title">Bid {bid.index + 1} <span className="mono" style={{ color: 'var(--color-text-faint)' }}>{shortAddress(bid.bidder)}</span></h3>
        <span className={`status ${bid.opened ? 'status--ok' : 'status--pending'}`}>{bid.disqualified ? 'Disqualified' : bid.opened ? 'Opened' : 'Sealed'}</span>
      </div>
      {bid.opened ? (
        <dl className="facts">
          <div className="fact"><dt className="fact__label">Price (minor units)</dt><dd className="fact__value mono">{bid.price.toString()}</dd></div>
          <div className="fact"><dt className="fact__label">Delivery</dt><dd className="fact__value mono">{bid.deliveryDays} days</dd></div>
          <div className="fact"><dt className="fact__label">Claims</dt><dd className="fact__value mono">{bid.compliance.toString(2).padStart(tender.raw.checklistItems, '0')}</dd></div>
          {bid.note && <div className="fact"><dt className="fact__label">Note</dt><dd className="fact__value">{bid.note}</dd></div>}
        </dl>
      ) : (
        <p style={{ color: 'var(--color-text-muted)' }}>Still sealed. {roundIsPublic ? 'The drand round is public: anyone can open it.' : `It can be opened from ${new Date(roundTime(Number(tender.raw.drandRound)) * 1000).toLocaleString()}.`}</p>
      )}
      {roundIsPublic && !unsealed && (
        <div><button type="button" className="button" onClick={unseal}>{bid.opened ? 'Check the seal' : 'Unseal in this browser'}</button></div>
      )}
      {unsealed?.state === 'working' && <p className="notice">Fetching the drand signature and decrypting…</p>}
      {unsealed?.state === 'failed' && <p className="notice notice--danger" role="alert">{unsealed.reason}</p>}
      {unsealed?.state === 'ready' && (
        <>
          {bid.opened ? (
            <p className={matches ? 'notice' : 'notice notice--danger'} role="status">
              {matches ? 'Seal check passed: the on-chain ciphertext decrypts to exactly the values that were opened.' : 'Seal MISMATCH: the on-chain ciphertext decrypts to different values from the ones opened. This can be challenged during the standstill.'}
            </p>
          ) : (
            <>
              <p className="notice">Decrypted: price {unsealed.bid.price.toString()}, delivery {unsealed.bid.deliveryDays} days. Submitting this opens the bid for everyone.</p>
              <TxButton label="Open this bid on chain" request={request} onConfirmed={onChanged} />
            </>
          )}
        </>
      )}
    </li>
  );
}

export function Opening({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const beforeDeadline = Date.now() / 1000 < Number(tender.raw.deadline);
  if (tender.bids.length === 0) return <p className="empty">There are no bids to open.</p>;
  return (
    <div className="stack">
      {beforeDeadline && <p className="notice">Bids open after the deadline. Until then they are encrypted to drand round {tender.raw.drandRound.toString()} of {QUICKNET.scheme}, which does not exist yet.</p>}
      <ul className="stack">
        {tender.bids.map((b) => <BidRow key={b.index} tender={tender} bid={b} onChanged={onChanged} />)}
      </ul>
    </div>
  );
}
