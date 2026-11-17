import { Link, NavLink } from '../lib/router.tsx';

const links = [
  { to: '/', label: 'Tender Board', end: true },
  { to: '/rules', label: 'Rules', end: false },
  { to: '/verify', label: 'Verify', end: false },
  { to: '/docs', label: 'How it works', end: false },
];

export function Navbar() {
  return (
    <header className="nav">
      <div className="container nav__inner">
        <Link to="/" className="nav__brand" aria-label="Gavelock home">
          Gavelock
        </Link>
        <nav className="nav__links" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="nav__link">
              {link.label}
            </NavLink>
          ))}
          <NavLink to="/new" className="button button--solid nav__cta">
            New tender
          </NavLink>
        </nav>
      </div>
    </header>
  );
}
