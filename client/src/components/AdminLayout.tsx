import type { ReactNode } from "react";
import { Layout } from "./Layout";
import { SubNav } from "./SubNav";

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Layout title="Warrior Log Dashboard" subtitle="Add reports and manage which players show up across the dashboard">
      <SubNav />
      {children}
    </Layout>
  );
}
