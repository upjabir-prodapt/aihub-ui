import type { LeftPanelProps } from '../../registry/leftPanels';
import type { SreMonitorState } from './types';
import DetailCard from '../../components/DetailCard';
import Gauge from '../../components/Gauge';
import StatCard from '../../components/StatCard';
import LineChart from '../../components/LineChart';
import './SreMonitorPanel.css';

// Fixed status palette (never themed) — see mcp-server's thresholds in
// agent_backend/agents/sre_monitor/prompt.md, which these mirror exactly.
const STATUS_GOOD = '#0ca30c';
const STATUS_WARNING = '#fab219';
const STATUS_CRITICAL = '#d03b3b';

// Where the gauge's colored zones change — the "Normal"/"Above Normal"
// TEXT label is still governed by UTIL_THRESHOLD alone (2-tier, matching
// the prompt's threshold rule), but the gauge's fill/track color is a
// finer 3-tier read (green/yellow/red) so the visual gives an earlier
// warning than the pass/fail label does on its own.
const UTIL_MID = 50;
const UTIL_THRESHOLD = 80;
const JITTER_THRESHOLD_MS = 30;

function utilizationColor(percent: number): string {
  if (percent >= UTIL_THRESHOLD) return STATUS_CRITICAL;
  if (percent >= UTIL_MID) return STATUS_WARNING;
  return STATUS_GOOD;
}

function utilizationStatus(percent: number): { label: string; color: string } {
  return {
    label: percent > UTIL_THRESHOLD ? 'Above Normal' : 'Normal',
    color: utilizationColor(percent),
  };
}

function jitterStatus(ms: number): { label: string; color: string } {
  if (ms > JITTER_THRESHOLD_MS) return { label: 'Degraded', color: STATUS_CRITICAL };
  if (ms >= 2) return { label: 'Elevated', color: STATUS_WARNING };
  return { label: 'Normal', color: STATUS_GOOD };
}

function formatPercent(percent: number): string {
  const rounded = Math.round(percent * 100) / 100;
  if (percent > 0 && rounded === 0) return '<0.01%';
  return `${rounded.toFixed(2)}%`;
}

// This agent's left panel: refreshes to whichever circuit the user most
// recently asked about in the chat (see AgentScreen's toolResults state).
export default function SreMonitorPanel({ toolResults }: LeftPanelProps) {
  const state = toolResults as SreMonitorState;
  const telemetry = state.get_circuit_telemetry;

  if (!telemetry) {
    return (
      <div className="sre-monitor-panel sre-monitor-panel--empty">
        <p>Select a circuit in the chat to see its live telemetry here.</p>
      </div>
    );
  }

  const circuit = state.list_active_circuits?.circuits.find(
    (c) => c.circuit_reference === telemetry.circuit_reference,
  );

  const util = telemetry.bandwidth_utilization;
  const jitter = telemetry.jitter;

  const utilPercent = util.available && util.percent !== undefined ? util.percent : null;
  const utilStatus = utilPercent !== null ? utilizationStatus(utilPercent) : null;

  const jitterMs = jitter.available && jitter.value_ms !== undefined ? jitter.value_ms : null;
  const jStatus = jitterMs !== null ? jitterStatus(jitterMs) : null;

  return (
    <div className="sre-monitor-panel">
      <DetailCard
        title={circuit?.name ?? telemetry.circuit_reference}
        rows={[
          { label: 'Circuit reference', value: telemetry.circuit_reference },
          { label: 'OCN', value: circuit?.ocn ?? '—' },
          {
            label: 'Current bandwidth',
            value: circuit?.bandwidth_mbps != null ? `${circuit.bandwidth_mbps} Mbps` : '—',
          },
          {
            label: 'Base bandwidth',
            value: circuit?.base_bandwidth_mbps != null ? `${circuit.base_bandwidth_mbps} Mbps` : '—',
          },
          { label: 'Connection type', value: circuit?.connection_type ?? '—' },
          { label: 'Resiliency', value: circuit?.resiliency ?? '—' },
          { label: 'Status', value: circuit?.status ?? '—' },
        ]}
      />

      {utilPercent !== null && utilStatus ? (
        <Gauge
          value={utilPercent}
          displayValue={formatPercent(utilPercent)}
          label="Bandwidth Utilization"
          statusColor={utilStatus.color}
          statusLabel={utilStatus.label}
          thresholdPercent={UTIL_THRESHOLD}
          zones={[
            { upTo: UTIL_MID, color: STATUS_GOOD },
            { upTo: UTIL_THRESHOLD, color: STATUS_WARNING },
            { upTo: 100, color: STATUS_CRITICAL },
          ]}
        />
      ) : (
        <div className="sre-monitor-unavailable">Bandwidth utilization unavailable</div>
      )}

      {/* Only the three duration periods carry a time series — "current"
          is a single live reading with nothing to plot. */}
      {util.data_points && util.data_points.length > 0 && (
        <LineChart
          title="Utilization Trend"
          dataPoints={util.data_points}
          unitSuffix="%"
          yDomain={[0, 100]}
        />
      )}

      {jitterMs !== null && jStatus ? (
        <StatCard
          label="Jitter"
          value={`${jitterMs.toFixed(2)} ms`}
          statusColor={jStatus.color}
          statusLabel={jStatus.label}
        />
      ) : (
        <div className="sre-monitor-unavailable">Jitter unavailable</div>
      )}

      {jitter.data_points && jitter.data_points.length > 0 && (
        <LineChart title="Jitter Trend" dataPoints={jitter.data_points} unitSuffix=" ms" />
      )}
    </div>
  );
}
