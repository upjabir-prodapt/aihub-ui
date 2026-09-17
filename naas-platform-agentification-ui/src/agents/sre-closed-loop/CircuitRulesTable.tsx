import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CircuitSummary, ListActiveCircuitsResult } from '../sre-monitor/types';
import type { ReliabilityRule } from '../../api/types';
import '../../components/PickerTable.css';

const COLUMNS = '3.5rem 1.4fr 1.4fr 1fr 2.2fr';

// Rendered by ChatPanel (via registry/chatExtras.tsx) for a turn that
// called BOTH list_active_circuits and list_reliability_rules — the
// Service Reliability Agent's "show reliability rules" step (sre_closed_
// loop/prompt.md step 2). Replaces the plain Markdown table the agent
// used to write itself: this joins the two tool results the same way the
// prompt used to describe (matching each circuit's connection_id to a
// rule's connection_id) and renders ONE clickable table — Index, Circuit
// Reference, Name, Current Bandwidth, Rule — instead of that table being
// followed by a second, redundant generic CircuitTable card. Picking a
// row sends a plain identifying message — deliberately NOT
// CircuitTable.tsx's "I'll check circuit #N..." wording, which reads as
// the Service Observability Agent's read-only telemetry lookup; this
// agent is setting up/editing/deleting a policy, never "checking"
// anything. The agent still resolves the index/reference against
// list_active_circuits's order exactly as before, so no prompt-side
// change was needed for click handling itself. That outgoing message is
// also deliberately NOT run through i18n — same reasoning as every other
// picker component's onSelect message (literal chat input the prompt
// resolves by phrasing).
// Shares its table look with CircuitTable.tsx/PortSearch.tsx/
// PricingOptions.tsx/RecommendationOptions.tsx via PickerTable.css.
export default function CircuitRulesTable({
  circuits: circuitsResult,
  rules,
  onSelect,
}: {
  circuits: ListActiveCircuitsResult;
  rules: ReliabilityRule[];
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(circuit: CircuitSummary) {
    setSelectedIndex(circuit.index);
    onSelect(`Circuit #${circuit.index}: ${circuit.name} (${circuit.circuit_reference}).`);
  }

  function ruleSummary(circuit: CircuitSummary): string {
    const rule = rules.find((r) => r.connection_id === circuit.connection_id);
    if (!rule) return t('common.na');
    return t('circuitRules.summary', {
      increasePct: rule.increase_threshold_pct,
      nextMbps: rule.next_bandwidth_mbps,
      decreasePct: rule.decrease_threshold_pct,
      baseMbps: rule.base_bandwidth_mbps,
    });
  }

  if (circuitsResult.error) {
    return (
      <div className="picker-table-wrap picker-table-wrap--error">
        {t('errors.circuitLookupUnavailable')}
        {circuitsResult.error}
      </div>
    );
  }

  // Defense in depth: same reasoning as CircuitTable.tsx — never crash the
  // whole chat on a malformed result.
  const circuits = Array.isArray(circuitsResult.circuits) ? circuitsResult.circuits : [];

  if (circuits.length === 0) {
    return (
      <div className="picker-table-wrap picker-table-wrap--empty">{t('emptyStates.noActiveCircuits')}</div>
    );
  }

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: COLUMNS }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell">{t('common.circuitReference')}</span>
        <span className="picker-table-cell">{t('common.name')}</span>
        <span className="picker-table-cell">{t('common.currentBandwidth')}</span>
        <span className="picker-table-cell">{t('common.rule')}</span>
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
              <span className="picker-table-cell">{circuit.circuit_reference}</span>
              <span className="picker-table-cell">{circuit.name}</span>
              <span className="picker-table-cell">
                {circuit.bandwidth_mbps != null ? `${circuit.bandwidth_mbps} Mbps` : '—'}
              </span>
              <span className="picker-table-cell picker-table-cell--wrap">{ruleSummary(circuit)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
