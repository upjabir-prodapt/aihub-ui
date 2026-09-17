// Mirrors agent_backend.registry.models.AgentPublic — the subset of the
// registry (registry/agents.yaml) the backend exposes over GET /agents.
// This is the ONLY copy of agent metadata on the frontend; there is no
// parallel agents list in TS to keep in sync.
export interface AgentPublic {
  id: string;
  display_name: string;
  description: string;
  frontend_route: string;
}

export interface ChatRequest {
  agent_id: string;
  message: string;
  session_id?: string;
  user_id?: string;
  // Landing page's language selector — send only on a session's first
  // message (see NaasChatPanel.tsx) to seed which language the agent's
  // reply starts in; omit on every later turn so an in-chat "switch to X"
  // request keeps working exactly as before.
  language?: string;
}

// POST /chat now streams Server-Sent Events instead of returning one JSON
// body — see shared/api/naas.ts's postChatStream for the event shapes
// ("text_delta" | "tool_result" | "done" | "error") consumed there.

// Mirrors agent_backend.agents.service_order.db's port_tickets row shape,
// as returned by GET/POST /admin/tickets/*.
export interface ServiceOrderTicket {
  id: number;
  created_at: string;
  city: string | null;
  country: string | null;
  post_code: string | null;
  building_id: string | null;
  building_name: string | null;
  location_id: string | null;
  product_id: string | null;
  bandwidth: string | null;
  commitment_period: string | null;
  rental_charge: string | null;
  status: 'pending' | 'approved';
  approved_at: string | null;
  product_type: 'ethernet_port' | 'offnet_port' | 'offnet_modification';
}

// Mirrors agent_backend.reliability_db's 3 tables, as returned by
// GET /reliability/*. Used by SreClosedLoopPanel (Service Reliability
// Agent's left panel) to show the background poller acting on a
// simulated event without needing to go through chat.
export interface ReliabilityRule {
  id: number;
  connection_id: string;
  circuit_reference: string;
  base_bandwidth_mbps: number | null;
  next_bandwidth_mbps: number | null;
  increase_threshold_pct: number;
  decrease_threshold_pct: number;
  current_bandwidth_mbps: number | null;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
  updated_at: string;
}

export interface ReliabilityEvent {
  id: number;
  connection_id: string;
  circuit_reference: string;
  event_type: 'UTILIZATION_HIGH' | 'UTILIZATION_LOW';
  status: 'PENDING' | 'CLAIMED' | 'PROCESSED' | 'IGNORED';
  created_at: string;
  processed_at: string | null;
}

export interface ReliabilityAuditEntry {
  id: number;
  connection_id: string;
  circuit_reference: string;
  event_id: number | null;
  rule_id: number | null;
  action: 'INCREASE' | 'DECREASE' | 'NO_ACTION';
  previous_bandwidth_mbps: number | null;
  new_bandwidth_mbps: number | null;
  triggered_by: 'MANUAL_CONFIRM' | 'MONITORING_EVENT';
  colt_request_url: string | null;
  status: 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT';
  created_at: string;
  completed_at: string | null;
  rental_charge: string | null;
}

export interface DemoCircuit {
  // Both null when no Reliability Rule exists yet for any circuit — see
  // SreClosedLoopPanel.tsx, which disables the Simulate buttons in that
  // state instead of offering a target with no rule to act on.
  circuit_reference: string | null;
  name: string | null;
}

// Mirrors GET /circuits/{circuit_reference}/route's response shape — a
// circuit's two physical Ethernet Port endpoints, for the Service
// Observability Agent's left-panel route map (see components/CityMap.tsx).
export interface CircuitEndpointLocation {
  city: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface CircuitRoute {
  from: CircuitEndpointLocation;
  to: CircuitEndpointLocation;
}

// ── Service Order Agent ──────────────────────────────────────────────────
// Mirrors the JSON shapes returned by the Service Order Agent's tools
// (mcp-server/src/mcp_server/tools/connections.py and
// agent-backend/agents/service_order/tools.py), as they arrive in
// POST /chat's `tool_results`. Agent-specific — no other agent's frontend
// code depends on these.

export interface ConnectionPort {
  index: number;
  port_id: string;
  // Shown to the user in place of `location` (see PortSearch.tsx) —
  // `location` stays in the data for the duplicate-port cross-check and
  // for search filtering, it's just not the visible label anymore.
  port_name: string;
  // Distinct real fields (the real API nests both inside one "address"
  // object) — shown as separate table columns in Flow E's Inventory
  // Check step, alongside port_name; no bandwidth column there since a
  // Connection's bandwidth comes from the Bandwidth Recommendation step,
  // not an existing port's current one.
  building_name: string;
  site_name: string;
  city: string;
  location: string;
  bandwidth: string;
  product_type: string;
  // Real Colt field (e.g. "ON_NET") — the actual, definitive Onnet/Offnet
  // signal for this port, not a guess.
  access_type: string;
  // Real fields — whether this port's VLAN config can be changed at all,
  // and the VLANs already configured on it (empty if none). Flow E's
  // Ethernet path shows these instead of asking for a VLAN Type/ID from
  // scratch when a picked existing port already has some.
  vlan_configuration_allowed: boolean;
  vlans: { vlan_id: string; vlan_type: string }[];
  // Real coordinates when the live Colt response has them, else null —
  // for the left panel's map (ServiceOrderPanel.tsx's ConnectionMap,
  // wrapping the shared CityMap component) only, never a business
  // decision input. The model reads these off a matched row here and
  // passes them straight through to update_order_summary's
  // source_lat/source_lng/destination_lat/destination_lng.
  latitude: number | null;
  longitude: number | null;
}

export interface ListPortsResult {
  ports: ConnectionPort[];
  error?: string;
}

// mcp-server/tools/address.py's list_buildings_by_address. Rendered by
// BuildingSearch.tsx as a clickable picker, not a markdown table.
export interface BuildingCandidate {
  index: number;
  building_id: string;
  name: string;
  city: string;
  country: string;
  post_code: string;
  is_stub: boolean;
  is_fttx: boolean;
}

export interface ListBuildingsResult {
  buildings: BuildingCandidate[];
  is_empty?: boolean;
  error?: string;
  invalid_input?: string;
}

// mcp-server/tools/offnet.py's list_offnet_bandwidths and
// mcp-server/tools/comcast.py's list_comcast_bandwidths — same shape for
// both. Rendered by BandwidthOptions.tsx as a clickable picker.
export interface BandwidthCandidate {
  index: number;
  bandwidth_mbps: number;
  is_stub?: boolean;
}

export interface ListBandwidthsResult {
  bandwidths: BandwidthCandidate[];
}

export interface CreatePortResult {
  ticket_id: number;
  building_name: string;
  location_id: string;
}

// agent-backend/agents/service_order/tools.py's create_invoice. Rendered
// by InvoiceCard.tsx as a dedicated component, not plain chat markdown.
// `line_items` entries are "Label: Value" strings — InvoiceCard splits on
// the first colon.
export interface InvoiceResult {
  invoice_id: string;
  service: string;
  status: string;
  line_items: string[];
}

// Shared shape across every pricing tool (mcp-server/tools/prices.py,
// offnet.py, fttx.py, comcast.py) — all return an ascending-by-commitment
// `options` list. Field names vary slightly by connectivity type: new-port
// pricing uses `commitment_period`/`rental_charge`; Offnet's modification
// options (get_offnet_port_mod_options) use `contract_term` instead and
// have no `rental_charge`. Rendered by PricingOptions.tsx as a clickable
// single-select picker, not a markdown table.
export interface PricingOption {
  index: number;
  bandwidth?: string;
  commitment_period?: string;
  contract_term?: string;
  rental_charge?: string;
  is_stub?: boolean;
}

export interface PricingOptionsResult {
  options: PricingOption[];
  error?: string;
}

// Shared shape for agent-backend/agents/service_order/tools.py's
// present_bandwidth_recommendation and present_commitment_recommendation.
// The tool call itself is a pure passthrough (no Colt call of its own,
// same as preview_invoice) — but the model populates `reason` from real
// data it already fetched (real per-user bandwidth math against the
// real bandwidth ceiling, or real commitment-period price differences),
// never an invented figure. Rendered by RecommendationOptions.tsx as a
// clickable table (the recommended value tagged, alternatives as other
// rows) instead of the freeform prose template the model used to write
// itself.
export interface RecommendationResult {
  recommended: string;
  reason: string;
  alternatives: string[];
  // Only present_commitment_recommendation sets these today (real rental
  // charge per term, same order as recommended/alternatives) —
  // present_bandwidth_recommendation never does, so RecommendationOptions
  // only renders a Price column when recommended_price is present.
  recommended_price?: string;
  alternative_prices?: string[];
}

// agent-backend/agents/service_order/tools.py's start_service_order_flow —
// a marker, not Colt/DB data. `started_at` changes on every call (even a
// repeat of the same `flow`), which ServiceOrderPanel uses to detect "a
// flow just (re)started" and reset its order summary.
export interface StartFlowResult {
  flow: 'qualify' | 'port' | 'modify_offnet' | 'circuit';
  started_at: string;
}

// agent-backend/agents/service_order/tools.py's update_order_summary —
// purely a display signal, not Colt/DB data. Each call *replaces* the
// whole thing (the agent always resends every field already known, not
// just the newest one — see the tool's own docstring), so the latest
// value is always the complete current summary; no accumulation needed
// on this side. `order_type` says which shape of fields is meaningful:
// "port" -> location/bandwidth/price, "connection" ->
// source_port/destination_port/bandwidth/commitment_period.
// `ip_assignment`/`vlan_type`/`vlan_id` are Flow E-only (unified DIA-or-
// Ethernet circuit ordering) — DIA sets ip_assignment, Ethernet sets
// vlan_type/vlan_id — shown alongside either order_type when present.
export interface OrderSummaryResult {
  order_type: 'port' | 'connection';
  location?: string;
  source_port?: string;
  destination_port?: string;
  bandwidth?: string;
  commitment_period?: string;
  price?: string;
  ip_assignment?: string;
  vlan_type?: string;
  vlan_id?: string;
  // Connection orders only — plots each port on the left panel's map
  // (ServiceOrderPanel.tsx's ConnectionMap). Either pair can be absent
  // (e.g. a brand-new port geocode_port_location couldn't resolve), in
  // which case that marker just doesn't render.
  source_lat?: number;
  source_lng?: number;
  destination_lat?: number;
  destination_lng?: number;
  // Hover label for each marker.
  source_city?: string;
  destination_city?: string;
}

// Accumulated across turns by NaasChatScreen, same as SreMonitorState — a
// later turn's tool_results only ever adds/replaces one key at a time.
export interface ServiceOrderState {
  start_service_order_flow?: StartFlowResult;
  update_order_summary?: OrderSummaryResult;
  list_connection_endpoint_ports?: ListPortsResult;
  // Same shape as list_connection_endpoint_ports — a distinct tool name
  // purely so the frontend knows to render the interactive port-search
  // picker for this call (see chatExtras.tsx / PortSearch.tsx) and not
  // for the quiet duplicate-port check that uses
  // list_connection_endpoint_ports instead.
  search_existing_ports?: ListPortsResult;
  // Same shape/picker as search_existing_ports (present_port_matches is a
  // passthrough tool that hands PortSearch.tsx the LLM's already-filtered
  // Existing Port Inventory Check matches) — see chatExtras.tsx.
  present_port_matches?: ListPortsResult;
  // Location Classification's building lookup — see BuildingSearch.tsx.
  list_buildings_by_address?: ListBuildingsResult;
  // Comcast-Offnet's candidate-port step — same shape as ListPortsResult
  // (a subset of ConnectionPort's fields), reuses PortSearch.tsx's
  // picker rather than a new component. Colt-Offnet has no equivalent —
  // create_offnet_location is itself a simulation, so there's no real
  // "site" inventory to list candidates from.
  list_comcast_port_candidates?: ListPortsResult;
  // Colt-Offnet/Comcast-Offnet's bandwidth-selection step — see
  // BandwidthOptions.tsx.
  list_offnet_bandwidths?: ListBandwidthsResult;
  list_comcast_bandwidths?: ListBandwidthsResult;
  create_ethernet_port?: CreatePortResult;
  create_invoice?: InvoiceResult;
  preview_invoice?: InvoiceResult;
  present_bandwidth_recommendation?: RecommendationResult;
  present_commitment_recommendation?: RecommendationResult;
  // One of these is present on whichever turn called a pricing tool —
  // same "only one of N ever appears on a given turn" pattern as
  // create_invoice/preview_invoice above.
  get_ethernet_port_price?: PricingOptionsResult;
  get_dia_price?: PricingOptionsResult;
  get_ethernet_circuit_price?: PricingOptionsResult;
  get_offnet_port_price?: PricingOptionsResult;
  get_fttx_price?: PricingOptionsResult;
  get_comcast_port_price?: PricingOptionsResult;
  get_offnet_port_mod_options?: PricingOptionsResult;
}

// ── SRE Monitor / Closed-Loop Agents ─────────────────────────────────────
// Mirrors the JSON shapes returned by two MCP tools
// (mcp-server/src/mcp_server/tools/{circuits,telemetry}.py), as they
// arrive in POST /chat's `tool_results`. list_active_circuits itself is
// shared — both the Service Observability Agent and the Service
// Reliability Agent call it (registry/chatExtras.tsx's CircuitRulesTable
// joins it against list_reliability_rules for the latter).

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

// Accumulated across turns by NaasChatScreen (see mergeToolResults) — a
// later turn's get_circuit_telemetry-only response must not erase an
// earlier turn's circuit list, since the agent only calls
// list_active_circuits once per conversation.
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
