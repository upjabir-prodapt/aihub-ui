import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionPort, ListPortsResult } from '../types/naas';

const COLUMNS = '3.5rem 1.3fr 1fr 1fr';

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

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called search_existing_ports or present_port_matches — a plain table
// of the ports already fetched that turn (Index, Port Name, Building,
// Site), no search/filter box. Each row is one clickable
// button (the Index cell is the visual focus, but the whole row is the
// click target) — picking one sends a plain identifying message back
// into the chat, exactly as if the user had typed it themselves. Shares
// its table look with PricingOptions.tsx/RecommendationOptions.tsx via
// PickerTable.css.
export default function PortSearch({
  result,
  onSelect,
}: {
  result: ListPortsResult;
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(port: ConnectionPort) {
    setSelectedIndex(port.index);
    onSelect(`I'll use port #${port.index}: ${text(port.port_name)}.`);
  }

  if (result.error) {
    return (
      <div className="picker-table-wrap picker-table-wrap--error">
        {t('errors.portLookupUnavailable')}
        {result.error}
      </div>
    );
  }

  // Defense in depth: an uncaught backend exception (e.g. a network
  // failure that isn't a ColtAPIError) can surface `result` as something
  // other than the expected shape — never crash the whole chat on it.
  const ports = Array.isArray(result.ports) ? result.ports : [];

  if (ports.length === 0) {
    return <div className="picker-table-wrap picker-table-wrap--empty">{t('emptyStates.noPortsFound')}</div>;
  }

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: COLUMNS }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell picker-table-cell--wrap">{t('common.portName')}</span>
        <span className="picker-table-cell picker-table-cell--wrap">{t('common.building')}</span>
        <span className="picker-table-cell picker-table-cell--wrap">{t('common.site')}</span>
      </div>
      <div className="picker-table-body">
        {ports.map((port) => {
          const isSelected = selectedIndex === port.index;
          return (
            <button
              key={port.index}
              type="button"
              className={`picker-table-row ${isSelected ? 'picker-table-row--selected' : ''}`}
              style={{ gridTemplateColumns: COLUMNS }}
              onClick={() => handleSelect(port)}
              disabled={selectedIndex !== null}
            >
              <span className="picker-table-cell picker-table-cell--index">
                <span className="picker-table-index-badge">{port.index}</span>
              </span>
              <span className="picker-table-cell picker-table-cell--wrap">{text(port.port_name)}</span>
              <span className="picker-table-cell picker-table-cell--wrap">{text(port.building_name)}</span>
              <span className="picker-table-cell picker-table-cell--wrap">{text(port.site_name)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
