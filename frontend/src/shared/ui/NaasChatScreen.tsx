import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import UnifiedLeftPanel from './UnifiedLeftPanel';
import { renderChatExtra } from './chatExtras';
import NaasChatPanel, { type ChatPanelHandle } from './NaasChatPanel';
import NaasNavbar from './NaasNavbar';
import { useNaasLanguage } from '../hooks/useNaasLanguage';
import '../../styles/naas.css';

const DEFAULT_LEFT_WIDTH_PERCENT = 30;
const MIN_LEFT_WIDTH_PERCENT = 20;
const MAX_LEFT_WIDTH_PERCENT = 50;

// Spans all 3 specialist domains, so whichever one the user picks, the
// orchestrator has something concrete to route on immediately. `text` is
// what actually gets sent as the chat message on click — always English,
// regardless of UI language, since it's literal input the orchestrator's
// prompt resolves by phrasing, same reasoning as the picker components'
// "I'll check circuit #N..." messages (see chatExtras.tsx's callers).
// `labelKey` is only what the button displays.
const SAMPLE_PROMPTS: { labelKey: string; text: string }[] = [
  { labelKey: 'welcome.samplePrompts.telemetry', text: 'Show the telemetry for my connections' },
  { labelKey: 'welcome.samplePrompts.rules', text: 'Show my active reliability rules' },
  { labelKey: 'welcome.samplePrompts.order', text: 'Help me place a new service order' },
];

// Loose/defensive on purpose: toolResults is generic (Record<string,
// unknown>) since this doesn't know any specialist's specific tool
// shapes — this just needs to answer "does this look like a non-empty
// circuits list?" without importing an agent-specific type here.
function circuitsArray(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null) return [];
  const circuits = (value as { circuits?: unknown }).circuits;
  return Array.isArray(circuits) ? circuits : [];
}

// Mounted at "/naas" — a single, unified interface: a persistent Navbar on
// top (brand + which specialist is currently active + language + admin
// link), and below it either a clean, centered "what do you want to do?"
// welcome screen (Claude-style, no agent cards — the orchestrator decides
// which specialist handles a request, the user never picks one directly)
// or, once the conversation has actually started, the same split
// left-panel/chat layout NaasAgentScreen.tsx's standalone screens use. The
// 3 specialists remain directly reachable at their own
// "/naas/agents/:agentId" route (NaasAgentScreen.tsx, untouched) for
// isolated testing — just no longer linked from this screen.
//
// One NaasChatPanel instance carries a session across the welcome <-> split
// layout switch — only its `variant` prop and surrounding layout change,
// so the session and its accumulated messages carry over untouched.
// autoGreet is off here (unlike NaasAgentScreen.tsx's standalone screens)
// since the welcome heading below already covers what an opening greeting
// bubble would say — the first message actually shown once the transcript
// appears is the user's own. This instance is only ever remounted (a fresh
// session, via the `chatInstance` key) when the user explicitly closes the
// session with Navbar's "New chat" button — see handleNewChat.
export default function NaasChatScreen() {
  const { t } = useTranslation();
  const [language, setLanguage] = useNaasLanguage();
  // Accumulated across the whole conversation, not replaced per turn — a
  // tool only re-appears here on the turn it's actually called again
  // (e.g. the circuit list is fetched once, telemetry is refetched per
  // selection), so a naive replace would drop the circuit list as soon
  // as the user picked one. See leftPanels.tsx's LeftPanelProps.
  const [toolResults, setToolResults] = useState<Record<string, unknown>>({});
  // Which specialist most recently called a tool this conversation (ADK
  // agent name, e.g. "service_order") — drives both UnifiedLeftPanel's
  // auto-switch and Navbar's active-agent highlight. null until the first
  // tool call.
  const [lastActiveAgent, setLastActiveAgent] = useState<string | null>(null);
  // True from the moment the user actually sends their first message this
  // session — NaasChatPanel's onFirstMessageSent, fired on Enter/Send (or
  // a sample prompt's own send, see sendSamplePrompt below), deliberately
  // NOT while they're still typing it, so the layout stays put until
  // there's an actual turn to show. Switches from the centered welcome
  // screen to the split layout; this is a one-way transition for the
  // session, matching how Claude's own landing screen behaves once a
  // conversation starts.
  const [chatStarted, setChatStarted] = useState(false);
  const chatPanelRef = useRef<ChatPanelHandle>(null);
  // Bumped on "New chat" (see handleNewChat) and used as NaasChatPanel's
  // `key` — changing a component's key forces React to unmount the old
  // instance and mount a fresh one, which is what actually closes the old
  // session (a new sessionId, empty messages) rather than just hiding it.
  const [chatInstance, setChatInstance] = useState(0);
  // Draggable split between the left panel and chat — resets to 30/70 on
  // reload rather than persisting (deliberately simple).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [leftWidthPercent, setLeftWidthPercent] = useState(DEFAULT_LEFT_WIDTH_PERCENT);
  const [isDragging, setIsDragging] = useState(false);

  function handleNewChat() {
    setChatStarted(false);
    setLastActiveAgent(null);
    setToolResults({});
    setLeftWidthPercent(DEFAULT_LEFT_WIDTH_PERCENT);
    setChatInstance((n) => n + 1);
  }

  function handleToolResults(newResults: Record<string, unknown>, agent?: string) {
    if (agent) setLastActiveAgent(agent);
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

  function sendSamplePrompt(text: string) {
    // No explicit setChatStarted(true) here — NaasChatPanel's send()
    // (which sendMessage below calls into) fires onFirstMessageSent itself
    // the same way a typed Enter/Send does, so this stays a single code
    // path for "the session's first message was sent" regardless of how.
    chatPanelRef.current?.sendMessage(text);
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

  return (
    <div className="chat-screen-page">
      <NaasNavbar
        activeAgent={lastActiveAgent}
        chatStarted={chatStarted}
        onNewChat={handleNewChat}
        language={language}
        onLanguageChange={setLanguage}
      />
      <div
        className="agent-screen-body"
        ref={bodyRef}
        style={chatStarted ? { gridTemplateColumns: `${leftWidthPercent}% 6px 1fr` } : { gridTemplateColumns: '1fr' }}
      >
        {chatStarted && (
          <>
            <section className="agent-screen-left">
              <UnifiedLeftPanel toolResults={toolResults} lastActiveAgent={lastActiveAgent} />
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
          </>
        )}
        <section className={`agent-screen-right${chatStarted ? '' : ' agent-screen-right--welcome'}`}>
          {!chatStarted && (
            <div className="chat-welcome-copy">
              <h1>{t('welcome.heading')}</h1>
              <p>{t('welcome.subheading')}</p>
            </div>
          )}
          <NaasChatPanel
            key={chatInstance}
            ref={chatPanelRef}
            language={language}
            variant={chatStarted ? 'default' : 'welcome'}
            autoGreet={false}
            onToolResults={handleToolResults}
            renderBeforeMessage={renderChatExtra}
            onFirstMessageSent={() => setChatStarted(true)}
          />
          {!chatStarted && (
            <div className="chat-welcome-prompts">
              {SAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt.labelKey}
                  type="button"
                  className="chat-welcome-prompt"
                  onClick={() => sendSamplePrompt(prompt.text)}
                >
                  {t(prompt.labelKey)}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
