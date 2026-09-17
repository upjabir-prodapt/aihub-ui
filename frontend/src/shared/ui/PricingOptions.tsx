import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PricingOption, PricingOptionsResult } from '../types/naas';

function periodLabel(option: PricingOption): string {
  return option.commitment_period ?? option.contract_term ?? '—';
}

// Rendered by ChatPanel (via registry/chatExtras.tsx) for whichever turn
// called one of the pricing tools (get_ethernet_port_price, get_dia_price,
// get_ethernet_circuit_price, get_offnet_port_price, get_fttx_price,
// get_comcast_port_price, get_offnet_port_mod_options) — a table over
// that turn's already-sorted `options` (Index, Commitment Period,
// Bandwidth [only when the data actually carries one — omitted for the
// bandwidth-fixed "both sides existing" case], Cost), in place of the
// plain markdown table the model used to write itself. Picking a row
// sends a plain identifying message back into the chat, exactly as if
// the user had typed that index themselves. Shares its table look with
// PortSearch.tsx/RecommendationOptions.tsx via PickerTable.css.
export default function PricingOptions({
  result,
  onSelect,
}: {
  result: PricingOptionsResult;
  onSelect: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  function handleSelect(option: PricingOption) {
    setSelectedIndex(option.index);
    const label = periodLabel(option);
    const charge = option.rental_charge ? ` at ${option.rental_charge}` : '';
    onSelect(`I'll go with option #${option.index}: ${label}${charge}.`);
  }

  if (result.error) {
    return (
      <div className="picker-table-wrap picker-table-wrap--error">
        {t('errors.pricingLookupUnavailable')}
        {result.error}
      </div>
    );
  }

  // Defense in depth: `result` is only as trustworthy as whatever the
  // backend actually sent this turn — an uncaught exception on the Colt
  // side (e.g. a network failure that isn't a ColtAPIError) can surface
  // here as something other than the expected shape. Render nothing
  // rather than crash the whole chat on a malformed `options`.
  if (!Array.isArray(result.options)) {
    return null;
  }

  if (result.options.length === 0) {
    return (
      <div className="picker-table-wrap picker-table-wrap--empty">
        {t('emptyStates.noPricingOptions')}
      </div>
    );
  }

  // Bandwidth is fixed (not shown per-row) for the "both sides existing"
  // Ethernet case — only add the column when at least one row actually
  // carries a value, rather than showing an all-dash column.
  const hasBandwidth = result.options.some((o) => o.bandwidth);
  const columns = hasBandwidth ? '3.5rem 1.3fr 1fr 1.2fr' : '3.5rem 1.6fr 1.4fr';

  return (
    <div className="picker-table-wrap">
      <div className="picker-table-header" style={{ gridTemplateColumns: columns }} role="row">
        <span className="picker-table-cell picker-table-cell--index">{t('common.index')}</span>
        <span className="picker-table-cell">{t('common.commitmentPeriod')}</span>
        {hasBandwidth && <span className="picker-table-cell">{t('common.bandwidth')}</span>}
        <span className="picker-table-cell">{t('common.cost')}</span>
      </div>
      <div className="picker-table-body">
        {result.options.map((option) => (
          <button
            key={option.index}
            type="button"
            className={`picker-table-row ${selectedIndex === option.index ? 'picker-table-row--selected' : ''}`}
            style={{ gridTemplateColumns: columns }}
            onClick={() => handleSelect(option)}
            disabled={selectedIndex !== null}
          >
            <span className="picker-table-cell picker-table-cell--index">
              <span className="picker-table-index-badge">{option.index}</span>
            </span>
            <span className="picker-table-cell">{periodLabel(option)}</span>
            {hasBandwidth && <span className="picker-table-cell">{option.bandwidth ?? '—'}</span>}
            <span className="picker-table-cell">{option.rental_charge ?? '—'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
