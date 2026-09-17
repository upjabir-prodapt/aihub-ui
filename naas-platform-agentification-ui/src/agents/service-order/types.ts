// Mirrors the JSON shapes returned by the Service Order Agent's tools
// (mcp-server/src/mcp_server/tools/connections.py and
// agent-backend/agents/service_order/tools.py), as they arrive in
// POST /chat's `tool_results`. Agent-specific — no other agent's frontend
// code depends on this file.

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

// Accumulated across turns by ChatScreen, same as SreMonitorState — a
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
