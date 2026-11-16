import { HashRouter, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { Board } from './pages/Board.tsx';
import { Docs } from './pages/Docs.tsx';
import { NotFound } from './pages/NotFound.tsx';

// Hash routing: every route is served by the same index.html, so the site works from any static
// host or sub-path without rewrites.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Board />} />
          <Route path="docs" element={<Docs />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
