import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { getWarriorStats, type WarriorStats } from '../api';

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function warriorKey(w: WarriorStats): string {
  return `${w.player_name}::${w.server}`;
}

// Two different characters can share a display name (e.g. same name on
// different realms) - only suffix the select label with "(server)" for
// names that actually collide, matching Compare page's convention.
function buildDisplayNames(warriors: WarriorStats[]): Map<string, string> {
  const serversByName = new Map<string, Set<string>>();
  for (const w of warriors) {
    if (!serversByName.has(w.player_name)) serversByName.set(w.player_name, new Set());
    serversByName.get(w.player_name)!.add(w.server);
  }
  const names = new Map<string, string>();
  for (const w of warriors) {
    const servers = serversByName.get(w.player_name);
    names.set(
      warriorKey(w),
      servers && servers.size > 1 ? `${w.player_name} (${w.server})` : w.player_name,
    );
  }
  return names;
}

function StatBreakdownCard({
  title,
  total,
  totalLabel,
  byInstance,
}: {
  title: string;
  total: number;
  totalLabel: string;
  byInstance: Record<string, number>;
}) {
  const rows = Object.entries(byInstance).sort((a, b) => b[1] - a[1]);
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="warrior-stat-card">
        <div className="warrior-stat-col">
          <div className="wallet-summary-item">
            <span className="value">{fmtInt(total)}</span>
            <span className="label">{totalLabel}</span>
          </div>
        </div>
        <div className="warrior-stat-col warrior-stat-breakdown">
          {rows.map(([instance, value]) => (
            <div className="wallet-summary-item" key={instance}>
              <span className="value">{fmtInt(value)}</span>
              <span className="label">{instance}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function WarriorsPage() {
  const [warriors, setWarriors] = useState<WarriorStats[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    getWarriorStats().then((data) => {
      setWarriors(data);
      if (data.length > 0) setSelectedKey(warriorKey(data[0]));
    });
  }, []);

  const displayNames = useMemo(
    () => buildDisplayNames(warriors ?? []),
    [warriors],
  );

  const selected = warriors?.find((w) => warriorKey(w) === selectedKey) ?? null;

  return (
    <Layout title="Warriors" subtitle="Individual warrior stats across all raids">
      <div className="card">
        <form onSubmit={(e) => e.preventDefault()}>
          <select
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={!warriors || warriors.length === 0}
          >
            {warriors && warriors.length === 0 && (
              <option>No warriors tracked yet</option>
            )}
            {warriors?.map((w) => (
              <option key={warriorKey(w)} value={warriorKey(w)}>
                {displayNames.get(warriorKey(w))}
              </option>
            ))}
          </select>
        </form>
      </div>

      {selected && (
        <>
          <StatBreakdownCard
            title="Damage"
            total={selected.totalDamage}
            totalLabel="Total Damage"
            byInstance={selected.damageByInstance}
          />
          <StatBreakdownCard
            title="Damage Taken"
            total={selected.totalDamageTaken}
            totalLabel="Total Damage Taken"
            byInstance={selected.damageTakenByInstance}
          />
          <StatBreakdownCard
            title="Casts"
            total={selected.totalCasts}
            totalLabel="Total Casts"
            byInstance={selected.castsByInstance}
          />
        </>
      )}
    </Layout>
  );
}
