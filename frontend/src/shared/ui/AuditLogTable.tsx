import { useTranslation } from 'react-i18next';
import type { ReliabilityAuditEntry } from '../types/naas';

// Rendered by ChatPanel (via registry/chatExtras.tsx) for a turn that
// called list_audit_log — the Service Reliability Agent's "show audit
// log" step (sre_closed_loop/prompt.md step 6). Replaces the Markdown
// table the agent used to write itself. Unlike CircuitRulesTable.tsx (and
// every other in-chat picker), this is NOT clickable — there's no
// meaningful "select a row" action for a historical log entry — so it's a
// plain <table> (naturally handles its 9 columns' width/scrolling far
// better than PickerTable.css's CSS-grid row-of-buttons shape, which
// assumes a handful of columns) rather than reusing the picker-table
// classes, though it keeps the same rounded-card visual language.
// `entry.action`/`entry.status` are live API/DB data, left untranslated.
function statusClass(status: ReliabilityAuditEntry['status']): string {
  if (status === 'COMPLETED') return 'audit-log-badge audit-log-badge--good';
  if (status === 'FAILED') return 'audit-log-badge audit-log-badge--bad';
  // TIMED_OUT (and SUBMITTED) mean "Colt hadn't confirmed completion
  // within our wait window" — not failed; the background poller keeps
  // re-checking and flips this to COMPLETED on its own. Styled distinctly
  // from FAILED so it doesn't read as a confirmed error — same convention
  // as the left panel's own audit table (SreClosedLoopPanel.tsx).
  return 'audit-log-badge audit-log-badge--pending';
}

function formatMbps(value: number | null): string {
  return value != null ? `${value} Mbps` : '—';
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

export default function AuditLogTable({ entries }: { entries: ReliabilityAuditEntry[] }) {
  const { t } = useTranslation();
  // Defense in depth: same reasoning as every other chat-extra — never
  // crash the whole chat on a malformed result.
  const rows = Array.isArray(entries) ? entries : [];

  if (rows.length === 0) {
    return <div className="audit-log-wrap audit-log-wrap--empty">{t('emptyStates.noActionsLogged')}</div>;
  }

  return (
    <div className="audit-log-wrap">
      <table className="audit-log-table">
        <thead>
          <tr>
            <th>{t('common.index')}</th>
            <th>{t('common.timestamp')}</th>
            <th>{t('common.circuitReference')}</th>
            <th>{t('common.action')}</th>
            <th>{t('common.previousBandwidth')}</th>
            <th>{t('common.newBandwidth')}</th>
            <th>{t('common.rentalCharge')}</th>
            <th>{t('common.triggeredBy')}</th>
            <th>{t('common.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, i) => (
            <tr key={entry.id}>
              <td>{i + 1}</td>
              <td>{formatTimestamp(entry.created_at)}</td>
              <td>{entry.circuit_reference}</td>
              <td>{entry.action}</td>
              <td>{formatMbps(entry.previous_bandwidth_mbps)}</td>
              <td>{formatMbps(entry.new_bandwidth_mbps)}</td>
              <td>{entry.rental_charge ?? t('common.na')}</td>
              <td>{entry.triggered_by === 'MONITORING_EVENT' ? t('common.automatic') : t('common.manual')}</td>
              <td>
                <span className={statusClass(entry.status)}>{entry.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
