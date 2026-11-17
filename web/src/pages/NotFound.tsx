import { Link, useLocation } from '../lib/router.tsx';

export function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="stack">
      <header className="page__head">
        <span className="eyebrow">Not found</span>
        <h1 className="title">There is no page here.</h1>
        <p className="lede">
          Nothing is served at <span className="mono">{pathname}</span>.
        </p>
      </header>
      <div>
        <Link className="button" to="/">
          Back to the Tender Board
        </Link>
      </div>
    </div>
  );
}
