import React, { useMemo, useState } from 'react';
import { Languages, Users2, FileText, Boxes, ArrowRight, Search } from 'lucide-react';
import { useAuth } from '../auth/useAuth';
import { useTranslationJobs } from '../translation/useTranslationJobs';
import { useSalesJobs } from '../sales/useSalesJobs';
import type { ServiceEntitlements } from '../../shared/ui/Sidebar';
import '../../styles/service-hub.css';

interface ServiceHubPageProps {
  entitlements?: ServiceEntitlements;
  onNavigate: (tab: string) => void;
}

interface ServiceCardDef {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  icon: React.ReactNode;
  comingSoon?: boolean;
  entitlementKey?: keyof ServiceEntitlements;
}

const SERVICES: ServiceCardDef[] = [
  {
    id: 'translation',
    name: 'Translation',
    category: 'Language',
    description: 'Documents and copy translated across supported languages, formatting intact.',
    tags: ['txt', 'docx', 'pdf'],
    icon: <Languages size={18} />,
    entitlementKey: 'translation',
  },
  {
    id: 'sales',
    name: 'Sales Agent',
    category: 'Revenue',
    description: 'Account research briefs built from public company signals.',
    tags: ['brief', 'pdf'],
    icon: <Users2 size={18} />,
    entitlementKey: 'sales',
  },
  {
    id: 'contracts',
    name: 'Contract Management',
    category: 'Revenue',
    description: 'Contract repository, clause extraction and an AI review assistant.',
    tags: ['pdf', 'docx', 'xlsx'],
    icon: <FileText size={18} />,
    comingSoon: true,
  },
  {
    id: 'vertex-ai',
    name: 'Vertex AI Platform',
    category: 'Platform',
    description: 'Model lifecycle management across sandbox, development and production.',
    tags: [],
    icon: <Boxes size={18} />,
    comingSoon: true,
  },
];

function displayNameFromEmail(email: string | null): string {
  if (!email) return 'there';
  const local = email.split('@')[0] ?? email;
  const first = local.split(/[.\-_]/)[0] ?? local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const ServiceHubPage: React.FC<ServiceHubPageProps> = ({ entitlements, onNavigate }) => {
  const { user } = useAuth();
  const { jobs: tJobs, jobOrder: tJobOrder } = useTranslationJobs();
  const { jobs: sJobs, jobOrder: sJobOrder } = useSalesJobs();
  const [query, setQuery] = useState('');

  const email = user?.email ?? null;
  // `companyName` comes from MS Graph at sign-in (decision D6), replacing the
  // Organization field the old blocking modal asked every user to type.
  const org = user?.companyName ?? null;

  const translationActive = tJobOrder
    .map((id) => tJobs[id])
    .filter((j) => j && j.status !== 'completed' && j.status !== 'failed' && j.status !== 'cancelled');

  const salesActive = sJobOrder
    .map((id) => sJobs[id])
    .filter((j) => j && ['PENDING', 'QUEUED', 'PROCESSING'].includes(j.status));

  const inFlightItems = useMemo(() => {
    const items: { id: string; title: string; subtitle: string }[] = [
      ...translationActive.map((j) => ({
        id: j.job_id,
        title: j.result?.translated_document?.filename || `Job ${j.job_id.slice(0, 8)}…`,
        subtitle: 'Translation',
      })),
      ...salesActive.map((j) => ({
        id: j.job_id,
        title: j.company_name || `Job ${j.job_id.slice(0, 8)}…`,
        subtitle: 'Sales research',
      })),
    ];
    return items.slice(0, 4);
  }, [translationActive, salesActive]);

  const totalInFlight = translationActive.length + salesActive.length;

  const inFlightByService = (id: string): number => {
    if (id === 'translation') return translationActive.length;
    if (id === 'sales') return salesActive.length;
    return 0;
  };

  const filtered = useMemo(() => {
    const isLocked = (s: (typeof SERVICES)[number]): boolean =>
      !s.comingSoon &&
      s.entitlementKey !== undefined &&
      entitlements !== undefined &&
      !entitlements[s.entitlementKey];

    const q = query.trim().toLowerCase();
    return SERVICES.filter((s) => {
      if (isLocked(s)) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [entitlements, query]);

  const categories = useMemo(() => {
    return Array.from(new Set(filtered.map((s) => s.category)));
  }, [filtered]);

  return (
    <div className="page-content">
      <div className="hub-page">
        <p className="hub-eyebrow">
          Colt AI Hub{org ? ` · ${org}` : ''}
        </p>
        <h1 className="hub-title">Welcome back, {displayNameFromEmail(email)}.</h1>
        <p className="hub-subtitle">
          Every AI service you're entitled to, in one place. Start a job, watch it run, and pick up
          right where a failed run left off — no re-uploading required.
        </p>

        {totalInFlight > 0 && (
          <div className="hub-inflight-card">
            <div className="hub-inflight-header">
              <span>In flight now</span>
              <span className="hub-inflight-count">{totalInFlight}</span>
            </div>
            <ul className="hub-inflight-list">
              {inFlightItems.map((item) => (
                <li key={item.id} className="hub-inflight-item">
                  <span className="hub-inflight-dot" />
                  <span className="hub-inflight-title">{item.title}</span>
                  <span className="hub-inflight-sub">{item.subtitle}</span>
                </li>
              ))}
            </ul>
            <button type="button" className="hub-inflight-link" onClick={() => onNavigate('tracker')}>
              Open job tracker <ArrowRight size={13} />
            </button>
          </div>
        )}

        <div className="hub-search-wrap">
          <Search size={16} className="hub-search-icon" />
          <input
            type="search"
            className="hub-search-input"
            placeholder="Search services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search services"
          />
        </div>

        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: '24px 0' }}>
            No services match &ldquo;{query}&rdquo;.
          </p>
        )}

        {categories.map((category) => (
          <section key={category} className="hub-category">
            <div className="hub-category-label">{category}</div>
            <div className="hub-card-grid">
              {filtered
                .filter((s) => s.category === category)
                .map((service) => {
                  const disabled = service.comingSoon;
                  const inFlight = inFlightByService(service.id);

                  return (
                    <div key={service.id} className={`hub-card ${disabled ? 'hub-card--disabled' : ''}`}>
                      <div className="hub-card-top">
                        <span className="hub-card-icon">{service.icon}</span>
                        <div>
                          <h3 className="hub-card-title">{service.name}</h3>
                          <p className="hub-card-desc">{service.description}</p>
                        </div>
                      </div>

                      {service.tags.length > 0 && (
                        <div className="hub-card-tags">
                          {service.tags.map((tag) => (
                            <span key={tag} className="hub-tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="hub-card-footer">
                        <span className="hub-card-status">
                          {service.comingSoon ? (
                            <span className="hub-status-soon">Coming soon</span>
                          ) : inFlight > 0 ? (
                            <>
                              <span className="hub-status-dot" /> {inFlight} in flight
                            </>
                          ) : (
                            <span className="hub-status-idle">Idle</span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="hub-run-btn"
                          disabled={disabled}
                          onClick={() => !disabled && onNavigate(service.id)}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};

export default ServiceHubPage;
