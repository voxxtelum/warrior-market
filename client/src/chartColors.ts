const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
  "#86bcb6", "#d37295",
];

// Mirrors --positive / --negative in styles.css - kept as JS constants since
// canvas/SVG rendering (charts, sparklines, heatmap) can't read CSS custom
// properties directly. Update both places together.
export const POSITIVE_COLOR = "#0ea5e9";
export const NEGATIVE_COLOR = "#ff6b6b";

export function paletteColor(i: number): string {
  return PALETTE[i % PALETTE.length];
}

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
