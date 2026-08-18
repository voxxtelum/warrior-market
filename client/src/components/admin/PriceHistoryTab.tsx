import { useEffect, useState } from 'react';
import { Pagination } from '../Pagination';
import {
  getAdminPriceHistory,
  getWarriorVolumeOverview,
  type PriceHistoryResponse,
  type PriceHistorySource,
  type WarriorVolumeRow,
} from '../../api';
import { fmtDateTime, priceDelta } from '../../format';

const PAGE_SIZE = 50;

const SOURCE_OPTIONS: { key: PriceHistorySource; label: string }[] = [
  { key: 'raid', label: 'Raid' },
  { key: 'raid_anchor', label: 'Raid (anchor)' },
  { key: 'swing', label: 'Swing' },
  { key: 'trade', label: 'Trade' },
  { key: 'drift', label: 'Drift' },
];

// Drift excluded by default - it's overwhelmingly the largest and least
// interesting slice of this table (hourly ticks, forever, every warrior).
// 'raid_anchor' rows are audit-only (a raid after a warrior's first no
// longer moves the live price, only the anchor - see commitReport)
// but are included by default alongside 'raid' since together they're the
// full raid history for a warrior.
const DEFAULT_SOURCES: PriceHistorySource[] = ['raid', 'raid_anchor', 'swing', 'trade'];

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

export function PriceHistoryTab() {
  // Draft filters reflect what's checked/selected in the controls; applied
  // filters are what was actually last fetched with. They only sync on
  // "Apply filters" (or on unmount-free tab load), so ticking a few
  // checkboxes doesn't fire a request per click.
  const [draftSources, setDraftSources] = useState<PriceHistorySource[]>(DEFAULT_SOURCES);
  const [draftWarriorId, setDraftWarriorId] = useState<number | null>(null);
  const [appliedSources, setAppliedSources] = useState<PriceHistorySource[]>(DEFAULT_SOURCES);
  const [appliedWarriorId, setAppliedWarriorId] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<PriceHistoryResponse | null>(null);
  const [warriors, setWarriors] = useState<WarriorVolumeRow[] | null>(null);

  useEffect(() => {
    getWarriorVolumeOverview()
      .then((rows) => setWarriors([...rows].sort((a, b) => a.playerName.localeCompare(b.playerName))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    getAdminPriceHistory({
      sources: appliedSources,
      warriorId: appliedWarriorId ?? undefined,
      page,
      pageSize: PAGE_SIZE,
    })
      .then(setData)
      .catch(() => {});
  }, [appliedSources, appliedWarriorId, page]);

  function toggleDraftSource(key: PriceHistorySource) {
    setDraftSources((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]));
  }

  function applyFilters() {
    setAppliedSources(draftSources);
    setAppliedWarriorId(draftWarriorId);
    setPage(0);
  }

  const filtersDirty =
    draftWarriorId !== appliedWarriorId ||
    draftSources.length !== appliedSources.length ||
    draftSources.some((s) => !appliedSources.includes(s));

  const pageCount = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <section className="admin-section">
      <h2 style={{ marginTop: 0 }}>Price History</h2>
      <p className="subtitle" style={{ marginBottom: '1rem' }}>
        Every recorded price change, across every warrior, newest first.
      </p>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {SOURCE_OPTIONS.map((opt) => (
            <label key={opt.key} style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={draftSources.includes(opt.key)}
                onChange={() => toggleDraftSource(opt.key)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <select
          value={draftWarriorId ?? ''}
          onChange={(e) => setDraftWarriorId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">All characters</option>
          {warriors?.map((w) => (
            <option key={w.warriorId} value={w.warriorId}>
              {w.playerName}-{w.server}
            </option>
          ))}
        </select>
        <button type="button" className="btn-affirm" onClick={applyFilters} disabled={!filtersDirty}>
          Apply filters
        </button>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Character</th>
              <th>Price</th>
              <th>Δ</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {data?.entries.length === 0 && (
              <tr>
                <td colSpan={5} className="no-data">
                  No matching price history.
                </td>
              </tr>
            )}
            {data?.entries.map((entry) => {
              const delta = entry.delta !== null ? priceDelta(entry.price - entry.delta, entry.price) : null;
              return (
                <tr key={entry.id}>
                  <td>{fmtDateTime(entry.createdAt)}</td>
                  <td className="warrior-name">
                    {entry.playerName}-{entry.server}
                  </td>
                  <td>{fmtPrice(entry.price)}</td>
                  <td className={delta?.cls}>{delta ? delta.text : <span className="no-data">–</span>}</td>
                  <td>
                    <span className={`source-pill ${entry.source}`}>{entry.source}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </section>
  );
}
