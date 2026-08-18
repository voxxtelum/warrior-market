import { AdminLayout } from '../components/AdminLayout';
import { UsersTab } from '../components/admin/UsersTab';

export function AdminUsersPage() {
  return (
    <AdminLayout>
      <UsersTab />
    </AdminLayout>
  );
}
