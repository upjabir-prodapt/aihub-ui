import { useState } from 'react';
import type { InvoiceResult } from './types';
import './InvoiceCard.css';

// Drop your logo file here (any of these paths) — the card falls back to
// a text wordmark automatically until one exists, so nothing looks broken
// in the meantime.
const LOGO_SRC = '/colt-logo.svg';

function parseLineItem(raw: string): { label: string; value: string } {
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex === -1) return { label: raw, value: '' };
  return {
    label: raw.slice(0, separatorIndex).trim(),
    value: raw.slice(separatorIndex + 1).trim(),
  };
}

// Rendered by ChatPanel (via registry/chatExtras.tsx) as its own element
// above the chat bubble for the turn that called create_invoice — a
// dedicated document-style component, not a markdown table, per request.
export default function InvoiceCard({ invoice }: { invoice: InvoiceResult }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const isConfirmed = invoice.status.toLowerCase().includes('confirm');

  return (
    <div className="invoice-card">
      <div className="invoice-card-header">
        {logoFailed ? (
          <span className="invoice-card-wordmark">COLT</span>
        ) : (
          <img
            src={LOGO_SRC}
            alt="Colt"
            className="invoice-card-logo"
            onError={() => setLogoFailed(true)}
          />
        )}
        <div className="invoice-card-heading">
          <span className="invoice-card-title">Invoice</span>
          <span className="invoice-card-id">{invoice.invoice_id}</span>
        </div>
        <span
          className={`invoice-card-status invoice-card-status--${isConfirmed ? 'confirmed' : 'pending'}`}
        >
          {invoice.status}
        </span>
      </div>

      <div className="invoice-card-service">{invoice.service}</div>

      <table className="invoice-card-table">
        <tbody>
          {invoice.line_items.map((raw) => {
            const { label, value } = parseLineItem(raw);
            return (
              <tr key={label}>
                <th>{label}</th>
                <td>{value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
