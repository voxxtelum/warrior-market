import { useEffect, useState } from "react";
import { getPlayers, setPlayerHidden, type PlayerRow } from "../../api";

export function PlayersTab() {
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);

  useEffect(() => {
    getPlayers()
      .then(setPlayers)
      .catch(() => {});
  }, []);

  function toggleHidden(player: PlayerRow) {
    const nowHidden = !player.hidden;
    setPlayers((prev) =>
      prev?.map((p) =>
        p.player_name === player.player_name && p.server === player.server ? { ...p, hidden: nowHidden ? 1 : 0 } : p
      ) ?? null
    );
    setPlayerHidden(player.player_name, player.server, nowHidden);
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Players</h2>
      <p className="subtitle" style={{ marginBottom: "1rem" }}>
        Choose which players appear in Compare, Trends, and Stock Market
      </p>
      <ul className="player-toggle-list">
        {players?.length === 0 && <li>No players found yet - add some reports first.</li>}
        {players?.map((player) => (
          <li key={`${player.player_name}::${player.server}`}>
            <label>
              <input type="checkbox" checked={!player.hidden} onChange={() => toggleHidden(player)} />
              <span>{player.player_name}</span>
            </label>
            <span className="player-server">{player.server}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
