import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './AiAnalysisNote.css';

// Shared left-panel "AI Analysis" card — originally Service Observability
// Agent-only (one per telemetry metric, generated server-side by
// core/telemetry_analysis.py), now also used by the Service Order Agent
// to surface its existing bandwidth/commitment-period recommendation
// reasoning (present_bandwidth_recommendation/present_commitment_
// recommendation's `reason`, already shown in the chat picker card —
// this is an additional left-panel surface of that same data, not a
// replacement for it) — see ServiceOrderPanel.tsx. Renders nothing at
// all (not an empty card) when `text` is absent.
export default function AiAnalysisNote({ text }: { text?: string }) {
  const { t } = useTranslation();
  if (!text) return null;
  return (
    <div className="ai-analysis-note">
      <div className="ai-analysis-note-title">
        <Sparkles size={15} />
        {t('sreMonitor.aiAnalysis')}
      </div>
      <p>{text}</p>
    </div>
  );
}
