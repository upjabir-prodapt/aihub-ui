import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  LayoutDashboard, 
  Database, 
  UploadCloud, 
  Search, 
  MessageSquare, 
  FileSearch,
  TrendingUp,
  AlertTriangle,
  Clock,
  Filter,
  Download,
  MoreVertical,
  Send,
  User,
  Bot
} from 'lucide-react';
import { config } from '../config';
import '../styles/contracts.css';

const API_BASE = config.contracts.apiBase;

type TabType = 'dashboard' | 'repository' | 'upload' | 'review' | 'assistant';

interface ContractDocument {
  docx: string;
  stored_at: string;
}

const ContractManagementPage: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<TabType>('dashboard');
  const [docs, setDocs] = useState<ContractDocument[]>([]);
  const [selectedDocKey, setSelectedDocKey] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState([
    { role: 'bot', text: 'Hello! I am your Colt AI Assistant. You can ask me questions about your contracts, such as "What are the termination clauses in the MSA?" or "Summarize the obligations for Counterparty X".' }
  ]);
  const [inputText, setInputText] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await axios.get<ContractDocument[]>(`${API_BASE}/documents`);
        if (!cancelled) setDocs(res.data);
      } catch (err) {
        console.error('Fetch docs error:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const renderDashboard = () => (
    <div className="analytics-content">
      <div className="analytics-grid">
        <div className="analytics-card">
          <div className="analytics-title">Total Contracts</div>
          <div className="analytics-value">1,284</div>
          <div className="analytics-trend trend-up">
            <TrendingUp size={14} /> +12% vs last month
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-title">Compliance Score</div>
          <div className="analytics-value">84%</div>
          <div className="analytics-trend" style={{ color: 'var(--text-muted)' }}>
            Average across portfolio
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-title">Critical Findings</div>
          <div className="analytics-value" style={{ color: '#ef4444' }}>24</div>
          <div className="analytics-trend trend-down">
            <AlertTriangle size={14} /> Requires immediate review
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-title">Upcoming Renewals</div>
          <div className="analytics-value">42</div>
          <div className="analytics-trend" style={{ color: 'var(--text-teal)' }}>
            Next 30 days
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        <div className="analytics-card">
          <div className="analytics-title">Contract Types Distribution</div>
          <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            [Chart Area: MSAs, NDAs, Orders, SLAs]
          </div>
        </div>
        <div className="analytics-card">
          <div className="analytics-title">Compliance Trend</div>
          <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
            [Line Chart: Score over time]
          </div>
        </div>
      </div>
    </div>
  );

  const renderRepository = () => (
    <div className="repository-content">
      <div className="repo-controls">
        <div className="contract-search-wrapper" style={{ maxWidth: '400px' }}>
          <Search className="contract-search-icon" size={18} />
          <input type="text" className="contract-search-input" placeholder="Search across repository..." />
        </div>
        <button className="output-action-btn">
          <Filter size={16} /> Filters
        </button>
        <button className="output-action-btn" style={{ marginLeft: 'auto' }}>
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="repo-table-wrap">
        <table className="repo-table">
          <thead>
            <tr>
              <th>Document Key</th>
              <th>Type</th>
              <th>Counterparty</th>
              <th>Date Stored</th>
              <th>Compliance</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc, i) => (
              <tr key={doc.docx} onClick={() => { setSelectedDocKey(doc.docx); setActiveSubTab('review'); }} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 600 }}>{doc.docx}</td>
                <td>{i % 3 === 0 ? 'NDA' : i % 3 === 1 ? 'MSA' : 'Order Form'}</td>
                <td>Colt Services Ltd.</td>
                <td>{new Date(doc.stored_at).toLocaleDateString()}</td>
                <td>
                  <span className={`badge-compliance ${i % 4 === 0 ? 'badge-critical' : i % 4 === 1 ? 'badge-warning' : 'badge-good'}`}>
                    {i % 4 === 0 ? 'Critical' : i % 4 === 1 ? 'Low' : 'Compliant'}
                  </span>
                </td>
                <td><MoreVertical size={16} color="var(--text-muted)" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderReview = () => (
    <div className="review-layout">
      <div className="doc-viewer">
        <div style={{ textAlign: 'center' }}>
          <FileSearch size={64} style={{ opacity: 0.2, marginBottom: '16px' }} />
          <p>PDF Interaction Viewport</p>
          <span style={{ fontSize: '11px', opacity: 0.5 }}>{selectedDocKey || 'No Document Selected'}</span>
        </div>
      </div>

      <div className="insight-panel">
        <div className="insight-header">
           <h3 style={{ fontSize: '16px', fontWeight: 700 }}>Contract Insights</h3>
           <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>AI-Extracted Data & Summary</p>
        </div>
        <div className="insight-body">
           <div className="data-section">
              <h4 className="section-title">AI Summary</h4>
              <div className="page-tabs" style={{ marginBottom: '12px' }}>
                <button className="page-tab-btn active" style={{ padding: '4px 10px', fontSize: '11px' }}>Short</button>
                <button className="page-tab-btn" style={{ padding: '4px 10px', fontSize: '11px' }}>Medium</button>
                <button className="page-tab-btn" style={{ padding: '4px 10px', fontSize: '11px' }}>Full</button>
              </div>
              <p style={{ fontSize: '13px', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
                This agreement establishes the terms for a 3-year partnership between Colt Technology Services and the provider. Key risks include a strict 90-day notice period for termination and unlimited liability for data breaches.
              </p>
           </div>

           <div className="data-section">
              <h4 className="section-title">Key Data Points</h4>
              <div className="data-grid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="data-card">
                  <div className="card-label">Counterparty</div>
                  <div className="card-value">Enterprise Solutions Inc.</div>
                </div>
                <div className="data-card">
                  <div className="card-label">Effective Date</div>
                  <div className="card-value">Jan 12, 2026</div>
                </div>
                <div className="data-card">
                  <div className="card-label">Compliance Store</div>
                  <div className="card-value" style={{ color: '#ef4444', fontWeight: 700 }}>62 / 100 (Critical)</div>
                </div>
              </div>
           </div>
        </div>
      </div>
    </div>
  );

  const renderAssistant = () => (
    <div className="assistant-container">
      <div className="chat-history">
        {chatMessages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
             <div className="msg-avatar" style={{ 
               width: '36px', height: '36px', borderRadius: '10px', 
               background: msg.role === 'user' ? 'var(--colt-teal)' : 'var(--bg-elevated)',
               display: 'flex', alignItems: 'center', justifyContent: 'center'
             }}>
               {msg.role === 'user' ? <User size={18} color="white" /> : <Bot size={18} color="var(--colt-teal)" />}
             </div>
             <div className="msg-bubble">
                {msg.text}
                {msg.role === 'bot' && i === 0 && (
                   <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                      <button className="meta-chip">What is the liability cap?</button>
                      <button className="meta-chip">List all expiring NDAs</button>
                   </div>
                )}
             </div>
          </div>
        ))}
      </div>
      <div className="chat-input-wrap">
        <form className="chat-input-area" onSubmit={(e) => {
          e.preventDefault();
          if (!inputText.trim()) return;
          setChatMessages([...chatMessages, { role: 'user', text: inputText }]);
          setInputText('');
          // Simulate bot response
          setTimeout(() => {
            setChatMessages(prev => [...prev, { role: 'bot', text: 'I am analyzing your request across the contract corpus...' }]);
          }, 1000);
        }}>
           <input 
             type="text" 
             className="chat-input" 
             placeholder="Ask a question about your contracts..." 
             value={inputText}
             onChange={(e) => setInputText(e.target.value)}
           />
           <button type="submit" className="translate-btn" style={{ width: 'auto', padding: '0 20px', marginTop: 0 }}>
             <Send size={16} />
           </button>
        </form>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="contracts-upload-wrap">
      <div className="hero-banner" style={{ marginBottom: '32px' }}>
         <div className="hero-left">
            <div className="hero-icon-wrap">
               <UploadCloud size={24} />
            </div>
            <div>
               <h2 className="hero-title">Bulk Ingestion</h2>
               <p className="hero-subtitle">Upload multiple PDF, Word or Excel contracts for automated classification and extraction.</p>
            </div>
         </div>
      </div>

      <div className="drop-zone" style={{ padding: '80px 40px' }}>
        <div className="drop-zone-icon" style={{ width: '64px', height: '64px' }}><UploadCloud size={32} /></div>
        <h3 className="drop-zone-title" style={{ fontSize: '18px' }}>Drop files to ingest</h3>
        <p className="drop-zone-sub">Supports PDF, DOCX, XLSX, TXT (Max 10MB per file)</p>
        <button className="translate-btn" style={{ width: 'auto', padding: '12px 32px', marginTop: '16px' }}>Select Files</button>
      </div>
    </div>
  );

  return (
    <div className="contracts-container">
      {/* Sub-Nav Bar */}
      <nav className="sub-nav">
        <div className="sub-nav-tabs">
          <button className={`sub-nav-btn ${activeSubTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveSubTab('dashboard')}>
            <LayoutDashboard size={18} /> Dashboard
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'repository' ? 'active' : ''}`} onClick={() => setActiveSubTab('repository')}>
            <Database size={18} /> Repository
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'upload' ? 'active' : ''}`} onClick={() => setActiveSubTab('upload')}>
            <UploadCloud size={18} /> Ingestion
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'review' ? 'active' : ''}`} onClick={() => setActiveSubTab('review')}>
            <Search size={18} /> Review
          </button>
          <button className={`sub-nav-btn ${activeSubTab === 'assistant' ? 'active' : ''}`} onClick={() => setActiveSubTab('assistant')}>
            <MessageSquare size={18} /> AI Assistant
          </button>
        </div>
        
        <div className="status-pill" style={{ opacity: 0.8 }}>
          <Clock size={12} /> Last Sync: Just now
        </div>
      </nav>

      {/* Dynamic Content Area */}
      <div className="tab-content-area" style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
        {activeSubTab === 'dashboard' && renderDashboard()}
        {activeSubTab === 'repository' && renderRepository()}
        {activeSubTab === 'review' && renderReview()}
        {activeSubTab === 'assistant' && renderAssistant()}
        {activeSubTab === 'upload' && renderUpload()}
      </div>
    </div>
  );
};

export default ContractManagementPage;
