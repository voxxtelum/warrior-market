import { Navigate, Route, Routes } from "react-router-dom";
import { StockPage } from "./pages/StockPage";
import { ComparePage } from "./pages/ComparePage";
import { TrendsPage } from "./pages/TrendsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { AdminReportsPage } from "./pages/AdminReportsPage";
import { AdminPlayersPage } from "./pages/AdminPlayersPage";
import { AdminStockConfigPage } from "./pages/AdminStockConfigPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/stock" replace />} />
      <Route path="/stock" element={<StockPage />} />
      <Route path="/compare" element={<ComparePage />} />
      <Route path="/trends" element={<TrendsPage />} />
      <Route path="/overview" element={<OverviewPage />} />
      <Route path="/admin" element={<AdminReportsPage />} />
      <Route path="/admin/players" element={<AdminPlayersPage />} />
      <Route path="/admin/stock-config" element={<AdminStockConfigPage />} />
      <Route path="/admin/users" element={<AdminUsersPage />} />
    </Routes>
  );
}

export default App;
