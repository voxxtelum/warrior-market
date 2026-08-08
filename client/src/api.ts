export interface AuthUser {
  discordId: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
}

export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  const body = await res.json();
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

export interface AdminUserRow {
  discordId: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  firstLoginAt: number;
  lastLoginAt: number;
  linkedWarrior: { id: number; playerName: string; server: string } | null;
}

export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const res = await fetch("/api/admin/users");
  if (!res.ok) throw new Error("Failed to load users");
  return res.json();
}

export async function setUserAdmin(discordId: string, isAdmin: boolean): Promise<void> {
  await fetch(`/api/admin/users/${encodeURIComponent(discordId)}/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
}

export interface AdminWarriorRow {
  id: number;
  playerName: string;
  server: string;
}

export async function getAdminWarriors(): Promise<AdminWarriorRow[]> {
  const res = await fetch("/api/admin/users/warriors");
  if (!res.ok) throw new Error("Failed to load warriors");
  return res.json();
}

export async function linkUserWarrior(discordId: string, warriorId: number): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(discordId)}/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ warriorId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to link warrior");
  }
}

export async function unlinkUserWarrior(discordId: string): Promise<void> {
  await fetch(`/api/admin/users/${encodeURIComponent(discordId)}/unlink`, { method: "POST" });
}

export interface ReportRow {
  code: string;
  title: string;
  zone: string | null;
  start_time: number;
  end_time: number | null;
  fetched_at: number;
}

export async function getReports(): Promise<ReportRow[]> {
  const res = await fetch("/api/reports");
  return res.json();
}

export async function addReport(url: string): Promise<{ title: string; zone: string | null }> {
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Failed to add report");
  return body;
}

export async function deleteReport(code: string): Promise<void> {
  const res = await fetch(`/api/reports/${encodeURIComponent(code)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete report");
  }
}

export interface TrackedAbility {
  id: number;
  name: string;
}

export interface CompareReport {
  code: string;
  title: string;
  start_time: number;
}

export interface CastCompareRow {
  player_name: string;
  ability_id: number;
  ability_name: string;
  values: Record<string, number>;
}

export interface DamageCompareRow {
  player_name: string;
  values: Record<string, number>;
}

export interface CompareData {
  zone: string;
  reports: CompareReport[];
  trackedAbilities: TrackedAbility[];
  casts: CastCompareRow[];
  damage: DamageCompareRow[];
}

export async function getZones(): Promise<string[]> {
  const res = await fetch("/api/compare/zones");
  return res.json();
}

export async function getCompareData(zone: string): Promise<CompareData> {
  const res = await fetch(`/api/compare?zone=${encodeURIComponent(zone)}`);
  return res.json();
}

export interface StockPoint {
  report_code: string;
  zone: string | null;
  start_time: number;
  price: number;
  report_score: number;
  damage_score: number;
  damage_trend_score: number;
  damage_peer_score: number;
  cast_score: number;
  dps: number;
  excluded_low_attendance: boolean;
}

export interface PlayerStock {
  player_name: string;
  server: string;
  series: StockPoint[];
  avatar: string | null;
}

export async function getStock(): Promise<PlayerStock[]> {
  const res = await fetch("/api/stock");
  return res.json();
}

export interface OverviewMetricPoint {
  report_code: string;
  total: number;
  average: number;
}

export interface OverviewAbilityValue {
  report_code: string;
  average: number;
}

export interface OverviewAbility {
  id: number;
  name: string;
  values: OverviewAbilityValue[];
}

export interface OverviewData {
  zone: string;
  reports: CompareReport[];
  dps: OverviewMetricPoint[];
  damage: OverviewMetricPoint[];
  abilities: OverviewAbility[];
}

export async function getOverviewData(zone: string): Promise<OverviewData> {
  const res = await fetch(`/api/overview?zone=${encodeURIComponent(zone)}`);
  return res.json();
}

export interface StockAbilityConfig {
  id: number;
  name: string;
  weight: number;
  bucket: string;
}

export interface StockConfig {
  abilities: StockAbilityConfig[];
  tankTopN: number;
  tankMinUptimePct: number;
  minBucketSize: number;
  coldStartReports: number;
  dpsEmaAlpha: number;
  damageWeight: number;
  castWeight: number;
  priceSensitivity: number;
  startingPrice: number;
  newPlayerGraceReports: number;
  newPlayerPenaltyLeniency: number;
  minAttendancePct: number;
  damageTrendWeight: number;
  damagePeerWeight: number;
  damageTrendZClamp: number;
  driftIntervalMs: number;
  driftMaxPct: number;
  driftReversionStrength: number;
}

export async function getStockConfig(): Promise<StockConfig> {
  const res = await fetch("/api/stock/config");
  if (!res.ok) throw new Error("Failed to load stock config");
  return res.json();
}

export async function saveStockConfig(config: StockConfig): Promise<void> {
  const res = await fetch("/api/stock/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to save config");
  }
}

export interface PlayerRow {
  player_name: string;
  server: string;
  hidden: number;
}

export async function getPlayers(): Promise<PlayerRow[]> {
  const res = await fetch("/api/players");
  if (!res.ok) throw new Error("Failed to load players");
  return res.json();
}

export async function setPlayerHidden(playerName: string, server: string, hidden: boolean): Promise<void> {
  await fetch("/api/players/hidden", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_name: playerName, server, hidden }),
  });
}

export interface PriceSnapshotPoint {
  created_at: number;
  price: number;
  source: "raid" | "drift";
  report_code: string | null;
}

export interface PlayerPriceHistory {
  player_name: string;
  server: string;
  series: PriceSnapshotPoint[];
}

export async function getStockHistory(): Promise<PlayerPriceHistory[]> {
  const res = await fetch("/api/stock/history");
  return res.json();
}

export interface HoldingView {
  playerName: string;
  server: string;
  shares: number;
  costBasisTotal: number;
  latestPrice: number | null;
  marketValue: number | null;
}

export interface WalletData {
  balance: number;
  holdings: HoldingView[];
  netWorth: number;
}

export async function getWallet(): Promise<WalletData> {
  const res = await fetch("/api/trading/wallet");
  if (!res.ok) throw new Error("Failed to load wallet");
  return res.json();
}

export async function getWarriorPrice(playerName: string, server: string): Promise<number | null> {
  const res = await fetch(`/api/trading/price/${encodeURIComponent(playerName)}/${encodeURIComponent(server)}`);
  if (!res.ok) return null;
  const body = await res.json();
  return body.price;
}

export async function postTrade(
  playerName: string,
  server: string,
  side: "buy" | "sell",
  amount: number
): Promise<{ shares: number; price: number; total: number }> {
  const res = await fetch("/api/trading/trade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerName, server, side, amount }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Trade failed");
  return body;
}

export interface TransactionView {
  id: number;
  playerName: string;
  server: string;
  side: "buy" | "sell" | "liquidation";
  shares: number;
  price: number;
  total: number;
  createdAt: number;
  username: string | null;
  avatar: string | null;
  isMine: boolean;
}

export async function getMyTransactions(): Promise<TransactionView[]> {
  const res = await fetch("/api/trading/transactions/mine");
  return res.json();
}

export async function getTradeFeed(): Promise<TransactionView[]> {
  const res = await fetch("/api/trading/feed");
  return res.json();
}

export interface LeaderboardEntryView {
  username: string;
  avatar: string | null;
  balance: number;
  holdingsValue: number;
  netWorth: number;
}

export async function getLeaderboard(): Promise<LeaderboardEntryView[]> {
  const res = await fetch("/api/trading/leaderboard");
  return res.json();
}

export interface NotificationView {
  id: number;
  message: string;
  warriorId: number | null;
  amount: number | null;
  createdAt: number;
}

export async function getNotifications(): Promise<NotificationView[]> {
  const res = await fetch("/api/notifications");
  return res.json();
}

export async function markNotificationRead(id: number): Promise<void> {
  await fetch(`/api/notifications/${id}/read`, { method: "POST" });
}

export interface MarketStats {
  totalCoinInWallets: number;
  totalCoinInHoldings: number;
  totalNetWorth: number;
  userCount: number;
  perWarriorVolume: { player_name: string; server: string; volume: number; tradeCount: number }[];
  topTraders: { user_id: string; username: string; turnover: number; tradeCount: number }[];
}

export async function getAdminMarketStats(): Promise<MarketStats> {
  const res = await fetch("/api/admin/market-stats");
  if (!res.ok) throw new Error("Failed to load market stats");
  return res.json();
}

export interface AdminWalletRow {
  userId: string;
  username: string;
  avatar: string | null;
  balance: number;
  holdingsValue: number;
  netWorth: number;
}

export async function getAdminWallets(): Promise<AdminWalletRow[]> {
  const res = await fetch("/api/admin/market/wallets");
  if (!res.ok) throw new Error("Failed to load wallets");
  return res.json();
}

export async function adjustWalletBalance(userId: string, delta: number, reason?: string): Promise<void> {
  const res = await fetch("/api/admin/market/wallet-adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, delta, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to adjust balance");
  }
}

export async function resetMarket(confirmationPhrase: string): Promise<void> {
  const res = await fetch("/api/admin/market/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationPhrase }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to reset market");
  }
}
