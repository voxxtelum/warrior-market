import type { ReactNode } from "react";
import { Layout } from "./Layout";
import { MarketSubNav } from "./MarketSubNav";

export function MarketLayout({ children }: { children: ReactNode }) {
  return (
    <Layout
      title="Warrior Market"
      subtitle={
        <>
          Stocks for <s>Morons</s> &lt;Dawnfire&gt; Warriors
        </>
      }
    >
      <MarketSubNav />
      {children}
    </Layout>
  );
}
