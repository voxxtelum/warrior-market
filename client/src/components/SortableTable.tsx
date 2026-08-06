import { useMemo, useState } from "react";
import { fmtDate } from "../format";

interface ReportColumn {
  code: string;
  start_time: number;
}

interface SortableTableProps<T> {
  id?: string;
  reports: ReportColumn[];
  rows: T[];
  rowKey: (row: T) => string;
  getLabel: (row: T) => string;
  getValue: (row: T, reportCode: string) => number | undefined;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
}

type SortKey = "label" | string;

export function SortableTable<T>({
  id,
  reports,
  rows,
  rowKey,
  getLabel,
  getValue,
  onRowClick,
  isSelected,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  function valueFor(row: T, key: SortKey): number | string | null {
    if (key === "label") return getLabel(row);
    return getValue(row, key) ?? null;
  }

  const sortedRows = useMemo(() => {
    if (sortKey === null) return rows;
    return [...rows].sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string" || typeof bv === "string") {
        return sortDir * String(av).localeCompare(String(bv));
      }
      return sortDir * (av - bv);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1) as 1 | -1);
    } else {
      setSortKey(key);
      setSortDir(key === "label" ? 1 : -1);
    }
  }

  function arrowFor(key: SortKey): string {
    if (sortKey !== key) return "";
    return sortDir === 1 ? " ▲" : " ▼";
  }

  return (
    <table id={id}>
      <thead>
        <tr>
          <th className="sortable" onClick={() => handleSort("label")}>
            Player{arrowFor("label")}
          </th>
          {reports.map((r) => (
            <th key={r.code} className="sortable" onClick={() => handleSort(r.code)}>
              {fmtDate(r.start_time)}
              {arrowFor(r.code)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row) => (
          <tr
            key={rowKey(row)}
            style={onRowClick ? { cursor: "pointer" } : undefined}
            onClick={() => onRowClick?.(row)}
            className={isSelected?.(row) ? "selected-row" : undefined}
          >
            <td>{getLabel(row)}</td>
            {reports.map((r) => {
              const v = getValue(row, r.code);
              return <td key={r.code}>{typeof v === "number" ? v.toLocaleString() : <span className="no-data">–</span>}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
