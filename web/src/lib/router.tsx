// A small hash router. Every route is served by the one index.html, so the site works from any static host,
// sub-path or on-chain container with no rewrites. It does only what the app needs: patterns with `:name`
// parameters, a catch-all, links, an active-link style, and a layout with an Outlet.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

export interface RouteDef {
  /** `/`, `/rules/:id`, or `*` for anything else. */
  path: string;
  element: ReactNode;
}

/** The path after `#`, always starting with `/`, without a query string. */
export function pathFromHash(hash: string): string {
  const raw = hash.replace(/^#/, '').split('?')[0] ?? '';
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** Match a path against a pattern. Returns the parameters, or null when it does not match. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  if (pattern === '*') return {};
  const p = pattern.split('/').filter(Boolean);
  const q = path.split('/').filter(Boolean);
  if (p.length !== q.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i]!;
    const value = q[i]!;
    if (seg.startsWith(':')) {
      try {
        params[seg.slice(1)] = decodeURIComponent(value);
      } catch {
        return null;
      }
    } else if (seg !== value) {
      return null;
    }
  }
  return params;
}

interface RouterState {
  path: string;
  params: Record<string, string>;
  outlet: ReactNode;
}

const Context = createContext<RouterState>({ path: '/', params: {}, outlet: null });

/** Renders the matching route's element inside `layout`, which places it with <Outlet />. */
export function Router({ routes, layout }: { routes: RouteDef[]; layout: () => ReactNode }) {
  const [path, setPath] = useState(() => pathFromHash(window.location.hash));
  useEffect(() => {
    const on = () => setPath(pathFromHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const value = useMemo<RouterState>(() => {
    // Exact patterns win over the catch-all, whatever order they were listed in.
    const ordered = [...routes].sort((a, b) => Number(a.path === '*') - Number(b.path === '*'));
    for (const r of ordered) {
      const params = matchPath(r.path, path);
      if (params) return { path, params, outlet: r.element };
    }
    return { path, params: {}, outlet: null };
  }, [routes, path]);
  return <Context.Provider value={value}>{layout()}</Context.Provider>;
}

export function Outlet(): ReactNode {
  return useContext(Context).outlet;
}

export function useParams(): Record<string, string | undefined> {
  return useContext(Context).params;
}

export function useLocation(): { pathname: string } {
  return { pathname: useContext(Context).path };
}

export function useNavigate(): (to: string) => void {
  return useCallback((to: string) => {
    window.location.hash = `#${to}`;
  }, []);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, ...rest }: LinkProps) {
  return <a href={`#${to}`} {...rest} />;
}

/** A link that is marked current (aria-current="page") on its own route; with `end` only on an exact match. */
export function NavLink({ to, end, ...rest }: LinkProps & { end?: boolean }) {
  const { path } = useContext(Context);
  const current = end || to === '/' ? path === to : path === to || path.startsWith(`${to}/`);
  return <a href={`#${to}`} aria-current={current ? 'page' : undefined} {...rest} />;
}
