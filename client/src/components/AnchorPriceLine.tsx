import {
  MUTED_COLOR,
  NEGATIVE_COLOR,
  POSITIVE_COLOR,
  lerpColor,
} from '../chartColors';
import { fmtCoin } from '../format';

interface AnchorPriceLineProps {
  price: number | null;
  anchorPrice: number | null;
  raidAnchorPrice: number | null;
}

// Price deviation from anchor beyond this fraction is fully saturated color.
const DEVIATION_CAP = 0.05;

// Minimum distance (in % of the line) between two points before one gets
// nudged - the log scale still lets two of the three values land within a
// label's width of each other (e.g. anchor and raid anchor both close to
// price but far from each other), so positions get a min-gap declutter pass
// after the log-scale position is computed.
const MIN_GAP_PCT = 30;

type Point = { cls: string; prefix: string; value: number };

// A single-line visual replacing 3 separate numeric columns: the two most
// extreme of {price, anchorPrice, raidAnchorPrice} anchor the ends of a
// fixed-width line, and the middle value sits proportionally between them.
// This one min/max rule covers every case (price mid-range, price becoming
// an end when it's the extreme in either direction, and collapsing to a
// single point when all three are equal) without branching on which value
// is which. Position uses a log scale rather than linear, since these
// prices can span a wide range and a linear scale would crowd every pair of
// close-together values toward the same spot. Color (line + price label
// only) tracks how far price has drifted from its trading anchor, capped at
// DEVIATION_CAP for full saturation - anchor/raid-anchor labels stay
// neutral since they're the reference points, not the moving value. The
// line is mirrored when price is above its anchor so price always reads on
// the left (see `flip` below).
export function AnchorPriceLine({
  price,
  anchorPrice,
  raidAnchorPrice,
}: AnchorPriceLineProps) {
  const points: Point[] = [
    { cls: 'apl-anchor', prefix: 'A: ', value: anchorPrice },
    { cls: 'apl-raid-anchor', prefix: 'R: ', value: raidAnchorPrice },
    { cls: 'apl-price', prefix: '', value: price },
  ].filter((p): p is Point => p.value !== null && p.value > 0);

  if (points.length < 2) {
    return <span>{price !== null ? fmtCoin(price) : '–'}</span>;
  }

  const logValues = points.map((p) => Math.log(p.value));
  const minLog = Math.min(...logValues);
  const maxLog = Math.max(...logValues);
  const rangeLog = maxLog - minLog;
  const pctFor = (v: number) =>
    rangeLog === 0 ? 50 : ((Math.log(v) - minLog) / rangeLog) * 100;

  // Declutter: push points apart (in ascending position order) until they're
  // at least MIN_GAP_PCT apart. A forward pass alone pushes a cluster of
  // points sitting near the *right* edge past 100 - clamping each one back
  // down individually would just collapse them on top of each other again -
  // so a backward pass follows to pull the whole cluster back inside the
  // line's bounds while preserving the gaps the forward pass established.
  const sorted = [...points].sort((a, b) => pctFor(a.value) - pctFor(b.value));
  const pcts = sorted.map((p) => pctFor(p.value));
  for (let i = 1; i < pcts.length; i++) {
    pcts[i] = Math.max(pcts[i], pcts[i - 1] + MIN_GAP_PCT);
  }
  pcts[pcts.length - 1] = Math.min(pcts[pcts.length - 1], 100);
  for (let i = pcts.length - 2; i >= 0; i--) {
    pcts[i] = Math.min(pcts[i], pcts[i + 1] - MIN_GAP_PCT);
  }
  const dev =
    price !== null && anchorPrice !== null && anchorPrice > 0
      ? (price - anchorPrice) / anchorPrice
      : null;

  // Price trading below its anchor already lands on the left naturally (it's
  // the lower value). Mirror the line when price is trading *above* its
  // anchor so price always reads on the left and the anchors on the right -
  // direction is then read from color alone, not from which side price is on.
  const flip = dev !== null && dev > 0;
  const declutteredPct = new Map<string, number>(
    sorted.map((p, i) => [p.cls, flip ? 100 - pcts[i] : pcts[i]]),
  );

  let color = MUTED_COLOR;
  if (dev !== null && dev !== 0) {
    const t = Math.min(1, Math.abs(dev) / DEVIATION_CAP);
    color = lerpColor(
      MUTED_COLOR,
      dev > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR,
      t,
    );
  }

  return (
    <div
      className="anchor-price-line"
      style={{ ['--line-color' as string]: color }}
    >
      <div className="apl-line" />
      {points.map((p) => (
        <div
          key={p.cls}
          className={`apl-point ${p.cls}`}
          style={{ left: `${declutteredPct.get(p.cls)}%` }}
        >
          <span className="apl-dot" />
          <span className="apl-label">
            {p.prefix}
            {fmtCoin(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
