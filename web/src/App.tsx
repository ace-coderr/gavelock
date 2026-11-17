import { Layout } from './components/Layout.tsx';
import { Router, type RouteDef } from './lib/router.tsx';
import { Board } from './pages/Board.tsx';
import { Buyer } from './pages/Buyer.tsx';
import { Docs } from './pages/Docs.tsx';
import { NotFound } from './pages/NotFound.tsx';
import { RuleProver } from './pages/RuleProver.tsx';
import { Rules } from './pages/Rules.tsx';
import { Studio } from './pages/Studio.tsx';
import { Supplier } from './pages/Supplier.tsx';
import { Tender } from './pages/Tender.tsx';
import { Verify } from './pages/Verify.tsx';

const routes: RouteDef[] = [
  { path: '/', element: <Board /> },
  { path: '/new', element: <Studio /> },
  { path: '/rules', element: <Rules /> },
  { path: '/rules/:id', element: <RuleProver /> },
  { path: '/t/:id', element: <Tender /> },
  { path: '/suppliers/:address', element: <Supplier /> },
  { path: '/buyers/:address', element: <Buyer /> },
  { path: '/verify', element: <Verify /> },
  { path: '/docs', element: <Docs /> },
  { path: '*', element: <NotFound /> },
];

// Hash routing: every route is served by the same index.html, so the site works from any static
// host or sub-path without rewrites.
export function App() {
  return <Router routes={routes} layout={() => <Layout />} />;
}
