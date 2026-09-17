import type {
  AgentPublic,
  ChatRequest,
  CircuitRoute,
  DemoCircuit,
  ReliabilityAuditEntry,
  ReliabilityEvent,
  ReliabilityRule,
  ServiceOrderTicket,
} from './types';
// The standalone i18next instance (not the useTranslation() hook) — this
// module has no component/hook context to call it from. Only applied to
// the handful of these error messages that actually reach the user (via
// AgentScreen.tsx/Admin.tsx's setError or ChatPanel.tsx's onError); the
// rest are silently swallowed by every caller (.catch(() => {})) and so
// deliberately left as plain English — translating a string nothing ever
// displays isn't worth the noise.
import i18n from '../i18n';

// The only place the agent-backend's base URL is read from. Everything
// else in the app imports fetchAgents/postChatStream rather than calling
// fetch() directly, so the backend stays a swappable network peer.
const AGENT_BACKEND_URL =
  import.meta.env.VITE_AGENT_BACKEND_URL ?? 'http://127.0.0.1:8200';

export async function fetchAgents(): Promise<AgentPublic[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/agents`);
  if (!res.ok) {
    throw new Error(i18n.t('errors.loadAgentsFailed', { status: res.status }));
  }
  return res.json();
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

// POST /chat now streams Server-Sent Events (see api/chat.py) instead of
// returning one JSON body once the whole turn is done — a multi-tool-call
// turn otherwise buffered 10-15s of total silence before anything
// rendered. This reads the response body as a stream and dispatches each
// SSE frame to the matching handler as soon as it arrives; total turn
// time is unchanged, but the caller can render text/tool results
// progressively instead of waiting for all of it.
export async function postChatStream(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (err) {
    handlers.onError(i18n.t('errors.chatUnreachable', { message: (err as Error).message }));
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError(i18n.t('errors.chatRequestFailed', { status: res.status }));
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
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/pending`);
  if (!res.ok) {
    throw new Error(i18n.t('errors.loadPendingTicketsFailed', { status: res.status }));
  }
  return res.json();
}

export async function fetchTicketHistory(): Promise<ServiceOrderTicket[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/history`);
  if (!res.ok) {
    throw new Error(i18n.t('errors.loadTicketHistoryFailed', { status: res.status }));
  }
  return res.json();
}

export async function approveTicket(ticketId: number): Promise<ServiceOrderTicket> {
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/${ticketId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(i18n.t('errors.approveTicketFailed', { ticketId, status: res.status }));
  }
  return res.json();
}

// Service Reliability Agent — left-panel dashboard. Hits agent-backend's
// /reliability/* endpoints directly (bypassing chat), same convention as
// the admin ticket-approval calls above.
export async function fetchDemoCircuit(): Promise<DemoCircuit> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/demo-circuit`);
  if (!res.ok) {
    throw new Error(`Failed to load demo circuit (${res.status})`);
  }
  return res.json();
}

export async function simulateUtilizationHigh(): Promise<ReliabilityEvent> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/simulate/utilization-high`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(i18n.t('errors.simulateHighFailed', { status: res.status }));
  }
  return res.json();
}

export async function simulateUtilizationLow(): Promise<ReliabilityEvent> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/simulate/utilization-low`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(i18n.t('errors.simulateLowFailed', { status: res.status }));
  }
  return res.json();
}

export async function fetchReliabilityRules(): Promise<ReliabilityRule[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/rules`);
  if (!res.ok) {
    throw new Error(`Failed to load reliability rules (${res.status})`);
  }
  return res.json();
}

export async function fetchReliabilityEvents(): Promise<ReliabilityEvent[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/events`);
  if (!res.ok) {
    throw new Error(`Failed to load reliability events (${res.status})`);
  }
  return res.json();
}

export async function fetchReliabilityAuditLog(): Promise<ReliabilityAuditEntry[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/reliability/audit-log`);
  if (!res.ok) {
    throw new Error(`Failed to load reliability audit log (${res.status})`);
  }
  return res.json();
}

// Service Observability Agent — left-panel route map (CityMap). Bypasses
// chat/toolResults entirely, same convention as the Reliability endpoints
// above: the panel already knows which circuit's telemetry is on screen,
// so it fetches this directly rather than the agent needing to surface it.
export async function fetchCircuitRoute(circuitReference: string): Promise<CircuitRoute> {
  const res = await fetch(
    `${AGENT_BACKEND_URL}/circuits/${encodeURIComponent(circuitReference)}/route`,
  );
  if (!res.ok) {
    throw new Error(`Failed to load circuit route (${res.status})`);
  }
  return res.json();
}
