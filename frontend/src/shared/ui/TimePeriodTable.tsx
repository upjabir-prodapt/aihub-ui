import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresentTimePeriodOptionsResult, TimePeriodOption } from '../types/naas';

const COLUMNS = '3.5rem 1fr';

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called present_time_period_options — a plain table (Index, Period), same
// headers as the Markdown table the model used to write itself, replacing
// it with the same clickable-row pattern CircuitTable.tsx already uses for
// the circuit list. Picking a row sends a plain identifying message back
// into the chat; the model resolves the index against sre_monitor/
// prompt.md step 4's fixed index -> period mapping. The onSelect message
// and `option.period` itself (from the backend's fixed option list) are
// deliberately NOT run through i18n — see CircuitTable.tsx's equivalent
// note. Shares its table look with CircuitTable.tsx/PortSearch.tsx/
// PricingOptions.tsx/RecommendationOptions.tsx via PickerTable.css.
export default function TimePeriodTable({
  result,
  onSelect,
}: {
  result: PresentTimePeriodOptionsResult;
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(option: TimePeriodOption) {
    setSelectedIndex(option.index);
    onSelect(`I'll check period #${option.index}: ${option.period}.`);
  }

  // Defense in depth: same reasoning as CircuitTable.tsx — never crash the
  // whole chat on a malformed result.
  const periods = Array.isArray(result.periods) ? result.periods : [];

  if (periods.length === 0) return null;

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: COLUMNS }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell">{t('common.period')}</span>
      </div>
      <div className="picker-table-body">
        {periods.map((option) => {
          const isSelected = selectedIndex === option.index;
          return (
            <button
              key={option.index}
              type="button"
              className={`picker-table-row ${isSelected ? 'picker-table-row--selected' : ''}`}
              style={{ gridTemplateColumns: COLUMNS }}
              onClick={() => handleSelect(option)}
              disabled={selectedIndex !== null}
            >
              <span className="picker-table-cell picker-table-cell--index">
                <span className="picker-table-index-badge">{option.index}</span>
              </span>
              <span className="picker-table-cell">{option.period}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
