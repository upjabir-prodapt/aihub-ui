import type { ReactNode } from 'react';

// Purely cosmetic, frontend-only companion to registry/agents.yaml — the
// backend has no notion of icon/color. Same pattern as leftPanels.tsx: one
// entry per agent id, so a new agent gets a one-line addition here too.
interface AgentVisual {
  color: string;
  icon: ReactNode;
}

const iconProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function OrderIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 13a9 9 0 0 1 18 0" />
      <path d="M12 13l3-4" />
      <circle cx="12" cy="13" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function LoopIcon() {
  return (
    <svg {...iconProps}>
      <path d="M17 2.1l4 4-4 4" />
      <path d="M3 12.2v-2a4 4 0 0 1 4-4h14" />
      <path d="M7 21.9l-4-4 4-4" />
      <path d="M21 11.8v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export const agentVisuals: Record<string, AgentVisual> = {
  'service-order': { color: '#0d9488', icon: <OrderIcon /> },
  'sre-monitor': { color: '#ea580c', icon: <MonitorIcon /> },
  'sre-closed-loop': { color: '#db2777', icon: <LoopIcon /> },
};

export const defaultAgentVisual: AgentVisual = {
  color: '#0d9488',
  icon: <OrderIcon />,
};
