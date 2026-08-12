// Exact chevron-down SVG supplied in funds.md for the Fund card's Details
// expander - a different (outline, 24x24) style from the existing mini
// ChevronDownIcon used elsewhere, kept as its own component rather than
// reused so this card matches the spec literally.
export function ChevronDownOutlineIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </svg>
  );
}
