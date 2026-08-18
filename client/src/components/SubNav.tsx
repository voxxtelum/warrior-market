import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/admin", label: "Add Report", end: true },
  { to: "/admin/manage-app", label: "Manage App" },
  { to: "/admin/manage-funds", label: "Manage Funds" },
  { to: "/admin/price-history", label: "Price History" },
  { to: "/admin/notifications", label: "Notifications" },
  { to: "/admin/audit-log", label: "Audit Log" },
  { to: "/admin/summary", label: "Summary" },
];

export function SubNav() {
  return <TabNav links={LINKS} />;
}
