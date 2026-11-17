import { useEffect } from 'react';
import { Outlet, useLocation } from '../lib/router.tsx';
import { useScrollVariable } from '../lib/motion.ts';
import { Navbar } from './Navbar.tsx';
import { Footer } from './Footer.tsx';

export function Layout() {
  const { pathname } = useLocation();
  const home = pathname === '/';
  useScrollVariable();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <Navbar />
      {/* The key restarts the enter animation on every route change. The home page lays out its own full-width sections. */}
      <main className={`page${home ? ' page--home' : ''}`} key={pathname}>
        {home ? (
          <Outlet />
        ) : (
          <div className="container">
            <Outlet />
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
