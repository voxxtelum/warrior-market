export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Rounds to cents and treats sub-cent negative dust (from floating-point
// drift across repeated trade arithmetic - fee/price-impact math especially)
// as exactly zero, so a balance that's conceptually empty never displays as
// the confusing "-0.00" (a real quirk of Number.prototype.toFixed on tiny
// negative values that round to 0).
export function fmtCoin(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toFixed(2);
}

export function priceDelta(prev: number, curr: number): { text: string; cls: string } {
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const cls = diff > 0 ? "delta-pos" : diff < 0 ? "delta-neg" : "delta-neutral";
  const text = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
  return { text, cls };
}

export function fmtRelativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return fmtDate(ts);
}
