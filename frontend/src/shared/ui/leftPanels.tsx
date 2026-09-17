import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import PlaceholderPanel from './PlaceholderPanel';
import SreMonitorPanel from './SreMonitorPanel';
import SreClosedLoopPanel from './SreClosedLoopPanel';
import ServiceOrderPanel from './ServiceOrderPanel';

// Every left panel receives the tool_results accumulated so far this
// conversation, keyed by tool name. Untyped here — each agent's own
// panel component narrows this to its tools' actual shapes. Shared by
// NaasAgentScreen.tsx's per-specialist lookup (leftPanels[agentId]) below
// and UnifiedLeftPanel.tsx's own agent-name switch (the embedded
// orchestrator chat), which renders these same 3 components directly
// rather than going through this Record.
export interface LeftPanelProps {
  toolResults: Record<string, unknown>;
}

// Frontend-side companion to registry/agents.yaml's `left_panel_component`
// field, used by NaasAgentScreen.tsx's standalone per-specialist screens.
export const leftPanels: Record<string, ComponentType<LeftPanelProps>> = {
  'service-order': ServiceOrderPanel,
  'sre-monitor': SreMonitorPanel,
  'sre-closed-loop': SreClosedLoopPanel,
};

// A named (PascalCase) function, not an inline arrow assigned straight to
// the lowercase `defaultLeftPanel` export below — react-hooks/rules-of-
// hooks only recognizes a function as a component (and so allows it to
// call useTranslation()) by that naming convention.
function DefaultLeftPanel() {
  const { t } = useTranslation();
  return <PlaceholderPanel label={t('placeholder.comingSoon')} />;
}

export const defaultLeftPanel: ComponentType<LeftPanelProps> = DefaultLeftPanel;
