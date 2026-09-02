import { useState } from 'react';
import NaaSLanding from './pages/NaaSLanding';
import NaaSAgentScreen from './pages/NaaSAgentScreen';
import NaaSAdmin from './pages/NaaSAdmin';

type NaaSView = { name: 'grid' } | { name: 'agent'; agentId: string } | { name: 'admin' };

// Local-state navigation (grid -> agent chat -> admin), not react-router —
// this hub's AppShell has no router at all, and every other service tab
// (Translation, Sales Agent) already navigates the same way.
export default function NaaSPage() {
  const [view, setView] = useState<NaaSView>({ name: 'grid' });

  if (view.name === 'agent') {
    return <NaaSAgentScreen agentId={view.agentId} onBack={() => setView({ name: 'grid' })} />;
  }

  if (view.name === 'admin') {
    return <NaaSAdmin onBack={() => setView({ name: 'grid' })} />;
  }

  return (
    <NaaSLanding
      onSelectAgent={(agentId) => setView({ name: 'agent', agentId })}
      onOpenAdmin={() => setView({ name: 'admin' })}
    />
  );
}
