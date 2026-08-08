import { useEffect, useState } from 'react';
import { MarketLayout } from '../components/MarketLayout';
import { getLeaderboard, type LeaderboardEntryView } from '../api';
import { fmtCoin } from '../format';

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntryView[] | null>(null);

  useEffect(() => {
    getLeaderboard().then(setEntries);
  }, []);

  return (
    <MarketLayout>
      <div className="card">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Trader</th>
                <th>Balance</th>
                <th>Holdings value</th>
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
                  <td>{i + 1}</td>
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
                      {e.username}
                      {e.linkedWarrior && (
                        <>
                          {` (`}
                          <span className="warrior-name">
                            {`${e.linkedWarrior.playerName}-${e.linkedWarrior.server}`}
                          </span>
                          {`)`}
                        </>
                      )}
                    </span>
                  </td>
                  <td>{fmtCoin(e.balance)}</td>
                  <td>{fmtCoin(e.holdingsValue)}</td>
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
