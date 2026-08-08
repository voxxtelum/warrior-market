import { useId } from "react";
import { NEGATIVE_COLOR, POSITIVE_COLOR, withAlpha } from "../chartColors";

const SPARK_POS = POSITIVE_COLOR;
const SPARK_NEG = NEGATIVE_COLOR;

interface SparklineProps {
  prices: number[];
  width?: number;
  height?: number;
}

// A tiny inline-SVG area chart of a player's full price history. The
// baseline is the *first* data point (not zero), and the line/fill are
// split into blue-above/red-below segments right at wherever the price
// crosses that baseline - built with two clip-path rects rather than a
// single trend color, so a price that dips below its starting point and
// recovers shows both colors like a real ticker sparkline.
export function Sparkline({ prices, width = 90, height = 28 }: SparklineProps) {
  const rawId = useId();
  const id = rawId.replace(/:/g, "");

  if (prices.length === 0) return null;

  if (prices.length === 1) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <circle cx={width / 2} cy={height / 2} r={2} fill={SPARK_POS} />
      </svg>
    );
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

  return (
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
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#${clipAboveId})`}
      />
      <path
        d={linePath}
        fill="none"
        stroke={SPARK_NEG}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#${clipBelowId})`}
      />
    </svg>
  );
}
