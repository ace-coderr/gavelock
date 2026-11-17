import { useState } from 'react';
import type { Address } from 'viem';
import { bytesToHex, encodeAbiParameters, encodeFunctionData, keccak256, type Hex } from 'viem';
import { XLAYER, randomSalt, tenderPanelAbi } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { live, type TenderDetail } from '../../lib/tender.ts';
import { useWallet } from '../../lib/wallet.tsx';
import { PanelSeats } from '../../components/PanelSeats.tsx';
import { TxButton } from '../../components/TxButton.tsx';

const key = (id: bigint, account: string) => `gavelock:scores:${id}:${account.toLowerCase()}`;

export function Panel({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const [scores, setScores] = useState<Record<number, string>>({});
  const [prepared, setPrepared] = useState<{ to: Address; data: Hex } | null>(null);
  const me = wallet.account?.toLowerCase();
  const isMember = me !== undefined && tender.panel.some((m) => m.toLowerCase() === me);
  const nowSec = Date.now() / 1000;
  const r = tender.raw;
  const committing = nowSec >= Number(r.openingEnd) && nowSec < Number(r.commitEnd);
  const revealing = nowSec >= Number(r.commitEnd) && nowSec < Number(r.revealEnd);
  const saved = (() => { try { return wallet.account ? JSON.parse(localStorage.getItem(key(tender.id, wallet.account)) ?? 'null') as { scores: number[]; salt: Hex } | null : null; } catch { return null; } })();

  if (r.panelSize === 0) return <p className="empty">{r.quick ? 'A Quick Quote has no panel. The rule scores price, delivery and the checklist only.' : 'This tender has no evaluation panel.'}</p>;

  const values = tender.bids.map((_, i) => Number(scores[i] ?? ''));
  const valid = tender.bids.length > 0 && values.every((v, i) => scores[i] !== undefined && scores[i] !== '' && Number.isInteger(v) && v >= 0 && v <= 100);

  /** Seal the scores into a commitment. The salt is saved before anything is sent: without it they cannot be revealed. */
  const prepare = () => {
    if (!valid || !wallet.account) return;
    const salt = randomSalt();
    localStorage.setItem(key(tender.id, wallet.account), JSON.stringify({ scores: values, salt }));
    const commitment = keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }], [BigInt(XLAYER.id), live().tenders, tender.id, wallet.account, bytesToHex(Uint8Array.from(values)), salt]));
    setPrepared({ to: live().panel, data: encodeFunctionData({ abi: tenderPanelAbi, functionName: 'commitScores', args: [tender.id, commitment] }) });
  };
  const revealRequest = saved ? { to: live().panel, data: encodeFunctionData({ abi: tenderPanelAbi, functionName: 'revealScores', args: [tender.id, bytesToHex(Uint8Array.from(saved.scores)), saved.salt] }) } : null;

  return (
    <div className="stack">
      <p className="notice">Each panel member commits a hidden score from 0 to 100 for every bid, then reveals it. The contract takes the median of the revealed scores. {r.quorum} of {r.panelSize} must reveal.</p>
      <PanelSeats seats={tender.panelStatus.map((m) => ({ address: m.address, state: m.revealed ? 'revealed' : m.committed ? 'committed' : 'empty', you: m.address.toLowerCase() === me }))} />
      <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
        {tender.panelStatus.filter((m) => m.committed).length} of {tender.panel.length} committed · {tender.panelStatus.filter((m) => m.revealed).length} revealed
      </p>
      <ul className="stack">
        {tender.panel.map((member, k) => (
          <li key={member} className="card"><span className="mono">{shortAddress(member)}</span> · seat {k + 1}{member.toLowerCase() === me ? ' (you)' : ''}</li>
        ))}
      </ul>
      {isMember && (committing || revealing) && (
        <section className="card stack">
          <h3 className="card__title">{committing ? 'Commit your scores' : 'Reveal your scores'}</h3>
          {committing && (
            <>
              <p style={{ color: 'var(--color-text-muted)' }}>One score per bid, in bid order. They are hidden until the reveal window. Your scores and a secret salt are kept in this browser.</p>
              {tender.bids.map((b, i) => (
                <label key={i} className="fact"><span className="fact__label">Bid {i + 1} {b.opened ? `(price ${b.price})` : '(not opened)'}</span><input className="button" inputMode="numeric" value={scores[i] ?? ''} onChange={(e) => setScores({ ...scores, [i]: e.target.value })} /></label>
              ))}
              {!prepared ? (
                <div><button type="button" className="button" disabled={!valid} onClick={prepare}>Seal my scores</button></div>
              ) : (
                <>
                  <p className="notice">Your scores and salt are saved in this browser.</p>
                  <TxButton label="Commit scores" request={prepared} onConfirmed={onChanged} />
                </>
              )}
            </>
          )}
          {revealing && (saved ? <TxButton label="Reveal scores" request={revealRequest} onConfirmed={onChanged} /> : <p className="notice notice--danger">This browser has no saved scores for this tender, so it cannot reveal them.</p>)}
        </section>
      )}
    </div>
  );
}
