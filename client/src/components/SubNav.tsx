import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/admin", label: "Add Report", end: true },
  { to: "/admin/manage-app", label: "Manage App" },
  { to: "/admin/manage-funds", label: "Manage Funds" },
  { to: "/admin/price-history", label: "Price History" },
  { to: "/admin/audit-log", label: "Audit Log" },
];

export function SubNav() {
  return <TabNav links={LINKS} />;
}
