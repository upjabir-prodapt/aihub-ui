import { useRef } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  Circle,
  FileCheck2,
  GitBranch,
  Hammer,
  Link2,
  MapPin,
  Minus,
  Plug,
  Search,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import type { LeftPanelProps } from '../../registry/leftPanels';
import type { ServiceOrderState } from './types';
import { computeServiceOrderFlow, type FlowNode, type NodeStatus, type ServiceOrderFlow } from './flowState';
import './ServiceOrderPanel.css';

// Which tool_results keys computeServiceOrderFlow actually reads — see
// useEffectiveServiceOrderState below.
const RELEVANT_KEYS: (keyof ServiceOrderState)[] = [
  'start_service_order_flow',
  'list_buildings_by_address',
  'list_building_sites',
  'get_ethernet_port_price',
  'get_ethernet_circuit_price',
  'list_connection_endpoint_ports',
  'search_existing_ports',
  'create_ethernet_port',
];

// AgentScreen accumulates tool_results for the whole chat session and
// never clears a key (see its mergeToolResults) — fine for sre-monitor,
// but here it means a second, independent flow later in the same
// conversation (another Port order, or a Connection order after a Port
// order) would otherwise still see the first flow's stale results and
// misread its own progress. start_service_order_flow's `started_at`
// changes on every call (even a repeat of the same flow type), so it's
// used here as a reset marker: whenever it changes, everything
// accumulated *before* that point is snapshotted as a "baseline" and
// treated as absent going forward — only tool results that changed
// *after* the marker count toward the current diagram.
function useEffectiveServiceOrderState(toolResults: Record<string, unknown>): ServiceOrderState {
  const prevToolResultsRef = useRef<Record<string, unknown>>({});
  const baselineRef = useRef<Record<string, unknown>>({});
  const lastStartedAtRef = useRef<string | undefined>(undefined);

  const startedAt = (toolResults.start_service_order_flow as { started_at?: string } | undefined)
    ?.started_at;
  if (startedAt !== undefined && startedAt !== lastStartedAtRef.current) {
    baselineRef.current = prevToolResultsRef.current;
    lastStartedAtRef.current = startedAt;
  }
  prevToolResultsRef.current = toolResults;

  const effective: Record<string, unknown> = {};
  for (const key of RELEVANT_KEYS) {
    if (toolResults[key] !== baselineRef.current[key]) {
      effective[key] = toolResults[key];
    }
  }
  return effective as ServiceOrderState;
}

// One "what is this step about" icon per node id — falls back to Circle
// for any id not listed (there shouldn't be any, but this stays safe if
// flowState.ts ever adds a node without a matching entry here).
const STEP_ICONS: Record<string, LucideIcon> = {
  address: MapPin,
  building: Building2,
  availability: Search,
  qualify: FileCheck2,
  order: FileCheck2,
  price: Tag,
  'confirm-create': FileCheck2,
  'select-ports': Plug,
  existing: Link2,
  'new-port': Hammer,
  'new-port-site': Building2,
  'new-port-price': Tag,
  'new-port-create': FileCheck2,
  'circuit-price': Tag,
  confirm: FileCheck2,
};

const STATUS_ICONS: Record<NodeStatus, LucideIcon> = {
  done: Check,
  current: Circle,
  upcoming: Circle,
  blocked: AlertTriangle,
  skipped: Minus,
};

function NodeBox({ n }: { n: FlowNode }) {
  const StepIcon = STEP_ICONS[n.id] ?? Circle;
  const StatusIcon = STATUS_ICONS[n.status];
  return (
    <div className={`flow-node flow-node--${n.status}`}>
      <span className="flow-node-icon" aria-hidden="true">
        <StepIcon size={16} strokeWidth={1.75} />
      </span>
      <span className="flow-node-text">
        <span className="flow-node-label">{n.label}</span>
        {n.detail && <span className="flow-node-detail">{n.detail}</span>}
      </span>
      <span className={`flow-node-status flow-node-status--${n.status}`} aria-hidden="true">
        <StatusIcon size={12} strokeWidth={2.25} />
      </span>
    </div>
  );
}

function Connector() {
  return <div className="flow-connector" aria-hidden="true" />;
}

function StepList({ nodes }: { nodes: FlowNode[] }) {
  return (
    <>
      {nodes.map((n, i) => (
        <div key={n.id}>
          {i > 0 && <Connector />}
          <NodeBox n={n} />
        </div>
      ))}
    </>
  );
}

function BranchRow({ left, right }: { left: FlowNode; right: FlowNode }) {
  return (
    <div className="flow-branch">
      <div className="flow-branch-joint" aria-hidden="true">
        <GitBranch size={14} strokeWidth={1.75} />
      </div>
      <div className="flow-branch-options">
        <div className="flow-branch-option">
          <NodeBox n={left} />
        </div>
        <div className="flow-branch-option">
          <NodeBox n={right} />
        </div>
      </div>
    </div>
  );
}

// Rough "how far along" count for the header — approximate by design:
// nodes belonging to a branch not taken are excluded from the total, and
// there's no dedicated signal for a couple of terminal states (see
// flowState.ts's header comment), so this is a progress hint, not a
// precise step counter.
function collectNodes(flow: ServiceOrderFlow): FlowNode[] {
  if (flow.kind === 'empty') return [];
  if (flow.kind === 'qualify-or-port') {
    const nodes = [...flow.trunk, flow.branch.qualify, flow.branch.order];
    if (flow.branch.order.status !== 'upcoming') nodes.push(...flow.orderSteps);
    return nodes;
  }
  const nodes = [flow.selectPorts, flow.branch.existing, flow.branch.newPort];
  if (flow.branch.newPort.status !== 'upcoming') nodes.push(...flow.newPortSteps);
  nodes.push(flow.price, flow.confirm);
  return nodes;
}

function ProgressHeader({ flow }: { flow: ServiceOrderFlow }) {
  const nodes = collectNodes(flow).filter((n) => n.status !== 'skipped');
  const done = nodes.filter((n) => n.status === 'done').length;
  const total = nodes.length;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="service-order-progress">
      <div className="service-order-progress-track">
        <div className="service-order-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="service-order-progress-label">
        {done} of {total} steps
      </span>
    </div>
  );
}

// This agent's left panel: a branching flowchart of the current
// conversation's progress, derived from tool_results (see flowState.ts),
// reset per-flow via useEffectiveServiceOrderState above.
export default function ServiceOrderPanel({ toolResults }: LeftPanelProps) {
  const state = useEffectiveServiceOrderState(toolResults);
  const flow = computeServiceOrderFlow(state);

  if (flow.kind === 'empty') {
    return (
      <div className="service-order-panel service-order-panel--empty">
        <p>
          Start a Qualify Address, Ethernet Port, or Ethernet Connection
          request in the chat to see its progress here.
        </p>
      </div>
    );
  }

  if (flow.kind === 'qualify-or-port') {
    const [address, building, availability] = flow.trunk;
    const showOrderSteps = flow.branch.order.status !== 'upcoming';

    return (
      <div className="service-order-panel">
        <h3 className="service-order-panel-title">Qualify Address / Ethernet Port</h3>
        <ProgressHeader flow={flow} />
        <div className="flow">
          <NodeBox n={address} />
          <Connector />
          <NodeBox n={building} />
          <Connector />
          <NodeBox n={availability} />
          <BranchRow left={flow.branch.qualify} right={flow.branch.order} />
          {showOrderSteps && (
            <>
              <Connector />
              <StepList nodes={flow.orderSteps} />
            </>
          )}
        </div>
      </div>
    );
  }

  const showNewPortSteps = flow.branch.newPort.status !== 'upcoming';

  return (
    <div className="service-order-panel">
      <h3 className="service-order-panel-title">Ethernet Connection</h3>
      <ProgressHeader flow={flow} />
      <div className="flow">
        <NodeBox n={flow.selectPorts} />
        <BranchRow left={flow.branch.existing} right={flow.branch.newPort} />
        {showNewPortSteps && (
          <div className="flow-nested">
            <StepList nodes={flow.newPortSteps} />
          </div>
        )}
        <Connector />
        <NodeBox n={flow.price} />
        <Connector />
        <NodeBox n={flow.confirm} />
      </div>
    </div>
  );
}
