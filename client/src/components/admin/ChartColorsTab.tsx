import { useEffect, useMemo, useState } from 'react';
import { getChartColorPins, getStockHistory, saveChartColorPins } from '../../api';

const STATUS_VISIBLE_MS = 3000;
const STATUS_FADE_MS = 1000;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

interface CharacterOption {
  key: string;
  playerName: string;
  server: string;
}

function pinsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a).filter((k) => a[k] !== '');
  const bKeys = Object.keys(b).filter((k) => b[k] !== '');
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

export function ChartColorsTab() {
  const [characters, setCharacters] = useState<CharacterOption[] | null>(null);
  const [savedPins, setSavedPins] = useState<Record<string, string> | null>(null);
  const [draftPins, setDraftPins] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const [statusFading, setStatusFading] = useState(false);

  useEffect(() => {
    Promise.all([getStockHistory(), getChartColorPins()]).then(([history, pins]) => {
      const options = history
        .map((p) => ({ key: `${p.player_name}::${p.server}`, playerName: p.player_name, server: p.server }))
        .sort((a, b) => a.playerName.localeCompare(b.playerName));
      setCharacters(options);
      setSavedPins(pins);
      setDraftPins(pins);
    });
  }, []);

  useEffect(() => {
    if (!status) return;
    setStatusFading(false);
    const fadeTimer = setTimeout(() => setStatusFading(true), STATUS_VISIBLE_MS);
    const clearTimer = setTimeout(() => setStatus(null), STATUS_VISIBLE_MS + STATUS_FADE_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(clearTimer);
    };
  }, [status]);

  const dirty = savedPins !== null && !pinsEqual(draftPins, savedPins);

  const filteredCharacters = useMemo(() => {
    if (!characters) return [];
    const q = search.trim().toLowerCase();
    if (!q) return characters;
    return characters.filter(
      (c) => c.playerName.toLowerCase().includes(q) || c.server.toLowerCase().includes(q),
    );
  }, [characters, search]);

  // Which currently-valid pinned colors are shared by more than one
  // character, keyed by normalized (lowercased) hex - so a collision warning
  // can be shown next to every row involved, not just the second one typed.
  const collisionsByColor = useMemo(() => {
    const byColor = new Map<string, string[]>();
    for (const [key, value] of Object.entries(draftPins)) {
      if (!HEX_COLOR_RE.test(value)) continue;
      const norm = value.toLowerCase();
      const list = byColor.get(norm) ?? [];
      list.push(key);
      byColor.set(norm, list);
    }
    const collisions = new Map<string, string[]>();
    for (const [color, keys] of byColor) {
      if (keys.length > 1) collisions.set(color, keys);
    }
    return collisions;
  }, [draftPins]);

  const nameByKey = useMemo(() => {
    const map = new Map<string, string>();
    characters?.forEach((c) => map.set(c.key, c.playerName));
    return map;
  }, [characters]);

  function handleColorChange(key: string, value: string) {
    setDraftPins((prev) => {
      const next = { ...prev };
      if (value === '') delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function handleSave() {
    const invalidKey = Object.keys(draftPins).find(
      (key) => draftPins[key] !== '' && !HEX_COLOR_RE.test(draftPins[key]),
    );
    if (invalidKey) {
      setStatus({
        text: `"${nameByKey.get(invalidKey) ?? invalidKey}" has an invalid color - use a 6-digit hex code like #4e79a7`,
        kind: 'error',
      });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(draftPins).filter(([, value]) => value !== ''),
      );
      await saveChartColorPins(payload);
      setSavedPins(payload);
      setDraftPins(payload);
      setStatus({ text: 'Saved.', kind: 'success' });
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-section">
      <h2 style={{ marginTop: 0 }}>Chart Colors</h2>
      <p className="subtitle" style={{ marginBottom: '1rem' }}>
        Pin specific characters to always draw with the same line color on the Stock page chart, instead of the
        color that's normally assigned by leaderboard rank.
      </p>

      <input
        type="text"
        placeholder="Search characters..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: '1rem', maxWidth: '280px' }}
      />

      <div className="table-scroll chart-colors-scroll">
        <table>
          <thead>
            <tr>
              <th>Character</th>
              <th>Server</th>
              <th>Color</th>
            </tr>
          </thead>
          <tbody>
            {characters === null && (
              <tr>
                <td colSpan={3} className="no-data">
                  Loading...
                </td>
              </tr>
            )}
            {characters !== null && filteredCharacters.length === 0 && (
              <tr>
                <td colSpan={3} className="no-data">
                  No characters match "{search}".
                </td>
              </tr>
            )}
            {filteredCharacters.map((c) => {
              const value = draftPins[c.key] ?? '';
              const isValid = value === '' || HEX_COLOR_RE.test(value);
              const collision = isValid && value !== '' ? collisionsByColor.get(value.toLowerCase()) : undefined;
              return (
                <tr key={c.key}>
                  <td className="warrior-name">{c.playerName}</td>
                  <td>{c.server}</td>
                  <td>
                    <div className="chart-color-cell">
                      <span
                        className="chart-color-swatch"
                        style={{ background: isValid && value !== '' ? value : 'transparent' }}
                      />
                      <input
                        type="text"
                        className="chart-color-input"
                        placeholder="#4e79a7"
                        value={value}
                        onChange={(e) => handleColorChange(c.key, e.target.value)}
                      />
                      {!isValid && <span className="status error">Invalid hex</span>}
                      {collision && collision.length > 1 && (
                        <span className="status error">
                          Also used by{' '}
                          {collision
                            .filter((k) => k !== c.key)
                            .map((k) => nameByKey.get(k) ?? k)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card-footer">
        {status && <span className={`status ${status.kind}${statusFading ? ' fading' : ''}`}>{status.text}</span>}
        <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || !dirty}>
          Save changes
        </button>
      </div>
    </section>
  );
}
