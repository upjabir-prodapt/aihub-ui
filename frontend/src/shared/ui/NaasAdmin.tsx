import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { approveTicket, fetchPendingTickets, fetchTicketHistory } from '../api/naas';
import type { ServiceOrderTicket } from '../types/naas';
import '../../styles/naas.css';

type Tab = 'pending' | 'history';

function formatAddress(ticket: ServiceOrderTicket): string {
  return [ticket.city, ticket.country, ticket.post_code].filter(Boolean).join(', ') || '—';
}

// Takes `t` as a parameter rather than calling useTranslation() itself —
// this is a plain function, not a component, so it can't use hooks.
function formatProductType(ticket: ServiceOrderTicket, t: TFunction): string {
  const labels: Record<ServiceOrderTicket['product_type'], string> = {
    ethernet_port: t('admin.productTypes.ethernetPort'),
    offnet_port: t('admin.productTypes.offnetPort'),
    offnet_modification: t('admin.productTypes.offnetModification'),
  };
  return labels[ticket.product_type] ?? t('admin.productTypes.ethernetPort');
}

// Mounted at "/naas/admin" — role-gated the same as the rest of "/naas" (see
// app/router.tsx's RequireRole wrapper), so unlike the pre-BFF version of
// this screen, ticket approval needs no separate per-action login check
// here: reaching this route at all already required NaaS.User/Platform.Admin.
export default function NaasAdmin() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<ServiceOrderTicket[]>([]);
  const [history, setHistory] = useState<ServiceOrderTicket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);

  function refetch() {
    fetchPendingTickets().then(setPending).catch((err: Error) => setError(err.message));
    fetchTicketHistory().then(setHistory).catch((err: Error) => setError(err.message));
  }

  useEffect(() => {
    refetch();
  }, []);

  async function handleApprove(ticketId: number) {
    setApprovingId(ticketId);
    try {
      await approveTicket(ticketId);
      refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovingId(null);
    }
  }

  const rows = tab === 'pending' ? pending : history;

  return (
    <div className="admin-page">
      <header className="admin-header">
        <Link to="/naas" className="back-link">
          ← {t('admin.backLink')}
        </Link>
        <h1>{t('admin.title')}</h1>
      </header>

      {error && <p className="admin-error">{error}</p>}

      <div className="admin-tabs">
        <button
          className={`admin-tab ${tab === 'pending' ? 'admin-tab--active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('admin.pendingTab', { count: pending.length })}
        </button>
        <button
          className={`admin-tab ${tab === 'history' ? 'admin-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          {t('admin.historyTab', { count: history.length })}
        </button>
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{t('admin.table.ticket')}</th>
              <th>{t('admin.table.type')}</th>
              <th>{t('admin.table.address')}</th>
              <th>{t('admin.table.building')}</th>
              <th>{t('admin.table.bandwidth')}</th>
              <th>{t('admin.table.commitment')}</th>
              <th>{t('admin.table.rentalCharge')}</th>
              <th>{tab === 'pending' ? t('admin.table.created') : t('admin.table.approved')}</th>
              {tab === 'pending' && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'pending' ? 9 : 8} className="admin-empty">
                  {tab === 'pending' ? t('admin.noPendingTickets') : t('admin.noHistoryTickets')}
                </td>
              </tr>
            )}
            {rows.map((ticket) => (
              <tr key={ticket.id}>
                <td>#{ticket.id}</td>
                <td>{formatProductType(ticket, t)}</td>
                <td>{formatAddress(ticket)}</td>
                <td>{ticket.building_name ?? '—'}</td>
                <td>{ticket.bandwidth ?? '—'}</td>
                <td>{ticket.commitment_period ?? '—'}</td>
                <td>{ticket.rental_charge ?? '—'}</td>
                <td>{tab === 'pending' ? ticket.created_at : ticket.approved_at}</td>
                {tab === 'pending' && (
                  <td>
                    <button
                      className="admin-approve-btn"
                      disabled={approvingId === ticket.id}
                      onClick={() => handleApprove(ticket.id)}
                    >
                      {approvingId === ticket.id ? t('admin.approving') : t('admin.approve')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
