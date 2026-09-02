interface PlaceholderPanelProps {
  label: string;
}

export default function PlaceholderPanel({ label }: PlaceholderPanelProps) {
  return (
    <div className="placeholder-panel">
      <p>{label}</p>
    </div>
  );
}
