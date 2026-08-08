import { useEffect, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import { AdjustCoinsModal } from "../components/AdjustCoinsModal";
import { ConfirmModal } from "../components/ConfirmModal";
import { getAdminWallets, resetMarket, type AdminWalletRow } from "../api";
import { fmtCoin } from "../format";

export function AdminManageMarketPage() {
  const [wallets, setWallets] = useState<AdminWalletRow[] | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<AdminWalletRow | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  function reloadWallets() {
    // A non-admin briefly hits this before RequireAdmin's redirect commits
    // (same client-side-only-guard tradeoff as the other admin pages) - swallow
    // the 401 rather than crashing on it, since the redirect is already coming.
    getAdminWallets()
      .then(setWallets)
      .catch(() => {});
  }

  useEffect(reloadWallets, []);

  async function handleReset() {
    await resetMarket("RESET MARKET");
    setResetting(false);
    setResetDone(true);
    reloadWallets();
  }

  return (
    <AdminLayout>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Wallets</h2>
        <div className="table-scroll">
          <table id="manage-wallets-table">
            <thead>
              <tr>
                <th></th>
                <th>Username</th>
                <th>Balance</th>
                <th>Holdings value</th>
                <th>Net worth</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wallets?.length === 0 && (
                <tr>
                  <td colSpan={6} className="no-data">
                    No users yet.
                  </td>
                </tr>
              )}
              {wallets?.map((w) => (
                <tr key={w.userId}>
                  <td>
                    {w.avatar ? (
                      <img className="user-avatar" src={w.avatar} alt="" width={28} height={28} />
                    ) : (
                      <span className="user-avatar user-avatar-placeholder" />
                    )}
                  </td>
                  <td>{w.username}</td>
                  <td>{fmtCoin(w.balance)}</td>
                  <td>{fmtCoin(w.holdingsValue)}</td>
                  <td>{fmtCoin(w.netWorth)}</td>
                  <td>
                    <button type="button" onClick={() => setAdjustTarget(w)}>
                      Add/Remove Coins
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card danger-card">
        <h2 style={{ marginTop: 0 }}>Global reset</h2>
        <p className="subtitle">
          Resets every wallet, holding, trade, notification, and price history back to a clean slate. Raid/report
          data is not affected.
        </p>
        <button type="button" className="btn-danger" onClick={() => setResetting(true)}>
          Reset Market
        </button>
        {resetDone && <p className="status success">Market reset.</p>}
      </div>

      {adjustTarget && (
        <AdjustCoinsModal target={adjustTarget} onClose={() => setAdjustTarget(null)} onAdjusted={reloadWallets} />
      )}

      {resetting && (
        <ConfirmModal
          title="Reset the entire market?"
          body={
            <>
              <p>This will:</p>
              <ul>
                <li>Reset every user's wallet to 1000 coin</li>
                <li>Clear all holdings</li>
                <li>Permanently delete the full trade history</li>
                <li>Clear all notifications</li>
                <li>Rebuild every player's price history from existing raid reports (drift resumes from now)</li>
              </ul>
              <p>Raid/report data itself (reports, casts, damage, linked warriors) is not affected.</p>
              <p>
                <strong>This cannot be undone.</strong>
              </p>
            </>
          }
          confirmLabel="Reset market"
          requireTypedPhrase="RESET MARKET"
          onConfirm={handleReset}
          onClose={() => setResetting(false)}
        />
      )}
    </AdminLayout>
  );
}
