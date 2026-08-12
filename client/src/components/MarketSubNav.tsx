import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/market/stocks", label: "Stocks" },
  // Hardcoded literal, not a runtime/admin-toggleable flag - remove this
  // badge by deleting this line in a future deploy, per funds.md.
  { to: "/market/funds", label: "Funds", badge: "NEW" },
  { to: "/market/leaderboard", label: "Leaderboard" },
  { to: "/market/feed", label: "Trade Feed" },
  { to: "/market/wallet", label: "Wallet" },
];

export function MarketSubNav() {
  return <TabNav links={LINKS} />;
}
