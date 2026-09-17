import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchAgents } from '../api/client';
import type { AgentPublic } from '../api/types';
import { defaultLeftPanel, leftPanels } from '../registry/leftPanels';
import { renderChatExtra } from '../registry/chatExtras';
import ChatPanel from '../components/ChatPanel';
import ThemeToggle from '../components/ThemeToggle';
import './AgentScreen.css';

const DEFAULT_LEFT_WIDTH_PERCENT = 30;
const MIN_LEFT_WIDTH_PERCENT = 20;
const MAX_LEFT_WIDTH_PERCENT = 50;

// Loose/defensive on purpose: toolResults is generic (Record<string,
// unknown>) since AgentScreen doesn't know any agent's specific tool
// shapes — this just needs to answer "does this look like a non-empty
// circuits list?" without importing an agent-specific type here.
function circuitsArray(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null) return [];
  const circuits = (value as { circuits?: unknown }).circuits;
  return Array.isArray(circuits) ? circuits : [];
}

// Standalone per-specialist screen, restored alongside the new merged
// orchestrator experience (see ChatScreen.tsx) — reached via one of the 3
// specialist cards on Landing.tsx, or a direct /agents/:agentId link.
// Talks to exactly one named agent (unlike ChatScreen.tsx's embedded
// chat, which always talks to the orchestrator and lets it route).
export default function AgentScreen() {
  const { t } = useTranslation();
  const { agentId } = useParams<{ agentId: string }>();
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Accumulated across the whole conversation, not replaced per turn — a
  // tool only re-appears here on the turn it's actually called again (e.g.
  // the circuit list is fetched once, telemetry is refetched per
  // selection), so a naive replace would drop the circuit list as soon as
  // the user picked one. See leftPanels.tsx's LeftPanelProps.
  const [toolResults, setToolResults] = useState<Record<string, unknown>>({});
  // Draggable split between the left panel and chat — resets to 30/70 on
  // reload/agent switch rather than persisting (deliberately simple).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [leftWidthPercent, setLeftWidthPercent] = useState(DEFAULT_LEFT_WIDTH_PERCENT);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setToolResults({});
  }, [agentId]);

  useEffect(() => {
    fetchAgents()
      .then((agents) => {
        const match = agents.find((a) => a.id === agentId);
        if (!match) {
          setError(t('agentScreen.unknownAgent', { agentId }));
          return;
        }
        setAgent(match);
      })
      .catch((err: Error) => setError(err.message));
    // `t` deliberately excluded — this only needs the current translation
    // at the moment an error is actually set, and including it would
    // re-run this fetch on every language switch too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function handleToolResults(newResults: Record<string, unknown>) {
    setToolResults((prev) => {
      const merged = { ...prev, ...newResults };
      // A transient backend hiccup on a background refresh (e.g.
      // list_active_circuits re-fetched after a boost) shouldn't wipe out
      // an already-good circuit list with an empty one — that would blank
      // out the left panel's detail card over a temporary failure that has
      // nothing to do with the data actually changing. Keep the last
      // known-good list_active_circuits result if the new one came back
      // empty.
      const prevCircuits = circuitsArray(prev.list_active_circuits);
      const newCircuits = circuitsArray(newResults.list_active_circuits);
      if (prevCircuits.length > 0 && newCircuits.length === 0) {
        merged.list_active_circuits = prev.list_active_circuits;
      }
      // The opposite case for ai_analysis_utilization/ai_analysis_jitter
      // (Service Observability Agent): each is generated fresh alongside
      // get_circuit_telemetry every time, never independently. If this
      // turn's tool_results has a new get_circuit_telemetry but no fresh
      // analysis for one (or both) metrics (e.g. that generation call
      // failed just this once, or the metric is unavailable this time),
      // drop any leftover analysis from a previous, different reading
      // rather than showing it stale next to the new numbers.
      if ('get_circuit_telemetry' in newResults) {
        if (!('ai_analysis_utilization' in newResults)) delete merged.ai_analysis_utilization;
        if (!('ai_analysis_jitter' in newResults)) delete merged.ai_analysis_jitter;
      }
      return merged;
    });
  }

  // Pointer capture (rather than window-level mousemove listeners) keeps
  // delivering move/up events to the divider even once the pointer leaves
  // its thin hit area mid-drag — the standard resizable-pane pattern.
  function handleDividerPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
  }

  function handleDividerPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!isDragging || !bodyRef.current) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.min(MAX_LEFT_WIDTH_PERCENT, Math.max(MIN_LEFT_WIDTH_PERCENT, percent));
    setLeftWidthPercent(clamped);
  }

  function handleDividerPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
  }

  const LeftPanel = (agentId && leftPanels[agentId]) || defaultLeftPanel;

  return (
    <div className="agent-screen">
      <header className="agent-screen-header">
        <Link to="/" className="back-link">
          ← {t('agentScreen.controlPanel')}
        </Link>
        <h1>{agent?.display_name ?? agentId}</h1>
        <ThemeToggle />
      </header>

      {error && <p className="agent-screen-error">{error}</p>}

      <div
        className="agent-screen-body"
        ref={bodyRef}
        style={{ gridTemplateColumns: `${leftWidthPercent}% 6px 1fr` }}
      >
        <section className="agent-screen-left">
          <LeftPanel toolResults={toolResults} />
        </section>
        <div
          className={`agent-screen-divider${isDragging ? ' is-dragging' : ''}`}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onDoubleClick={() => setLeftWidthPercent(DEFAULT_LEFT_WIDTH_PERCENT)}
          role="separator"
          aria-orientation="vertical"
          aria-label={t('chat.resizePanels')}
          title={t('chat.resizeTooltip')}
        />
        <section className="agent-screen-right">
          {agentId && (
            <ChatPanel
              agentId={agentId}
              onToolResults={handleToolResults}
              renderBeforeMessage={renderChatExtra}
            />
          )}
        </section>
      </div>
    </div>
  );
}
