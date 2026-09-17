import './Gauge.css';

interface GaugeZone {
  /** This zone covers the range up to (and not including) the previous
   * zone's `upTo`, through this one's `upTo`. Zones must be given in
   * ascending order and the last one should end at 100. */
  upTo: number;
  color: string;
}

interface GaugeProps {
  /** 0-100, drives needle position and arc fill. Clamped internally. */
  value: number;
  /** Preformatted center text, e.g. "57.64%" or "<0.01%". */
  displayValue: string;
  label: string;
  statusColor: string;
  statusLabel: string;
  /** Where the "normal" zone ends, 0-100. Drawn as a reference tick. */
  thresholdPercent?: number;
  /** Optional background reference bands (e.g. green/yellow/red), drawn
   * under the value fill so the scale itself hints at severity even
   * before reading the needle position. Omit for a plain neutral track. */
  zones?: GaugeZone[];
}

const CX = 108;
const CY = 104;
const RADIUS = 78;
const STROKE_WIDTH = 16;
const SCALE_TICKS = [0, 25, 50, 75, 100];

function pointOnArc(percent: number, radius: number) {
  const angleDeg = 180 - (Math.max(0, Math.min(100, percent)) / 100) * 180;
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(angleRad), y: CY - radius * Math.sin(angleRad) };
}

function arcPath(fromPercent: number, toPercent: number, radius: number): string {
  const start = pointOnArc(fromPercent, radius);
  const end = pointOnArc(toPercent, radius);
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

export default function Gauge({
  value,
  displayValue,
  label,
  statusColor,
  statusLabel,
  thresholdPercent = 80,
  zones,
}: GaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const fillPath = clamped > 0.05 ? arcPath(0, clamped, RADIUS) : null;
  const needleTip = pointOnArc(clamped, RADIUS * 0.8);

  const tickInner = pointOnArc(thresholdPercent, RADIUS - STROKE_WIDTH / 2 - 3);
  const tickOuter = pointOnArc(thresholdPercent, RADIUS + STROKE_WIDTH / 2 + 3);

  let zoneStart = 0;
  const zoneSegments = zones?.map((zone) => {
    const segment = { from: zoneStart, to: zone.upTo, color: zone.color };
    zoneStart = zone.upTo;
    return segment;
  });

  return (
    <div className="gauge-card">
      <div className="gauge-card-title">{label}</div>
      <svg viewBox="0 0 216 128" className="gauge-svg">
        {zoneSegments ? (
          zoneSegments.map((segment) => (
            <path
              key={segment.to}
              d={arcPath(segment.from, segment.to, RADIUS)}
              stroke={segment.color}
              strokeWidth={STROKE_WIDTH}
              fill="none"
              className="gauge-zone"
            />
          ))
        ) : (
          <path d={arcPath(0, 100, RADIUS)} className="gauge-track" strokeWidth={STROKE_WIDTH} fill="none" />
        )}
        {fillPath && (
          <path
            d={fillPath}
            stroke={statusColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            fill="none"
          />
        )}
        <line
          x1={tickInner.x}
          y1={tickInner.y}
          x2={tickOuter.x}
          y2={tickOuter.y}
          className="gauge-threshold-tick"
        />
        {SCALE_TICKS.map((tick) => {
          const pos = pointOnArc(tick, RADIUS + STROKE_WIDTH / 2 + 12);
          return (
            <text key={tick} x={pos.x} y={pos.y} className="gauge-scale-label" textAnchor="middle" dy="0.32em">
              {tick}
            </text>
          );
        })}
        <line x1={CX} y1={CY} x2={needleTip.x} y2={needleTip.y} className="gauge-needle" />
        <circle cx={CX} cy={CY} r={6} className="gauge-hub" />
      </svg>
      <div className="gauge-value">{displayValue}</div>
      <div className="gauge-status">
        <span className="gauge-status-dot" style={{ background: statusColor }} aria-hidden="true" />
        <span>{statusLabel}</span>
      </div>
    </div>
  );
}
