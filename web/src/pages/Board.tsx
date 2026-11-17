import { Link } from 'react-router';
import { DEPLOYMENT, isDeployed } from '@gavelock/core';
import { NetworkPanel } from '../components/NetworkPanel.tsx';
import { TenderList } from '../components/TenderList.tsx';

export function Board() {
  const deployed = isDeployed(DEPLOYMENT);

  return (
    <div className="stack stagger">
      <header className="page__head">
        <span className="eyebrow">Tender Board</span>
        <h1 className="title">Tenders nobody can quietly bend.</h1>
        <p className="lede">
          Bids stay sealed until the deadline. The scoring rule is frozen before the first bid arrives. The award is
          computed on chain by a public circuit, not chosen by the buyer.
        </p>
      </header>

      {deployed ? (
        <TenderList />
      ) : (
        <section className="empty" aria-labelledby="board-empty-title">
          <h2 className="empty__title" id="board-empty-title">
            No tenders yet
          </h2>
          <p>
            The Gavelock tender contract has not been deployed to X Layer yet, so there is nothing to list. Once it
            is, this board reads every tender straight from the contract.
          </p>
          <Link className="button" to="/docs">
            How it works
          </Link>
        </section>
      )}

      <NetworkPanel />
    </div>
  );
}
