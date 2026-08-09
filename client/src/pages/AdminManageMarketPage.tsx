import { useEffect, useState } from 'react';
import { AdminLayout } from '../components/AdminLayout';
import { AddRemoveCoinsCard } from '../components/AddRemoveCoinsCard';
import { ConfirmModal } from '../components/ConfirmModal';
import { Pagination } from '../components/Pagination';
import { PortfolioBreakdownChart } from '../components/PortfolioBreakdownChart';
import {
  getAdminUserDetail,
  getAdminWallets,
  getAdminWarriors,
  getWarriorHolders,
  resetMarket,
  type AdminUserDetail,
  type AdminWalletRow,
  type AdminWarriorRow,
  type WarriorHoldersResponse,
} from '../api';
import { fmtCoin, fmtDateTime } from '../format';

const PAGE_SIZE = 25;

type View = 'users' | 'warriors' | 'danger';

function pnlCell(pnl: number | null) {
  if (pnl === null) return <span className="no-data">–</span>;
  const cls = pnl > 0 ? 'delta-pos' : pnl < 0 ? 'delta-neg' : 'delta-neutral';
  return (
    <span className={cls}>
      {pnl >= 0 ? '+' : ''}
      {fmtCoin(pnl)}
    </span>
  );
}

export function AdminManageMarketPage() {
  const [view, setView] = useState<View>('users');

  const [wallets, setWallets] = useState<AdminWalletRow[] | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [page, setPage] = useState(0);

  const [warriors, setWarriors] = useState<AdminWarriorRow[] | null>(null);
  const [selectedWarriorId, setSelectedWarriorId] = useState<number | null>(
    null,
  );
  const [warriorHolders, setWarriorHolders] =
    useState<WarriorHoldersResponse | null>(null);

  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  function reloadWallets() {
    // A non-admin briefly hits this before RequireAdmin's redirect commits -
    // swallow the 401 rather than crashing on it, since the redirect is
    // already coming (matches the other admin pages' convention).
    getAdminWallets()
      .then(setWallets)
      .catch(() => {});
  }

  function reloadUserDetail(userId: string) {
    getAdminUserDetail(userId)
      .then(setUserDetail)
      .catch(() => {});
  }

  useEffect(reloadWallets, []);

  useEffect(() => {
    if (view === 'warriors' && warriors === null) {
      getAdminWarriors()
        .then(setWarriors)
        .catch(() => {});
    }
  }, [view, warriors]);

  useEffect(() => {
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    setPage(0);
    reloadUserDetail(selectedUserId);
  }, [selectedUserId]);

  useEffect(() => {
    if (selectedWarriorId === null) {
      setWarriorHolders(null);
      return;
    }
    getWarriorHolders(selectedWarriorId)
      .then(setWarriorHolders)
      .catch(() => {});
  }, [selectedWarriorId]);

  async function handleReset() {
    await resetMarket('RESET MARKET');
    setResetting(false);
    setResetDone(true);
    reloadWallets();
  }

  const pageCount = userDetail
    ? Math.ceil(userDetail.transactions.length / PAGE_SIZE)
    : 0;
  const pageTransactions = userDetail?.transactions.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <AdminLayout>
      <div className="manage-market-tabs">
        <button
          type="button"
          className={view === 'users' ? 'active' : undefined}
          onClick={() => setView('users')}
        >
          Users
        </button>
        <button
          type="button"
          className={view === 'warriors' ? 'active' : undefined}
          onClick={() => setView('warriors')}
        >
          Characters
        </button>
        <button
          type="button"
          className={view === 'danger' ? 'active' : undefined}
          onClick={() => setView('danger')}
        >
          Danger Zone
        </button>
      </div>

      {view === 'users' && !selectedUserId && (
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
                        <img
                          className="user-avatar"
                          src={w.avatar}
                          alt=""
                          width={28}
                          height={28}
                        />
                      ) : (
                        <span className="user-avatar user-avatar-placeholder" />
                      )}
                    </td>
                    <td>{w.username}</td>
                    <td>{fmtCoin(w.balance)}</td>
                    <td>{fmtCoin(w.holdingsValue)}</td>
                    <td>{fmtCoin(w.netWorth)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedUserId(w.userId)}
                      >
                        View portfolio
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === 'users' && selectedUserId && (
        <>
          <button
            type="button"
            className="text-link text-link-accent"
            style={{ marginBottom: '1rem' }}
            onClick={() => setSelectedUserId(null)}
          >
            ← Back to users
          </button>

          <div className="card">
            <div className="admin-user-heading">
              {userDetail?.avatar ? (
                <img
                  className="user-avatar"
                  src={userDetail.avatar}
                  alt=""
                  width={28}
                  height={28}
                />
              ) : (
                <span className="user-avatar user-avatar-placeholder" />
              )}
              <h2>
                {userDetail?.username ?? '…'}
                {userDetail?.linkedWarrior && (
                  <>
                    {' '}
                    / {userDetail.linkedWarrior.playerName}-
                    {userDetail.linkedWarrior.server}
                  </>
                )}
              </h2>
            </div>
            <div className="wallet-summary">
              <div className="wallet-summary-item">
                <span className="value">
                  {userDetail ? fmtCoin(userDetail.balance) : '–'}
                </span>
                <span className="label">Balance</span>
              </div>
              <div className="wallet-summary-item">
                <span className="value">
                  {userDetail
                    ? fmtCoin(userDetail.netWorth - userDetail.balance)
                    : '–'}
                </span>
                <span className="label">Holdings</span>
              </div>
              <div className="wallet-summary-item">
                <span className="value">
                  {userDetail ? fmtCoin(userDetail.netWorth) : '–'}
                </span>
                <span className="label">Portfolio</span>
              </div>
            </div>
          </div>

          {userDetail && (
            <AddRemoveCoinsCard
              userId={userDetail.userId}
              onAdjusted={() => {
                reloadUserDetail(userDetail.userId);
                reloadWallets();
              }}
            />
          )}

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Portfolio breakdown</h2>
            <PortfolioBreakdownChart holdings={userDetail?.holdings ?? []} />
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Holdings</h2>
            <div className="table-scroll table-compact">
              <table>
                <thead>
                  <tr>
                    <th>Warrior</th>
                    <th>Price</th>
                    <th className="mobile-hide">Shares</th>
                    <th className="mobile-hide">Cost basis</th>
                    <th className="mobile-hide">Value</th>
                    <th>P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {userDetail?.holdings.length === 0 && (
                    <tr>
                      <td colSpan={6} className="no-data">
                        No holdings.
                      </td>
                    </tr>
                  )}
                  {userDetail?.holdings.map((h) => {
                    const pnl =
                      h.marketValue !== null
                        ? h.marketValue - h.costBasisTotal
                        : null;
                    return (
                      <tr key={`${h.playerName}::${h.server}`}>
                        <td className="warrior-name">{h.playerName}</td>
                        <td>
                          {h.latestPrice !== null ? (
                            fmtCoin(h.latestPrice)
                          ) : (
                            <span className="no-data">–</span>
                          )}
                        </td>
                        <td className="mobile-hide">
                          {h.shares.toFixed(3)}
                        </td>
                        <td className="mobile-hide">
                          {fmtCoin(h.costBasisTotal)}
                        </td>
                        <td className="mobile-hide">
                          {h.marketValue !== null ? (
                            fmtCoin(h.marketValue)
                          ) : (
                            <span className="no-data">–</span>
                          )}
                        </td>
                        <td>{pnlCell(pnl)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Trade history</h2>
            <div className="table-scroll table-compact">
              <table>
                <thead>
                  <tr>
                    <th className="mobile-hide">When</th>
                    <th>Warrior</th>
                    <th>Side</th>
                    <th className="mobile-hide">Shares</th>
                    <th className="mobile-hide">Price</th>
                    <th>Total</th>
                    <th>P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {userDetail?.transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="no-data">
                        No trades yet.
                      </td>
                    </tr>
                  )}
                  {pageTransactions?.map((tx) => (
                    <tr key={tx.id}>
                      <td className="mobile-hide">
                        {fmtDateTime(tx.createdAt)}
                      </td>
                      <td className="warrior-name">{tx.playerName}</td>
                      <td>{tx.side}</td>
                      <td className="mobile-hide">
                        {tx.shares.toFixed(3)}
                      </td>
                      <td className="mobile-hide">{fmtCoin(tx.price)}</td>
                      <td>{fmtCoin(tx.total)}</td>
                      <td>{pnlCell(tx.realizedPnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
          </div>
        </>
      )}

      {view === 'warriors' && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Who's investing in this character?</h2>
          <select
            value={selectedWarriorId ?? ''}
            onChange={(e) =>
              setSelectedWarriorId(
                e.target.value ? Number(e.target.value) : null,
              )
            }
            disabled={!warriors || warriors.length === 0}
          >
            <option value="">Select a character…</option>
            {warriors?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.playerName} ({w.server})
              </option>
            ))}
          </select>

          {warriorHolders && (
            <>
              <div className="wallet-summary" style={{ marginTop: '1.25rem' }}>
                <div className="wallet-summary-item">
                  <span className="value">
                    {warriorHolders.latestPrice !== null
                      ? fmtCoin(warriorHolders.latestPrice)
                      : '–'}
                  </span>
                  <span className="label">Price</span>
                </div>
                <div className="wallet-summary-item">
                  <span className="value">
                    {fmtCoin(warriorHolders.totalInvested)}
                  </span>
                  <span className="label">Total invested</span>
                </div>
                <div className="wallet-summary-item">
                  <span className="value">
                    {warriorHolders.holders.length}
                  </span>
                  <span className="label">Holders</span>
                </div>
              </div>

              <div
                className="table-scroll table-compact"
                style={{ marginTop: '1.25rem' }}
              >
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th>Username</th>
                      <th className="mobile-hide">Shares</th>
                      <th>Market value</th>
                      <th>% of character</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warriorHolders.holders.length === 0 && (
                      <tr>
                        <td colSpan={5} className="no-data">
                          No current holders.
                        </td>
                      </tr>
                    )}
                    {warriorHolders.holders.map((h) => (
                      <tr key={h.userId}>
                        <td>
                          {h.avatar ? (
                            <img
                              className="user-avatar"
                              src={h.avatar}
                              alt=""
                              width={28}
                              height={28}
                            />
                          ) : (
                            <span className="user-avatar user-avatar-placeholder" />
                          )}
                        </td>
                        <td>{h.username}</td>
                        <td className="mobile-hide">
                          {h.shares.toFixed(3)}
                        </td>
                        <td>
                          {h.marketValue !== null ? (
                            fmtCoin(h.marketValue)
                          ) : (
                            <span className="no-data">–</span>
                          )}
                        </td>
                        <td>{(h.percentOfWarrior * 100).toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {view === 'danger' && (
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
    </AdminLayout>
  );
}
