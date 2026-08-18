import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDownIcon } from './icons/ChevronDownIcon';

const LINKS = [
  { to: '/admin', label: 'Add Report', end: true },
  { to: '/admin/manage-app', label: 'Manage App' },
  { to: '/admin/manage-funds', label: 'Manage Funds' },
  { to: '/admin/price-history', label: 'Price History' },
  { to: '/admin/notifications', label: 'Notifications' },
  { to: '/admin/audit-log', label: 'Audit Log' },
  { to: '/admin/summary', label: 'Summary' },
  { to: '/admin/backup', label: 'Backup' },
];

export function AdminSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = LINKS.find((l) => l.to === location.pathname)?.to ?? LINKS[0].to;

  return (
    <div className="admin-sidebar">
      <nav className="admin-sidebar-nav">
        {LINKS.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) => (isActive ? 'active' : undefined)}
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="sub-nav-mobile-wrap">
        <select
          className="sub-nav-select"
          value={current}
          onChange={(e) => navigate(e.target.value)}
        >
          {LINKS.map((link) => (
            <option key={link.to} value={link.to}>
              {link.label}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="sub-nav-select-chevron" />
      </div>
    </div>
  );
}
