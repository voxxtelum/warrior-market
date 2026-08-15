import { useEffect, useState } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import { GlobalAddRemoveCoinsCard } from './GlobalAddRemoveCoinsCard';
import { PlayersTab } from './PlayersTab';
import { getStockConfig, resetMarket, saveStockConfig, type StockConfig } from '../../api';

export function DangerZoneTab() {
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  // Starting wallet balance lives in stock_config (same single-row config
  // other tunable economy settings already share), not because it's a
  // stock-pricing setting, but so it doesn't need a whole new config table
  // for one number. Fetched here (not on the Stock Config page) since an
  // admin looking to change what new users start with is far more likely to
  // find it next to "Global add/remove coins" and "Reset Market" than
  // buried among raid-scoring/drift knobs.
  const [stockConfig, setStockConfig] = useState<StockConfig | null>(null);
  const [startingBalanceDraft, setStartingBalanceDraft] = useState(1000);
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceStatus, setBalanceStatus] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);

  useEffect(() => {
    getStockConfig()
      .then((config) => {
        setStockConfig(config);
        setStartingBalanceDraft(config.startingWalletBalance);
      })
      .catch(() => {});
  }, []);

  async function handleSaveStartingBalance() {
    if (!stockConfig) return;
    setSavingBalance(true);
    setBalanceStatus(null);
    try {
      const next = { ...stockConfig, startingWalletBalance: startingBalanceDraft };
      await saveStockConfig(next);
      setStockConfig(next);
      setBalanceStatus({ text: 'Saved.', kind: 'success' });
    } catch (err) {
      setBalanceStatus({ text: err instanceof Error ? err.message : String(err), kind: 'error' });
    } finally {
      setSavingBalance(false);
    }
  }

  async function handleReset() {
    await resetMarket('RESET MARKET');
    setResetting(false);
    setResetDone(true);
  }

  return (
    <>
      <GlobalAddRemoveCoinsCard />

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New user starting balance</h2>
        <p className="subtitle" style={{ marginBottom: '1rem' }}>
          Coins a brand-new wallet is seeded with, and what "Reset Market" below resets every wallet back to.
        </p>
        <div className="config-grid">
          <label>
            <span className="field-label">Starting balance</span>
            <input
              type="number"
              step="10"
              value={startingBalanceDraft}
              onChange={(e) => setStartingBalanceDraft(Number(e.target.value))}
              disabled={!stockConfig}
            />
          </label>
        </div>
        <div className="card-footer">
          {balanceStatus && <span className={`status ${balanceStatus.kind}`}>{balanceStatus.text}</span>}
          <button
            type="button"
            className="btn-affirm"
            onClick={handleSaveStartingBalance}
            disabled={savingBalance || !stockConfig || startingBalanceDraft === stockConfig?.startingWalletBalance}
          >
            Save changes
          </button>
        </div>
      </div>

      <PlayersTab />

      <div className="card danger-card">
        <h2 style={{ marginTop: 0 }}>Global reset</h2>
        <p className="subtitle">
          Resets every wallet, holding, trade, notification, and price
          history back to a clean slate. Raid/report data is not affected.
        </p>
        <div className="danger-card-action">
          <button
            type="button"
            className="btn-danger"
            onClick={() => setResetting(true)}
          >
            Reset Market
          </button>
        </div>
        {resetDone && <p className="status success">Market reset.</p>}
      </div>

      {resetting && (
        <ConfirmModal
          title="Reset the entire market?"
          body={
            <>
              <p>This will:</p>
              <ul>
                <li>Reset every user's wallet to {stockConfig?.startingWalletBalance ?? 1000} coin</li>
                <li>Clear all holdings</li>
                <li>Permanently delete the full trade history</li>
                <li>Clear all notifications</li>
                <li>
                  Rebuild every player's price history from existing raid
                  reports (drift resumes from now)
                </li>
              </ul>
              <p>
                Raid/report data itself (reports, casts, damage, linked
                warriors) is not affected.
              </p>
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
    </>
  );
}
