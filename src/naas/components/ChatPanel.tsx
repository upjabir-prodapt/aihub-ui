import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { postChat } from '../api/client';
import './ChatPanel.css';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  // This turn's tool_results, kept per-message (rather than only bubbled
  // up via onToolResults) so renderBeforeMessage can render something
  // tied to the exact turn that produced it — see chatExtras.tsx.
  toolResults?: Record<string, unknown>;
}

interface ChatPanelProps {
  agentId: string;
  // Fired with a turn's tool_results whenever they're non-empty. Generic —
  // ChatPanel doesn't know or care what's inside; a left-panel component
  // interprets them for its own agent (see registry/leftPanels.tsx).
  onToolResults?: (toolResults: Record<string, unknown>) => void;
  // Optional per-agent hook (registry/chatExtras.tsx): renders something
  // *before* an assistant turn's chat bubble, keyed off that turn's
  // tool_results — e.g. the Service Order Agent's Invoice card. Most
  // agents don't set this and get nothing extra rendered. The second
  // argument lets an interactive extra (e.g. PortSearch) send a message
  // into the chat on the user's behalf, exactly as if they'd typed it.
  renderBeforeMessage?: (
    toolResults: Record<string, unknown>,
    sendMessage: (text: string) => void,
  ) => ReactNode;
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Generic REST chat panel — agent-agnostic. It talks to POST /chat with
// whichever agentId is passed in, so this same component works for every
// agent screen; nothing here is SRE-Monitor-specific.
export default function ChatPanel({ agentId, onToolResults, renderBeforeMessage }: ChatPanelProps) {
  const [sessionId] = useState(makeSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Guards against React 18 Strict Mode's dev-only double-invocation of
  // mount effects: without this, the greeting effect below fires the real
  // POST /chat call twice (a cleanup flag only stops the *frontend* from
  // rendering the stale response — it doesn't stop the backend/tool call
  // that's already in flight), and two concurrent turns can each try to
  // authenticate + call the same downstream API at once. The ref persists
  // across Strict Mode's simulated unmount/remount, so the guard holds
  // where a per-invocation local variable wouldn't.
  const hasGreetedRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Kick the conversation off as soon as the agent screen opens, so the
  // agent can greet the user first (per its system prompt) without them
  // having to type anything.
  useEffect(() => {
    if (hasGreetedRef.current) return;
    hasGreetedRef.current = true;

    setSending(true);
    postChat({ agent_id: agentId, message: 'Hi', session_id: sessionId })
      .then((res) => {
        setMessages([{ role: 'assistant', text: res.reply, toolResults: res.tool_results }]);
        if (onToolResults && Object.keys(res.tool_results ?? {}).length > 0) {
          onToolResults(res.tool_results);
        }
      })
      .catch((err: Error) => {
        setMessages([{ role: 'assistant', text: `⚠️ ${err.message}` }]);
      })
      .finally(() => {
        setSending(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    if (overrideText === undefined) setInput('');
    setMessages((prev) => [...prev, { role: 'user', text }]);
    setSending(true);
    try {
      const res = await postChat({ agent_id: agentId, message: text, session_id: sessionId });
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.reply, toolResults: res.tool_results },
      ]);
      if (onToolResults && Object.keys(res.tool_results ?? {}).length > 0) {
        onToolResults(res.tool_results);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `⚠️ ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((message, i) => {
          const extra =
            message.role === 'assistant' && message.toolResults && renderBeforeMessage
              ? renderBeforeMessage(message.toolResults, send)
              : null;
          return (
            <Fragment key={i}>
              {extra && <div className="chat-extra">{extra}</div>}
              <div className={`chat-bubble chat-bubble--${message.role}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
              </div>
            </Fragment>
          );
        })}
        {sending && (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--pending">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
        <div ref={bottomRef} />
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
          placeholder="Type a message…"
          disabled={sending}
        />
        <button className="chat-send" type="submit" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
