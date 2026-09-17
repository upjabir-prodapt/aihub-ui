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
  // message (see ChatPanel.tsx) to seed which language the agent's reply
  // starts in; omit on every later turn so an in-chat "switch to X"
  // request keeps working exactly as before.
  language?: string;
}

// POST /chat now streams Server-Sent Events instead of returning one JSON
// body — see api/client.ts's postChatStream for the event shapes
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
