import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { ConnectionPort, ListPortsResult } from './types';
import './PortSearch.css';

// Defense in depth: the backend normalizes every field to a plain string
// (mcp-server/tools/connections.py's _display()), but this API has
// already surfaced one unannounced nested-object shape for `location` —
// coercing here too means a future surprise degrades to an ugly string
// instead of crashing the whole page (React refuses to render an object
// as a child at all).
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function matches(port: ConnectionPort, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    text(port.location).toLowerCase().includes(q) ||
    text(port.product_type).toLowerCase().includes(q) ||
    text(port.bandwidth).toLowerCase().includes(q)
  );
}

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called search_existing_ports — a live search-as-you-type picker over
// the ports already fetched that turn (no per-keystroke server round
// trip). Picking a row sends a plain identifying message back into the
// chat, exactly as if the user had typed it themselves.
export default function PortSearch({
  result,
  onSelect,
}: {
  result: ListPortsResult;
  onSelect: (text: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () => result.ports.filter((port) => matches(port, query)),
    [result.ports, query],
  );

  function handleSelect(port: ConnectionPort) {
    setSelectedIndex(port.index);
    onSelect(`I'll use port #${port.index}: ${text(port.location)}.`);
  }

  if (result.error) {
    return (
      <div className="port-search port-search--error">
        Port lookup is temporarily unavailable: {result.error}
      </div>
    );
  }

  return (
    <div className="port-search">
      <div className="port-search-input-row">
        <Search size={16} strokeWidth={2} className="port-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="port-search-input"
          placeholder="Search by city, country, or postal code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="port-search-results">
        {filtered.length === 0 && (
          <div className="port-search-empty">No ports match "{query}".</div>
        )}
        {filtered.map((port) => (
          <button
            key={port.index}
            type="button"
            className={`port-search-row ${selectedIndex === port.index ? 'port-search-row--selected' : ''}`}
            onClick={() => handleSelect(port)}
            disabled={selectedIndex !== null}
          >
            <span className="port-search-row-location">{text(port.location)}</span>
            <span className="port-search-row-meta">
              {text(port.bandwidth)} · {text(port.product_type)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
