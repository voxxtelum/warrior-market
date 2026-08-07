import type { ReactNode } from "react";
import { Layout } from "./Layout";
import { SubNav } from "./SubNav";
import { RequireAdmin } from "./RequireAdmin";

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <Layout title="Dawnfire Warrior Stocks" subtitle="Add reports and manage which players show up across the dashboard">
        <SubNav />
        {children}
      </Layout>
    </RequireAdmin>
  );
}
