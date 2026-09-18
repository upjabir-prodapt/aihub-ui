import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecommendationResult } from '../types/naas';

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called present_bandwidth_recommendation or
// present_commitment_recommendation — a table (Index, <label>[, Price])
// showing the recommended value first (tagged "Recommended", with its
// one-line reason) followed by up to 3 alternatives, in place of the
// freeform prose template the model used to write itself. `label` names
// the column ("Bandwidth" or "Commitment Period") since this same
// component serves both. The Price column only appears when the result
// actually carries prices (present_commitment_recommendation does today,
// present_bandwidth_recommendation doesn't) — same "only show a column
// the data actually has" pattern as PricingOptions.tsx's Bandwidth
// column. Picking a row sends a plain confirming message back into the
// chat. Shares its table look with PortSearch.tsx/PricingOptions.tsx via
// PickerTable.css.
export default function RecommendationOptions({
  label,
  result,
  onSelect,
}: {
  label: string;
  result: RecommendationResult;
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);

  function handleSelect(value: string) {
    setSelected(value);
    onSelect(`I'll go with ${value}.`);
  }

  // Defense in depth: same reasoning as PricingOptions.tsx — never crash
  // the whole chat on a malformed result (e.g. an uncaught backend
  // exception surfacing as something other than the expected shape).
  if (typeof result.recommended !== 'string' || !Array.isArray(result.alternatives)) {
    return null;
  }

  const hasPrices = result.recommended_price !== undefined;
  // Defense in depth: `alternatives` should only ever be the *other*
  // real options — the model has occasionally repeated `recommended`'s
  // own value inside it too, which would otherwise render the same
  // option twice, both tagged "Recommended". Filter that out here (and
  // keep alternative_prices aligned by index) so the table can never
  // show a self-duplicate, regardless of what the tool call passed.
  const altPairs = result.alternatives
    .map((value, i) => ({ value, price: result.alternative_prices?.[i] }))
    .filter((a) => a.value !== result.recommended);
  const rows = [result.recommended, ...altPairs.map((a) => a.value)];
  const prices = hasPrices ? [result.recommended_price, ...altPairs.map((a) => a.price)] : [];
  const COLUMNS = hasPrices ? '3.5rem 1fr 1fr' : '3.5rem 1fr';

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: COLUMNS }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell">{label}</span>
        {hasPrices && <span className="picker-table-cell">{t('common.price')}</span>}
      </div>
      <div className="picker-table-body">
        {rows.map((value, i) => {
          const isRecommended = value === result.recommended;
          return (
            <button
              key={value}
              type="button"
              className={`picker-table-row ${isRecommended ? 'picker-table-row--recommended' : ''} ${selected === value ? 'picker-table-row--selected' : ''}`}
              style={{ gridTemplateColumns: COLUMNS }}
              onClick={() => handleSelect(value)}
              disabled={selected !== null}
            >
              <span className="picker-table-cell picker-table-cell--index">
                <span className="picker-table-index-badge">{i + 1}</span>
              </span>
              <span className="picker-table-cell picker-table-cell--label">
                <span className="picker-table-row-primary">
                  {value}
                  {isRecommended && (
                    <span className="picker-table-recommended-badge">{t('common.recommended')}</span>
                  )}
                </span>
                {isRecommended && (
                  <span className="picker-table-row-meta">{result.reason}</span>
                )}
              </span>
              {hasPrices && <span className="picker-table-cell">{prices[i] ?? '—'}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
