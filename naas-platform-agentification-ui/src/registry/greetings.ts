// Frontend-side companion to chatExtras.tsx/leftPanels.tsx: a fixed,
// per-agent opening greeting shown immediately on mount, with no backend
// call — the greeting text never actually varies, so a silent "Hi" turn
// would be pure added latency for a fixed string. Only agents listed here
// skip the backend round-trip; any agentId not present falls back to
// ChatPanel's original silent-"Hi" behavior. The embedded orchestrator
// chat (ChatScreen.tsx) doesn't use this at all — it passes
// autoGreet={false} instead, since its "Welcome to On-Demand NaaS 2.0 /
// How can I help you today?" heading already covers what a greeting
// bubble would otherwise say (see agents/orchestrator/prompt.md's ROLE &
// PURPOSE/TONE & GUARDRAILS intro for the equivalent copy the agent
// itself would use if asked directly, e.g. via a stray /agents/orchestrator
// URL).
//
// Values are i18n translation keys, not raw text — this is a plain
// object (no hook context to call useTranslation() from), so
// ChatPanel.tsx's own `t()` resolves the key at the point the greeting
// is actually shown.
export const greetings: Record<string, string> = {
  'service-order': 'greetings.serviceOrder',
};
