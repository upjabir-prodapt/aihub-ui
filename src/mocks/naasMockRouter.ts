import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './translationMockRouter.ts';
import { mockNaasManager } from './mockNaasManager.ts';
import type { AgentPublic, ChatRequest, ChatResponse } from '../naas/api/types.ts';

// Basic stub for the agent-backend (naas-mcp) API — see src/naas/api/client.ts.
// Returns plain canned replies with empty tool_results, so agent-specific
// panels (ServiceOrderPanel, SreMonitorPanel) stay in their empty state.
// Not a simulation of the real ADK orchestrator/MCP tool flow.
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
  if (pathname === '/agents' && method === 'GET') {
    sendJson(res, 200, MOCK_AGENTS);
    return true;
  }

  if (pathname === '/chat' && method === 'POST') {
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

  if (pathname === '/admin/tickets/pending' && method === 'GET') {
    sendJson(res, 200, mockNaasManager.getPending());
    return true;
  }

  if (pathname === '/admin/tickets/history' && method === 'GET') {
    sendJson(res, 200, mockNaasManager.getHistory());
    return true;
  }

  const approveMatch = pathname.match(/^\/admin\/tickets\/(\d+)\/approve$/);
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
