import { NavLink } from "react-router-dom";

const LINKS: { to: string; label: string }[] = [
  { to: "/stock", label: "Stocks" },
  { to: "/compare", label: "Compare" },
  { to: "/trends", label: "Trends" },
  { to: "/overview", label: "Raid Overview" },
];

export function MainNav() {
  return (
    <nav className="main-nav">
      {LINKS.map((link) => (
        <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "active" : undefined)}>
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
