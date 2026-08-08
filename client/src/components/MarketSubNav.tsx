import { NavLink } from "react-router-dom";

const LINKS: { to: string; label: string }[] = [
  { to: "/market/stocks", label: "Stocks" },
  { to: "/market/leaderboard", label: "Leaderboard" },
  { to: "/market/feed", label: "Trade Feed" },
  { to: "/market/wallet", label: "Wallet" },
];

export function MarketSubNav() {
  return (
    <nav className="sub-nav">
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          className={({ isActive }) => (isActive ? "active" : undefined)}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
