import { useState } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import { resetMarket } from '../../api';

export function DangerZoneTab() {
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleReset() {
    await resetMarket('RESET MARKET');
    setResetting(false);
    setResetDone(true);
  }

  return (
    <>
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
                <li>Reset every user's wallet to 1000 coin</li>
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
