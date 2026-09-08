import type { ServiceOrderState } from './types';

// Derives "where are we in the conversation" from the tools that have
// fired so far. `state` is expected to be ServiceOrderPanel's *effective*
// state (post flow-reset), not the raw accumulated tool_results — see
// ServiceOrderPanel.tsx for why a reset is needed at all. Which top-level
// diagram to show comes from the explicit `start_service_order_flow`
// marker, not from guessing off tool co-occurrence — that marker is the
// authoritative signal, including for telling apart the Connection flow's
// "create a new port for one side" sub-branch (which reuses the exact
// same tools as Flow B) from a standalone Port order.
//
// A few things still have no dedicated tool call and so can't be told
// apart here (e.g. whether the user picked "qualify only" instead of
// continuing to order, or the final "submitted" confirmation for a pure
// existing-port Connection) — those are called out inline below rather
// than guessed at.

export type NodeStatus = 'done' | 'current' | 'upcoming' | 'blocked' | 'skipped';

export interface FlowNode {
  id: string;
  label: string;
  status: NodeStatus;
  detail?: string;
}

export type ServiceOrderFlow =
  | { kind: 'empty' }
  | {
      kind: 'qualify-or-port';
      trunk: [FlowNode, FlowNode, FlowNode]; // Address, Building, Availability
      branch: { qualify: FlowNode; order: FlowNode };
      orderSteps: [FlowNode, FlowNode]; // Price, Confirm & Create
    }
  | {
      kind: 'connection';
      selectPorts: FlowNode;
      branch: { existing: FlowNode; newPort: FlowNode };
      newPortSteps: [FlowNode, FlowNode, FlowNode]; // Site, Price, Create
      price: FlowNode;
      confirm: FlowNode;
    };

function node(id: string, label: string, status: NodeStatus, detail?: string): FlowNode {
  return { id, label, status, detail };
}

export function computeServiceOrderFlow(state: ServiceOrderState): ServiceOrderFlow {
  const activeFlow = state.start_service_order_flow?.flow;

  if (activeFlow === undefined) {
    return { kind: 'empty' };
  }

  if (activeFlow === 'connection') {
    // search_existing_ports is the interactive-picker call (Flow C step
    // 2); list_connection_endpoint_ports is the quiet duplicate-port
    // check (step 3) — either one appearing means ports were looked up.
    const portsListed = !!state.list_connection_endpoint_ports || !!state.search_existing_ports;
    // Reuses the exact same tools as the Port flow — their presence here
    // means the Connection flow branched into "create a new port for one
    // side" (see prompt.md Flow C step 3).
    const newPortInProgress = !!state.list_buildings_by_address;
    const sitesChecked = !!state.list_building_sites;
    const newPortPriced = !!state.get_ethernet_port_price;
    const newPortCreated = !!state.create_ethernet_port;
    const circuitPriced = !!state.get_ethernet_circuit_price;

    const selectPorts = node(
      'select-ports',
      'Select source & destination',
      portsListed ? 'done' : 'current',
    );

    const branch = {
      existing: node(
        'existing',
        'Both ports already exist',
        newPortInProgress
          ? 'skipped'
          : circuitPriced
            ? 'done'
            : portsListed
              ? 'current'
              : 'upcoming',
      ),
      newPort: node(
        'new-port',
        'Create a new port for one side',
        newPortInProgress ? (newPortCreated ? 'done' : 'current') : portsListed ? 'upcoming' : 'upcoming',
      ),
    };

    const newPortSteps: [FlowNode, FlowNode, FlowNode] = [
      node(
        'new-port-site',
        'Find building & available site',
        sitesChecked ? 'done' : newPortInProgress ? 'current' : 'upcoming',
        state.list_building_sites && !state.list_building_sites.any_available
          ? 'No port available there'
          : undefined,
      ),
      node(
        'new-port-price',
        'Price the new port',
        newPortPriced ? 'done' : sitesChecked ? 'current' : 'upcoming',
      ),
      node(
        'new-port-create',
        'Confirm & create port',
        newPortCreated ? 'done' : newPortPriced ? 'current' : 'upcoming',
        newPortCreated ? 'Pending admin approval' : undefined,
      ),
    ];

    const price = node(
      'circuit-price',
      'Connection price',
      newPortInProgress
        ? 'skipped'
        : circuitPriced
          ? 'done'
          : portsListed
            ? 'current'
            : 'upcoming',
      newPortInProgress ? 'Not available until the new port exists' : undefined,
    );

    const confirm = node(
      'confirm',
      'Confirm & submit',
      newPortInProgress
        ? newPortCreated
          ? 'done'
          : newPortPriced
            ? 'current'
            : 'upcoming'
        : circuitPriced
          ? 'current'
          : 'upcoming',
    );

    return { kind: 'connection', selectPorts, branch, newPortSteps, price, confirm };
  }

  // Qualify Address / Ethernet Port creation share the same first two
  // steps (address -> building -> site availability) — see prompt.md
  // Flow A step 1-3 and Flow B step 1-3 — so which one the user is doing
  // can't be told apart until pricing/creation happens (or never, if they
  // stop at "qualify only").
  const buildingsListed = !!state.list_buildings_by_address;
  const sitesChecked = !!state.list_building_sites;
  const anyAvailable = state.list_building_sites?.any_available ?? false;
  const priced = !!state.get_ethernet_port_price;
  const created = !!state.create_ethernet_port;

  const trunk: [FlowNode, FlowNode, FlowNode] = [
    node('address', 'Address', buildingsListed ? 'done' : 'current'),
    node('building', 'Select building', sitesChecked ? 'done' : buildingsListed ? 'current' : 'upcoming'),
    node(
      'availability',
      'Check site availability',
      !sitesChecked ? 'upcoming' : anyAvailable ? 'done' : 'blocked',
      sitesChecked && !anyAvailable ? 'No port available at this building' : undefined,
    ),
  ];

  const branch = {
    qualify: node(
      'qualify',
      'Qualify result',
      sitesChecked ? 'done' : 'upcoming',
      sitesChecked ? (anyAvailable ? 'Qualifies' : 'Does not qualify') : undefined,
    ),
    order: node(
      'order',
      'Continue to order a port',
      created ? 'done' : sitesChecked && anyAvailable ? 'current' : 'upcoming',
    ),
  };

  const orderSteps: [FlowNode, FlowNode] = [
    node('price', 'Price the port', priced ? 'done' : sitesChecked && anyAvailable ? 'current' : 'upcoming'),
    node(
      'confirm-create',
      'Confirm & create port',
      created ? 'done' : priced ? 'current' : 'upcoming',
      created ? 'Pending admin approval' : undefined,
    ),
  ];

  return { kind: 'qualify-or-port', trunk, branch, orderSteps };
}
