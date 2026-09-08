import { useEffect, useState } from 'react';
import { approveTicket, fetchPendingTickets, fetchTicketHistory } from '../api/client';
import type { ServiceOrderTicket } from '../api/types';
import './NaaSAdmin.css';

type Tab = 'pending' | 'history';

interface NaaSAdminProps {
  onBack: () => void;
}

function formatAddress(ticket: ServiceOrderTicket): string {
  return [ticket.city, ticket.country, ticket.post_code].filter(Boolean).join(', ') || '—';
}

export default function NaaSAdmin({ onBack }: NaaSAdminProps) {
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
    <div className="naas-admin-page">
      <header className="naas-admin-header">
        <button type="button" className="naas-back-link" onClick={onBack}>
          ← Control panel
        </button>
        <h1>Service Order Tickets</h1>
      </header>

      {error && <p className="naas-admin-error">{error}</p>}

      <div className="naas-admin-tabs">
        <button
          className={`naas-admin-tab ${tab === 'pending' ? 'naas-admin-tab--active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Pending ({pending.length})
        </button>
        <button
          className={`naas-admin-tab ${tab === 'history' ? 'naas-admin-tab--active' : ''}`}
          onClick={() => setTab('history')}
        >
          History ({history.length})
        </button>
      </div>

      <div className="naas-admin-table-wrap">
        <table className="naas-admin-table">
          <thead>
            <tr>
              <th>Ticket</th>
              <th>Address</th>
              <th>Building</th>
              <th>Bandwidth</th>
              <th>Commitment</th>
              <th>Rental Charge</th>
              <th>{tab === 'pending' ? 'Created' : 'Approved'}</th>
              {tab === 'pending' && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={tab === 'pending' ? 8 : 7} className="naas-admin-empty">
                  No {tab} tickets.
                </td>
              </tr>
            )}
            {rows.map((ticket) => (
              <tr key={ticket.id}>
                <td>#{ticket.id}</td>
                <td>{formatAddress(ticket)}</td>
                <td>{ticket.building_name ?? '—'}</td>
                <td>{ticket.bandwidth ?? '—'}</td>
                <td>{ticket.commitment_period ?? '—'}</td>
                <td>{ticket.rental_charge ?? '—'}</td>
                <td>{tab === 'pending' ? ticket.created_at : ticket.approved_at}</td>
                {tab === 'pending' && (
                  <td>
                    <button
                      className="naas-admin-approve-btn"
                      disabled={approvingId === ticket.id}
                      onClick={() => handleApprove(ticket.id)}
                    >
                      {approvingId === ticket.id ? 'Approving…' : 'Approve'}
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
