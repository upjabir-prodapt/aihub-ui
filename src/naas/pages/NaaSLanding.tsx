import { useEffect, useState } from 'react';
import { fetchAgents } from '../api/client';
import type { AgentPublic } from '../api/types';
import { agentVisuals, defaultAgentVisual } from '../registry/agentVisuals';
import './NaaSLanding.css';

interface NaaSLandingProps {
  onSelectAgent: (agentId: string) => void;
  onOpenAdmin: () => void;
}

export default function NaaSLanding({ onSelectAgent, onOpenAdmin }: NaaSLandingProps) {
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAgents()
      .then(setAgents)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="naas-landing-page">
      <header className="naas-landing-hero">
        <div className="naas-landing-hero-decor" aria-hidden="true">
          <span className="naas-decor-circle naas-decor-circle--1" />
          <span className="naas-decor-circle naas-decor-circle--2" />
          <span className="naas-decor-circle naas-decor-circle--3" />
        </div>
        <button type="button" className="naas-landing-admin-link" onClick={onOpenAdmin}>
          Admin →
        </button>
        <div className="naas-landing-hero-content">
          <h1>Welcome to On-Demand NaaS 2.0</h1>
          <p className="naas-landing-subtitle">
            Select the specialized AI agent from the control panel below to
            handle your operations loop:
          </p>
        </div>
      </header>

      <main className="naas-landing-main">
        {loading && <p className="naas-landing-status">Loading agents…</p>}
        {error && (
          <p className="naas-landing-status naas-landing-error">
            Could not reach the agent backend: {error}
          </p>
        )}

        <div className="naas-agent-grid">
          {agents.map((agent) => {
            const visual = agentVisuals[agent.id] ?? defaultAgentVisual;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => onSelectAgent(agent.id)}
                className="naas-agent-card"
              >
                <span
                  className="naas-agent-card-icon"
                  style={{ color: visual.color, background: `${visual.color}1a` }}
                >
                  {visual.icon}
                </span>
                <h2>{agent.display_name}</h2>
                <p>{agent.description}</p>
                <span className="naas-agent-card-cta" style={{ color: visual.color }}>
                  Open agent →
                </span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
