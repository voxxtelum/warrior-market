interface Delta {
  text: string;
  cls: string;
}

interface StackCellProps {
  values: number[];
  formatValue: (n: number) => string;
  formatDelta: (prev: number, curr: number) => Delta;
}

// Renders one line per value: the first is the baseline with no delta, each
// line after it shows its change from the line directly above.
export function StackCell({ values, formatValue, formatDelta }: StackCellProps) {
  if (values.length === 0) {
    return (
      <div>
        <span className="no-data">–</span>
      </div>
    );
  }
  return (
    <>
      {values.map((v, i) => {
        const formatted = formatValue(v);
        if (i === 0) return <div key={i}>{formatted}</div>;
        const delta = formatDelta(values[i - 1], v);
        return (
          <div key={i}>
            {formatted} <span className={delta.cls}>{delta.text}</span>
          </div>
        );
      })}
    </>
  );
}
