import type { ReactNode } from 'react';
import { Layout } from './Layout';
import { SubNav } from './SubNav';
import { RequireAdmin } from './RequireAdmin';

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <Layout title="Dawnfire Warrior Stocks" subtitle="Admin Contol Panel">
        <SubNav />
        {children}
      </Layout>
    </RequireAdmin>
  );
}
