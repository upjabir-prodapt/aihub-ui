import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { fetchAgents } from '../api/client';
import type { AgentPublic } from '../api/types';
import { defaultLeftPanel, leftPanels } from '../registry/leftPanels';
import { chatExtras } from '../registry/chatExtras';
import ChatPanel from '../components/ChatPanel';
import './NaaSAgentScreen.css';

const DEFAULT_LEFT_WIDTH_PERCENT = 50;
const MIN_LEFT_WIDTH_PERCENT = 20;
// Capped at the default (not e.g. 80) rather than the usual symmetric
// range — dragging past center would shrink the chat pane below its
// original width, which is what forced its Markdown tables into a
// horizontal scrollbar. The right side should never get smaller than it
// started; only the left side gives up space.
const MAX_LEFT_WIDTH_PERCENT = DEFAULT_LEFT_WIDTH_PERCENT;

interface NaaSAgentScreenProps {
  agentId: string;
  onBack: () => void;
}

export default function NaaSAgentScreen({ agentId, onBack }: NaaSAgentScreenProps) {
  const [agent, setAgent] = useState<AgentPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Accumulated across the whole conversation, not replaced per turn — a
  // tool only re-appears here on the turn it's actually called again (e.g.
  // the circuit list is fetched once, telemetry is refetched per
  // selection), so a naive replace would drop the circuit list as soon as
  // the user picked one. See leftPanels.tsx's LeftPanelProps.
  const [toolResults, setToolResults] = useState<Record<string, unknown>>({});
  // Draggable split between the left panel and chat — resets to 50/50 on
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
          setError(`Unknown agent: ${agentId}`);
          return;
        }
        setAgent(match);
      })
      .catch((err: Error) => setError(err.message));
  }, [agentId]);

  function handleToolResults(newResults: Record<string, unknown>) {
    setToolResults((prev) => ({ ...prev, ...newResults }));
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
  const renderBeforeMessage = agentId ? chatExtras[agentId] : undefined;

  return (
    <div className="naas-agent-screen">
      <header className="naas-agent-screen-header">
        <button type="button" className="naas-back-link" onClick={onBack}>
          ← Control panel
        </button>
        <h1>{agent?.display_name ?? agentId}</h1>
      </header>

      {error && <p className="naas-agent-screen-error">{error}</p>}

      <div
        className="naas-agent-screen-body"
        ref={bodyRef}
        style={{ gridTemplateColumns: `${leftWidthPercent}% 6px 1fr` }}
      >
        <section className="naas-agent-screen-left">
          <LeftPanel toolResults={toolResults} />
        </section>
        <div
          className={`naas-agent-screen-divider${isDragging ? ' is-dragging' : ''}`}
          onPointerDown={handleDividerPointerDown}
          onPointerMove={handleDividerPointerMove}
          onPointerUp={handleDividerPointerUp}
          onDoubleClick={() => setLeftWidthPercent(DEFAULT_LEFT_WIDTH_PERCENT)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize agent panels"
          title="Drag to resize — double-click to reset"
        />
        <section className="naas-agent-screen-right">
          {agentId && (
            <ChatPanel
              agentId={agentId}
              onToolResults={handleToolResults}
              renderBeforeMessage={renderBeforeMessage}
            />
          )}
        </section>
      </div>
    </div>
  );
}
