import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers';
import AppRouter from './router';
import '../styles/layout.css';

/**
 * Provider order matters: `AppProviders` wraps the router so job state survives
 * navigation (see providers.tsx), and `BrowserRouter` wraps both so the auth
 * provider can be used from route elements.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </BrowserRouter>
);

export default App;
