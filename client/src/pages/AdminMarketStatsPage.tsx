import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { getAdminMarketStats, type MarketStats } from "../api";

export function AdminMarketStatsPage() {
  const [stats, setStats] = useState<MarketStats | null>(null);

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
            <span className="value">{stats ? stats.totalCoinInWallets.toFixed(2) : "–"}</span>
            <span className="label">Coin in wallets</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? stats.totalCoinInHoldings.toFixed(2) : "–"}</span>
            <span className="label">Coin deployed in holdings</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">{stats ? stats.totalNetWorth.toFixed(2) : "–"}</span>
            <span className="label">Total net worth</span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Volume by warrior</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Warrior</th>
                <th>Volume</th>
                <th>Trades</th>
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
              {stats?.perWarriorVolume.map((row) => (
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
