import React from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import AppShell from './AppShell';
import ServiceHubPage from '../features/hub/ServiceHubPage';
import JobTrackerPage from '../features/tracker/JobTrackerPage';
import TranslationPage from '../features/translation/TranslationPage';
import SalesAgentPage from '../features/sales/SalesAgentPage';
import AccessDenied from '../features/auth/AccessDenied';
import RequireRole from '../features/auth/RequireRole';
import { ROLE_SALES, ROLE_TRANSLATION } from '../features/auth/authTypes';
import { useEntitlements } from '../features/auth/useAuth';

/**
 * Real URLs, which is the point of the router (decision D9): the BFF's
 * `return_to` can now land the user back where they were after silent SSO.
 *
 * Routes:
 *   /            hub
 *   /tracker     all jobs; `?service=translation|sales` pre-filters
 *   /translation role-gated
 *   /sales       role-gated
 *   /denied      terminal, reached from RequireRole
 */

const HubRoute: React.FC = () => {
  const navigate = useNavigate();
  const entitlements = useEntitlements();
  return (
    <ServiceHubPage
      entitlements={entitlements}
      onNavigate={(tab: string) => navigate(tab === 'hub' ? '/' : `/${tab}`)}
    />
  );
};

const TranslationRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <TranslationPage
      onOpenTracker={() => navigate('/tracker?service=translation')}
      onBack={() => navigate('/')}
    />
  );
};

const SalesRoute: React.FC = () => {
  const navigate = useNavigate();
  return (
    <SalesAgentPage
      onOpenTracker={() => navigate('/tracker?service=sales')}
      onBack={() => navigate('/')}
    />
  );
};

const AppRouter: React.FC = () => (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<HubRoute />} />
      <Route path="tracker" element={<JobTrackerPage />} />

      <Route element={<RequireRole anyOf={ROLE_TRANSLATION} service="translation" />}>
        <Route path="translation" element={<TranslationRoute />} />
      </Route>

      <Route element={<RequireRole anyOf={ROLE_SALES} service="sales" />}>
        <Route path="sales" element={<SalesRoute />} />
      </Route>

      <Route path="denied" element={<AccessDenied />} />
      {/* Unknown client path: back to the hub rather than a blank pane. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Routes>
);

export default AppRouter;
