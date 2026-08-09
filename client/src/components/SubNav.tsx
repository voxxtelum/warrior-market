import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/admin", label: "Add Report", end: true },
  { to: "/admin/players", label: "Players" },
  { to: "/admin/stock-config", label: "Stock Config" },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/market-stats", label: "Market Stats" },
  { to: "/admin/manage-market", label: "Manage Market" },
  { to: "/admin/audit-log", label: "Audit Log" },
];

export function SubNav() {
  return <TabNav links={LINKS} />;
}
