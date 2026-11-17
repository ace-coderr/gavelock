import { useEffect, useState } from 'react';
import { encodeFunctionData } from 'viem';
import { gavelockAbi, openingHint, QUICKNET, roundTime, type Bid, type Checklist, type OpenedBid } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { fetchCiphertext, live, type BidRecord, type TenderDetail } from '../../lib/tender.ts';
import { GlassWipe } from '../../components/GlassWipe.tsx';
import { Countdown, SealReceipt } from '../../components/Receipt.tsx';
import { TxButton } from '../../components/TxButton.tsx';

function checklistOf(t: TenderDetail): Checklist {
  return { items: t.raw.checklistItems, mandatoryMask: t.raw.mandatoryMask, preferredAMask: t.raw.preferredAMask, preferredBMask: t.raw.preferredBMask };
}

/** Result of decrypting a bid's on-chain ciphertext in this browser. */
type Unsealed = { state: 'working' } | { state: 'ready'; bid: Bid } | { state: 'failed'; reason: string };

function BidRow({ tender, bid, onChanged }: { tender: TenderDetail; bid: BidRecord; onChanged: () => void }) {
  const [unsealed, setUnsealed] = useState<Unsealed | null>(null);
  // The ciphertext names the drand round it is sealed to, and that can be read at any time. A bid sealed to a
  // later round than the tender's cannot be opened by others at the deadline: its owner could then choose,
  // after seeing the other bids, whether to open it. That is flagged here for everyone to see, and it can be challenged.
  const [header, setHeader] = useState<'checking' | 'ok' | 'wrong-round' | 'not-a-seal'>('checking');
  useEffect(() => {
    let live = true;
    Promise.all([fetchCiphertext(bid.ciphertext), import('@gavelock/core/seal')])
      .then(([bytes, { sealHeader }]) => {
        const h = sealHeader(bytes);
        if (live) setHeader(!h ? 'not-a-seal' : h.round === Number(tender.raw.drandRound) ? 'ok' : 'wrong-round');
      })
      .catch(() => {
        if (live) setHeader('checking');
      });
    return () => {
      live = false;
    };
  }, [bid.ciphertext, tender.raw.drandRound]);
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
      {header === 'wrong-round' && <p className="notice notice--danger" role="alert">This bid is sealed to a different drand round from the tender’s. Others cannot open it at the deadline, so its owner can decide whether to open it after seeing the other bids. It can be challenged as a seal mismatch.</p>}
      {header === 'not-a-seal' && <p className="notice notice--danger" role="alert">The stored bytes are not a time-lock ciphertext, so only the owner of this bid can ever open it. It can be challenged as a seal mismatch.</p>}
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

/**
 * The bids behind frosted glass. Before the deadline the glass shows only what the chain holds about a sealed bid:
 * its ciphertext size, its commitment and the time left. After the deadline it shows the opened bids as read from
 * the chain. "Opened" replaces "Sealed" in the lettering only once at least one bid has really been opened.
 */
function BidsGlass({ tender }: { tender: TenderDetail }) {
  const deadline = Number(tender.raw.deadline);
  const past = Date.now() / 1000 >= deadline;
  const anyOpened = tender.bids.some((b) => b.opened);
  return (
    <GlassWipe word={past && anyOpened ? 'Opened' : 'Sealed'} hint="The bids are behind frosted glass. Use the Clear the glass button to see them without wiping.">
      <div className="floats" style={{ paddingBlock: 0, justifyContent: 'flex-start' }}>
        {tender.bids.map((b) =>
          b.opened ? (
            <div className="receipt" key={b.index}>
              <span className="receipt__label">Opened bid</span>
              <span className="receipt__big">Bid {b.index + 1}</span>
              <div className="receipt__row"><span>Price (minor units)</span><span className="mono">{b.price.toString()}</span></div>
              <div className="receipt__row"><span>Delivery</span><span className="mono">{b.deliveryDays} days</span></div>
              <div className="receipt__row"><span>Opened in block</span><span className="mono">{b.openedBlock.toString()}</span></div>
            </div>
          ) : (
            <SealReceipt
              key={b.index}
              title={`Bid ${b.index + 1}`}
              seed={b.commitment}
              rows={[
                ['Ciphertext', `${b.ciphertextBytes} bytes`],
                ['Commitment', `${b.commitment.slice(0, 10)}…${b.commitment.slice(-4)}`],
                ['Sealed in block', b.sealedBlock.toString()],
                [past ? 'Deadline' : 'Time left', past ? 'passed' : <Countdown until={deadline} />],
              ]}
            />
          ),
        )}
      </div>
    </GlassWipe>
  );
}

export function Opening({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const beforeDeadline = Date.now() / 1000 < Number(tender.raw.deadline);
  if (tender.bids.length === 0) return <p className="empty">There are no bids to open.</p>;
  return (
    <div className="stack">
      <BidsGlass tender={tender} />
      {beforeDeadline && <p className="notice">Bids open after the deadline. Until then they are encrypted to drand round {tender.raw.drandRound.toString()} of {QUICKNET.scheme}, which does not exist yet.</p>}
      <ul className="stack">
        {tender.bids.map((b) => <BidRow key={b.index} tender={tender} bid={b} onChanged={onChanged} />)}
      </ul>
    </div>
  );
}
