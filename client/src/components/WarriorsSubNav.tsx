import { TabNav, type TabNavLink } from "./TabNav";

const LINKS: TabNavLink[] = [
  { to: "/warriors/compare", label: "Compare" },
  { to: "/warriors/trends", label: "Trends" },
  { to: "/warriors/raids", label: "Raids" },
  { to: "/warriors/breakdown", label: "Breakdown" },
];

export function WarriorsSubNav() {
  return <TabNav links={LINKS} />;
}
