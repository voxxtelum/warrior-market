import { useState } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { UsersTab } from '../components/admin/UsersTab';
import { CharactersTab } from '../components/admin/CharactersTab';
import { PlayersTab } from '../components/admin/PlayersTab';
import { StockConfigTab } from '../components/admin/StockConfigTab';
import { DangerZoneTab } from '../components/admin/DangerZoneTab';

type View = 'users' | 'characters' | 'players' | 'stock-config' | 'danger';

const TABS: { key: View; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'characters', label: 'Characters' },
  { key: 'players', label: 'Players' },
  { key: 'stock-config', label: 'Stock Config' },
  { key: 'danger', label: 'Danger Zone' },
];

export function AdminManageAppPage() {
  const [view, setView] = useState<View>('users');

  return (
    <AdminLayout>
      <div className="manage-app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={view === tab.key ? 'active' : undefined}
            onClick={() => setView(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {view === 'users' && <UsersTab />}
      {view === 'characters' && <CharactersTab />}
      {view === 'players' && <PlayersTab />}
      {view === 'stock-config' && <StockConfigTab />}
      {view === 'danger' && <DangerZoneTab />}
    </AdminLayout>
  );
}
