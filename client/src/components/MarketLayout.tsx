import type { ReactNode } from 'react';
import { Layout } from './Layout';
import { MarketSubNav } from './MarketSubNav';
import { ChartBarIcon } from './icons/ChartBarIcon';

export function MarketLayout({ children }: { children: ReactNode }) {
    return (
        <Layout
            title="Warrior Market"
            icon={<ChartBarIcon className="page-title-icon" />}
            subtitle={
                <>
                    Stocks for <s>Morons</s>&nbsp;
                    <span className="accent-gold">&lt;Dawnfire&gt;</span>{' '}
                    Warriors
                </>
            }
        >
            <MarketSubNav />
            {children}
        </Layout>
    );
}
