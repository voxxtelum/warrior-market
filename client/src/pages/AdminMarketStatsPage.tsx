import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { getAdminMarketStats, type MarketStats } from "../api";
import { fmtCoin } from "../format";

type VolumeRow = MarketStats["perWarriorVolume"][number];
type SortKey = "player" | "volume" | "trades";

function sortValue(row: VolumeRow, key: SortKey): string | number {
  if (key === "player") return row.player_name;
  if (key === "volume") return row.volume;
  return row.tradeCount;
}

const VOLUME_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "player", label: "Warrior" },
  { key: "volume", label: "Volume" },
  { key: "trades", label: "Trades" },
];

export function AdminMarketStatsPage() {
  const [stats, setStats] = useState<MarketStats | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("volume");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === "player" ? 1 : -1);
    }
  }

  function arrowFor(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === 1 ? " ▲" : " ▼";
  }

  const sortedVolume = useMemo(() => {
    if (!stats) return [];
    return [...stats.perWarriorVolume].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * (av - bv);
    });
  }, [stats, sortKey, sortDir]);

  useEffect(() => {
    // A non-admin briefly hits this before RequireAdmin's redirect commits
    // (same client-side-only-guard tradeoff as the other admin pages) - swallow
    // the 401 rather than crashing on it, since the redirect is already coming.
    getAdminMarketStats()
      .then(setStats)
      .catch(() => {});
  }, []);

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Market size</h2>
        <div className="wallet-summary">
          <div className="wallet-summary-item">
            <span className="value">{stats?.userCount ?? "–"}</span>
            <span className="label">Traders</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? fmtCoin(stats.totalCoinInWallets) : "–"}</span>
            <span className="label">Coin in wallets</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? fmtCoin(stats.totalCoinInHoldings) : "–"}</span>
            <span className="label">Coin deployed in holdings</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? fmtCoin(stats.totalNetWorth) : "–"}</span>
            <span className="label">Total net worth</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? fmtCoin(stats.totalTradeVolume) : "–"}</span>
            <span className="label">Total trade volume</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Volume by warrior</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {VOLUME_COLUMNS.map((col) => (
                  <th key={col.key} className="sortable" onClick={() => handleSort(col.key)}>
                    {col.label}
                    {arrowFor(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats?.perWarriorVolume.length === 0 && (
                <tr>
                  <td colSpan={3} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {sortedVolume.map((row) => (
                <tr key={`${row.player_name}::${row.server}`}>
                  <td>{row.player_name}</td>
                  <td>{row.volume.toFixed(2)}</td>
                  <td>{row.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Top traders by turnover</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Trader</th>
                <th>Turnover</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              {stats?.topTraders.length === 0 && (
                <tr>
                  <td colSpan={3} className="no-data">
                    No trades yet.
                  </td>
                </tr>
              )}
              {stats?.topTraders.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.username}</td>
                  <td>{row.turnover.toFixed(2)}</td>
                  <td>{row.tradeCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
