import { SealPic } from './Pictures.tsx';

/** A sealed-bid receipt: what the chain holds about a bid that cannot be read yet. Every figure is read from the chain. */
export function SealReceipt({ title, rows, seed }: { title: string; rows: [string, string][]; seed: string }) {
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
