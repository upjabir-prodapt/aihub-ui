import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import LoginModal from './components/LoginModal';
import TranslationPage from './pages/TranslationPage';
import ContractManagementPage from './pages/ContractManagementPage';
import SalesAgentPage from './pages/SalesAgentPage';
import VertexAIPage from './pages/VertexAIPage';
import './styles/layout.css';

// ── Inner shell (has access to AuthContext) ──────────────────────────────

function AppShell() {
  const [activeTab, setActiveTab] = useState('translation');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [loginOpen, setLoginOpen] = useState(false);

  const { isAuthenticated } = useAuth();

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  const openLogin = () => setLoginOpen(true);
  const closeLogin = () => {
    // Only allow closing if authenticated (non-blocking behaviour from topbar)
    setLoginOpen(false);
  };

  return (
    <div className="app-layout">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="main-content">
        <Topbar
          activeTab={activeTab}
          theme={theme}
          onToggleTheme={toggleTheme}
        />
        <div style={{ display: activeTab === 'translation' ? 'contents' : 'none' }}>
          <TranslationPage onRequestLogin={openLogin} />
        </div>
        <div style={{ display: activeTab === 'contracts' ? 'contents' : 'none' }}>
          <ContractManagementPage />
        </div>
        <div style={{ display: activeTab === 'sales' ? 'contents' : 'none' }}>
          <SalesAgentPage />
        </div>
        <div style={{ display: activeTab === 'vertex-ai' ? 'contents' : 'none' }}>
          <VertexAIPage />
        </div>
      </div>

      {/* Login modal — non-blocking when opened from topbar */}
      <LoginModal
        isOpen={loginOpen}
        onClose={isAuthenticated ? closeLogin : undefined}
        blocking={!isAuthenticated && loginOpen}
      />
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────

function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

export default App;
