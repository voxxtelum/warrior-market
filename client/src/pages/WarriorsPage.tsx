import { useEffect, useMemo, useState } from 'react';
import { Layout } from '../components/Layout';
import { ChevronDownIcon } from '../components/icons/ChevronDownIcon';
import { useAuth } from '../authContext';
import { getWarriorStats, type WarriorStats } from '../api';

// Everyone tracked by this dashboard is a Warrior (see ingest.ts) - the
// class color is a fixed constant rather than a per-player lookup.
const WARRIOR_CLASS_COLOR = '#C79C6E';

// Raid-tier progression order (rather than alphabetical or by-value) so the
// breakdown always reads chronologically. Instances outside this list (e.g.
// future raids) sort after the known ones, in their original order.
const RAID_ORDER = [
  'Molten Core',
  'Blackwing Lair',
  "Temple of Ahn'Qiraj",
  'Naxxramas',
];

function raidOrderIndex(instance: string): number {
  const i = RAID_ORDER.indexOf(instance);
  return i === -1 ? RAID_ORDER.length : i;
}

function sortByRaidOrder(
  byInstance: Record<string, number>,
): [string, number][] {
  return Object.entries(byInstance).sort(
    (a, b) => raidOrderIndex(a[0]) - raidOrderIndex(b[0]),
  );
}

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
    if (!serversByName.has(w.player_name))
      serversByName.set(w.player_name, new Set());
    serversByName.get(w.player_name)!.add(w.server);
  }
  const names = new Map<string, string>();
  for (const w of warriors) {
    const servers = serversByName.get(w.player_name);
    names.set(
      warriorKey(w),
      servers && servers.size > 1
        ? `${w.player_name} (${w.server})`
        : w.player_name,
    );
  }
  return names;
}

function StatSubcard({
  total,
  totalLabel,
  byInstance,
}: {
  total: number;
  totalLabel: string;
  byInstance: Record<string, number>;
}) {
  const rows = sortByRaidOrder(byInstance);
  return (
    <div className="warrior-subcard">
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
  );
}

export function WarriorsPage() {
  const { user, loading: authLoading } = useAuth();
  const [warriors, setWarriors] = useState<WarriorStats[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');

  useEffect(() => {
    getWarriorStats().then(setWarriors);
  }, []);

  // Defaults to the logged-in user's linked character once both the
  // warrior list and auth state have settled, but only ever runs once -
  // it must not clobber a selection the user has since made by hand.
  useEffect(() => {
    if (!warriors || warriors.length === 0 || authLoading || selectedKey)
      return;
    const linked = user?.linkedWarrior;
    const linkedKey = linked ? `${linked.playerName}::${linked.server}` : null;
    const defaultKey =
      linkedKey && warriors.some((w) => warriorKey(w) === linkedKey)
        ? linkedKey
        : warriorKey(warriors[0]);
    setSelectedKey(defaultKey);
  }, [warriors, user, authLoading, selectedKey]);

  const displayNames = useMemo(
    () => buildDisplayNames(warriors ?? []),
    [warriors],
  );

  const selected = warriors?.find((w) => warriorKey(w) === selectedKey) ?? null;

  return (
    <Layout title="Warriors" subtitle="Cool">
      <div className="card warrior-card">
        <div className="warrior-select-wrap">
          <select
            className="warrior-select"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
            disabled={!warriors || warriors.length === 0}
            style={{ color: WARRIOR_CLASS_COLOR }}
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
          <ChevronDownIcon className="warrior-select-chevron" />
        </div>

        {selected && (
          <div className="warrior-subcards">
            <StatSubcard
              total={selected.totalDamage}
              totalLabel="Total Damage"
              byInstance={selected.damageByInstance}
            />
            <StatSubcard
              total={selected.totalDamageTaken}
              totalLabel="Total Damage Taken"
              byInstance={selected.damageTakenByInstance}
            />
            <StatSubcard
              total={selected.totalCasts}
              totalLabel="Total Casts"
              byInstance={selected.castsByInstance}
            />
          </div>
        )}
      </div>
    </Layout>
  );
}
