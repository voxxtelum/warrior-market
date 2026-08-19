import { useId } from "react";
import { NEGATIVE_COLOR, POSITIVE_COLOR, withAlpha } from "../chartColors";

const SPARK_POS = POSITIVE_COLOR;
const SPARK_NEG = NEGATIVE_COLOR;

interface SparklineProps {
  prices: number[];
  width?: number;
  height?: number;
  animate?: boolean;
  strokeWidth?: number;
}

// A tiny inline-SVG area chart of a player's full price history. The
// baseline is the *first* data point (not zero), and the line/fill are
// split into blue-above/red-below segments right at wherever the price
// crosses that baseline - built with two clip-path rects rather than a
// single trend color, so a price that dips below its starting point and
// recovers shows both colors like a real ticker sparkline.
//
// `animate` (used by the Fund card) wraps the SVG in a container that
// reveals right-to-left on mount via a CSS clip-path transition (see
// `.sparkline-grow` in styles.css) - a stroke-dasharray "draw" animation
// was considered instead, but that draws *along the path* (left-to-right
// here), which doesn't match "grow from the right" the way a reveal wipe
// does.
export function Sparkline({ prices, width = 90, height = 28, animate = false, strokeWidth = 1.5 }: SparklineProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");

  if (prices.length === 0) return null;

  if (prices.length === 1) {
    const dot = (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <circle cx={width / 2} cy={height / 2} r={2} fill={SPARK_POS} />
      </svg>
    );
    return animate ? <span className="sparkline-grow">{dot}</span> : dot;
  }

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pad = 2;
  const stepX = width / (prices.length - 1);
  const yFor = (p: number) => pad + (1 - (p - min) / range) * (height - pad * 2);

  const points = prices.map((p, i) => [stepX * i, yFor(p)] as const);
  const baselineY = yFor(prices[0]);

  const linePath = "M " + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L ");
  const firstX = points[0][0].toFixed(1);
  const lastX = points[points.length - 1][0].toFixed(1);
  const areaPath = `${linePath} L ${lastX},${baselineY.toFixed(1)} L ${firstX},${baselineY.toFixed(1)} Z`;

  const clipAboveId = `${id}-above`;
  const clipBelowId = `${id}-below`;

  const svg = (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <clipPath id={clipAboveId}>
        <rect x={0} y={0} width={width} height={baselineY.toFixed(1)} />
      </clipPath>
      <clipPath id={clipBelowId}>
        <rect x={0} y={baselineY.toFixed(1)} width={width} height={(height - baselineY).toFixed(1)} />
      </clipPath>
      <path d={areaPath} fill={withAlpha(SPARK_POS, 0.25)} clipPath={`url(#${clipAboveId})`} />
      <path d={areaPath} fill={withAlpha(SPARK_NEG, 0.25)} clipPath={`url(#${clipBelowId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={SPARK_POS}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#${clipAboveId})`}
      />
      <path
        d={linePath}
        fill="none"
        stroke={SPARK_NEG}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#${clipBelowId})`}
      />
    </svg>
  );
  return animate ? <span className="sparkline-grow">{svg}</span> : svg;
}
