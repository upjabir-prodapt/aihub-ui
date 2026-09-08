import type { ComponentType } from 'react';
import PlaceholderPanel from '../components/PlaceholderPanel';
import SreMonitorPanel from '../agents/sre-monitor/SreMonitorPanel';
import ServiceOrderPanel from '../agents/service-order/ServiceOrderPanel';

// Every left panel receives the tool_results accumulated so far this
// conversation (see AgentScreen's mergeToolResults), keyed by tool name.
// Untyped here — each agent's own panel component narrows this to its
// tools' actual shapes.
export interface LeftPanelProps {
  toolResults: Record<string, unknown>;
}

// Frontend-side companion to registry/agents.yaml's `left_panel_component`
// field. Each agent gets its own entry here so that building its real
// left-panel UI later is a one-line swap of this map, not a change to
// AgentScreen itself.
export const leftPanels: Record<string, ComponentType<LeftPanelProps>> = {
  'service-order': ServiceOrderPanel,
  'sre-monitor': SreMonitorPanel,
  'sre-closed-loop': () => <PlaceholderPanel label="Agent UI coming soon" />,
};

export const defaultLeftPanel: ComponentType<LeftPanelProps> = () => (
  <PlaceholderPanel label="Agent UI coming soon" />
);
