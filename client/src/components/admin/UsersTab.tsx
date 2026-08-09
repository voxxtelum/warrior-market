import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../authContext';
import { AddRemoveCoinsCard } from '../AddRemoveCoinsCard';
import { Pagination } from '../Pagination';
import { PortfolioBreakdownCard } from '../PortfolioBreakdownCard';
import { SidePill } from '../SidePill';
import {
  getAdminUserDetail,
  getAdminWallets,
  getAdminWarriors,
  linkUserWarrior,
  setUserAdmin,
  unlinkUserWarrior,
  type AdminUserDetail,
  type AdminWalletRow,
  type AdminWarriorRow,
} from '../../api';
import { fmtCoin, fmtDateTime, fmtRelativeTime } from '../../format';
import { computePortfolioConcentration } from '../../portfolio';

const PAGE_SIZE = 25;

type SortKey =
  | 'username'
  | 'character'
  | 'holdings'
  | 'netWorth'
  | 'turnover'
  | 'trades'
  | 'lastLogin';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'username', label: 'Username' },
  { key: 'character', label: 'Character' },
  { key: 'holdings', label: 'Holdings' },
  { key: 'netWorth', label: 'Net Worth' },
  { key: 'turnover', label: 'Turnover' },
  { key: 'trades', label: 'Trades' },
  { key: 'lastLogin', label: 'Last Login' },
];

function sortValue(row: AdminWalletRow, key: SortKey): string | number {
  switch (key) {
    case 'username':
      return row.username.toLowerCase();
    case 'character':
      return row.linkedWarrior
        ? `${row.linkedWarrior.playerName}-${row.linkedWarrior.server}`.toLowerCase()
        : '';
    case 'holdings':
      return row.holdingsValue;
    case 'netWorth':
      return row.netWorth;
    case 'turnover':
      return row.turnover;
    case 'trades':
      return row.tradeCount;
    case 'lastLogin':
      return row.lastLoginAt;
  }
}

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

export function UsersTab() {
  const { user: currentUser } = useAuth();

  const [wallets, setWallets] = useState<AdminWalletRow[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('username');
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDetail, setUserDetail] = useState<AdminUserDetail | null>(null);
  const [page, setPage] = useState(0);

  const [warriors, setWarriors] = useState<AdminWarriorRow[] | null>(null);
  const [linkSelection, setLinkSelection] = useState('');

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
    if (!selectedUserId) {
      setUserDetail(null);
      return;
    }
    setPage(0);
    setLinkSelection('');
    reloadUserDetail(selectedUserId);
    if (warriors === null) {
      getAdminWarriors()
        .then(setWarriors)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(key === 'username' ? 1 : -1);
    }
  }

  function arrowFor(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 1 ? ' ▲' : ' ▼';
  }

  const sortedWallets = useMemo(() => {
    if (!wallets) return [];
    return [...wallets].sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (typeof av === 'string' || typeof bv === 'string') {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * (av - bv);
    });
  }, [wallets, sortKey, sortDir]);

  async function toggleAdmin() {
    if (!userDetail) return;
    const nowAdmin = !userDetail.isAdmin;
    setUserDetail({ ...userDetail, isAdmin: nowAdmin });
    await setUserAdmin(userDetail.userId, nowAdmin);
  }

  async function handleLink() {
    if (!userDetail || linkSelection === '') return;
    await linkUserWarrior(userDetail.userId, Number(linkSelection));
    setLinkSelection('');
    reloadUserDetail(userDetail.userId);
    reloadWallets();
  }

  async function handleUnlink() {
    if (!userDetail) return;
    await unlinkUserWarrior(userDetail.userId);
    reloadUserDetail(userDetail.userId);
    reloadWallets();
  }

  const linkedWarriorIds = new Set(
    (wallets ?? [])
      .filter((w) => w.linkedWarrior && w.userId !== userDetail?.userId)
      .map((w) => w.linkedWarrior!.id),
  );
  const unlinkedWarriors = warriors?.filter((w) => !linkedWarriorIds.has(w.id)) ?? [];

  const pageCount = userDetail
    ? Math.ceil(userDetail.transactions.length / PAGE_SIZE)
    : 0;
  const pageTransactions = userDetail?.transactions.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );
  const userConcentration = computePortfolioConcentration(
    userDetail?.holdings ?? [],
  );

  const isSelf = userDetail?.userId === currentUser?.discordId;

  if (!selectedUserId) {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Wallets</h2>
        <div className="table-scroll">
          <table id="manage-wallets-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} className="sortable" onClick={() => handleSort(col.key)}>
                    {col.label}
                    {arrowFor(col.key)}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {wallets?.length === 0 && (
                <tr>
                  <td colSpan={8} className="no-data">
                    No users yet.
                  </td>
                </tr>
              )}
              {sortedWallets.map((w) => (
                <tr key={w.userId}>
                  <td>
                    <span className="player-name-cell">
                      {w.avatar ? (
                        <img
                          className="user-avatar player-name-avatar"
                          src={w.avatar}
                          alt=""
                          width={20}
                          height={20}
                        />
                      ) : (
                        <span className="user-avatar user-avatar-placeholder player-name-avatar" />
                      )}
                      {w.username}
                    </span>
                  </td>
                  <td>
                    {w.linkedWarrior ? (
                      <span className="warrior-name">
                        {w.linkedWarrior.playerName}-{w.linkedWarrior.server}
                      </span>
                    ) : (
                      <span className="no-data">no character</span>
                    )}
                  </td>
                  <td>{fmtCoin(w.holdingsValue)}</td>
                  <td>{fmtCoin(w.netWorth)}</td>
                  <td>{fmtCoin(w.turnover)}</td>
                  <td>{w.tradeCount}</td>
                  <td>{fmtDateTime(w.lastLoginAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="text-link text-link-accent"
                      onClick={() => setSelectedUserId(w.userId)}
                    >
                      Profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
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
          <div className="admin-user-heading-left">
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
            <div className="admin-user-heading-name-row">
              <h2>{userDetail?.username ?? '…'}</h2>
              {userDetail?.linkedWarrior ? (
                <>
                  <select
                    className="admin-heading-select warrior-name"
                    value={userDetail.linkedWarrior.id}
                    onChange={() => {}}
                  >
                    <option value={userDetail.linkedWarrior.id}>
                      {userDetail.linkedWarrior.playerName}-{userDetail.linkedWarrior.server}
                    </option>
                  </select>
                  <button
                    type="button"
                    className="text-link text-link-accent admin-user-heading-link-action"
                    onClick={handleUnlink}
                  >
                    Unlink
                  </button>
                </>
              ) : (
                <>
                  <select
                    className="admin-heading-select"
                    value={linkSelection}
                    onChange={(e) => setLinkSelection(e.target.value)}
                  >
                    <option value="" disabled>
                      Select a character
                    </option>
                    {unlinkedWarriors.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.playerName}-{w.server}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-link text-link-accent admin-user-heading-link-action"
                    aria-disabled={linkSelection === ''}
                    onClick={handleLink}
                  >
                    Link
                  </button>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="text-link text-link-danger admin-user-heading-admin-toggle"
            aria-disabled={isSelf && userDetail?.isAdmin}
            title={isSelf && userDetail?.isAdmin ? "You can't revoke your own admin access" : undefined}
            onClick={() => {
              if (isSelf && userDetail?.isAdmin) return;
              toggleAdmin();
            }}
          >
            {userDetail?.isAdmin ? 'Revoke admin' : 'Add admin'}
          </button>
        </div>
        <div className="admin-user-meta">
          <div className="admin-user-meta-item">
            <span className="admin-user-meta-value">{userDetail?.userId ?? '–'}</span>
            <span className="label">Discord ID</span>
          </div>
          <div className="admin-user-meta-item">
            <span className="admin-user-meta-value">
              {userDetail ? fmtDateTime(userDetail.firstLoginAt) : '–'}
            </span>
            <span className="label">Joined</span>
          </div>
          <div className="admin-user-meta-item">
            <span className="admin-user-meta-value">
              {userDetail ? fmtDateTime(userDetail.lastLoginAt) : '–'}
            </span>
            <span className="label">Last Login</span>
          </div>
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
              {userDetail ? userConcentration.count : '–'}
            </span>
            <span className="label">Holdings</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">
              {userDetail
                ? fmtCoin(userDetail.netWorth - userDetail.balance)
                : '–'}
            </span>
            <span className="label">Holdings Value</span>
          </div>
          <div className="wallet-summary-item">
            <span className="value">
              {userDetail && userConcentration.largest
                ? `${userConcentration.largestPct.toFixed(0)}%`
                : '–'}
            </span>
            <span className="label">
              {userConcentration.largest
                ? `Largest: ${userConcentration.largest.playerName}`
                : 'Largest'}
            </span>
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

      <PortfolioBreakdownCard
        holdings={userDetail?.holdings ?? []}
        recentTransactions={userDetail?.transactions ?? []}
      />

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
                    <td className="mobile-hide">{h.shares.toFixed(3)}</td>
                    <td className="mobile-hide">{fmtCoin(h.costBasisTotal)}</td>
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
                <th className="side-pill-cell">Side</th>
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
                    <span className="time-ago">{fmtRelativeTime(tx.createdAt)}</span>
                  </td>
                  <td className="warrior-name">{tx.playerName}</td>
                  <td className="side-pill-cell">
                    <SidePill side={tx.side} />
                  </td>
                  <td className="mobile-hide">{tx.shares.toFixed(3)}</td>
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
  );
}
