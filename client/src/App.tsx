import { Navigate, Route, Routes } from "react-router-dom";
import { StockPage } from "./pages/StockPage";
import { ComparePage } from "./pages/ComparePage";
import { TrendsPage } from "./pages/TrendsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { AdminReportsPage } from "./pages/AdminReportsPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";
import { AdminStockConfigPage } from "./pages/AdminStockConfigPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminMarketStatsPage } from "./pages/AdminMarketStatsPage";
import { AdminManageMarketPage } from "./pages/AdminManageMarketPage";
import { AdminAuditLogPage } from "./pages/AdminAuditLogPage";
import { WalletPage } from "./pages/WalletPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { TradeFeedPage } from "./pages/TradeFeedPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/market/stocks" replace />} />
      <Route path="/market" element={<Navigate to="/market/stocks" replace />} />
      <Route path="/market/stocks" element={<StockPage />} />
      <Route path="/market/leaderboard" element={<LeaderboardPage />} />
      <Route path="/market/feed" element={<TradeFeedPage />} />
      <Route path="/market/wallet" element={<WalletPage />} />
      <Route path="/compare" element={<ComparePage />} />
      <Route path="/trends" element={<TrendsPage />} />
      <Route path="/overview" element={<OverviewPage />} />
      <Route path="/admin" element={<AdminReportsPage />} />
      <Route path="/admin/players" element={<AdminPlayersPage />} />
      <Route path="/admin/stock-config" element={<AdminStockConfigPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/market-stats" element={<AdminMarketStatsPage />} />
      <Route path="/admin/manage-market" element={<AdminManageMarketPage />} />
      <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
    </Routes>
  );
}

export default App;
