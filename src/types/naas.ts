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
}

export interface ChatResponse {
  agent_id: string;
  session_id: string;
  reply: string;
  // Structured result of each MCP tool called this turn, keyed by tool
  // name. Generic/untyped here — agent-specific screens narrow this to
  // their own tools' shapes (see e.g. src/agents/sre-monitor/types.ts).
  tool_results: Record<string, unknown>;
}

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
}
