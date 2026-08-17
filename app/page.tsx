'use client';

import dynamic from 'next/dynamic';

const HubShell = dynamic(() => import('@/modules/shell/HubShell'), { ssr: false });

export default function Home() {
  return <HubShell />;
}
