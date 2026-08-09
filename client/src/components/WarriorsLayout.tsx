import type { ReactNode } from 'react';
import { Layout } from './Layout';
import { WarriorsSubNav } from './WarriorsSubNav';
import { FireIcon } from './icons/FireIcon';

export function WarriorsLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      title="Warriors"
      icon={<FireIcon className="page-title-icon icon-fire" />}
      subtitle="What kind of warrior are you?"
    >
      <WarriorsSubNav />
      {children}
    </Layout>
  );
}
