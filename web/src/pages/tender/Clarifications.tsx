import { useState } from 'react';
import { encodeFunctionData } from 'viem';
import { tenderRecordsAbi } from '@gavelock/core';
import { shortAddress } from '../../lib/format.ts';
import { live, type TenderDetail } from '../../lib/tender.ts';
import { useWallet } from '../../lib/wallet.tsx';
import { TxButton } from '../../components/TxButton.tsx';

export function Clarifications({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const isBuyer = wallet.account?.toLowerCase() === tender.raw.buyer.toLowerCase();
  // The contract freezes questions, answers and documents when bidding starts.
  const open = tender.phase === 'Published' || tender.phase === 'Clarifications';
  const records = live().records;

  return (
    <div className="stack">
      {tender.questions.length === 0 ? (
        <p className="empty">No question has been asked.</p>
      ) : (
        <ul className="stack">
          {tender.questions.map((q) => (
            <li key={q.index} className="card">
              <p><strong>Q{q.index + 1}</strong> <span className="mono" style={{ color: 'var(--color-text-faint)' }}>from {shortAddress(q.asker)} · block {q.askedBlock.toString()}</span></p>
              <p>{q.text}</p>
              {q.answer !== null ? (
                <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-text-muted)' }}><strong>Buyer’s answer</strong> (block {q.answeredBlock.toString()}): {q.answer}</p>
              ) : open && isBuyer ? (
                <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
                  <textarea className="button" rows={3} maxLength={2048} placeholder="Your answer. It is public and cannot be edited." value={answers[q.index] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.index]: e.target.value })} />
                  <TxButton label="Answer on chain" request={answers[q.index]?.trim() ? { to: records, data: encodeFunctionData({ abi: tenderRecordsAbi, functionName: 'answer', args: [tender.id, BigInt(q.index), answers[q.index]!.trim()] }) } : null} onConfirmed={onChanged} />
                </div>
              ) : (
                <p style={{ marginTop: 'var(--space-3)', color: 'var(--color-text-faint)' }}>Not answered.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <section className="card stack">
          <h3 className="card__title">Ask the buyer</h3>
          <textarea className="button" rows={3} maxLength={2048} placeholder="Your question. It is public and cannot be edited." value={question} onChange={(e) => setQuestion(e.target.value)} />
          <TxButton label="Ask on chain" request={question.trim() ? { to: records, data: encodeFunctionData({ abi: tenderRecordsAbi, functionName: 'ask', args: [tender.id, question.trim()] }) } : null} onConfirmed={() => { setQuestion(''); onChanged(); }} />
        </section>
      ) : (
        <p className="notice">Questions and answers closed when bidding started. Nothing here can change any more.</p>
      )}
    </div>
  );
}
