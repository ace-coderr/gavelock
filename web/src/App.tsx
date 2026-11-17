import { HashRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { Board } from './pages/Board.tsx';
import { Docs } from './pages/Docs.tsx';
import { RuleProver } from './pages/RuleProver.tsx';
import { Rules } from './pages/Rules.tsx';
import { Buyer } from './pages/Buyer.tsx';
import { Studio } from './pages/Studio.tsx';
import { Supplier } from './pages/Supplier.tsx';
import { Tender } from './pages/Tender.tsx';
import { Verify } from './pages/Verify.tsx';
import { NotFound } from './pages/NotFound.tsx';

// Hash routing: every route is served by the same index.html, so the site works from any static
// host or sub-path without rewrites.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="new" element={<Studio />} />
          <Route path="rules" element={<Rules />} />
          <Route path="rules/:id" element={<RuleProver />} />
          <Route path="t/:id" element={<Tender />} />
          <Route path="suppliers/:address" element={<Supplier />} />
          <Route path="buyers/:address" element={<Buyer />} />
          <Route path="verify" element={<Verify />} />
          <Route path="docs" element={<Docs />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
