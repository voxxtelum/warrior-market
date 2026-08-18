import type { ReactNode } from 'react';
import { Layout } from './Layout';
import { AdminSidebar } from './AdminSidebar';
import { RequireAdmin } from './RequireAdmin';

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAdmin>
      <Layout title="Dawnfire Warrior Stocks" subtitle="Admin Contol Panel">
        <div className="admin-card">
          <AdminSidebar />
          <div className="admin-content">{children}</div>
        </div>
      </Layout>
    </RequireAdmin>
  );
}
