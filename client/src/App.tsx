import { Navigate, Route, Routes } from "react-router-dom";
import { StockPage } from "./pages/StockPage";
import { FundsPage } from "./pages/FundsPage";
import { ComparePage } from "./pages/ComparePage";
import { TrendsPage } from "./pages/TrendsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { AdminReportsPage } from "./pages/AdminReportsPage";
import { AdminManageAppPage } from "./pages/AdminManageAppPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminCharactersPage } from "./pages/AdminCharactersPage";
import { AdminManageFundsPage } from "./pages/AdminManageFundsPage";
import { AdminPriceHistoryPage } from "./pages/AdminPriceHistoryPage";
import { AdminNotificationsPage } from "./pages/AdminNotificationsPage";
import { AdminAuditLogPage } from "./pages/AdminAuditLogPage";
import { AdminSummaryPage } from "./pages/AdminSummaryPage";
import { AdminBackupPage } from "./pages/AdminBackupPage";
import { WalletPage } from "./pages/WalletPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { TradeFeedPage } from "./pages/TradeFeedPage";
import { FaqPage } from "./pages/FaqPage";
import { DocumentationPage } from "./pages/DocumentationPage";
import { WarriorsBreakdownPage } from "./pages/WarriorsBreakdownPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/market/stocks" replace />} />
      <Route path="/market" element={<Navigate to="/market/stocks" replace />} />
      <Route path="/market/stocks" element={<StockPage />} />
      <Route path="/market/funds" element={<FundsPage />} />
      <Route path="/market/leaderboard" element={<LeaderboardPage />} />
      <Route path="/market/feed" element={<TradeFeedPage />} />
      <Route path="/market/wallet" element={<WalletPage />} />
      <Route path="/warriors" element={<Navigate to="/warriors/compare" replace />} />
      <Route path="/warriors/compare" element={<ComparePage />} />
      <Route path="/warriors/trends" element={<TrendsPage />} />
      <Route path="/warriors/raids" element={<OverviewPage />} />
      <Route path="/warriors/breakdown" element={<WarriorsBreakdownPage />} />
      <Route path="/compare" element={<Navigate to="/warriors/compare" replace />} />
      <Route path="/trends" element={<Navigate to="/warriors/trends" replace />} />
      <Route path="/overview" element={<Navigate to="/warriors/raids" replace />} />
      <Route path="/faq" element={<FaqPage />} />
      <Route path="/documentation" element={<DocumentationPage />} />
      <Route path="/admin" element={<AdminManageAppPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
      <Route path="/admin/characters" element={<AdminCharactersPage />} />
      <Route path="/admin/reports" element={<AdminReportsPage />} />
      <Route path="/admin/manage-funds" element={<AdminManageFundsPage />} />
      <Route path="/admin/price-history" element={<AdminPriceHistoryPage />} />
      <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
      <Route path="/admin/audit-log" element={<AdminAuditLogPage />} />
      <Route path="/admin/summary" element={<AdminSummaryPage />} />
      <Route path="/admin/backup" element={<AdminBackupPage />} />
    </Routes>
  );
}

export default App;
