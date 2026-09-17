import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CircuitSummary, ListActiveCircuitsResult } from './types';
import '../../components/PickerTable.css';

const COLUMNS = '3.5rem 1.6fr 1.3fr 0.9fr 0.9fr';

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called list_active_circuits — a plain table of that turn's circuits
// (Index, Name, Circuit Reference, Bandwidth, Status), replacing the
// Markdown table the model used to write itself. Picking a row sends a
// plain identifying message back into the chat, exactly as if the user
// had typed that index themselves; the model then resolves it against
// the same circuit list already shown, per sre_monitor/prompt.md step 3.
// That outgoing message is deliberately NOT run through i18n — it's
// literal chat input the agent's prompt resolves by phrasing, not
// display text — so it stays English regardless of UI language, same as
// every other picker component's onSelect message. `circuit.status`
// below is live API data, also excluded from translation.
// Shares its table look with the Service Order Agent's
// PortSearch.tsx/PricingOptions.tsx/RecommendationOptions.tsx via
// PickerTable.css.
export default function CircuitTable({
  result,
  onSelect,
}: {
  result: ListActiveCircuitsResult;
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(circuit: CircuitSummary) {
    setSelectedIndex(circuit.index);
    onSelect(`I'll check circuit #${circuit.index}: ${circuit.name} (${circuit.circuit_reference}).`);
  }

  if (result.error) {
    return (
      <div className="picker-table-wrap picker-table-wrap--error">
        {t('errors.circuitLookupUnavailable')}
        {result.error}
      </div>
    );
  }

  // Defense in depth: same reasoning as PortSearch.tsx — never crash the
  // whole chat on a malformed result.
  const circuits = Array.isArray(result.circuits) ? result.circuits : [];

  if (circuits.length === 0) {
    return (
      <div className="picker-table-wrap picker-table-wrap--empty">{t('emptyStates.noActiveCircuits')}</div>
    );
  }

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: COLUMNS }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell">{t('common.name')}</span>
        <span className="picker-table-cell">{t('common.circuitReference')}</span>
        <span className="picker-table-cell">{t('common.bandwidth')}</span>
        <span className="picker-table-cell">{t('common.status')}</span>
      </div>
      <div className="picker-table-body">
        {circuits.map((circuit) => {
          const isSelected = selectedIndex === circuit.index;
          return (
            <button
              key={circuit.index}
              type="button"
              className={`picker-table-row ${isSelected ? 'picker-table-row--selected' : ''}`}
              style={{ gridTemplateColumns: COLUMNS }}
              onClick={() => handleSelect(circuit)}
              disabled={selectedIndex !== null}
            >
              <span className="picker-table-cell picker-table-cell--index">
                <span className="picker-table-index-badge">{circuit.index}</span>
              </span>
              <span className="picker-table-cell">{circuit.name}</span>
              <span className="picker-table-cell">{circuit.circuit_reference}</span>
              <span className="picker-table-cell">
                {circuit.bandwidth_mbps != null ? `${circuit.bandwidth_mbps} Mbps` : '—'}
              </span>
              <span className="picker-table-cell">{circuit.status}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
