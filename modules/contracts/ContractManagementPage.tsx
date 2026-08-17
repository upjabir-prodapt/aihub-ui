'use client';

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
  Bot,
} from 'lucide-react';
import { config } from '@/shared/config';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const API_BASE = config.contracts.apiBase;

type TabType = 'dashboard' | 'repository' | 'upload' | 'review' | 'assistant';

interface ContractDocument {
  docx: string;
  stored_at: string;
}

const NAV_TABS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'repository', label: 'Repository', icon: <Database className="w-4 h-4" /> },
  { id: 'upload', label: 'Ingestion', icon: <UploadCloud className="w-4 h-4" /> },
  { id: 'review', label: 'Review', icon: <Search className="w-4 h-4" /> },
  { id: 'assistant', label: 'AI Assistant', icon: <MessageSquare className="w-4 h-4" /> },
];

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
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="text-xs text-text-muted font-medium mb-1">Total Contracts</div>
          <div className="text-2xl font-bold text-text-primary mb-1">1,284</div>
          <div className="flex items-center gap-1 text-[11px] text-emerald-400">
            <TrendingUp className="w-3 h-3" /> +12% vs last month
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-muted font-medium mb-1">Compliance Score</div>
          <div className="text-2xl font-bold text-text-primary mb-1">84%</div>
          <div className="text-[11px] text-text-muted">Average across portfolio</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-muted font-medium mb-1">Critical Findings</div>
          <div className="text-2xl font-bold text-red-400 mb-1">24</div>
          <div className="flex items-center gap-1 text-[11px] text-red-400">
            <AlertTriangle className="w-3 h-3" /> Requires immediate review
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-text-muted font-medium mb-1">Upcoming Renewals</div>
          <div className="text-2xl font-bold text-text-primary mb-1">42</div>
          <div className="text-[11px] text-colt-teal">Next 30 days</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="text-sm font-bold text-text-primary mb-3">Contract Types Distribution</div>
          <div className="h-48 flex items-center justify-center text-text-muted text-xs bg-bg-elevated/50 rounded-lg">
            [Chart Area: MSAs, NDAs, Orders, SLAs]
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-sm font-bold text-text-primary mb-3">Compliance Trend</div>
          <div className="h-48 flex items-center justify-center text-text-muted text-xs bg-bg-elevated/50 rounded-lg">
            [Line Chart: Score over time]
          </div>
        </Card>
      </div>
    </div>
  );

  const renderRepository = () => (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            id="contract-repo-search"
            name="contract_search"
            type="search"
            placeholder="Search across repository..."
            aria-label="Search across repository"
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <Filter className="w-3.5 h-3.5" /> Filters
        </Button>
        <Button size="sm" className="cursor-pointer ml-auto">
          <Download className="w-3.5 h-3.5" /> Export CSV
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border-subtle bg-bg-elevated/30">
                <th className="p-3 font-semibold">Document Key</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Counterparty</th>
                <th className="p-3 font-semibold">Date Stored</th>
                <th className="p-3 font-semibold">Compliance</th>
                <th className="p-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, i) => (
                <tr
                  key={doc.docx}
                  onClick={() => { setSelectedDocKey(doc.docx); setActiveSubTab('review'); }}
                  className="cursor-pointer hover:bg-bg-hover border-b border-border-subtle/50 last:border-0 transition-colors"
                >
                  <td className="p-3 font-semibold text-text-primary">{doc.docx}</td>
                  <td className="p-3 text-text-secondary">{i % 3 === 0 ? 'NDA' : i % 3 === 1 ? 'MSA' : 'Order Form'}</td>
                  <td className="p-3 text-text-secondary">Colt Services Ltd.</td>
                  <td className="p-3 text-text-secondary">{new Date(doc.stored_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <Badge variant={i % 4 === 0 ? 'destructive' : i % 4 === 1 ? 'warning' : 'success'}>
                      {i % 4 === 0 ? 'Critical' : i % 4 === 1 ? 'Low' : 'Compliant'}
                    </Badge>
                  </td>
                  <td className="p-3"><MoreVertical className="w-4 h-4 text-text-muted" /></td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-text-muted text-sm">No documents found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );

  const renderReview = () => (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
      <Card className="flex items-center justify-center min-h-[400px] p-8">
        <div className="text-center text-text-muted">
          <FileSearch className="w-16 h-16 mx-auto mb-4 opacity-20" />
          <p className="text-sm">PDF Interaction Viewport</p>
          <span className="text-xs opacity-60">{selectedDocKey || 'No Document Selected'}</span>
        </div>
      </Card>

      <Card>
        <div className="p-4 border-b border-border-subtle">
          <h3 className="text-sm font-bold text-text-primary">Contract Insights</h3>
          <p className="text-[11px] text-text-muted mt-0.5">AI-Extracted Data & Summary</p>
        </div>
        <CardContent className="pt-4 space-y-5">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">AI Summary</h4>
            <div className="flex gap-1.5 mb-3">
              {['Short', 'Medium', 'Full'].map((t, i) => (
                <button key={t} className={cn(
                  "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer",
                  i === 0 ? "bg-colt-teal/10 text-colt-teal" : "text-text-muted hover:bg-bg-hover"
                )}>
                  {t}
                </button>
              ))}
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              This agreement establishes the terms for a 3-year partnership between Colt Technology Services and the provider. Key risks include a strict 90-day notice period for termination and unlimited liability for data breaches.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold uppercase tracking-wide text-text-muted mb-2">Key Data Points</h4>
            <div className="space-y-2">
              <div className="p-2.5 rounded-lg bg-bg-elevated/50">
                <div className="text-[10px] text-text-muted">Counterparty</div>
                <div className="text-sm font-semibold text-text-primary">Enterprise Solutions Inc.</div>
              </div>
              <div className="p-2.5 rounded-lg bg-bg-elevated/50">
                <div className="text-[10px] text-text-muted">Effective Date</div>
                <div className="text-sm font-semibold text-text-primary">Jan 12, 2026</div>
              </div>
              <div className="p-2.5 rounded-lg bg-bg-elevated/50">
                <div className="text-[10px] text-text-muted">Compliance Score</div>
                <div className="text-sm font-bold text-red-400">62 / 100 (Critical)</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const renderAssistant = () => (
    <Card className="flex flex-col h-full max-h-[calc(100vh-180px)]">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.map((msg, i) => (
          <div key={i} className={cn("flex gap-3", msg.role === 'user' && "flex-row-reverse")}>
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
              msg.role === 'user' ? "bg-colt-teal text-white" : "bg-bg-elevated text-colt-teal"
            )}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
            <div className={cn(
              "max-w-md p-3 rounded-xl text-sm leading-relaxed",
              msg.role === 'user' ? "bg-colt-teal/10 text-text-primary" : "bg-bg-elevated text-text-secondary"
            )}>
              {msg.text}
              {msg.role === 'bot' && i === 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="px-2.5 py-1 text-[11px] rounded-full bg-bg-surface border border-border-subtle hover:border-colt-teal/50 transition-colors cursor-pointer">
                    What is the liability cap?
                  </button>
                  <button className="px-2.5 py-1 text-[11px] rounded-full bg-bg-surface border border-border-subtle hover:border-colt-teal/50 transition-colors cursor-pointer">
                    List all expiring NDAs
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="p-4 border-t border-border-subtle">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!inputText.trim()) return;
            setChatMessages([...chatMessages, { role: 'user', text: inputText }]);
            setInputText('');
            setTimeout(() => {
              setChatMessages(prev => [...prev, { role: 'bot', text: 'I am analyzing your request across the contract corpus...' }]);
            }, 1000);
          }}
        >
          <Input
            type="text"
            placeholder="Ask a question about your contracts..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            className="flex-1"
          />
          <Button type="submit" size="icon" className="cursor-pointer shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </Card>
  );

  const renderUpload = () => (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-bg-surface to-bg-elevated border border-border-subtle p-6 shadow-md">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-colt-teal/10 border border-colt-teal/20 flex items-center justify-center text-colt-teal shrink-0">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">Bulk Ingestion</h2>
            <p className="text-sm text-text-secondary mt-0.5">Upload multiple PDF, Word or Excel contracts for automated classification and extraction.</p>
          </div>
        </div>
      </div>

      <div className="border-2 border-dashed border-border-default rounded-xl py-20 px-8 text-center hover:border-colt-teal/50 hover:bg-bg-hover/30 transition-colors cursor-pointer">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-bg-elevated flex items-center justify-center text-text-secondary">
          <UploadCloud className="w-7 h-7" />
        </div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Drop files to ingest</h3>
        <p className="text-xs text-text-secondary mb-4">Supports PDF, DOCX, XLSX, TXT (Max 10MB per file)</p>
        <Button className="cursor-pointer">Select Files</Button>
      </div>
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

        <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-text-muted shrink-0">
          <Clock className="w-3 h-3" /> Last Sync: Just now
        </div>
      </nav>

      <div className="flex-1 overflow-y-auto p-6">
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
