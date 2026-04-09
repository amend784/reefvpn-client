import { Link, useLocation } from 'react-router-dom';

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5L9 2.5l6 5v7a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 013 14.5v-7z"/>
      <path d="M7 16V10h4v6"/>
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="9" cy="9" r="7"/>
      <ellipse cx="9" cy="9" rx="3" ry="7"/>
      <path d="M2 9h14"/>
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="9" cy="9" r="2.5"/>
      <path d="M9 2v1.5M9 14.5V16M2 9h1.5M14.5 9H16M4.1 4.1l1.1 1.1M12.8 12.8l1.1 1.1M4.1 13.9l1.1-1.1M12.8 5.2l1.1-1.1"/>
    </svg>
  );
}

const navItems = [
  { path: '/', icon: <IconHome />, label: 'Dashboard' },
  { path: '/locations', icon: <IconGlobe />, label: 'Servers' },
  { path: '/settings', icon: <IconGear />, label: 'Settings' },
];

export default function Sidebar() {
  const location = useLocation();

  function isActive(path: string) {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  return (
    <aside className="sidebar">
      <div className="logo-wrap">
        <div className="logo-icon">R</div>
      </div>
      {navItems.map((item) => (
        <Link
          key={item.path}
          to={item.path}
          className={isActive(item.path) ? 'active' : ''}
          title={item.label}
        >
          {item.icon}
        </Link>
      ))}
    </aside>
  );
}
