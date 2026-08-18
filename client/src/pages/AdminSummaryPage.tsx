import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "../components/AdminLayout";
import {
  getAdminSummary,
  getSummaryHistory,
  getSummaryHistoryById,
  saveWeeklySummary,
  type SummaryHistoryEntry,
  type WeeklySummaryData,
} from "../api";
import { classEmoji } from "../warriorClasses";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getMostRecentCompletedWeek(referenceMs: number = Date.now()): { start: number; end: number } {
  const ref = new Date(referenceMs);
  const daysSinceMonday = (ref.getDay() + 6) % 7; // getDay(): 0=Sun..6=Sat
  const thisMonday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - daysSinceMonday);
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  return { start: lastMonday.getTime(), end: thisMonday.getTime() - 1 };
}

function shiftWeek(start: number, end: number, deltaWeeks: number): { start: number; end: number } {
  const delta = deltaWeeks * 7 * MS_PER_DAY;
  return { start: start + delta, end: end + delta };
}

function fmtWeekLabel(start: number, end: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const startStr = new Date(start).toLocaleDateString(undefined, opts);
  const endStr = new Date(end).toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function fmtGold(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return `${sign}$${Math.abs(rounded).toLocaleString()}`;
}

function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
}

function fmtDaysSince(ms: number): string {
  const days = Math.floor((Date.now() - ms) / MS_PER_DAY);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function charLabel(c: { playerName: string; server: string; class: string | null }): string {
  return `${classEmoji(c.class)} ${c.playerName}-${c.server}`;
}

function mention(userId: string): string {
  return `<@${userId}>`;
}

// Turns computed metrics into a Discord-flavored draft: bold headers, real
// emoji glyphs (not `:shortcode:` text - see warriorClasses.ts's
// CLASS_EMOJIS comment for why), and <@discordId> mentions the admin can
// paste straight into Discord. Metrics with no data this week fall back to
// a placeholder line instead of being silently omitted.
function buildSummaryText(data: WeeklySummaryData): string {
  const lines: string[] = [];
  lines.push(`📊 **Weekly Summary — ${fmtWeekLabel(data.weekStart, data.weekEnd)}**`);
  lines.push("");

  lines.push(
    data.mostActiveTrader
      ? `🔥 **Most Active Trader:** ${mention(data.mostActiveTrader.userId)} (${data.mostActiveTrader.tradeCount} trades)`
      : "🔥 **Most Active Trader:** No trades this week.",
  );

  lines.push(
    data.mostTradedCharacter
      ? `📣 **Most Traded Character:** ${charLabel(data.mostTradedCharacter)} (${data.mostTradedCharacter.tradeCount} trades)`
      : "📣 **Most Traded Character:** No trades this week.",
  );

  const vol = data.guildVolume;
  lines.push(
    vol.totalVolume > 0
      ? `💰 **Guild Volume:** ${fmtGold(vol.totalVolume)} traded (${fmtGold(vol.buyVolume)} bought / ${fmtGold(
          vol.sellVolume,
        )} sold) — net ${vol.netSentiment >= 0 ? "bullish 📈" : "bearish 📉"}`
      : "💰 **Guild Volume:** No trading activity this week.",
  );

  lines.push(
    data.biggestTrade
      ? `💸 **Biggest Trade:** ${mention(data.biggestTrade.userId)} ${data.biggestTrade.side === "buy" ? "bought" : "sold"} ${data.biggestTrade.shares.toFixed(
          2,
        )} shares of ${charLabel(data.biggestTrade)} for ${fmtGold(data.biggestTrade.total)}`
      : "💸 **Biggest Trade:** No trades this week.",
  );

  lines.push(
    data.biggestGainer
      ? `📈 **Biggest Gainer:** ${charLabel(data.biggestGainer)} ${fmtPct(data.biggestGainer.pctChange)} (${fmtGold(
          data.biggestGainer.fromPrice,
        )} → ${fmtGold(data.biggestGainer.toPrice)})`
      : "📈 **Biggest Gainer:** No notable movers this week.",
  );

  lines.push(
    data.biggestLoser
      ? `📉 **Biggest Loser:** ${charLabel(data.biggestLoser)} ${fmtPct(data.biggestLoser.pctChange)} (${fmtGold(
          data.biggestLoser.fromPrice,
        )} → ${fmtGold(data.biggestLoser.toPrice)})`
      : "📉 **Biggest Loser:** No notable movers this week.",
  );

  lines.push(
    data.mostVolatile
      ? `🎢 **Most Volatile:** ${charLabel(data.mostVolatile)}`
      : "🎢 **Most Volatile:** Not enough price history yet.",
  );

  lines.push(
    data.topRealizedGainer
      ? `🤑 **Top Realized Gain:** ${mention(data.topRealizedGainer.userId)} +${fmtGold(data.topRealizedGainer.realizedPnl)}`
      : "🤑 **Top Realized Gain:** No realized gains this week.",
  );

  lines.push(
    data.topRealizedLoser
      ? `😭 **Biggest Realized Loss:** ${mention(data.topRealizedLoser.userId)} ${fmtGold(data.topRealizedLoser.realizedPnl)}`
      : "😭 **Biggest Realized Loss:** No realized losses this week.",
  );

  lines.push(
    data.topFund
      ? `🏆 **Top Fund:** ${data.topFund.name} ${fmtPct(data.topFund.pctChange)}`
      : "🏆 **Top Fund:** No fund data this week.",
  );

  lines.push(
    data.bottomFund
      ? `🥶 **Worst Fund:** ${data.bottomFund.name} ${fmtPct(data.bottomFund.pctChange)}`
      : "🥶 **Worst Fund:** No fund data this week.",
  );

  lines.push(
    data.diamondHands
      ? `💎 **Diamond Hands:** ${mention(data.diamondHands.userId)} holding ${charLabel(data.diamondHands)} for ${fmtDaysSince(
          data.diamondHands.heldSinceMs,
        )} straight`
      : "💎 **Diamond Hands:** No open positions yet.",
  );

  lines.push(
    data.paperHands
      ? `📄 **Paper Hands:** ${mention(data.paperHands.userId)} (${data.paperHands.sellCount} sells this week)`
      : "📄 **Paper Hands:** No sells this week.",
  );

  return lines.join("\n");
}

// Preview-only: resolves <@discordId> back to a readable **Username** so the
// admin isn't stuck guessing whose ID is whose. Only resolves users that
// appear somewhere in this week's computed metrics - a hand-typed mention
// for someone outside that set is left as-is.
function resolveMentionsForPreview(text: string, mentionMap: Map<string, string>): string {
  return text.replace(/<@(\d+)>/g, (full, id: string) => {
    const username = mentionMap.get(id);
    return username ? `**${username}**` : full;
  });
}

function buildMentionMap(data: WeeklySummaryData): Map<string, string> {
  const map = new Map<string, string>();
  const add = (ref: { userId: string; username: string } | null) => {
    if (ref) map.set(ref.userId, ref.username);
  };
  add(data.mostActiveTrader);
  add(data.biggestTrade);
  add(data.topRealizedGainer);
  add(data.topRealizedLoser);
  add(data.diamondHands);
  add(data.paperHands);
  return map;
}

export function AdminSummaryPage() {
  const [week, setWeek] = useState(() => getMostRecentCompletedWeek());
  const [data, setData] = useState<WeeklySummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [history, setHistory] = useState<SummaryHistoryEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setStatusMessage(null);
    Promise.all([getAdminSummary(week.start, week.end), getSummaryHistory()])
      .then(async ([freshData, historyList]) => {
        if (cancelled) return;
        setData(freshData);
        setHistory(historyList);
        const existing = historyList.find((h) => h.weekStart === week.start && h.weekEnd === week.end);
        if (existing) {
          const detail = await getSummaryHistoryById(existing.id);
          if (cancelled) return;
          setText(detail.content);
          setSavedId(detail.id);
        } else {
          setText(buildSummaryText(freshData));
          setSavedId(null);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week.start, week.end]);

  const mentionMap = useMemo(() => (data ? buildMentionMap(data) : new Map<string, string>()), [data]);
  const preview = useMemo(() => resolveMentionsForPreview(text, mentionMap), [text, mentionMap]);

  async function handleSave() {
    setSaving(true);
    setStatusMessage(null);
    try {
      const saved = await saveWeeklySummary(week.start, week.end, text);
      setSavedId(saved.id);
      const historyList = await getSummaryHistory();
      setHistory(historyList);
      setStatusMessage("Saved.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setStatusMessage("Copied to clipboard.");
  }

  function handleRegenerate() {
    if (data) setText(buildSummaryText(data));
    setStatusMessage(null);
  }

  function loadHistoryEntry(entry: SummaryHistoryEntry) {
    setWeek({ start: entry.weekStart, end: entry.weekEnd });
  }

  return (
    <AdminLayout>
      <div className="card">
        <div className="summary-week-nav">
          <button type="button" onClick={() => setWeek((w) => shiftWeek(w.start, w.end, -1))}>
            ← Prev week
          </button>
          <h2 style={{ margin: 0 }}>{fmtWeekLabel(week.start, week.end)}</h2>
          <button type="button" onClick={() => setWeek((w) => shiftWeek(w.start, w.end, 1))}>
            Next week →
          </button>
        </div>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          {savedId ? "Loaded from a saved draft for this week." : "Freshly generated — not yet saved."}
        </p>

        {loading && <p className="no-data">Loading…</p>}

        {!loading && (
          <div className="summary-editor-grid">
            <div>
              <div className="summary-editor-toolbar">
                <span className="subtitle">Editable draft</span>
                <button type="button" onClick={handleRegenerate}>
                  Regenerate
                </button>
              </div>
              <textarea
                className="summary-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={18}
              />
            </div>
            <div>
              <div className="summary-editor-toolbar">
                <span className="subtitle">Preview (mentions resolved to names)</span>
              </div>
              <div className="summary-preview">{preview}</div>
            </div>
          </div>
        )}

        <div className="summary-actions">
          <button type="button" className="btn-affirm" onClick={handleSave} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={handleCopy} disabled={loading}>
            Copy
          </button>
          {statusMessage && <span className="subtitle">{statusMessage}</span>}
        </div>
      </div>

      <div className="card" style={{ marginTop: "1rem" }}>
        <h2 style={{ marginTop: 0 }}>History</h2>
        <p className="subtitle" style={{ marginBottom: "1rem" }}>
          Previously saved weeks. Click one to load it back into the editor above.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Week</th>
                <th>Last saved</th>
              </tr>
            </thead>
            <tbody>
              {history?.length === 0 && (
                <tr>
                  <td colSpan={2} className="no-data">
                    No summaries saved yet.
                  </td>
                </tr>
              )}
              {history?.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <a
                      href="#"
                      className="text-link text-link-accent"
                      onClick={(e) => {
                        e.preventDefault();
                        loadHistoryEntry(entry);
                      }}
                    >
                      {fmtWeekLabel(entry.weekStart, entry.weekEnd)}
                    </a>
                  </td>
                  <td>{new Date(entry.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
