// Mirrors the JSON shapes returned by the Service Order Agent's tools
// (mcp-server/src/mcp_server/tools/{address,building,prices,connections}.py
// and agent-backend/agents/service_order/tools.py's create_ethernet_port),
// as they arrive in POST /chat's `tool_results`. Agent-specific — no other
// agent's frontend code depends on this file.

export interface Building {
  index: number;
  building_id: string;
  name: string;
  city: string;
  country: string;
  post_code: string;
  is_stub?: boolean;
}

export interface ListBuildingsResult {
  buildings: Building[];
  error?: string;
}

export interface SiteProduct {
  index: number;
  site_id: string;
  location_id: string;
  product_id: string;
  bandwidth: string;
  is_stub?: boolean;
}

export interface ListSitesResult {
  sites: SiteProduct[];
  any_available: boolean;
  error?: string;
}

export interface PriceOption {
  index: number;
  commitment_period: string;
  rental_charge: string;
  is_stub?: boolean;
}

export interface PriceOptionsResult {
  options: PriceOption[];
  error?: string;
}

export interface ConnectionPort {
  index: number;
  port_id: string;
  location: string;
  bandwidth: string;
  product_type: string;
}

export interface ListPortsResult {
  ports: ConnectionPort[];
  error?: string;
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

// agent-backend/agents/service_order/tools.py's start_service_order_flow —
// a marker, not Colt/DB data. `started_at` changes on every call (even a
// repeat of the same `flow`), which ServiceOrderPanel uses to detect "a
// flow just (re)started" and reset its diagram — see flowState.ts.
export interface StartFlowResult {
  flow: 'qualify' | 'port' | 'connection';
  started_at: string;
}

// Accumulated across turns by AgentScreen, same as SreMonitorState — a
// later turn's tool_results only ever adds/replaces one key at a time.
export interface ServiceOrderState {
  start_service_order_flow?: StartFlowResult;
  list_buildings_by_address?: ListBuildingsResult;
  list_building_sites?: ListSitesResult;
  get_ethernet_port_price?: PriceOptionsResult;
  get_ethernet_circuit_price?: PriceOptionsResult;
  list_connection_endpoint_ports?: ListPortsResult;
  // Same shape as list_connection_endpoint_ports — a distinct tool name
  // purely so the frontend knows to render the interactive port-search
  // picker for this call (see chatExtras.tsx / PortSearch.tsx) and not
  // for the quiet duplicate-port check that uses
  // list_connection_endpoint_ports instead.
  search_existing_ports?: ListPortsResult;
  create_ethernet_port?: CreatePortResult;
  create_invoice?: InvoiceResult;
}
