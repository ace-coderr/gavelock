import { useState } from 'react';
import { DocumentUpload } from '../../components/DocumentUpload.tsx';
import { fetchDocument, type DocumentRecord, type TenderDetail } from '../../lib/tender.ts';

function DocumentRow({ doc }: { doc: DocumentRecord }) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'bad' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function download() {
    setStatus('loading');
    try {
      const { bytes, verified } = await fetchDocument(doc);
      setStatus(verified ? 'ok' : 'bad');
      if (!verified) {
        setMessage('The downloaded bytes do not match the SHA-256 recorded on chain. The file was not saved.');
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: doc.contentType || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.name;
      a.click();
      URL.revokeObjectURL(url);
      setMessage('Checked against the SHA-256 on chain and saved.');
    } catch (e) {
      setStatus('error');
      setMessage((e as Error).message);
    }
  }

  const complete = doc.completedBlock !== 0n;
  return (
    <li className="card">
      <div className="card__head">
        <h3 className="card__title">
          Version {doc.index + 1}: {doc.name}
        </h3>
        {complete ? (
          <button type="button" className="button" onClick={download} disabled={status === 'loading'}>
            {status === 'loading' ? 'Downloading…' : 'Download and verify'}
          </button>
        ) : (
          <span className="status status--warn">Upload incomplete: {doc.received} of {doc.size} bytes</span>
        )}
      </div>
      <dl className="facts">
        <div className="fact"><dt className="fact__label">Size</dt><dd className="fact__value mono">{doc.size.toLocaleString('en-US')} bytes</dd></div>
        <div className="fact"><dt className="fact__label">Type</dt><dd className="fact__value">{doc.contentType || 'unspecified'}</dd></div>
        <div className="fact"><dt className="fact__label">Posted in block</dt><dd className="fact__value mono">{doc.completedBlock.toString()}</dd></div>
        <div className="fact"><dt className="fact__label">SHA-256</dt><dd className="fact__value mono">{doc.sha256Hash}</dd></div>
      </dl>
      {message && <p className={status === 'ok' ? 'notice' : 'notice notice--danger'} role="status" style={{ marginTop: 'var(--space-3)' }}>{message}</p>}
    </li>
  );
}

export function Documents({ tender, onChanged }: { tender: TenderDetail; onChanged: () => void }) {
  return (
    <div className="stack">
      {tender.documents.length === 0 ? (
        <p className="empty">The buyer has not posted any document. Once bidding starts, none can be added.</p>
      ) : (
        <ul className="stack">
          {tender.documents.map((doc) => (
            <DocumentRow key={doc.index} doc={doc} />
          ))}
        </ul>
      )}
      <DocumentUpload tender={tender} onChanged={onChanged} />
    </div>
  );
}
