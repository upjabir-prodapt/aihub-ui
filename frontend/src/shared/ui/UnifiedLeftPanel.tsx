import { useTranslation } from 'react-i18next';
import PlaceholderPanel from './PlaceholderPanel';
import ServiceOrderPanel from './ServiceOrderPanel';
import SreMonitorPanel from './SreMonitorPanel';
import SreClosedLoopPanel from './SreClosedLoopPanel';
import type { LeftPanelProps } from './leftPanels';

// The merged orchestrator interface has one left-panel area that
// auto-switches between the 3 specialists' existing, unchanged panel
// components based on `lastActiveAgent` — the ADK agent name
// (`event.author`, underscored — "service_order"/"sre_monitor"/
// "sre_closed_loop") of whichever specialist most recently called a
// tool this conversation (see NaasChatScreen.tsx, which tracks this from
// NaasChatPanel's onToolResults callback). Nothing has happened yet (no
// specialist has acted this conversation) is the only case that falls
// through to the placeholder — a stale/unset `lastActiveAgent` never
// hides an already-populated panel, since it only ever changes forward.
export default function UnifiedLeftPanel({
  toolResults,
  lastActiveAgent,
}: LeftPanelProps & { lastActiveAgent: string | null }) {
  const { t } = useTranslation();
  switch (lastActiveAgent) {
    case 'service_order':
      return <ServiceOrderPanel toolResults={toolResults} />;
    case 'sre_monitor':
      return <SreMonitorPanel toolResults={toolResults} />;
    case 'sre_closed_loop':
      return <SreClosedLoopPanel />;
    default:
      return <PlaceholderPanel label={t('placeholder.unifiedDefault')} />;
  }
}
