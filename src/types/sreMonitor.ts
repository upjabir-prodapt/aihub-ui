// Mirrors the JSON shapes returned by the SRE Agent - Monitor's two MCP
// tools (mcp-server/src/mcp_server/tools/{circuits,telemetry}.py), as they
// arrive in POST /chat's `tool_results`. Agent-specific — no other agent's
// frontend code depends on this file.

export interface CircuitSummary {
  index: number;
  name: string;
  circuit_reference: string;
  bandwidth_mbps: number | null;
  base_bandwidth_mbps: number | null;
  connection_type: string;
  resiliency: string;
  status: string;
  ocn: string;
}

export interface ListActiveCircuitsResult {
  circuits: CircuitSummary[];
  error?: string;
}

export type TelemetryPeriod = 'current' | 'last_1_day' | 'last_7_days' | 'last_30_days';

export interface TelemetryDataPoint {
  timestamp: string;
  value: number;
}

export interface BandwidthUtilization {
  available: boolean;
  percent?: number;
  raw_value_bps?: number;
  // Only present for the three duration periods (not "current") — the
  // full time series for the left-panel chart, already converted to %.
  data_points?: TelemetryDataPoint[];
  error?: string;
}

export interface JitterReading {
  available: boolean;
  value_ms?: number;
  // Only present for the three duration periods (not "current").
  data_points?: TelemetryDataPoint[];
  error?: string;
}

export interface CircuitTelemetry {
  circuit_reference: string;
  ocn: string;
  period: TelemetryPeriod;
  window_start_utc: string;
  bandwidth_utilization: BandwidthUtilization;
  jitter: JitterReading;
}

// Accumulated across turns by AgentScreen (see mergeToolResults) — a later
// turn's get_circuit_telemetry-only response must not erase an earlier
// turn's circuit list, since the agent only calls list_active_circuits once
// per conversation.
export interface SreMonitorState {
  list_active_circuits?: ListActiveCircuitsResult;
  get_circuit_telemetry?: CircuitTelemetry;
}
