import { useState, type ReactNode } from 'react';
import './PickerTable.css';

// Defense in depth: the backend normalizes list rows to plain strings, but
// several of these tools' schemas are still guesses against undocumented
// real APIs (see e.g. address.py's own module docstring) — coercing here
// means a future surprise degrades to an ugly string instead of crashing
// the whole page (React refuses to render an object as a child at all).
// Copied from PortSearch.tsx rather than imported so this component has no
// dependency on any one agent's own files.
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export interface IndexedListPickerColumn<Row> {
  label: string;
  render: (row: Row) => ReactNode;
  // Opt in for a column whose real values can run long (building/site
  // names) — wraps instead of the default single-line ellipsis.
  wrap?: boolean;
  // grid-template-columns width for this column, default '1fr'.
  width?: string;
}

// Shorthand for the common case of a column that just reads one string
// field off the row through the same defensive text() coercion above.
export function textColumn<Row>(
  label: string,
  key: keyof Row,
  opts?: { wrap?: boolean; width?: string },
): IndexedListPickerColumn<Row> {
  return { label, render: (row) => text(row[key]), wrap: opts?.wrap, width: opts?.width };
}

// Generic clickable "indexed table" picker — every list-shaped tool result
// in this app (ports, buildings, bandwidth tiers, pricing options,
// recommendations) is fundamentally the same shape: an indexed list of
// rows, the user picks one by clicking it, and picking one sends a plain
// identifying message back into the chat exactly as if the user had typed
// that index themselves. This component is that shape, parameterized by
// column definitions — new list-tools that need a picker card should wire
// into this instead of writing another bespoke table component. Shares its
// look with every other picker via PickerTable.css.
export default function IndexedListPicker<Row extends { index: number }>({
  rows,
  columns,
  onSelect,
  selectMessage,
  emptyMessage = 'No options found.',
}: {
  rows: Row[];
  columns: IndexedListPickerColumn<Row>[];
  onSelect: (text: string) => void;
  selectMessage: (row: Row) => string;
  emptyMessage?: string;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(row: Row) {
    setSelectedIndex(row.index);
    onSelect(selectMessage(row));
  }

  if (rows.length === 0) {
    return <div className="picker-table-wrap picker-table-wrap--empty">{emptyMessage}</div>;
  }

  const gridColumns = `3.5rem ${columns.map((c) => c.width ?? '1fr').join(' ')}`;

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: gridColumns }} role="row">
        <span className="picker-table-cell picker-table-cell--index">Index</span>
        {columns.map((col) => (
          <span
            key={col.label}
            className={`picker-table-cell ${col.wrap ? 'picker-table-cell--wrap' : ''}`}
          >
            {col.label}
          </span>
        ))}
      </div>
      <div className="picker-table-body">
        {rows.map((row) => {
          const isSelected = selectedIndex === row.index;
          return (
            <button
              key={row.index}
              type="button"
              className={`picker-table-row ${isSelected ? 'picker-table-row--selected' : ''}`}
              style={{ gridTemplateColumns: gridColumns }}
              onClick={() => handleSelect(row)}
              disabled={selectedIndex !== null}
            >
              <span className="picker-table-cell picker-table-cell--index">
                <span className="picker-table-index-badge">{row.index}</span>
              </span>
              {columns.map((col) => (
                <span
                  key={col.label}
                  className={`picker-table-cell ${col.wrap ? 'picker-table-cell--wrap' : ''}`}
                >
                  {col.render(row)}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
