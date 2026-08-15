import { useEffect, useState } from 'react';
import { MarketLayout } from '../components/MarketLayout';
import { getLeaderboard, type LeaderboardEntryView } from '../api';
import { fmtCoin } from '../format';
import { classColor } from '../warriorClasses';

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntryView[] | null>(null);

  useEffect(() => {
    getLeaderboard().then(setEntries);
  }, []);

  return (
    <MarketLayout>
      <div className="card">
        <div className="table-scroll table-compact">
          <table>
            <thead>
              <tr>
                <th className="mobile-hide">#</th>
                <th>Trader</th>
                <th className="mobile-hide">Balance</th>
                <th className="mobile-hide">Holdings value</th>
                <th>Net worth</th>
              </tr>
            </thead>
            <tbody>
              {entries?.length === 0 && (
                <tr>
                  <td colSpan={5} className="no-data">
                    No traders yet.
                  </td>
                </tr>
              )}
              {entries?.map((e, i) => (
                <tr key={e.username + i}>
                  <td className="mobile-hide">{i + 1}</td>
                  <td>
                    <span className="player-name-cell">
                      {e.avatar && (
                        <img
                          className="user-avatar player-name-avatar"
                          src={e.avatar}
                          alt=""
                          width={20}
                          height={20}
                        />
                      )}
                      {e.linkedWarrior && (
                        <>
                          <span
                            className="warrior-name"
                            style={{ color: classColor(e.linkedWarrior.class) }}
                          >
                            {e.linkedWarrior.playerName}
                          </span>
                          &nbsp;
                        </>
                      )}
                      <span
                        className={
                          e.linkedWarrior ? 'username-muted' : undefined
                        }
                      >
                        {e.username}
                      </span>
                    </span>
                  </td>
                  <td className="mobile-hide">{fmtCoin(e.balance)}</td>
                  <td className="mobile-hide">{fmtCoin(e.holdingsValue)}</td>
                  <td>{fmtCoin(e.netWorth)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MarketLayout>
  );
}
