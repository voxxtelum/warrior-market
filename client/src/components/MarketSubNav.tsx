import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/market/stocks", label: "Stocks" },
  { to: "/market/leaderboard", label: "Leaderboard" },
  { to: "/market/feed", label: "Trade Feed" },
  { to: "/market/wallet", label: "Wallet" },
];

export function MarketSubNav() {
  return <TabNav links={LINKS} />;
}
