import { useState } from 'react';
import { buildAuditPack, packToPdf } from '../../lib/auditPack.ts';
import type { TenderDetail } from '../../lib/tender.ts';

function save(bytes: BlobPart, name: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function AuditPack({ tender }: { tender: TenderDetail }) {
  const [state, setState] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState('');

  async function run(kind: 'json' | 'pdf') {
    setState('working');
    try {
      const pack = await buildAuditPack(tender);
      if (kind === 'json') save(JSON.stringify(pack, null, 2), `gavelock-tender-${tender.id}-audit.json`, 'application/json');
      else save(packToPdf(pack) as BlobPart, `gavelock-tender-${tender.id}-audit.pdf`, 'application/pdf');
      setState('idle');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    }
  }

  return (
    <section className="card stack">
      <h3 className="card__title">Audit Pack</h3>
      <p style={{ color: 'var(--color-text-muted)' }}>
        Transaction hashes, document hashes, the rule circuit, every bid, the scores and the award, built in this browser from the chain. Nothing is uploaded.
      </p>
      <div className="card__head">
        <button type="button" className="button" disabled={state === 'working'} onClick={() => run('pdf')}>{state === 'working' ? 'Building…' : 'Download PDF'}</button>
        <button type="button" className="button" disabled={state === 'working'} onClick={() => run('json')}>Download JSON</button>
      </div>
      {state === 'error' && <p className="notice notice--danger" role="alert">{error}</p>}
    </section>
  );
}
