import { useEffect, useState } from "react";
import { MarketLayout } from "../components/MarketLayout";
import { getLeaderboard, type LeaderboardEntryView } from "../api";

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
                  <td>{e.username}</td>
                  <td>{e.balance.toFixed(2)}</td>
                  <td>{e.holdingsValue.toFixed(2)}</td>
                  <td>{e.netWorth.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </MarketLayout>
  );
}
