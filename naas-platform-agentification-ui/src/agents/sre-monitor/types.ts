// Mirrors the JSON shapes returned by two MCP tools
// (mcp-server/src/mcp_server/tools/{circuits,telemetry}.py), as they
// arrive in POST /chat's `tool_results`. list_active_circuits itself is
// shared — both the Service Observability Agent and the Service
// Reliability Agent call it (registry/chatExtras.tsx's CircuitRulesTable
// joins it against list_reliability_rules for the latter) — so
// CircuitSummary/ListActiveCircuitsResult aren't purely agent-specific
// even though this file lives under this agent's folder; the rest of this
// file (telemetry types) is.

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
  // Present in the raw tool result but not shown by this agent's own
  // CircuitTable — needed by the Service Reliability Agent's
  // CircuitRulesTable to join against a rule's own `connection_id` and to
  // compute a rule's target bandwidth.
  connection_id?: string;
  next_bandwidth_mbps?: number | null;
}

export interface ListActiveCircuitsResult {
  circuits: CircuitSummary[];
  error?: string;
}

export interface TimePeriodOption {
  index: number;
  period: string;
}

export interface PresentTimePeriodOptionsResult {
  periods: TimePeriodOption[];
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

// Accumulated across turns by ChatScreen (see mergeToolResults) — a later
// turn's get_circuit_telemetry-only response must not erase an earlier
// turn's circuit list, since the agent only calls list_active_circuits once
// per conversation.
export interface SreMonitorState {
  list_active_circuits?: ListActiveCircuitsResult;
  get_circuit_telemetry?: CircuitTelemetry;
  // Not MCP tool results — injected by agent-backend's run_turn
  // (core/telemetry_analysis.py) alongside get_circuit_telemetry: two
  // short, separately LLM-generated reads (trend, any spike, a
  // corrective note) — one for utilization, one for jitter, each shown
  // under its own gauge/chart rather than one combined blurb. Either can
  // be absent on its own (that metric was unavailable, or its generation
  // call failed) — the panel just omits that one section then.
  ai_analysis_utilization?: string;
  ai_analysis_jitter?: string;
}
