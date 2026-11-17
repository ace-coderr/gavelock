import { useEffect, useState } from 'react';
import { SealPic } from './Pictures.tsx';

/** A sealed-bid receipt: what the chain holds about a bid that cannot be read yet. Every figure is read from the chain. */
export function SealReceipt({ title, rows, seed }: { title: string; rows: [string, React.ReactNode][]; seed: string }) {
  return (
    <div className="receipt">
      <span className="receipt__label">Sealed-bid receipt</span>
      <span className="receipt__big">{title}</span>
      <div style={{ height: '3.4rem' }}>
        <SealPic seed={seed} label="A seal drawn from this bid's commitment" />
      </div>
      {rows.map(([k, v]) => (
        <div className="receipt__row" key={k}>
          <span>{k}</span>
          <span className="mono">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** The tender number card. */
export function NumberCard({ id, rows }: { id: string; rows: [string, string][] }) {
  return (
    <div className="receipt">
      <span className="receipt__label">Tender</span>
      <span className="receipt__big">No. {id}</span>
      {rows.map(([k, v]) => (
        <div className="receipt__row" key={k}>
          <span>{k}</span>
          <span className="mono">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Time until a moment (unix seconds), ticking each second. Says so plainly once it has passed. */
export function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  const left = until - now;
  if (left <= 0) return <>passed</>;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return <>{d > 0 ? `${d}d ` : ''}{h > 0 || d > 0 ? `${h}h ` : ''}{m}m {s}s</>;
}
