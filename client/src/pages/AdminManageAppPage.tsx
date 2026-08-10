import { useState } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { UsersTab } from '../components/admin/UsersTab';
import { CharactersTab } from '../components/admin/CharactersTab';
import { StockConfigTab } from '../components/admin/StockConfigTab';
import { DocsTab } from '../components/admin/DocsTab';
import { DangerZoneTab } from '../components/admin/DangerZoneTab';

type View = 'users' | 'characters' | 'stock-config' | 'docs' | 'danger';

const TABS: { key: View; label: string }[] = [
  { key: 'users', label: 'Users' },
  { key: 'characters', label: 'Characters' },
  { key: 'stock-config', label: 'Stock Config' },
  { key: 'docs', label: 'Docs' },
  { key: 'danger', label: 'Danger Zone' },
];

export function AdminManageAppPage() {
  const [view, setView] = useState<View>('users');
  // Set by StockConfigTab's "see docs" links so the Docs tab can scroll to
  // the relevant STOCKS.md section as soon as it's opened.
  const [docsAnchor, setDocsAnchor] = useState<string | null>(null);

  function navigateToDocs(anchor: string) {
    setDocsAnchor(anchor);
    setView('docs');
  }

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
      {view === 'stock-config' && <StockConfigTab onNavigateToDocs={navigateToDocs} />}
      {view === 'docs' && <DocsTab scrollToAnchor={docsAnchor} />}
      {view === 'danger' && <DangerZoneTab />}
    </AdminLayout>
  );
}
