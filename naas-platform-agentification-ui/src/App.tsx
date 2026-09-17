import { BrowserRouter, Route, Routes } from 'react-router-dom';
import ChatScreen from './pages/ChatScreen';
import AgentScreen from './pages/AgentScreen';
import Admin from './pages/Admin';
import { ThemeProvider } from './theme/ThemeContext';
import { LanguageProvider } from './language/LanguageContext';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<ChatScreen />} />
            <Route path="/agents/:agentId" element={<AgentScreen />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </BrowserRouter>
      </LanguageProvider>
    </ThemeProvider>
  );
}
