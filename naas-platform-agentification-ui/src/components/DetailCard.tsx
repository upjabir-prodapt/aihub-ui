import './DetailCard.css';

interface DetailRow {
  label: string;
  value: string;
}

interface DetailCardProps {
  title: string;
  rows: DetailRow[];
}

export default function DetailCard({ title, rows }: DetailCardProps) {
  return (
    <div className="detail-card">
      <div className="detail-card-title">{title}</div>
      <dl className="detail-card-rows">
        {rows.map((row) => (
          <div className="detail-card-row" key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
