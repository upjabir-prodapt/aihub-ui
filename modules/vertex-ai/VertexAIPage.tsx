'use client';

import React, { useState } from 'react';
import {
  Cloud,
  ShieldCheck,
  Activity,
  Box,
  Layers,
  GitBranch,
  Lock,
  BarChart3,
  Terminal,
  Database,
  Search,
  RefreshCw,
  Server,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SubTab = 'overview' | 'lifecycle' | 'governance' | 'monitoring';

const NAV_TABS: { id: SubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Environments', icon: <Cloud className="w-4 h-4" /> },
  { id: 'lifecycle', label: 'Model Lifecycle', icon: <RefreshCw className="w-4 h-4" /> },
  { id: 'governance', label: 'Governance & Security', icon: <ShieldCheck className="w-4 h-4" /> },
  { id: 'monitoring', label: 'Observability & AIOps', icon: <Activity className="w-4 h-4" /> },
];

const EnvCard: React.FC<{
  type: string;
  name: string;
  meta: { label: string; value: string }[];
  status: 'active' | 'locked';
  actionLabel: string;
}> = ({ type, name, meta, status, actionLabel }) => (
  <Card className="p-5 flex flex-col gap-4">
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-colt-teal">{type}</span>
      <h3 className="text-lg font-bold text-text-primary mt-1">{name}</h3>
    </div>
    <div className="space-y-2 flex-1">
      {meta.map((m) => (
        <div key={m.label} className="flex justify-between text-xs border-b border-border-subtle/50 pb-1.5">
          <span className="text-text-muted">{m.label}</span>
          <span className="text-text-primary font-medium">{m.value}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center justify-between pt-2">
      <span className={cn(
        "flex items-center gap-1.5 text-xs font-medium",
        status === 'active' ? "text-emerald-400" : "text-amber-400"
      )}>
        <span className={cn("w-1.5 h-1.5 rounded-full", status === 'active' ? "bg-emerald-400" : "bg-amber-400")} />
        {status === 'active' ? 'Active' : 'Hardened'}
      </span>
      <Button variant="outline" size="sm" className="cursor-pointer">{actionLabel}</Button>
    </div>
  </Card>
);

const LifecycleItem: React.FC<{ icon: React.ReactNode; name: string; desc: string }> = ({ icon, name, desc }) => (
  <div className="flex items-start gap-3 p-3 rounded-lg hover:bg-bg-hover transition-colors">
    <div className="w-9 h-9 rounded-lg bg-colt-teal/10 text-colt-teal flex items-center justify-center shrink-0">
      {icon}
    </div>
    <div>
      <div className="text-sm font-semibold text-text-primary">{name}</div>
      <div className="text-xs text-text-muted mt-0.5">{desc}</div>
    </div>
  </div>
);

const VertexAIPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');

  const renderOverview = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <EnvCard
          type="Experimental"
          name="Sandbox"
          meta={[
            { label: 'Data Policy', value: 'Synthetic Only' },
            { label: 'Approval', value: 'Flexible / Fast' },
            { label: 'VPC Access', value: 'Restricted' },
          ]}
          status="active"
          actionLabel="Manage"
        />
        <EnvCard
          type="Testing & Dev"
          name="Development"
          meta={[
            { label: 'Data Policy', value: 'Test Sets (No PII)' },
            { label: 'IAM / Policy', value: 'Standard Ticketing' },
            { label: 'CI/CD Pipeline', value: 'Enabled (Sandbox)' },
          ]}
          status="active"
          actionLabel="Manage"
        />
        <EnvCard
          type="Live Systems"
          name="Production"
          meta={[
            { label: 'Data Policy', value: 'Real Data (Secure)' },
            { label: 'Compliance', value: 'Strict GCP Org Policies' },
            { label: 'Access Control', value: 'No Direct Deployment' },
          ]}
          status="locked"
          actionLabel="View Logs"
        />
      </div>

      <Card>
        <div className="p-5 border-b border-border-subtle">
          <h3 className="text-base font-bold text-text-primary">Infrastructure Highlights</h3>
          <p className="text-xs text-text-secondary mt-0.5">Automated Terraform blueprints and Google Cloud integration.</p>
        </div>
        <CardContent className="pt-5 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 px-3">Network & Auth</div>
            <LifecycleItem icon={<Server className="w-4 h-4" />} name="VPC Service Controls" desc="No public IP exposure. Access via Zscaler & ZTNA." />
            <LifecycleItem icon={<Lock className="w-4 h-4" />} name="Federated Entra ID" desc="Enterprise SSO with role-based least privilege." />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 px-3">CI/CD Automation</div>
            <LifecycleItem icon={<GitBranch className="w-4 h-4" />} name="Cloud Build Pipelines" desc="Regular, compliant deployments via GitHub Actions." />
            <LifecycleItem icon={<Terminal className="w-4 h-4" />} name="Terraform IaC" desc="Blueprints for Sandbox, Dev, and Prod provisioning." />
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderLifecycle = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-text-primary">AI Lifecycle Management</h2>
          <p className="text-xs text-text-secondary mt-0.5">Unified Vertex AI orchestration for models and pipelines.</p>
        </div>
        <Badge variant="secondary">GOOGLE CLOUD VERTEX AI</Badge>
      </div>

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 px-3">Development & Deployment</div>
            <LifecycleItem icon={<Box className="w-4 h-4" />} name="Model Registry" desc="Version control and lifecycle management for all models." />
            <LifecycleItem icon={<Layers className="w-4 h-4" />} name="Vertex Pipelines" desc="Automated training and deployment workflows." />
            <LifecycleItem icon={<Database className="w-4 h-4" />} name="Feature Store" desc="Centralized repository for serving and sharing features." />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2 px-3">Observability & Drift</div>
            <LifecycleItem icon={<Activity className="w-4 h-4" />} name="Data Drift Detection" desc="Automated monitoring for input/output data quality." />
            <LifecycleItem icon={<BarChart3 className="w-4 h-4" />} name="Performance Metrics" desc="Accuracy, Latency, and Throughput monitoring." />
            <LifecycleItem icon={<Search className="w-4 h-4" />} name="Explainability" desc="Feature attribution and decision traceability tools." />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Registered Models', value: '12' },
          { label: 'Active Pipelines', value: '8' },
          { label: 'Avg. Latency', value: '120ms' },
          { label: 'Model Health', value: 'Optimal', color: 'text-emerald-400' },
        ].map((m) => (
          <Card key={m.label} className="p-4 text-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{m.label}</div>
            <div className={cn("text-xl font-bold text-text-primary", m.color)}>{m.value}</div>
          </Card>
        ))}
      </div>
    </div>
  );

  const renderGovernance = () => (
    <div className="space-y-6">
      <Card className="p-5 flex items-center gap-4 bg-colt-teal/5 border-colt-teal/20">
        <ShieldCheck className="w-7 h-7 text-colt-teal shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-bold text-text-primary">Security & SIEM Integration</div>
          <div className="text-xs text-text-secondary mt-0.5">All Vertex AI logs and metrics are forwarded to Microsoft Sentinel for centralized monitoring.</div>
        </div>
        <Badge variant="success">SENTINEL ACTIVE</Badge>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'IAM Compliance', value: '100%', trend: 'Zero policy violations', trendColor: 'text-emerald-400' },
          { label: 'Encryption Status', value: 'CMEK', trend: 'Customer-managed keys' },
          { label: 'Audit Log Coverage', value: 'FULL', trend: 'Real-time forwarding', trendColor: 'text-emerald-400' },
          { label: 'Privacy Score', value: 'A+', trend: 'DLP Policy enabled' },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">{m.label}</div>
            <div className="text-xl font-bold text-text-primary mb-1">{m.value}</div>
            <div className={cn("text-[11px]", m.trendColor ?? "text-text-muted")}>{m.trend}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div className="p-5 border-b border-border-subtle">
          <h4 className="text-sm font-bold text-text-primary">Compliance Guardrails</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border-subtle">
                <th className="p-3 font-semibold">Policy Control</th>
                <th className="p-3 font-semibold">Standard</th>
                <th className="p-3 font-semibold">Scope</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: 'Access Control', standard: 'Least Privilege / RBAC', scope: 'All Environments', status: 'Verified', variant: 'success' as const },
                { name: 'Data Localization', standard: 'EU-West-1 / EU-Central-1', scope: 'Production', status: 'Verified', variant: 'success' as const },
                { name: 'CMEK Rotation', standard: 'Annual Rotation', scope: 'All Persistent Storage', status: 'Due in 14d', variant: 'warning' as const },
              ].map((row) => (
                <tr key={row.name} className="border-b border-border-subtle/50 last:border-0">
                  <td className="p-3 font-semibold text-text-primary">{row.name}</td>
                  <td className="p-3 text-text-secondary">{row.standard}</td>
                  <td className="p-3 text-text-secondary">{row.scope}</td>
                  <td className="p-3"><Badge variant={row.variant}>{row.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-base">
      <nav className="flex items-center justify-between px-6 py-3 border-b border-border-subtle bg-bg-surface shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1">
          {NAV_TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
                activeSubTab === tab.id
                  ? "bg-colt-teal/10 text-colt-teal"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              )}
              onClick={() => setActiveSubTab(tab.id)}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[11px] font-medium text-emerald-400 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Platform Status: Healthy
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto p-6">
        {activeSubTab === 'overview' && renderOverview()}
        {activeSubTab === 'lifecycle' && renderLifecycle()}
        {activeSubTab === 'governance' && renderGovernance()}
        {activeSubTab === 'monitoring' && (
          <div className="flex flex-col items-center justify-center text-center py-24">
            <div className="w-14 h-14 rounded-full bg-colt-teal/10 text-colt-teal flex items-center justify-center mb-4">
              <Activity className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-text-primary mb-2">Observability Dashboard</h3>
            <p className="text-sm text-text-secondary max-w-md">Real-time tracing, error reporting, and SLO monitoring integrated with Cloud Monitoring.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VertexAIPage;
