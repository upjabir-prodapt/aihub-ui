import type { AgentPublic, ChatRequest, ChatResponse, ServiceOrderTicket } from './types';

// The only place the agent-backend's base URL is read from. Everything
// else in the app imports fetchAgents/postChat rather than calling
// fetch() directly, so the backend stays a swappable network peer.
const AGENT_BACKEND_URL =
  import.meta.env.VITE_NAAS_AGENT_BACKEND_URL ?? 'http://127.0.0.1:8200';

export async function fetchAgents(): Promise<AgentPublic[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/agents`);
  if (!res.ok) {
    throw new Error(`Failed to load agents (${res.status})`);
  }
  return res.json();
}

export async function postChat(request: ChatRequest): Promise<ChatResponse> {
  const res = await fetch(`${AGENT_BACKEND_URL}/chat`, {
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
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/pending`);
  if (!res.ok) {
    throw new Error(`Failed to load pending tickets (${res.status})`);
  }
  return res.json();
}

export async function fetchTicketHistory(): Promise<ServiceOrderTicket[]> {
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/history`);
  if (!res.ok) {
    throw new Error(`Failed to load ticket history (${res.status})`);
  }
  return res.json();
}

export async function approveTicket(ticketId: number): Promise<ServiceOrderTicket> {
  const res = await fetch(`${AGENT_BACKEND_URL}/admin/tickets/${ticketId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to approve ticket ${ticketId} (${res.status})`);
  }
  return res.json();
}
