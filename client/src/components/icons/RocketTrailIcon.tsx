import { RocketLaunchIcon } from './RocketLaunchIcon';

// Wraps RocketLaunchIcon with 3 speed-line spans trailing behind it - hidden
// at rest, drawn in (growing leftward from the icon) on `.icon-btn:hover`
// via the `.rocket-trail-line` CSS, timed alongside the icon-btn hover
// animation that slides this icon rightward as the button label collapses.
export function RocketTrailIcon({ className }: { className?: string }) {
  return (
    <span className="rocket-trail">
      <span className="rocket-trail-line" />
      <span className="rocket-trail-line" />
      <span className="rocket-trail-line" />
      <RocketLaunchIcon className={className} />
    </span>
  );
}
