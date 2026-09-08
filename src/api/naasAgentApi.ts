import type { AgentPublic, ChatRequest, ChatResponse, ServiceOrderTicket } from '../types/naas';
import {
  ensureFreshNaasGoogleIdToken,
  forceRefreshNaasGoogleIdToken,
} from './naasCloudRunAuth';
import { NAAS_API_BASE } from './naasConfig';

// Same-origin base — nginx (prod) / Vite (dev, vite.config.ts) proxy this to
// the naas-mcp agent-backend's Cloud Run URL, or vitePluginMock.ts's
// middleware intercepts it directly in mock mode. See naasConfig.ts.
const AGENT_BACKEND_URL = NAAS_API_BASE;

/**
 * Authorization: Bearer <Google OIDC> — Cloud Run IAM (nginx → X-Serverless-Authorization).
 * The human-user session travels via the httpOnly `colt_session` cookie
 * automatically once `credentials: 'include'` is set (see fetchNaasWithAuth).
 */
async function naasAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const googleIdToken = await ensureFreshNaasGoogleIdToken();
  return {
    accept: 'application/json',
    ...(googleIdToken ? { Authorization: `Bearer ${googleIdToken}` } : {}),
    ...extra,
  };
}

async function fetchNaasWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  let response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: { ...(await naasAuthHeaders()), ...init.headers },
  });

  if (response.status === 401 || response.status === 403) {
    await forceRefreshNaasGoogleIdToken();
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers: { ...(await naasAuthHeaders()), ...init.headers },
    });
  }

  return response;
}

export async function fetchAgents(): Promise<AgentPublic[]> {
  const res = await fetchNaasWithAuth(`${AGENT_BACKEND_URL}/agents`);
  if (!res.ok) {
    throw new Error(`Failed to load agents (${res.status})`);
  }
  return res.json();
}

export async function postChat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetchNaasWithAuth(`${AGENT_BACKEND_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Chat request failed (${res.status})`);
  }
  return res.json();
}

export async function fetchPendingTickets(): Promise<ServiceOrderTicket[]> {
  const res = await fetchNaasWithAuth(`${AGENT_BACKEND_URL}/admin/tickets/pending`);
  if (!res.ok) {
    throw new Error(`Failed to load pending tickets (${res.status})`);
  }
  return res.json();
}

export async function fetchTicketHistory(): Promise<ServiceOrderTicket[]> {
  const res = await fetchNaasWithAuth(`${AGENT_BACKEND_URL}/admin/tickets/history`);
  if (!res.ok) {
    throw new Error(`Failed to load ticket history (${res.status})`);
  }
  return res.json();
}

export async function approveTicket(ticketId: number): Promise<ServiceOrderTicket> {
  const res = await fetchNaasWithAuth(`${AGENT_BACKEND_URL}/admin/tickets/${ticketId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to approve ticket ${ticketId} (${res.status})`);
  }
  return res.json();
}
