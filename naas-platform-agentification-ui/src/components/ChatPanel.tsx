import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTranslation } from 'react-i18next';
import { postChatStream } from '../api/client';
import { greetings } from '../registry/greetings';
import { useLanguage, type Language } from '../language/LanguageContext';
import './ChatPanel.css';

// The one agent_id every chat request goes through now — see
// agents/orchestrator/agent.py. It transparently delegates each turn to
// whichever specialist (service_order/sre_monitor/sre_closed_loop) fits
// the user's intent via ADK's native sub_agents/transfer_to_agent.
const ORCHESTRATOR_AGENT_ID = 'orchestrator';

// remark-gfm's table parser treats any non-blank line immediately after a
// table's last row as part of that table (lazy continuation) instead of
// starting a new paragraph — so a reply like "| ... |\nSome sentence."
// (single newline, no blank line) renders the sentence squeezed into the
// table's fixed column width instead of as normal text below it. Agents
// are instructed to always leave a blank line there, but LLM output isn't
// 100% reliable about it — this makes it correct regardless, by inserting
// the blank line ourselves whenever it's missing.
function ensureBlankLineAfterTables(text: string): string {
  const lines = text.split('\n');
  const isTableRow = (line: string | undefined) =>
    line !== undefined && /^\s*\|.*\|\s*$/.test(line);
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    const next = lines[i + 1];
    if (isTableRow(lines[i]) && next !== undefined && next.trim() !== '' && !isTableRow(next)) {
      result.push('');
    }
  }
  return result.join('\n');
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  // This turn's tool_results, kept per-message (rather than only bubbled
  // up via onToolResults) so renderBeforeMessage can render something
  // tied to the exact turn that produced it — see chatExtras.tsx.
  toolResults?: Record<string, unknown>;
}

interface ChatPanelProps {
  // Registry agent id (e.g. "service-order") to talk to directly —
  // AgentScreen.tsx's standalone specialist screens pass this. Omitted
  // by ChatScreen.tsx's embedded orchestrator chat, which always talks
  // to the orchestrator and lets it route (see ORCHESTRATOR_AGENT_ID).
  agentId?: string;
  // Fired with a turn's tool_results whenever they're non-empty, plus
  // which specialist (ADK agent name, e.g. "service_order") actually
  // produced them — ChatScreen uses the latter to drive
  // UnifiedLeftPanel's auto-switching. Generic on the toolResults side —
  // ChatPanel doesn't know or care what's inside.
  onToolResults?: (toolResults: Record<string, unknown>, agent?: string) => void;
  // Renders something *before* an assistant turn's chat bubble, keyed off
  // that turn's tool_results — e.g. the Service Order Agent's Invoice
  // card (see registry/chatExtras.tsx's renderChatExtra). The second
  // argument lets an interactive extra (e.g. PortSearch) send a message
  // into the chat on the user's behalf, exactly as if they'd typed it.
  renderBeforeMessage?: (
    toolResults: Record<string, unknown>,
    sendMessage: (text: string) => void,
  ) => ReactNode;
  // Fired once, the moment the user's first message this session is
  // actually sent (Enter or the Send button — not while they're still
  // typing it) — ChatScreen.tsx uses this to switch from the pre-chat
  // welcome layout to the split left-panel/chat layout. Never fired again
  // after that first call.
  onFirstMessageSent?: () => void;
  // 'welcome' visually hides the message transcript and restyles the input
  // row into a centered, rounded search-bar look (see ChatPanel.css) —
  // used by ChatScreen.tsx's pre-chat screen. The SAME ChatPanel instance
  // (same session, same accumulated messages) is reused for both — only
  // this prop and its surrounding layout change — so the silent opening
  // greeting a session starts with is already in `messages` by the time
  // the transcript becomes visible again.
  variant?: 'default' | 'welcome';
  // False for ChatScreen.tsx's embedded orchestrator chat, whose welcome
  // screen already shows an equivalent "what can you help with" heading —
  // showing the greeting bubble too would just duplicate it once the
  // transcript becomes visible. True (default) for AgentScreen.tsx's
  // standalone specialist screens, which have no such heading and rely on
  // this for their opening line.
  autoGreet?: boolean;
}

export interface ChatPanelHandle {
  // Sends a message exactly as if the user had typed and submitted it —
  // used by ChatScreen.tsx's clickable sample prompts, which live outside
  // ChatPanel's own input and so need a way to trigger a turn from there.
  sendMessage: (text: string) => void;
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Streaming chat panel shared by both the embedded orchestrator chat
// (ChatScreen.tsx, no `agentId` — talks to POST /chat's fixed
// "orchestrator" id, which specialist actually handles a given turn is
// decided server-side via ADK's transfer_to_agent) and the standalone
// per-specialist screens (AgentScreen.tsx, passes its own `agentId`
// directly, no routing involved).
const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  { agentId, onToolResults, renderBeforeMessage, onFirstMessageSent, variant = 'default', autoGreet = true },
  ref,
) {
  const [sessionId] = useState(makeSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Which specialist most recently acted (ADK agent name, e.g.
  // "service_order") — drives this panel's own per-specialist table
  // styling (see the wrapper className below and ChatPanel.css). null
  // until the first tool call of the conversation.
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  // Whether a turn is currently in flight — true from the moment it's
  // sent until onDone/onError, rendered as the typing-dots pending
  // bubble the whole time. Text, tool_results, and the left-panel/
  // in-chat-extra they drive are all deliberately held back until the
  // turn actually finishes (see onDone below) rather than appearing
  // piecemeal as each part becomes available — a tool result (e.g. the
  // circuit list, or fresh telemetry) used to reach the left panel and
  // the in-chat picker table the moment its own event arrived, well
  // before the model's own trailing sentence about it had finished
  // streaming, which read as the table/left-panel "jumping ahead of" the
  // agent's response instead of the two appearing together.
  const [turnPending, setTurnPending] = useState(false);
  // The scrollable message list itself (see .chat-messages in
  // ChatPanel.css) — scrolled directly via scrollTop rather than a
  // bottom-sentinel scrollIntoView(), which walks up the DOM scrolling
  // *every* scrollable ancestor into view, not just this one. On "/",
  // where this panel sits below Landing's hero+cards in normal page
  // flow, that used to also drag the whole page down to reveal the
  // sentinel as soon as the greeting arrived — landing the user already
  // scrolled past the hero on first load instead of at the top.
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  // The language selector — always live, not just a session-start seed:
  // re-sent on any turn where it no longer matches what was last actually
  // sent to the backend, so switching it mid-conversation (e.g. Japanese
  // back to English) takes effect on the very next message instead of
  // silently doing nothing. lastSentLanguageRef starts at null ("nothing
  // sent yet"), treated as English for comparison purposes since that's
  // the backend's own unseeded default — this also means English is
  // still correctly skipped on a turn where it wouldn't change anything.
  // If the user instead switches language via in-chat text ("switch to
  // Japanese") without touching this dropdown, this ref is deliberately
  // NOT updated to match — the dropdown and the backend's active language
  // are allowed to diverge in that case, and the next turn correctly
  // sends nothing (this dropdown's own value hasn't changed), leaving
  // whatever the chat-text override set alone.
  const { language } = useLanguage();
  const lastSentLanguageRef = useRef<Language | null>(null);
  // This app's own UI text (input placeholder, Send button, empty-state
  // fallback) — independent of `language` above, which is the AGENT's
  // reply language; see language/LanguageContext.tsx for how one selector
  // drives both.
  const { t } = useTranslation();
  // Guards against React 18 Strict Mode's dev-only double-invocation of
  // mount effects: without this, the greeting effect below fires the real
  // POST /chat call twice (a cleanup flag only stops the *frontend* from
  // rendering the stale response — it doesn't stop the backend/tool call
  // that's already in flight), and two concurrent turns can each try to
  // authenticate + call the same downstream API at once. The ref persists
  // across Strict Mode's simulated unmount/remount, so the guard holds
  // where a per-invocation local variable wouldn't.
  const hasGreetedRef = useRef(false);
  // Guards onFirstMessageSent so it only ever fires once per mount.
  const hasSentFirstMessageRef = useRef(false);

  useEffect(() => {
    const el = messagesContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, turnPending]);

  // Runs one streamed turn: appends the user bubble (unless silent, used
  // for the opening greeting), shows the pending bubble for its duration,
  // and reveals everything it produced — text, left-panel tool_results,
  // and any in-chat extra — together once it actually finishes. `language`
  // is deliberately not a dependency of anything here — it's read fresh
  // each call, and lastSentLanguageRef (not a prop/state dependency) is
  // what decides whether it needs resending this turn, so it doesn't need
  // to be threaded through any effect's dependency array.
  async function runTurn(text: string, { silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setMessages((prev) => [...prev, { role: 'user', text }]);
    }
    setSending(true);
    setTurnPending(true);

    let fullText = '';
    // Which agent produced this turn's content — now set from every
    // text_delta as well as tool_result events (both carry `agent` — see
    // api/client.ts), so it's populated even on a turn that never calls a
    // tool at all (e.g. a specialist's own clarifying question before its
    // first tool call). Previously only tool_result set this, so a
    // text-only turn left the active-agent indicator (Navbar highlight,
    // UnifiedLeftPanel's panel choice) showing whichever specialist was
    // last active, even after the conversation had moved to a new one.
    let turnAgent: string | undefined;

    const shouldSendLanguage = language !== (lastSentLanguageRef.current ?? 'English');
    if (shouldSendLanguage) lastSentLanguageRef.current = language;

    await postChatStream(
      {
        agent_id: agentId ?? ORCHESTRATOR_AGENT_ID,
        message: text,
        session_id: sessionId,
        ...(shouldSendLanguage ? { language } : {}),
      },
      {
        onTextDelta: (delta, agent) => {
          fullText += delta;
          if (agent) turnAgent = agent;
        },
        onToolResult: (_name, _data, agent) => {
          turnAgent = agent;
        },
        onDone: (toolResults, agent) => {
          if (agent) turnAgent = agent;
          // Don't hardcode the "no text response" fallback here — a turn
          // that only calls a passthrough display tool (e.g.
          // present_bandwidth_recommendation) can legitimately have empty
          // reply text, and the picker card it renders already *is* the
          // response. The render loop below only shows the fallback text
          // when there's genuinely no card to show either.
          setMessages((prev) => [...prev, { role: 'assistant', text: fullText, toolResults }]);
          if (turnAgent) {
            onToolResults?.(toolResults, turnAgent);
            setActiveAgent(turnAgent);
          }
          setTurnPending(false);
          setSending(false);
        },
        onError: (message) => {
          setMessages((prev) => [...prev, { role: 'assistant', text: `⚠️ ${message}` }]);
          setTurnPending(false);
          setSending(false);
        },
      },
    );
  }

  // Show the opening greeting as soon as the chat screen opens, without
  // the user having to type anything — skipped entirely when autoGreet is
  // false (ChatScreen.tsx's embedded orchestrator chat, whose welcome
  // screen already covers this). Agents listed in registry/greetings.ts
  // get a fixed string seeded directly — no backend call, since that text
  // never actually varies (and, since there's no backend call, the
  // language seed doesn't fire here either — it'll go out on this same
  // agent's first *typed* message instead, via runTurn above). Any other
  // agent falls back to the original behavior: a silent "Hi" turn so its
  // own system prompt generates the greeting, which is also this
  // session's first postChatStream call and so the one that seeds the
  // language.
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    if (!autoGreet) return;
    const fixedGreetingKey = greetings[agentId ?? ORCHESTRATOR_AGENT_ID];
    if (fixedGreetingKey) {
      setMessages([{ role: 'assistant', text: t(fixedGreetingKey) }]);
    } else {
      runTurn('Hi', { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (overrideText === undefined) setInput('');
    if (!hasSentFirstMessageRef.current) {
      hasSentFirstMessageRef.current = true;
      onFirstMessageSent?.();
    }
    runTurn(text);
  }

  useImperativeHandle(ref, () => ({
    sendMessage: (text: string) => send(text),
  }));

  // A standalone screen already knows which single agent it's talking
  // to (its own `agentId` prop) — the embedded orchestrator chat has no
  // fixed agent, so it falls back to whichever specialist most recently
  // acted (`activeAgent`, from event.author).
  const cssAgent = agentId ?? activeAgent;

  return (
    <div
      className={`chat-panel${cssAgent ? ` chat-panel--${cssAgent.replace(/_/g, '-')}` : ''}${
        variant === 'welcome' ? ' chat-panel--welcome' : ''
      }`}
    >
      <div className="chat-messages" ref={messagesContainerRef}>
        {messages.map((message, i) => {
          const extra =
            message.role === 'assistant' && message.toolResults && renderBeforeMessage
              ? renderBeforeMessage(message.toolResults, send)
              : null;
          // Empty text with a card already showing (e.g.
          // present_bandwidth_recommendation) isn't a failure — the card
          // is the response, so skip the bubble entirely rather than
          // showing an alarming placeholder next to it. Only fall back to
          // the placeholder when there's genuinely nothing to show.
          const text = message.text || (extra ? '' : t('chat.noResponse'));
          return (
            <Fragment key={i}>
              {extra && <div className="chat-extra">{extra}</div>}
              {text !== '' && (
                <div className={`chat-bubble chat-bubble--${message.role}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {ensureBlankLineAfterTables(text)}
                  </ReactMarkdown>
                </div>
              )}
            </Fragment>
          );
        })}
        {turnPending && (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chat.inputPlaceholder')}
          disabled={sending}
        />
        <button className="chat-send" type="submit" disabled={sending || !input.trim()}>
          {t('common.send')}
        </button>
      </form>
    </div>
  );
});

export default ChatPanel;
