import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './translationMockRouter.ts';
import { mockNaasManager } from './mockNaasManager.ts';
import type { AgentPublic, ChatRequest, ChatResponse } from '../types/naas.ts';

// Basic stub for the agent-backend (naas-mcp) API — see src/api/naasAgentApi.ts.
// Returns plain canned replies with empty tool_results, so agent-specific
// panels (ServiceOrderPanel, SreMonitorPanel) stay in their empty state.
// Not a simulation of the real ADK orchestrator/MCP tool flow.
//
// Paths are prefixed /api/naas/v1/... (matching the same-origin path the
// browser calls, see naasConfig.ts), even though naas-mcp's own real routes
// are bare /agents, /chat, /admin/tickets/* — the prefix is stripped by
// vite.config.ts's proxy rewrite / nginx in the non-mock case, so the mock
// here matches what the browser actually requests.
const MOCK_AGENTS: AgentPublic[] = [
  {
    id: 'service-order',
    display_name: 'Service Order',
    description: 'Qualify addresses and order Ethernet ports and connections.',
    frontend_route: '/service-order',
  },
  {
    id: 'sre-monitor',
    display_name: 'SRE Monitor',
    description: 'Monitor network health and investigate incidents.',
    frontend_route: '/sre-monitor',
  },
  {
    id: 'sre-closed-loop',
    display_name: 'SRE Closed Loop',
    description: 'Automated detect-diagnose-remediate loop for network incidents.',
    frontend_route: '/sre-closed-loop',
  },
];

export async function handleNaasMock(
  pathname: string,
  method: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (pathname === '/api/naas/v1/agents' && method === 'GET') {
    sendJson(res, 200, MOCK_AGENTS);
    return true;
  }

  if (pathname === '/api/naas/v1/chat' && method === 'POST') {
    const raw = await readBody(req);
    try {
      const request = JSON.parse(raw) as ChatRequest;
      const response: ChatResponse = {
        agent_id: request.agent_id,
        session_id: request.session_id || `mock-session-${Date.now()}`,
        reply: `[mock] ${request.agent_id} received: "${request.message}"`,
        tool_results: {},
      };
      sendJson(res, 200, response);
    } catch {
      sendJson(res, 400, { error: { message: 'Invalid JSON payload' } });
    }
    return true;
  }

  if (pathname === '/api/naas/v1/admin/tickets/pending' && method === 'GET') {
    sendJson(res, 200, mockNaasManager.getPending());
    return true;
  }

  if (pathname === '/api/naas/v1/admin/tickets/history' && method === 'GET') {
    sendJson(res, 200, mockNaasManager.getHistory());
    return true;
  }

  const approveMatch = pathname.match(/^\/api\/naas\/v1\/admin\/tickets\/(\d+)\/approve$/);
  if (approveMatch && method === 'POST') {
    const ticketId = Number(approveMatch[1]);
    const ticket = mockNaasManager.approve(ticketId);
    if (!ticket) {
      sendJson(res, 404, { error: { message: `Ticket ${ticketId} not found` } });
    } else {
      sendJson(res, 200, ticket);
    }
    return true;
  }

  return false;
}
