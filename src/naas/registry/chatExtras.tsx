import type { ReactNode } from 'react';
import InvoiceCard from '../agents/service-order/InvoiceCard';
import PortSearch from '../agents/service-order/PortSearch';
import type { InvoiceResult, ListPortsResult } from '../agents/service-order/types';

// Frontend-side companion to leftPanels.tsx, but for the chat stream
// itself: an agent can optionally render something *before* a given
// turn's chat bubble (e.g. a dedicated Invoice card, or an interactive
// picker), keyed off that turn's tool_results. ChatPanel stays
// agent-agnostic — it just calls whichever function is registered here,
// if any, for the current agentId, passing along a way to send a message
// on the user's behalf (see PortSearch, which uses this to submit a pick).
export const chatExtras: Record<
  string,
  (toolResults: Record<string, unknown>, sendMessage: (text: string) => void) => ReactNode
> = {
  'service-order': (toolResults, sendMessage) => {
    const invoice = toolResults.create_invoice as InvoiceResult | undefined;
    if (invoice) return <InvoiceCard invoice={invoice} />;

    const portSearch = toolResults.search_existing_ports as ListPortsResult | undefined;
    if (portSearch) return <PortSearch result={portSearch} onSelect={sendMessage} />;

    return null;
  },
};
