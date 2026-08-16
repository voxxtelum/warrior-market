import { raidOrderIndex } from '../raidOrder';

// Replaces the old <select> instance dropdown on the Compare/Trends/Raids
// tabs with equal-width buttons, ordered by raid tier.
export function ZonePicker({
  zones,
  value,
  onChange,
}: {
  zones: string[] | null;
  value: string;
  onChange: (zone: string) => void;
}) {
  if (zones && zones.length === 0) {
    return <div className="zone-picker-empty">No reports added yet</div>;
  }

  const ordered = zones ? [...zones].sort((a, b) => raidOrderIndex(a) - raidOrderIndex(b)) : [];

  return (
    <div className="zone-picker">
      {ordered.map((z) => (
        <button
          key={z}
          type="button"
          className={z === value ? 'zone-picker-btn active' : 'zone-picker-btn'}
          onClick={() => onChange(z)}
        >
          {z}
        </button>
      ))}
    </div>
  );
}
