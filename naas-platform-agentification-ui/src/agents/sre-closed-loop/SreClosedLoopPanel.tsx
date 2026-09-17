import { useEffect, useRef, useState } from 'react';
import { Menu, TrendingDown, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { LeftPanelProps } from '../../registry/leftPanels';
import {
  fetchCircuitRoute,
  fetchDemoCircuit,
  fetchReliabilityAuditLog,
  fetchReliabilityEvents,
  simulateUtilizationHigh,
  simulateUtilizationLow,
} from '../../api/client';
import type {
  CircuitRoute,
  DemoCircuit,
  ReliabilityAuditEntry,
  ReliabilityEvent,
} from '../../api/types';
import CityMap, { CityMapLoading, WorldMap } from '../../components/CityMap';
import './SreClosedLoopPanel.css';

// Polls agent-backend's /reliability/* endpoints directly — independent
// of chat/toolResults entirely — so pressing a Simulate button and
// watching the background poller (reliability_poller.py) pick it up,
// act on it, and write an audit row is visible here without needing to
// ask the chat agent anything. Matches Admin.tsx's own-state-plus-fetch
// pattern rather than the other panels' toolResults-derived rendering,
// since this data isn't produced by a chat turn at all.
const REFRESH_INTERVAL_MS = 4000;

// Deliberately larger than the Service Observability Agent's compact
// side-by-side map (CityMap's own 300x170 default) — this map is meant
// to fill the panel's full top width on its own, per request. Fixed
// (not responsive to the panel's actual rendered width — that would
// need a ResizeObserver recomputing the whole tile grid on every
// resize) but sized to comfortably fit the left panel at its default
// 50%-of-window split; CityMap's own overflow: hidden safety net still
// applies if the panel is ever dragged/resized narrower than this.
const MAP_WIDTH = 400;
const MAP_HEIGHT = 220;

function eventStatusClass(status: ReliabilityEvent['status']): string {
  switch (status) {
    case 'PENDING':
      return 'scl-badge scl-badge--pending';
    case 'CLAIMED':
      return 'scl-badge scl-badge--claimed';
    case 'PROCESSED':
      return 'scl-badge scl-badge--good';
    case 'IGNORED':
      return 'scl-badge scl-badge--neutral';
    default:
      return 'scl-badge';
  }
}

function auditStatusClass(status: ReliabilityAuditEntry['status']): string {
  if (status === 'COMPLETED') return 'scl-badge scl-badge--good';
  if (status === 'FAILED') return 'scl-badge scl-badge--bad';
  // TIMED_OUT (and SUBMITTED) mean "Colt hadn't confirmed completion
  // within our wait window" — not "this failed". The underlying boost
  // may still land; the reliability poller keeps re-checking and flips
  // this to COMPLETED on its own once Colt confirms (see
  // reliability_poller.py's _reconcile_unresolved). Styled distinctly
  // from FAILED so it doesn't read as a confirmed error.
  return 'scl-badge scl-badge--pending';
}

function formatMbps(value: number | null): string {
  return value != null ? `${value} Mbps` : '—';
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const datePart = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const timePart = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

export default function SreClosedLoopPanel(_props: LeftPanelProps) {
  const { t } = useTranslation();
  const [demoCircuit, setDemoCircuit] = useState<DemoCircuit | null>(null);
  const [events, setEvents] = useState<ReliabilityEvent[]>([]);
  const [auditLog, setAuditLog] = useState<ReliabilityAuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<'high' | 'low' | null>(null);
  const [simulateOpen, setSimulateOpen] = useState(false);
  // Prevents onMouseLeave (fired the instant the pointer crosses into the
  // popup, since it's a separate element from the button) from closing
  // the popup before it ever registers the pointer entering it — both
  // the button and the popup share this one open/close pair instead.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openSimulate() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setSimulateOpen(true);
  }

  function scheduleCloseSimulate() {
    closeTimerRef.current = setTimeout(() => setSimulateOpen(false), 120);
  }

  // Same route-map fetch as the Service Observability Agent's panel
  // (fetchCircuitRoute/CityMap are the exact same components, reused
  // as-is), just keyed off demoCircuit's circuit_reference instead of a
  // chat turn's telemetry — demoCircuit already tracks "whichever
  // circuit's rule was created most recently" (see reliability.py's
  // _latest_rule), which is exactly the circuit Simulate acts on.
  const circuitReference = demoCircuit?.circuit_reference ?? null;
  const [route, setRoute] = useState<CircuitRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  useEffect(() => {
    setRoute(null);
    if (!circuitReference) {
      setRouteLoading(false);
      return;
    }
    let cancelled = false;
    setRouteLoading(true);
    fetchCircuitRoute(circuitReference)
      .then((result) => {
        if (!cancelled) setRoute(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [circuitReference]);

  function refetch() {
    // Re-fetched on every cycle, not just on mount — the target circuit
    // is whichever rule was created most recently (see reliability.py's
    // _simulation_target), so it can change the moment a rule is created
    // via either agent's chat, with no explicit signal from that
    // conversation back to this panel.
    //
    // Deliberately silent on failure (unlike handleSimulate below) — this
    // fires on an interval in the background, not from a user action, so
    // a transient blip (or the backend restarting) shouldn't pop a red
    // banner over data that's a moment away from refreshing correctly on
    // its own. Same convention as the other two agents' left panels never
    // surfacing a transient background-refresh error. The panel just
    // keeps showing its last-known-good values until the next successful
    // cycle.
    fetchDemoCircuit().then(setDemoCircuit).catch(() => {});
    fetchReliabilityEvents().then(setEvents).catch(() => {});
    fetchReliabilityAuditLog().then(setAuditLog).catch(() => {});
  }

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  async function handleSimulate(kind: 'high' | 'low') {
    setSimulating(kind);
    setError(null);
    try {
      await (kind === 'high' ? simulateUtilizationHigh() : simulateUtilizationLow());
      refetch();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSimulating(null);
    }
  }

  const hasTarget = demoCircuit?.circuit_reference != null;

  return (
    <div className="scl-panel">
      {/* The map is always visible, full width, at the top — a generic
          world view (WorldMap) until a Reliability Rule exists anywhere,
          then the real route for whichever circuit's rule is most
          recent (same target Simulate acts on). The hamburger button
          and its popup float on top of the map's top-left corner rather
          than taking a layout row of their own, so the map keeps the
          full top area. */}
      <div className="scl-map-area">
        {routeLoading && <CityMapLoading width={MAP_WIDTH} height={MAP_HEIGHT} />}
        {!routeLoading && hasTarget && route && (
          <CityMap from={route.from} to={route.to} width={MAP_WIDTH} height={MAP_HEIGHT} />
        )}
        {!routeLoading && !hasTarget && <WorldMap width={MAP_WIDTH} height={MAP_HEIGHT} />}

        <div
          className="scl-hamburger-wrap"
          onMouseEnter={openSimulate}
          onMouseLeave={scheduleCloseSimulate}
        >
          <button
            type="button"
            className="scl-hamburger-btn"
            aria-label={t('sreClosedLoop.simulateAria')}
            aria-haspopup="true"
            aria-expanded={simulateOpen}
            onClick={() => (simulateOpen ? setSimulateOpen(false) : openSimulate())}
          >
            <Menu size={18} />
          </button>

          {simulateOpen && (
            <div className="scl-simulate-popup">
              <div className="scl-simulate-popup-title">{t('sreClosedLoop.simulation')}</div>
              {hasTarget ? (
                <p className="scl-demo-circuit">
                  <strong>{demoCircuit?.name}</strong>{' '}
                  <span className="scl-muted">({demoCircuit?.circuit_reference})</span>
                </p>
              ) : (
                <p className="scl-demo-circuit scl-muted">{t('emptyStates.noRuleSetYet')}</p>
              )}
              <div className="scl-simulate-buttons">
                <button
                  className="scl-btn scl-btn--high"
                  disabled={simulating !== null || !hasTarget}
                  onClick={() => handleSimulate('high')}
                >
                  <TrendingUp size={14} />
                  {simulating === 'high' ? t('sreClosedLoop.submitting') : t('sreClosedLoop.highUtilization')}
                </button>
                <button
                  className="scl-btn scl-btn--low"
                  disabled={simulating !== null || !hasTarget}
                  onClick={() => handleSimulate('low')}
                >
                  <TrendingDown size={14} />
                  {simulating === 'low' ? t('sreClosedLoop.submitting') : t('sreClosedLoop.lowUtilization')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p className="scl-error">{error}</p>}

      <div className="scl-card">
        <div className="scl-card-title">{t('sreClosedLoop.recentEvents')}</div>
        <div className="scl-table-wrap">
          <table className="scl-table">
            <thead>
              <tr>
                <th>{t('common.circuitReference')}</th>
                <th>{t('common.type')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.created')}</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="scl-empty">
                    {t('emptyStates.noEventsYet')}
                  </td>
                </tr>
              )}
              {events.map((event) => (
                <tr key={event.id}>
                  <td>{event.circuit_reference}</td>
                  <td>
                    {event.event_type === 'UTILIZATION_HIGH'
                      ? t('sreClosedLoop.highUtilization')
                      : t('sreClosedLoop.lowUtilization')}
                  </td>
                  <td>
                    <span className={eventStatusClass(event.status)}>{event.status}</span>
                  </td>
                  <td>{formatTime(event.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="scl-card">
        <div className="scl-card-title">{t('sreClosedLoop.auditLog')}</div>
        <div className="scl-table-wrap">
          <table className="scl-table">
            <thead>
              <tr>
                <th>{t('common.circuitReference')}</th>
                <th>{t('common.action')}</th>
                <th>{t('common.bandwidth')}</th>
                <th>{t('common.rentalCharge')}</th>
                <th>{t('sreClosedLoop.trigger')}</th>
                <th>{t('common.status')}</th>
                <th>{t('common.timestamp')}</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 && (
                <tr>
                  <td colSpan={7} className="scl-empty">
                    {t('emptyStates.noActionsLogged')}
                  </td>
                </tr>
              )}
              {auditLog.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.circuit_reference}</td>
                  <td>{entry.action}</td>
                  <td>
                    {formatMbps(entry.previous_bandwidth_mbps)} → {formatMbps(entry.new_bandwidth_mbps)}
                  </td>
                  <td>{entry.rental_charge ?? t('common.notAvailable')}</td>
                  <td>
                    {entry.triggered_by === 'MONITORING_EVENT' ? t('common.automatic') : t('common.manual')}
                  </td>
                  <td>
                    <span className={auditStatusClass(entry.status)}>{entry.status}</span>
                  </td>
                  <td>{formatTimestamp(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
