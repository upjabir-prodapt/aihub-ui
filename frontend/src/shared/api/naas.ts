import type {
  AgentPublic,
  ChatRequest,
  CircuitRoute,
  DemoCircuit,
  ReliabilityAuditEntry,
  ReliabilityEvent,
  ReliabilityRule,
  ServiceOrderTicket,
} from '../types/naas';
// The standalone i18next instance (not the useTranslation() hook) — this
// module has no component/hook context to call it from. Only applied to
// the handful of these error messages that actually reach the user (via
// NaasAgentScreen.tsx/NaasAdmin.tsx's setError or NaasChatPanel.tsx's
// onError); the rest are silently swallowed by every caller
// (.catch(() => {})) and so deliberately left as plain English —
// translating a string nothing ever displays isn't worth the noise.
import i18n from '../i18n';
import { apiFetch, ApiError, apiJson, apiPostJson } from './client';

export type {
  AgentPublic,
  ChatRequest,
  CircuitRoute,
  DemoCircuit,
  ReliabilityAuditEntry,
  ReliabilityEvent,
  ReliabilityRule,
  ServiceOrderTicket,
};

/**
 * Same-origin `/api/naas/v1/*`, proxied by the BFF to Apigee — same pattern
 * as Translation/Sales. There is no `VITE_AGENT_BACKEND_URL` any more: the
 * browser never learns the downstream Cloud Run URL, and 401/403/503
 * handling + the CSRF header are automatic via `apiFetch`/`apiJson`.
 */
const API_BASE = '/api/naas/v1';

export async function fetchAgents(): Promise<AgentPublic[]> {
  return await apiJson<AgentPublic[]>(`${API_BASE}/agents`, {
    errorMessage: 'Failed to load agents',
  });
}

export interface ChatStreamHandlers {
  // `agent` is which agent actually produced this text (event.author on
  // the backend) — attached to every text_delta, not just tool_result
  // events, so the frontend can tell who's talking even on a turn that
  // never calls a tool at all (e.g. a specialist's own clarifying
  // question before its first tool call). Undefined only if the backend
  // genuinely couldn't determine one (shouldn't happen once any event has
  // arrived this turn).
  onTextDelta: (text: string, agent?: string) => void;
  // `agent` is which agent actually produced this result (event.author on
  // the backend) — under the orchestrator (agent_id is always
  // "orchestrator" now) a turn can span multiple specialists via ADK's
  // transfer_to_agent, so this is how the frontend knows which one just
  // acted (e.g. to pick which left-panel to show).
  onToolResult: (name: string, data: unknown, agent: string) => void;
  onDone: (toolResults: Record<string, unknown>, agent?: string) => void;
  onError: (message: string) => void;
}

// POST /chat streams Server-Sent Events (see the naas-mcp agent-backend's
// api/chat.py) instead of returning one JSON body once the whole turn is
// done — a multi-tool-call turn otherwise buffered 10-15s of total silence
// before anything rendered. `apiFetch` returns the raw `Response` (same
// same-origin credentials + CSRF header it applies to every other call),
// so this reads the body as a stream and dispatches each SSE frame to the
// matching handler as soon as it arrives.
export async function postChatStream(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await apiFetch(`${API_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(request),
    });
  } catch (err) {
    // ApiError (and its 401/403/503 subclasses) already carry a sensible
    // message — a 401 has also triggered apiFetch's login redirect by the
    // time we get here. Anything else (offline, DNS failure) falls back to
    // the network-unreachable copy.
    if (err instanceof ApiError) {
      handlers.onError(err.message);
    } else {
      handlers.onError(i18n.t('errors.chatUnreachable', { message: (err as Error).message }));
    }
    return;
  }

  if (!res.body) {
    handlers.onError('Chat stream returned no response body');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line — buffer until a full
    // frame is available, since a network chunk can split mid-frame.
    let separatorIndex: number;
    while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawFrame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const dataLine = rawFrame.split('\n').find((line) => line.startsWith('data: '));
      if (!dataLine) continue;

      const event = JSON.parse(dataLine.slice('data: '.length));
      switch (event.type) {
        case 'text_delta':
          handlers.onTextDelta(event.text, event.agent);
          break;
        case 'tool_result':
          handlers.onToolResult(event.name, event.data, event.agent);
          break;
        case 'done':
          handlers.onDone(event.tool_results ?? {}, event.agent);
          break;
        case 'error':
          handlers.onError(event.message);
          break;
      }
    }
  }
}

export async function fetchPendingTickets(): Promise<ServiceOrderTicket[]> {
  return await apiJson<ServiceOrderTicket[]>(`${API_BASE}/admin/tickets/pending`, {
    errorMessage: 'Failed to load pending tickets',
  });
}

export async function fetchTicketHistory(): Promise<ServiceOrderTicket[]> {
  return await apiJson<ServiceOrderTicket[]>(`${API_BASE}/admin/tickets/history`, {
    errorMessage: 'Failed to load ticket history',
  });
}

export async function approveTicket(ticketId: number): Promise<ServiceOrderTicket> {
  return await apiPostJson<ServiceOrderTicket>(
    `${API_BASE}/admin/tickets/${ticketId}/approve`,
    undefined,
    { errorMessage: `Failed to approve ticket ${ticketId}` },
  );
}

// Service Reliability Agent — left-panel dashboard. Hits the naas-mcp
// agent-backend's /reliability/* endpoints directly (bypassing chat), same
// convention as the admin ticket-approval calls above.
export async function fetchDemoCircuit(): Promise<DemoCircuit> {
  return await apiJson<DemoCircuit>(`${API_BASE}/reliability/demo-circuit`, {
    errorMessage: 'Failed to load demo circuit',
  });
}

export async function simulateUtilizationHigh(): Promise<ReliabilityEvent> {
  return await apiPostJson<ReliabilityEvent>(
    `${API_BASE}/reliability/simulate/utilization-high`,
    undefined,
    { errorMessage: 'Failed to simulate high utilization' },
  );
}

export async function simulateUtilizationLow(): Promise<ReliabilityEvent> {
  return await apiPostJson<ReliabilityEvent>(
    `${API_BASE}/reliability/simulate/utilization-low`,
    undefined,
    { errorMessage: 'Failed to simulate low utilization' },
  );
}

export async function fetchReliabilityRules(): Promise<ReliabilityRule[]> {
  return await apiJson<ReliabilityRule[]>(`${API_BASE}/reliability/rules`, {
    errorMessage: 'Failed to load reliability rules',
  });
}

export async function fetchReliabilityEvents(): Promise<ReliabilityEvent[]> {
  return await apiJson<ReliabilityEvent[]>(`${API_BASE}/reliability/events`, {
    errorMessage: 'Failed to load reliability events',
  });
}

export async function fetchReliabilityAuditLog(): Promise<ReliabilityAuditEntry[]> {
  return await apiJson<ReliabilityAuditEntry[]>(`${API_BASE}/reliability/audit-log`, {
    errorMessage: 'Failed to load reliability audit log',
  });
}

// Service Observability Agent — left-panel route map (CityMap). Bypasses
// chat/toolResults entirely, same convention as the Reliability endpoints
// above: the panel already knows which circuit's telemetry is on screen,
// so it fetches this directly rather than the agent needing to surface it.
export async function fetchCircuitRoute(circuitReference: string): Promise<CircuitRoute> {
  return await apiJson<CircuitRoute>(
    `${API_BASE}/circuits/${encodeURIComponent(circuitReference)}/route`,
    { errorMessage: 'Failed to load circuit route' },
  );
}
