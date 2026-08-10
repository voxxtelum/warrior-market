import { fmtCoin } from '../format';

function ArrowLongUpIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 18a.75.75 0 0 1-.75-.75V4.66L7.3 6.76a.75.75 0 0 1-1.1-1.02l3.25-3.5a.75.75 0 0 1 1.1 0l3.25 3.5a.75.75 0 1 1-1.1 1.02l-1.95-2.1v12.59A.75.75 0 0 1 10 18Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ArrowLongDownIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" width={14} height={14} aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 2a.75.75 0 0 1 .75.75v12.59l1.95-2.1a.75.75 0 1 1 1.1 1.02l-3.25 3.5a.75.75 0 0 1-1.1 0l-3.25-3.5a.75.75 0 1 1 1.1-1.02l1.95 2.1V2.75A.75.75 0 0 1 10 2Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export interface NetWorthDeltaBadgeProps {
  // Change in net worth since the last hourly portfolio snapshot.
  delta: number;
}

// Absolute value only, no +/- sign, no percent - the direction is carried
// entirely by the arrow and color, per the "since last hour" net worth
// stat next to Portfolio on the Wallet page and admin Profile page.
export function NetWorthDeltaBadge({ delta }: NetWorthDeltaBadgeProps) {
  // Decide direction from the cent-rounded value (same rounding fmtCoin
  // applies) rather than the raw float - otherwise sub-cent float drift
  // between the live and snapshotted net worth shows as a colored arrow
  // next to a displayed "0.00".
  const rounded = Math.round(delta * 100) / 100;
  const cls = rounded > 0 ? 'delta-pos' : rounded < 0 ? 'delta-neg' : 'delta-neutral';
  return (
    <span className={`net-worth-delta ${cls}`}>
      {rounded > 0 && <ArrowLongUpIcon />}
      {rounded < 0 && <ArrowLongDownIcon />}
      {fmtCoin(Math.abs(rounded))}
    </span>
  );
}
