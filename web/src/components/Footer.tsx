import { DEPLOYMENT, explorerAddress, isDeployed } from '@gavelock/core';
import { Link } from '../lib/router.tsx';

const REPOSITORY = 'https://github.com/ace-coderr/gavelock';

export function Footer() {
  const live = isDeployed(DEPLOYMENT) ? DEPLOYMENT : null;
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__about">
          <p className="footer__name">Gavelock</p>
          <p>Tamper-proof tenders on X Layer: sealed bids, public rules, awards anyone can recompute.</p>
        </div>
        <nav className="footer__col" aria-label="Footer">
          <p className="footer__head">Read</p>
          <Link to="/docs">How it works</Link>
          <Link to="/rules">Rules</Link>
          <Link to="/verify">Verify</Link>
        </nav>
        <div className="footer__col">
          <p className="footer__head">On chain</p>
          <a href={REPOSITORY} target="_blank" rel="noopener noreferrer">
            Repository
          </a>
          {live ? (
            <>
              <a href={explorerAddress(live.tenders)} target="_blank" rel="noopener noreferrer">
                Tender contract
              </a>
              <a href={explorerAddress(live.processor)} target="_blank" rel="noopener noreferrer">
                Rule processor
              </a>
              <a href={explorerAddress(live.ruleStock)} target="_blank" rel="noopener noreferrer">
                Rule stock
              </a>
            </>
          ) : (
            <span>Contracts: not deployed yet</span>
          )}
        </div>
      </div>
      <div className="container footer__limits">
        <p>
          Honest limits: bids stay sealed only while drand keeps publishing; documents, scores and awards are public by design; the contracts have had a
          self-review, not a third-party audit. Nothing here is legal advice. The full list is under How it works.
        </p>
      </div>
    </footer>
  );
}
