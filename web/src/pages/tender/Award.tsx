import { useState } from 'react';
import { encodeFunctionData } from 'viem';
import { gavelockAbi } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { live, type TenderDetail } from '../../lib/tender.ts';
import { useWallet } from '../../lib/wallet.tsx';
import { TxButton } from '../../components/TxButton.tsx';

const KINDS = ['False compliance claim', 'Seal mismatch'];
const RULINGS = ['Pending', 'Upheld', 'Rejected'];

export function Award({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const [pageSize, setPageSize] = useState('50');
  const [bidIndex, setBidIndex] = useState('1');
  const [kind, setKind] = useState(0);
  const [reason, setReason] = useState('');
  const [rulings, setRulings] = useState<Record<number, string>>({});
  const r = tender.raw;
  const to = live().tenders;
  const me = wallet.account?.toLowerCase();
  const isBuyer = me === r.buyer.toLowerCase();
  const awarded = r.awardedAt !== 0n;
  const winner = r.best === 0 ? null : r.best - 1;
  const finalizing = !r.cancelled && !r.closed && !awarded && (r.recomputing || Date.now() / 1000 >= Number(r.revealEnd));
  const standstill = awarded && !r.closed && Date.now() / 1000 < Number(r.standstillEnd);
  const canClose = awarded && !r.closed && !r.cancelled && Date.now() / 1000 >= Number(r.standstillEnd) && r.openChallenges === 0;
  const done = r.closed || r.cancelled;

  return (
    <div className="stack">
      <section className="card">
        <h3 className="card__title">The award</h3>
        {winner !== null && awarded ? (
          <p>Bid {winner + 1} ({shortAddress(tender.bids[winner]!.bidder)}) won with a score of {r.bestScore} out of 15. {r.closed ? 'The award is final.' : standstill ? `Challenges are open until ${new Date(Number(r.standstillEnd) * 1000).toLocaleString()}.` : ''}</p>
        ) : r.cancelled ? <p>No award: the tender was cancelled. {tender.cancelReason ?? ''}</p> : (
          <p style={{ color: 'var(--color-text-muted)' }}>{r.recomputing ? 'A challenge was upheld. The award must be computed again.' : 'The award has not been computed yet.'}{r.stage > 0 ? ` In progress: stage ${r.stage} of 3, ${r.scoreCursor} bids scored.` : ''}</p>
        )}
        {r.medianPrice !== 0n && <p className="mono" style={{ color: 'var(--color-text-faint)' }}>Median compliant price {r.medianPrice.toString()} · reference price {r.lowestValidPrice.toString()}</p>}
      </section>

      {finalizing && (
        <section className="card stack">
          <h3 className="card__title">Compute the award</h3>
          <p style={{ color: 'var(--color-text-muted)' }}>Anyone can do this. If there are many bids, work through them in pages; the result is the same however it is split.</p>
          <label className="fact"><span className="fact__label">Bids per transaction</span><input className="button" inputMode="numeric" value={pageSize} onChange={(e) => setPageSize(e.target.value)} /></label>
          <TxButton label="Compute the award" request={/^\d+$/.test(pageSize) && Number(pageSize) > 0 ? { to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'finalize', args: [tender.id, BigInt(pageSize)] }) } : null} onConfirmed={onChanged} />
        </section>
      )}

      {tender.bids.some((b) => b.opened) && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['#', 'Price', 'Days', 'Score', 'Eligible', 'Flags'].map((h) => <th key={h} className="fact__label" style={{ textAlign: 'left', padding: 'var(--space-2)' }}>{h}</th>)}</tr></thead>
            <tbody>
              {tender.bids.filter((b) => b.opened).map((b) => (
                <tr key={b.index} style={winner === b.index && awarded ? { fontWeight: 'var(--weight-bold)' } : undefined}>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.index + 1}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.price.toString()}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.deliveryDays}</td>
                  <td className="mono" style={{ padding: 'var(--space-2)' }}>{b.score}</td>
                  <td style={{ padding: 'var(--space-2)' }}>{b.eligible ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 'var(--space-2)' }}>{[b.abnormallyLow && 'Abnormally low price', b.disqualified && 'Disqualified'].filter(Boolean).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="stack">
        <h3 className="card__title">Challenges</h3>
        {tender.challenges.length === 0 ? <p className="empty">No challenge has been filed.</p> : (
          <ul className="stack">
            {tender.challenges.map((c) => (
              <li key={c.index} className="card stack">
                <p><strong>{KINDS[c.kind]}</strong> against bid {c.bidIndex + 1} · <span className="status status--pending">{RULINGS[c.ruling]}</span></p>
                <p>{c.reason}</p>
                {c.ruling !== 0 && <p style={{ color: 'var(--color-text-muted)' }}><strong>Buyer’s ruling:</strong> {c.rulingReason}</p>}
                {c.ruling === 0 && isBuyer && !done && (
                  <>
                    <textarea className="button" rows={2} placeholder="Your reason. It is public." value={rulings[c.index] ?? ''} onChange={(e) => setRulings({ ...rulings, [c.index]: e.target.value })} />
                    <div className="card__head">
                      <TxButton label="Uphold: disqualify the bid" request={rulings[c.index]?.trim() ? { to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'rule', args: [tender.id, BigInt(c.index), true, rulings[c.index]!.trim()] }) } : null} onConfirmed={onChanged} />
                      <TxButton label="Reject" request={rulings[c.index]?.trim() ? { to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'rule', args: [tender.id, BigInt(c.index), false, rulings[c.index]!.trim()] }) } : null} onConfirmed={onChanged} />
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {standstill && (
          <div className="card stack">
            <h4 className="card__title">File a challenge</h4>
            <label className="fact"><span className="fact__label">Bid number</span><input className="button" inputMode="numeric" value={bidIndex} onChange={(e) => setBidIndex(e.target.value)} /></label>
            <label className="fact"><span className="fact__label">Kind</span><select className="button" value={kind} onChange={(e) => setKind(Number(e.target.value))}>{KINDS.map((k, i) => <option key={k} value={i}>{k}</option>)}</select></label>
            <textarea className="button" rows={3} maxLength={2048} placeholder="What is wrong, and how can it be checked?" value={reason} onChange={(e) => setReason(e.target.value)} />
            <TxButton label="File the challenge" request={reason.trim() && /^\d+$/.test(bidIndex) && Number(bidIndex) >= 1 ? { to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'challenge', args: [tender.id, BigInt(Number(bidIndex) - 1), kind, reason.trim()] }) } : null} onConfirmed={() => { setReason(''); onChanged(); }} />
          </div>
        )}
      </section>

      {canClose && <TxButton label="Make the award final" request={{ to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'close', args: [tender.id] }) }} onConfirmed={onChanged} />}

      {done && tender.bids.length > 0 && (
        <section className="card stack">
          <h3 className="card__title">Deposits</h3>
          <p style={{ color: 'var(--color-text-muted)' }}>Anyone can send a deposit to the wallet it belongs to. A bid left unopened is forfeited to the buyer once another bid was opened.</p>
          {tender.bids.map((b) => (
            <div key={b.index} className="card__head">
              <span>Bid {b.index + 1} <span className="mono">{shortAddress(b.bidder)}</span></span>
              {b.claimed ? <span className="status status--ok">Paid out</span> : <TxButton label={`Pay out deposit ${b.index + 1}`} request={{ to, data: encodeFunctionData({ abi: gavelockAbi, functionName: 'claimDeposit', args: [tender.id, BigInt(b.index)] }) }} onConfirmed={onChanged} />}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
