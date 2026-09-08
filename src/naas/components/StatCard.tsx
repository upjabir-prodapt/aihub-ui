import './StatCard.css';

interface StatCardProps {
  label: string;
  value: string;
  statusColor?: string;
  statusLabel?: string;
}

export default function StatCard({ label, value, statusColor, statusLabel }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {statusColor && statusLabel && (
        <div className="stat-card-status">
          <span className="stat-card-status-dot" style={{ background: statusColor }} aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      )}
    </div>
  );
}
