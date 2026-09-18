import type { ReactNode } from 'react';
import InvoiceCard from './InvoiceCard';
import PortSearch from './PortSearch';
import PricingOptions from './PricingOptions';
import RecommendationOptions from './RecommendationOptions';
import BuildingSearch from './BuildingSearch';
import BandwidthOptions from './BandwidthOptions';
import CircuitTable from './CircuitTable';
import TimePeriodTable from './TimePeriodTable';
import CircuitRulesTable from './CircuitRulesTable';
import AuditLogTable from './AuditLogTable';
import type {
  InvoiceResult,
  ListActiveCircuitsResult,
  ListBandwidthsResult,
  ListBuildingsResult,
  ListPortsResult,
  PresentTimePeriodOptionsResult,
  PricingOptionsResult,
  RecommendationResult,
  ReliabilityAuditEntry,
  ReliabilityRule,
} from '../types/naas';
import i18n from '../i18n';

// Companion to UnifiedLeftPanel.tsx/leftPanels.tsx, but for the chat
// stream itself: a turn can optionally render something *before* its
// chat bubble (e.g. a dedicated Quote card, or an interactive picker),
// keyed off that turn's tool_results. NaasChatPanel calls this
// unconditionally for every turn, in both the embedded orchestrator
// chat (NaasChatScreen.tsx) and every standalone specialist screen
// (NaasAgentScreen.tsx) — every tool name checked below is unique to its
// own specialist EXCEPT list_active_circuits, which both the Service
// Observability Agent and the Service Reliability Agent call (the latter
// alongside list_reliability_rules, checked first below so that
// combination renders one joined table instead of two) — so this never
// misfires for a turn handled by an unrelated specialist (their
// tool_results just won't match anything here, and the function returns
// null). Add more `const x = toolResults.some_tool as SomeType` checks
// here if another specialist gets a chat-extra card.
//
// `i18n.t(...)` (the standalone instance, not the `useTranslation()`
// hook) is used below for the couple of translated strings this plain
// function needs to hand to its children as props — hooks only work
// inside a component/another hook, and this is neither. It still stays
// in sync with the active language: NaasChatPanel.tsx (the only caller)
// already re-renders on a language change via its own `useTranslation()`
// call, and this function re-runs as part of that same render.
export function renderChatExtra(
  toolResults: Record<string, unknown>,
  sendMessage: (text: string) => void,
): ReactNode {
  // preview_invoice renders the same card, pre-confirmation, marked
  // Pending — create_invoice (post-confirmation, Confirmed) is checked
  // first since only one of the two ever appears on a given turn.
  const invoice = (toolResults.create_invoice ?? toolResults.preview_invoice) as
    | InvoiceResult
    | undefined;
  if (invoice) return <InvoiceCard invoice={invoice} />;

  // search_existing_ports (Flow D) and present_port_matches (Flow E's
  // Existing Port Inventory Check) share the same picker — only one is
  // ever called on a given turn.
  // list_comcast_port_candidates returns the same shape (Index, Port
  // Name, Building Name, Site) as the Existing Port Inventory Check
  // tools above — only one of the three is ever present on a given
  // turn, so they all share PortSearch's picker. Colt-Offnet has no
  // equivalent tool (create_offnet_location is itself a simulation, so
  // there's no real "site" inventory to list candidates from).
  const portSearch = (toolResults.search_existing_ports ??
    toolResults.present_port_matches ??
    toolResults.list_comcast_port_candidates) as ListPortsResult | undefined;
  if (portSearch) return <PortSearch result={portSearch} onSelect={sendMessage} />;

  const buildingSearch = toolResults.list_buildings_by_address as ListBuildingsResult | undefined;
  if (buildingSearch) return <BuildingSearch result={buildingSearch} onSelect={sendMessage} />;

  // Only one of the two is ever called on a given turn (Colt-Offnet vs.
  // Comcast-Offnet).
  const bandwidthOptions = (toolResults.list_offnet_bandwidths ??
    toolResults.list_comcast_bandwidths) as ListBandwidthsResult | undefined;
  if (bandwidthOptions) return <BandwidthOptions result={bandwidthOptions} onSelect={sendMessage} />;

  const bandwidthRecommendation = toolResults.present_bandwidth_recommendation as
    | RecommendationResult
    | undefined;
  if (bandwidthRecommendation) {
    return (
      <RecommendationOptions
        label={i18n.t('common.bandwidth')}
        result={bandwidthRecommendation}
        onSelect={sendMessage}
      />
    );
  }

  const commitmentRecommendation = toolResults.present_commitment_recommendation as
    | RecommendationResult
    | undefined;
  if (commitmentRecommendation) {
    return (
      <RecommendationOptions
        label={i18n.t('common.commitmentPeriod')}
        result={commitmentRecommendation}
        onSelect={sendMessage}
      />
    );
  }

  // Only one pricing tool is ever called on a given turn — first-present
  // wins, same pattern as create_invoice ?? preview_invoice above.
  const pricingOptions = (toolResults.get_ethernet_port_price ??
    toolResults.get_dia_price ??
    toolResults.get_ethernet_circuit_price ??
    toolResults.get_offnet_port_price ??
    toolResults.get_fttx_price ??
    toolResults.get_comcast_port_price ??
    toolResults.get_offnet_port_mod_options) as PricingOptionsResult | undefined;
  if (pricingOptions) return <PricingOptions result={pricingOptions} onSelect={sendMessage} />;

  const activeCircuits = toolResults.list_active_circuits as ListActiveCircuitsResult | undefined;
  const reliabilityRules = toolResults.list_reliability_rules as
    | { rules: ReliabilityRule[] }
    | undefined;
  // The Service Reliability Agent's "show reliability rules" step calls
  // BOTH tools in the same turn — checked before the plain activeCircuits
  // case below so that turn renders one joined, clickable table instead
  // of this card followed by a second, redundant generic CircuitTable.
  if (activeCircuits && reliabilityRules) {
    return (
      <CircuitRulesTable
        circuits={activeCircuits}
        rules={reliabilityRules.rules ?? []}
        onSelect={sendMessage}
      />
    );
  }

  if (activeCircuits) return <CircuitTable result={activeCircuits} onSelect={sendMessage} />;

  const timePeriodOptions = toolResults.present_time_period_options as
    | PresentTimePeriodOptionsResult
    | undefined;
  if (timePeriodOptions) return <TimePeriodTable result={timePeriodOptions} onSelect={sendMessage} />;

  // The Service Reliability Agent's "show audit log" step — not
  // clickable, unlike every other card here (see AuditLogTable.tsx).
  const auditLog = toolResults.list_audit_log as { audit_log: ReliabilityAuditEntry[] } | undefined;
  if (auditLog) return <AuditLogTable entries={auditLog.audit_log ?? []} />;

  return null;
}
