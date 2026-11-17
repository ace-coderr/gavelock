import { useState } from 'react';
import { encodeFunctionData, sha256, toHex, type Hash } from 'viem';
import { tenderRecordsAbi } from '@gavelock/core';
import { publicClient, xLayer } from '../lib/client.ts';
import { live, type TenderDetail } from '../lib/tender.ts';
import { useWallet } from '../lib/wallet.tsx';

/** One chunk per transaction, comfortably under the contract's 24,575-byte limit. */
const CHUNK = 24_000;
const MAX_BYTES = 1 << 20;

/**
 * The buyer posts a document: the first chunk creates it, the rest are appended, and the contract checks
 * the SHA-256 of the stored bytes when the last chunk arrives. If a chunk fails the upload can be resumed
 * from where it stopped; a document that is never completed is shown as incomplete and does not count.
 */
export function DocumentUpload({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  const wallet = useWallet();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ step: 'idle' } | { step: 'sending'; done: number; total: number } | { step: 'done' } | { step: 'failed'; message: string; resumeFrom: number }>({ step: 'idle' });
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [index, setIndex] = useState<bigint | null>(null);

  const records = live().records;
  if (!wallet.account || wallet.account.toLowerCase() !== tender.raw.buyer.toLowerCase()) return null;
  if (!['Published', 'Clarifications'].includes(tender.phase)) return null;

  async function pick(f: File | null) {
    setFile(f);
    setStatus({ step: 'idle' });
    setIndex(null);
    setBytes(f ? new Uint8Array(await f.arrayBuffer()) : null);
  }

  async function send(from: number) {
    if (!wallet.client || !wallet.account || !file || !bytes) return;
    const total = Math.ceil(bytes.length / CHUNK);
    const hash = sha256(toHex(bytes));
    let docIndex = index;
    for (let k = from; k < total; k++) {
      setStatus({ step: 'sending', done: k, total });
      const chunk = toHex(bytes.subarray(k * CHUNK, (k + 1) * CHUNK));
      const data =
        k === 0
          ? encodeFunctionData({ abi: tenderRecordsAbi, functionName: 'publishDocument', args: [tender.id, file.name.slice(0, 128), file.type.slice(0, 64), hash, bytes.length, chunk] })
          : encodeFunctionData({ abi: tenderRecordsAbi, functionName: 'appendDocument', args: [tender.id, docIndex!, chunk] });
      try {
        if (k === 0) docIndex = await publicClient.readContract({ address: records, abi: tenderRecordsAbi, functionName: 'documentCount', args: [tender.id] });
        const tx: Hash = await wallet.client.sendTransaction({ account: wallet.account, chain: xLayer, to: records, data });
        const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
        if (receipt.status !== 'success') throw new Error('The transaction was mined but reverted.');
        if (k === 0) setIndex(docIndex);
      } catch (e) {
        setStatus({ step: 'failed', message: (e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message, resumeFrom: k });
        return;
      }
    }
    setStatus({ step: 'done' });
    onChanged();
  }

  const tooBig = file !== null && file.size > MAX_BYTES;
  const chunks = bytes ? Math.ceil(bytes.length / CHUNK) : 0;

  return (
    <section className="card stack">
      <h3 className="card__title">Post a document</h3>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Documents are stored on chain and cannot be edited or removed. A corrected version is a new document. Up to 1 MiB; each {CHUNK.toLocaleString('en-US')} bytes is one transaction, so a larger file asks you to sign several times. Posting is only possible until bidding starts.
      </p>
      <input type="file" onChange={(e) => pick(e.target.files?.[0] ?? null)} disabled={status.step === 'sending'} />
      {tooBig && <p className="notice notice--danger">That file is larger than 1 MiB.</p>}
      {file && !tooBig && status.step === 'idle' && (
        <div>
          <button type="button" className="button" onClick={() => send(0)}>Post {file.name} ({chunks} transaction{chunks === 1 ? '' : 's'})</button>
        </div>
      )}
      {status.step === 'sending' && <p className="notice" aria-live="polite">Sending part {status.done + 1} of {status.total}. Approve each one in your wallet.</p>}
      {status.step === 'done' && <p className="notice"><span className="status status--ok">Posted</span> The contract checked the SHA-256 of the stored bytes.</p>}
      {status.step === 'failed' && (
        <div className="notice notice--danger" role="alert">
          <span>Stopped at part {status.resumeFrom + 1} of {chunks}: {status.message}</span>
          <div><button type="button" className="button" onClick={() => send(status.resumeFrom)}>Resume from part {status.resumeFrom + 1}</button></div>
        </div>
      )}
    </section>
  );
}
