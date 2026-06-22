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
import '../styles/vertex-ai.css';

type SubTab = 'overview' | 'lifecycle' | 'governance' | 'monitoring';

const VertexAIPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('overview');

  const renderOverview = () => (
    <div className="vertex-overview">
      <div className="env-grid">
        <div className="env-card">
          <div className="env-type">Experimental</div>
          <h2 className="env-name">Sandbox</h2>
          <div className="env-meta">
            <div className="env-meta-item">
              <span className="meta-label">Data Policy</span>
              <span className="meta-value">Synthetic Only</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">Approval</span>
              <span className="meta-value">Flexible / Fast</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">VPC Access</span>
              <span className="meta-value">Restricted</span>
            </div>
          </div>
          <div className="env-card-footer">
            <span className="env-status"><span className="env-status-dot status-active" /> Active</span>
            <button className="output-action-btn">Manage</button>
          </div>
        </div>

        <div className="env-card">
          <div className="env-type">Testing & Dev</div>
          <h2 className="env-name">Development</h2>
          <div className="env-meta">
            <div className="env-meta-item">
              <span className="meta-label">Data Policy</span>
              <span className="meta-value">Test Sets (No PII)</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">IAM / Policy</span>
              <span className="meta-value">Standard Ticketing</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">CI/CD Pipeline</span>
              <span className="meta-value">Enabled (Sandbox)</span>
            </div>
          </div>
          <div className="env-card-footer">
            <span className="env-status"><span className="env-status-dot status-active" /> Active</span>
            <button className="output-action-btn">Manage</button>
          </div>
        </div>

        <div className="env-card">
          <div className="env-type">Live Systems</div>
          <h2 className="env-name">Production</h2>
          <div className="env-meta">
            <div className="env-meta-item">
              <span className="meta-label">Data Policy</span>
              <span className="meta-value">Real Data (Secure)</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">Compliance</span>
              <span className="meta-value">Strict GCP Org Policies</span>
            </div>
            <div className="env-meta-item">
              <span className="meta-label">Access Control</span>
              <span className="meta-value">No Direct Deployment</span>
            </div>
          </div>
          <div className="env-card-footer">
            <span className="env-status"><span className="env-status-dot status-locked" /> Hardened</span>
            <button className="output-action-btn">View Logs</button>
          </div>
        </div>
      </div>

      <div className="lifecycle-section" style={{ marginTop: '24px' }}>
         <div className="lifecycle-header">
            <div>
               <h3 className="hero-title" style={{ fontSize: '18px' }}>Infrastructure Highlights</h3>
               <p className="hero-subtitle">Automated Terraform blueprints and Google Cloud integration.</p>
            </div>
         </div>
         <div className="lifecycle-grid">
            <div className="lifecycle-category">
               <div className="category-title">Network & Auth</div>
               <div className="lifecycle-item">
                  <div className="item-icon"><Server size={20} /></div>
                  <div className="item-content">
                     <div className="item-name">VPC Service Controls</div>
                     <div className="item-desc">No public IP exposure. Access via Zscaler & ZTNA.</div>
                  </div>
               </div>
               <div className="lifecycle-item">
                  <div className="item-icon"><Lock size={20} /></div>
                  <div className="item-content">
                     <div className="item-name">Federated Entra ID</div>
                     <div className="item-desc">Enterprise SSO with role-based least privilege.</div>
                  </div>
               </div>
            </div>
            <div className="lifecycle-category">
               <div className="category-title">CI/CD Automation</div>
               <div className="lifecycle-item">
                  <div className="item-icon"><GitBranch size={20} /></div>
                  <div className="item-content">
                     <div className="item-name">Cloud Build Pipelines</div>
                     <div className="item-desc">Regular, compliant deployments via GitHub Actions.</div>
                  </div>
               </div>
               <div className="lifecycle-item">
                  <div className="item-icon"><Terminal size={20} /></div>
                  <div className="item-content">
                     <div className="item-name">Terraform IaC</div>
                     <div className="item-desc">Blueprints for Sandbox, Dev, and Prod provisioning.</div>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );

  const renderLifecycle = () => (
    <div className="lifecycle-section">
      <header className="lifecycle-header">
        <div>
          <h2 className="hero-title" style={{ fontSize: '20px' }}>AI Lifecycle Management</h2>
          <p className="hero-subtitle">Unified Vertex AI orchestration for models and pipelines.</p>
        </div>
        <div className="security-badge">GOOGLE CLOUD VERTEX AI</div>
      </header>

      <div className="lifecycle-grid">
        <div className="lifecycle-category">
           <div className="category-title">Development & Deployment</div>
           <div className="lifecycle-item">
              <div className="item-icon"><Box size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Model Registry</div>
                 <div className="item-desc">Version control and lifecycle management for all models.</div>
              </div>
           </div>
           <div className="lifecycle-item">
              <div className="item-icon"><Layers size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Vertex Pipelines</div>
                 <div className="item-desc">Automated training and deployment workflows.</div>
              </div>
           </div>
           <div className="lifecycle-item">
              <div className="item-icon"><Database size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Feature Store</div>
                 <div className="item-desc">Centralized repository for serving and sharing features.</div>
              </div>
           </div>
        </div>

        <div className="lifecycle-category">
           <div className="category-title">Observability & Drift</div>
           <div className="lifecycle-item">
              <div className="item-icon"><Activity size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Data Drift Detection</div>
                 <div className="item-desc">Automated monitoring for input/output data quality.</div>
              </div>
           </div>
           <div className="lifecycle-item">
              <div className="item-icon"><BarChart3 size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Performance Metrics</div>
                 <div className="item-desc">Accuracy, Latency, and Throughput monitoring.</div>
              </div>
           </div>
           <div className="lifecycle-item">
              <div className="item-icon"><Search size={20} /></div>
              <div className="item-content">
                 <div className="item-name">Explainability</div>
                 <div className="item-desc">Feature attribution and decision traceability tools.</div>
              </div>
           </div>
        </div>
      </div>

      <div className="metrics-row" style={{ marginTop: '32px' }}>
         <div className="metric-card">
            <div className="metric-lbl">Registered Models</div>
            <div className="metric-val">12</div>
         </div>
         <div className="metric-card">
            <div className="metric-lbl">Active Pipelines</div>
            <div className="metric-val">8</div>
         </div>
         <div className="metric-card">
            <div className="metric-lbl">Avg. Latency</div>
            <div className="metric-val">120ms</div>
         </div>
         <div className="metric-card">
            <div className="metric-lbl">Model Health</div>
            <div className="metric-val" style={{ color: '#10b981' }}>Optimal</div>
         </div>
      </div>
    </div>
  );

  const renderGovernance = () => (
    <div className="governance-view">
      <div className="security-strip" style={{ marginBottom: '24px' }}>
         <ShieldCheck size={28} />
         <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>Security & SIEM Integration</div>
            <div style={{ opacity: 0.8, fontSize: '12px' }}>All Vertex AI logs and metrics are forwarded to Microsoft Sentinel for centralized monitoring.</div>
         </div>
         <div className="security-badge">SENTINEL ACTIVE</div>
      </div>

      <div className="analytics-grid">
         <div className="analytics-card">
            <div className="analytics-title">IAM Compliance</div>
            <div className="analytics-value">100%</div>
            <div className="analytics-trend trend-up">Zero policy violations</div>
         </div>
         <div className="analytics-card">
            <div className="analytics-title">Encryption Status</div>
            <div className="analytics-value">CMEK</div>
            <div className="analytics-trend">Customer-managed keys</div>
         </div>
         <div className="analytics-card">
            <div className="analytics-title">Audit Log Coverage</div>
            <div className="analytics-value">FULL</div>
            <div className="analytics-trend trend-up">Real-time forwarding</div>
         </div>
         <div className="analytics-card">
            <div className="analytics-title">Privacy Score</div>
            <div className="analytics-value">A+</div>
            <div className="analytics-trend">DLP Policy enabled</div>
         </div>
      </div>

      <div className="lifecycle-section" style={{ marginTop: '24px' }}>
         <h4 className="category-title">Compliance Guardrails</h4>
         <div className="lifecycle-grid">
            <div className="repo-table-wrap" style={{ gridColumn: 'span 2' }}>
               <table className="repo-table">
                  <thead>
                     <tr>
                        <th>Policy Control</th>
                        <th>Standard</th>
                        <th>Scope</th>
                        <th>Status</th>
                     </tr>
                  </thead>
                  <tbody>
                     <tr>
                        <td style={{ fontWeight: 600 }}>Access Control</td>
                        <td>Least Privilege / RBAC</td>
                        <td>All Environments</td>
                        <td><span className="badge-compliance badge-good">Verified</span></td>
                     </tr>
                     <tr>
                        <td style={{ fontWeight: 600 }}>Data Localization</td>
                        <td>EU-West-1 / EU-Central-1</td>
                        <td>Production</td>
                        <td><span className="badge-compliance badge-good">Verified</span></td>
                     </tr>
                     <tr>
                        <td style={{ fontWeight: 600 }}>CMEK Rotation</td>
                        <td>Annual Rotation</td>
                        <td>All Persistent Storage</td>
                        <td><span className="badge-compliance badge-warning">Due in 14d</span></td>
                     </tr>
                  </tbody>
               </table>
            </div>
         </div>
      </div>
    </div>
  );

  return (
    <div className="vertex-container">
      <nav className="sub-nav">
        <div className="sub-nav-tabs">
          <button className={`sub-nav-btn ${activeSubTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveSubTab('overview')}>
            <Cloud size={18} /> Environments
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'lifecycle' ? 'active' : ''}`} onClick={() => setActiveSubTab('lifecycle')}>
            <RefreshCw size={18} /> Model Lifecycle
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'governance' ? 'active' : ''}`} onClick={() => setActiveSubTab('governance')}>
            <ShieldCheck size={18} /> Governance & Security
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'monitoring' ? 'active' : ''}`} onClick={() => setActiveSubTab('monitoring')}>
            <Activity size={18} /> Observability & AIOps
          </button>
        </div>
        
        <div className="status-pill">
           <div className="status-active" style={{ width: '8px', height: '8px', borderRadius: '50%', marginRight: '8px' }} />
           Platform Status: Healthy
        </div>
      </nav>

      <div className="vertex-content" style={{ flex: 1, overflowY: 'auto' }}>
        {activeSubTab === 'overview' && renderOverview()}
        {activeSubTab === 'lifecycle' && renderLifecycle()}
        {activeSubTab === 'governance' && renderGovernance()}
        {activeSubTab === 'monitoring' && (
           <div className="output-placeholder">
              <Activity size={48} color="var(--colt-teal)" />
              <h3 className="hero-title" style={{ marginTop: '16px' }}>Observability Dashboard</h3>
              <p className="hero-subtitle">Real-time tracing, error reporting, and SLO monitoring integrated with Cloud Monitoring.</p>
           </div>
        )}
      </div>
    </div>
  );
};

export default VertexAIPage;
