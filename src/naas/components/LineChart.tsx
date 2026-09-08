import { useMemo, useState, type MouseEvent } from 'react';
import './LineChart.css';

interface DataPoint {
  timestamp: string;
  value: number;
}

interface LineChartProps {
  title: string;
  dataPoints: DataPoint[];
  /** Appended after the number in axis labels and the tooltip, e.g. "%" or " ms". */
  unitSuffix: string;
  /** Fixed y-axis domain (e.g. [0, 100] for a percent chart). Omitted = auto-scale to data. */
  yDomain?: [number, number];
  color?: string;
}

const WIDTH = 320;
const HEIGHT = 150;
const PADDING = { top: 12, right: 12, bottom: 24, left: 34 };
const TICK_COUNT = 4;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function formatTick(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTooltipDate(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Hand-built (no charting library) to match Gauge's approach — a single
// series (this app's brand teal, per the dataviz skill's "one hue" rule
// for a lone trend line) with a crosshair + tooltip per the skill's
// interaction spec (an HTML/SVG chart is interactive by default).
export default function LineChart({
  title,
  dataPoints,
  unitSuffix,
  yDomain,
  color = '#00D7BD',
}: LineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;

  const [minY, maxY] = useMemo<[number, number]>(() => {
    if (yDomain) return yDomain;
    if (dataPoints.length === 0) return [0, 1];
    const max = Math.max(...dataPoints.map((p) => p.value), 0);
    return [0, niceMax(max * 1.15)];
  }, [dataPoints, yDomain]);

  const xForIndex = (i: number) =>
    dataPoints.length <= 1
      ? PADDING.left
      : PADDING.left + (i / (dataPoints.length - 1)) * plotWidth;
  const yForValue = (v: number) =>
    PADDING.top + plotHeight - ((v - minY) / (maxY - minY || 1)) * plotHeight;

  const linePath = dataPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xForIndex(i)} ${yForValue(p.value)}`)
    .join(' ');
  const areaPath =
    dataPoints.length > 0
      ? `${linePath} L ${xForIndex(dataPoints.length - 1)} ${PADDING.top + plotHeight} L ${xForIndex(0)} ${PADDING.top + plotHeight} Z`
      : '';

  const yTicks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => minY + ((maxY - minY) * i) / TICK_COUNT);

  const tickIndices =
    dataPoints.length > 1
      ? Array.from({ length: 5 }, (_, i) => Math.round((i / 4) * (dataPoints.length - 1)))
      : dataPoints.length === 1
        ? [0]
        : [];

  function handleMove(e: MouseEvent<SVGRectElement>) {
    if (dataPoints.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, relativeX / rect.width));
    const index = Math.round(ratio * (dataPoints.length - 1));
    setHoverIndex(index);
  }

  const hovered = hoverIndex !== null ? dataPoints[hoverIndex] : null;
  const tooltipOnRight = hoverIndex !== null && hoverIndex > dataPoints.length / 2;

  return (
    <div className="line-chart-card">
      <div className="line-chart-title">{title}</div>
      {dataPoints.length === 0 ? (
        <div className="line-chart-empty">No data available for this window.</div>
      ) : (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="line-chart-svg"
          onMouseLeave={() => setHoverIndex(null)}
        >
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={yForValue(tick)}
                y2={yForValue(tick)}
                className="line-chart-gridline"
              />
              <text x={PADDING.left - 6} y={yForValue(tick)} className="line-chart-axis-label" textAnchor="end" dy="0.32em">
                {Math.round(tick)}
              </text>
            </g>
          ))}

          {tickIndices.map((i) => (
            <text
              key={i}
              x={xForIndex(i)}
              y={HEIGHT - 6}
              className="line-chart-axis-label"
              textAnchor="middle"
            >
              {formatTick(dataPoints[i].timestamp)}
            </text>
          ))}

          <path d={areaPath} fill={color} className="line-chart-area" />
          <path d={linePath} fill="none" stroke={color} className="line-chart-line" />

          {hovered && hoverIndex !== null && (
            <>
              <line
                x1={xForIndex(hoverIndex)}
                x2={xForIndex(hoverIndex)}
                y1={PADDING.top}
                y2={PADDING.top + plotHeight}
                className="line-chart-crosshair"
              />
              <circle
                cx={xForIndex(hoverIndex)}
                cy={yForValue(hovered.value)}
                r={4}
                fill={color}
                className="line-chart-dot"
              />
            </>
          )}

          {/* Transparent hit area spanning the full plot, on top */}
          <rect
            x={PADDING.left}
            y={PADDING.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onMouseMove={handleMove}
          />
        </svg>
      )}

      {hovered && (
        <div
          className="line-chart-tooltip"
          style={{ [tooltipOnRight ? 'right' : 'left']: '0.75rem' }}
        >
          <div className="line-chart-tooltip-value">
            {hovered.value.toFixed(2)}
            {unitSuffix}
          </div>
          <div className="line-chart-tooltip-date">{formatTooltipDate(hovered.timestamp)}</div>
        </div>
      )}
    </div>
  );
}
