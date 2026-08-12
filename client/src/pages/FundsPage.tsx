import { useEffect, useState } from "react";
import { MarketLayout } from "../components/MarketLayout";
import { FundCard } from "../components/FundCard";
import { FundTradeModal } from "../components/FundTradeModal";
import { getFunds, type PublicFundView } from "../api";

export function FundsPage() {
  const [funds, setFunds] = useState<PublicFundView[] | null>(null);
  const [tradeTarget, setTradeTarget] = useState<PublicFundView | null>(null);

  function load() {
    getFunds()
      .then(setFunds)
      .catch(() => {});
  }

  useEffect(load, []);

  return (
    <MarketLayout>
      {funds?.length === 0 && <p className="subtitle">No funds are available yet - check back soon.</p>}
      {funds?.map((fund) => (
        <FundCard key={fund.id} fund={fund} onBuy={setTradeTarget} />
      ))}

      {tradeTarget && (
        <FundTradeModal fund={tradeTarget} onClose={() => setTradeTarget(null)} onTraded={load} />
      )}
    </MarketLayout>
  );
}
