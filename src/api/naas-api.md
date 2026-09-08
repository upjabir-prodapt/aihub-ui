# NaaS Agent Backend API

Contract between this frontend and the naas-mcp agent-backend (Cloud Run
service `VITE_NAAS_AGENT_BACKEND_URL`). Implementation: `naasAgentApi.ts`
(this folder), `naasConfig.ts`, `naasCloudRunAuth.ts`. Types:
`src/types/naas.ts`, `src/types/serviceOrder.ts`, `src/types/sreMonitor.ts`.

## Base path & routing

The browser always calls the same-origin path `/api/naas/v1/...`
(`NAAS_API_BASE` in `naasConfig.ts`) — never the Cloud Run URL directly:

- **Dev**: Vite's proxy (`vite.config.ts`) forwards `/api/naas/v1/*` to
  `VITE_NAAS_AGENT_BACKEND_URL`, rewriting the path to strip the
  `/api/naas/v1` prefix (naas-mcp's own routes are bare `/agents`, `/chat`,
  `/admin/tickets/*` — no prefix of their own, unlike Translation/Sales).
- **Prod**: nginx does the same rewrite/proxy (`nginx/default.conf.template`,
  `location /api/naas/v1/`).
- **Mock**: `src/mocks/naasMockRouter.ts` intercepts the prefixed path
  directly, before either proxy is reached.

## Auth — two layers

Every request carries both:

1. **`Authorization: Bearer <Google Cloud Run ID token>`** — service-to-
   service auth proving this UI's backend/proxy may invoke the naas-mcp
   Cloud Run service. Audience = `VITE_NAAS_AGENT_BACKEND_URL`. Obtained via
   `naasCloudRunAuth.ts` (mirrors `salesCloudRunAuth.ts`/`cloudRunAuth.ts`),
   cached in `localStorage` (`naas_google_id_token`), refreshed on a timer
   or on 401/403.
2. **`colt_session` httpOnly cookie** (`credentials: 'include'`) — the human
   user's hub login session, the same cookie minted by Translation/Sales'
   `POST auth/token`. Identifies *who* is chatting/approving. Chat works
   without it (anonymous); ticket approval requires it — see below.

A 401/403 triggers one Cloud-Run-token refresh + retry (`fetchNaasWithAuth`
in `naasAgentApi.ts`); a second failure surfaces the error to the caller.

## Endpoints

### `GET /api/naas/v1/agents`

No body. Returns the available agents:

```ts
interface AgentPublic {
  id: string;              // 'service-order' | 'sre-monitor' | 'sre-closed-loop'
  display_name: string;
  description: string;
  frontend_route: string;
}
```

### `POST /api/naas/v1/chat`

```ts
interface ChatRequest {
  agent_id: string;
  message: string;
  session_id?: string;   // client-generated UUID, one per conversation
  user_id?: string;       // hub-session user's email, when logged in
}

interface ChatResponse {
  agent_id: string;
  session_id: string;
  reply: string;
  tool_results: Record<string, unknown>;  // keyed by MCP tool name — see below
}
```

`session_id` is generated client-side (`crypto.randomUUID()`) once per chat
screen mount and reused for every turn in that conversation. `user_id` is
the hub-session user's email (`AuthContext`'s `user.email`) when the visitor
is signed in, omitted otherwise — chat does not require login.

#### `tool_results` contract

One key per MCP tool the agent called this turn; accumulated turn-over-turn
by the frontend (a later turn only adds/replaces the keys it actually
called). Shapes are agent-specific:

- **`service-order`** (`ServiceOrderState`, `src/types/serviceOrder.ts`):
  `start_service_order_flow`, `list_buildings_by_address`,
  `list_building_sites`, `get_ethernet_port_price`,
  `get_ethernet_circuit_price`, `list_connection_endpoint_ports`,
  `search_existing_ports`, `create_ethernet_port`, `create_invoice`.
- **`sre-monitor`** (`SreMonitorState`, `src/types/sreMonitor.ts`):
  `list_active_circuits`, `get_circuit_telemetry`.

### `GET /api/naas/v1/admin/tickets/pending`

No body. Returns `ServiceOrderTicket[]` with `status: 'pending'`.

### `GET /api/naas/v1/admin/tickets/history`

No body. Returns `ServiceOrderTicket[]` with `status: 'approved'`.

```ts
interface ServiceOrderTicket {
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
```

### `POST /api/naas/v1/admin/tickets/{ticketId}/approve`

No body. Returns the updated `ServiceOrderTicket` (`status: 'approved'`,
`approved_at` set).

**Requires a signed-in hub session** — the frontend disables the Approve
button and blocks the call when `useAuth().isAuthenticated` is false
(`src/pages/NaaSAdmin.tsx`). This is a frontend-side gate today; end-to-end
enforcement additionally requires the naas-mcp backend itself to validate
the `colt_session` cookie (or an equivalent `HUB_IAP_AUDIENCE`-style
fallback), the same way Translation/Sales' `iap_auth.py` does — that
backend-side check is out of this repo's scope and needs to be confirmed
with the agent-backend team.

## Errors

Non-2xx responses throw `Error(<message> (HTTP <status>))` from
`naasAgentApi.ts`'s functions (no structured error-body parsing today,
unlike `parseSalesApiError` on the Sales side). A 401/403 is retried once
after a forced token refresh before surfacing.
