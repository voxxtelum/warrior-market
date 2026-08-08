import { NavLink } from "react-router-dom";

const LINKS: { to: string; label: string; end?: boolean }[] = [
  { to: "/admin", label: "Add Report", end: true },
  { to: "/admin/players", label: "Players" },
  { to: "/admin/stock-config", label: "Stock Config" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/market-stats", label: "Market Stats" },
  { to: "/admin/manage-market", label: "Manage Market" },
];

export function SubNav() {
  return (
    <nav className="sub-nav">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
