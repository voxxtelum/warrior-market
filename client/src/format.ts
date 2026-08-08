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

export function priceDelta(prev: number, curr: number): { text: string; cls: string } {
  const diff = curr - prev;
  const pct = (diff / prev) * 100;
  const cls = diff > 0 ? "delta-pos" : diff < 0 ? "delta-neg" : "delta-neutral";
  const text = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
  return { text, cls };
}
