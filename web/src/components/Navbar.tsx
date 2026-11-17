import { Link, NavLink } from 'react-router';

const links = [
  { to: '/', label: 'Tender Board', end: true },
  { to: '/rules', label: 'Rules', end: false },
  { to: '/docs', label: 'How it works', end: false },
];

export function Navbar() {
  return (
    <header className="nav">
      <div className="container nav__inner">
        <Link to="/" className="nav__brand" aria-label="Gavelock home">
          <svg className="nav__mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect x="6" y="7" width="20" height="8" rx="2.5" fill="currentColor" />
            <rect x="14" y="15" width="4" height="9" fill="currentColor" />
            <rect x="8" y="24" width="16" height="3" rx="1.5" fill="currentColor" opacity="0.55" />
          </svg>
          Gavelock
        </Link>
        <nav className="nav__links" aria-label="Main">
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} className="nav__link">
              {link.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
