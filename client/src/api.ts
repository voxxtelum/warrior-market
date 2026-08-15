export interface AuthUser {
  discordId: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  linkedWarrior: { playerName: string; server: string; class: string | null } | null;
}

export async function getMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me");
  const body = await res.json();
  return body.user;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
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
  class: string | null;
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

export async function linkUserWarriorManual(
  discordId: string,
  playerName: string,
  server: string,
  characterClass: string,
): Promise<void> {
  const res = await fetch(`/api/admin/users/${encodeURIComponent(discordId)}/link-manual`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerName, server, class: characterClass }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to link character");
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

export interface TankTopNZoneConfig {
  zone: string;
  topN: number;
}

export interface StockConfig {
  abilities: StockAbilityConfig[];
  tankTopN: number;
  tankTopNByZone: TankTopNZoneConfig[];
  minBucketSize: number;
  coldStartReports: number;
  dpsEmaAlpha: number;
  damageWeight: number;
  castWeight: number;
  pricePerScorePointUp: number;
  pricePerScorePointDown: number;
  startingPrice: number;
  startingWalletBalance: number;
  newPlayerGraceReports: number;
  newPlayerPenaltyLeniency: number;
  minAttendancePct: number;
  damageTrendWeight: number;
  damagePeerWeight: number;
  damageTrendZClampUp: number;
  damageTrendZClampDown: number;
  driftIntervalMs: number;
  fundValuationIntervalMs: number;
  driftMaxPct: number;
  driftReversionStrength: number;
  demandMaxPctPerTrade: number;
  demandLiquidityDenominator: number;
  tradeFeePct: number;
  demandAnchorDecayPct: number;
  marketGravityStrength: number;
  swingChancePct: number;
  swingUpMagnitude: number;
  swingDownMagnitude: number;
  swingMagnitudeFuzz: number;
  swingCooldownGapPct: number;
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
  delta: number | null;
  source: "raid" | "drift" | "swing" | "trade";
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
  lastRaidPrice: number | null;
  marketValue: number | null;
}

export interface WalletData {
  balance: number;
  holdings: HoldingView[];
  netWorth: number;
  netWorthDelta: number;
  tradeCount: number;
  tradeFeePct: number;
}

export async function getWallet(): Promise<WalletData> {
  const res = await fetch("/api/trading/wallet");
  if (!res.ok) throw new Error("Failed to load wallet");
  return res.json();
}

export interface WarriorPrice {
  // The actual current tradable price (price_snapshots' latest row - raid +
  // drift + demand together), as opposed to getStock()'s purely
  // raid-performance-derived series. This is what a trade actually fills at.
  price: number | null;
  // Frozen ledger value for the most recent raid, as opposed to
  // getStock()'s live-recomputed series (which reapplies the *current*
  // scoring config across all history, and so can drift far from what's
  // actually in the ledger/chart). Use this, not getStock(), for any
  // "change since last raid" figure compared against the live price.
  lastRaidPrice: number | null;
}

export async function getWarriorPrice(playerName: string, server: string): Promise<WarriorPrice> {
  const res = await fetch(`/api/trading/price/${encodeURIComponent(playerName)}/${encodeURIComponent(server)}`);
  if (!res.ok) throw new Error('Failed to load price');
  return res.json();
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
  realizedPnl: number | null;
}

export interface PersonalTransactionView {
  id: number;
  targetType: "character" | "fund";
  targetName: string;
  side: "buy" | "sell" | "liquidation";
  shares: number;
  price: number;
  total: number;
  createdAt: number;
  username: string | null;
  avatar: string | null;
  isMine: boolean;
  realizedPnl: number | null;
}

export async function getMyTransactions(): Promise<PersonalTransactionView[]> {
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
  linkedWarrior: { playerName: string; server: string; class: string | null } | null;
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

// Admin-authored broadcast popup (distinct from the wallet-event
// NotificationView above) - see NotificationPopup.tsx.
export interface ActiveNotificationView {
  id: number;
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
}

export async function getActiveNotification(): Promise<ActiveNotificationView | null> {
  const res = await fetch("/api/notifications/active");
  if (!res.ok) return null;
  return res.json();
}

export async function markNotificationViewed(id: number): Promise<void> {
  await fetch(`/api/notifications/${id}/viewed`, { method: "POST" });
}

export interface MarketSummary {
  totalMarketSize: number;
  totalTradeVolume: number;
}

export async function getMarketSummary(): Promise<MarketSummary> {
  const res = await fetch("/api/trading/market-summary");
  if (!res.ok) throw new Error("Failed to load market summary");
  return res.json();
}

export async function getFaq(): Promise<string> {
  const res = await fetch("/api/faq");
  if (!res.ok) throw new Error("Failed to load FAQ");
  return res.text();
}

export async function getStocksDoc(): Promise<string> {
  const res = await fetch("/api/stocks-doc");
  if (!res.ok) throw new Error("Failed to load STOCKS.md");
  return res.text();
}

export interface WarriorStats {
  player_name: string;
  server: string;
  totalDamage: number;
  damageByInstance: Record<string, number>;
  totalDamageTaken: number;
  damageTakenByInstance: Record<string, number>;
  totalCasts: number;
  castsByInstance: Record<string, number>;
}

export async function getWarriorStats(): Promise<WarriorStats[]> {
  const res = await fetch("/api/warriors");
  if (!res.ok) throw new Error("Failed to load warrior stats");
  return res.json();
}

export interface AdminWalletRow {
  userId: string;
  username: string;
  avatar: string | null;
  linkedWarrior: { id: number; playerName: string; server: string; class: string | null } | null;
  firstLoginAt: number;
  lastLoginAt: number;
  balance: number;
  holdingsValue: number;
  netWorth: number;
  turnover: number;
  tradeCount: number;
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

export interface AdminWalletAdjustment {
  id: number;
  adminUsername: string;
  targetUsername: string;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  createdAt: number;
}

export async function getAdminAuditLog(): Promise<AdminWalletAdjustment[]> {
  const res = await fetch("/api/admin/market/audit-log");
  if (!res.ok) throw new Error("Failed to load audit log");
  return res.json();
}

export interface AdminNotificationAuditEntry {
  id: number;
  adminUsername: string;
  notificationId: number | null;
  notificationName: string | null;
  action: string;
  detail: string | null;
  createdAt: number;
}

export async function getAdminNotificationAuditLog(): Promise<AdminNotificationAuditEntry[]> {
  const res = await fetch("/api/admin/notifications/meta/audit-log");
  if (!res.ok) throw new Error("Failed to load notification audit log");
  return res.json();
}

export interface AdminUserHolding {
  playerName: string;
  server: string;
  shares: number;
  costBasisTotal: number;
  latestPrice: number | null;
  lastRaidPrice: number | null;
  marketValue: number | null;
}

export interface AdminUserTransaction {
  id: number;
  targetType: "character" | "fund";
  targetName: string;
  side: "buy" | "sell" | "liquidation";
  shares: number;
  price: number;
  total: number;
  createdAt: number;
  realizedPnl: number | null;
}

export interface AdminUserDetail {
  userId: string;
  username: string;
  avatar: string | null;
  isAdmin: boolean;
  linkedWarrior: { id: number; playerName: string; server: string; class: string | null } | null;
  firstLoginAt: number;
  lastLoginAt: number;
  balance: number;
  holdings: AdminUserHolding[];
  netWorth: number;
  netWorthDelta: number;
  tradeCount: number;
  transactions: AdminUserTransaction[];
}

export async function getAdminUserDetail(userId: string): Promise<AdminUserDetail> {
  const res = await fetch(`/api/admin/market/users/${encodeURIComponent(userId)}`);
  if (!res.ok) throw new Error("Failed to load user detail");
  return res.json();
}

export interface WarriorHolderView {
  userId: string;
  username: string;
  avatar: string | null;
  shares: number;
  costBasisTotal: number;
  marketValue: number | null;
  percentOfWarrior: number;
}

export interface WarriorHoldersResponse {
  playerName: string;
  server: string;
  latestPrice: number | null;
  totalInvested: number;
  holders: WarriorHolderView[];
}

export async function getWarriorHolders(warriorId: number): Promise<WarriorHoldersResponse> {
  const res = await fetch(`/api/admin/market/warriors/${warriorId}/holders`);
  if (!res.ok) throw new Error("Failed to load warrior holders");
  return res.json();
}

export interface WarriorVolumeRow {
  warriorId: number;
  playerName: string;
  server: string;
  volume: number;
  tradeCount: number;
  totalShares: number;
  holderCount: number;
  totalInvested: number;
  hidden: boolean;
  price: number | null;
  anchorPrice: number | null;
  raidAnchorPrice: number | null;
}

export async function getWarriorVolumeOverview(): Promise<WarriorVolumeRow[]> {
  const res = await fetch("/api/admin/market/warriors/volume");
  if (!res.ok) throw new Error("Failed to load warrior volume");
  return res.json();
}

export interface WarriorTradeRow {
  id: number;
  username: string;
  avatar: string | null;
  side: "buy" | "sell" | "liquidation";
  shares: number;
  price: number;
  total: number;
  createdAt: number;
}

export async function getWarriorTrades(warriorId: number): Promise<WarriorTradeRow[]> {
  const res = await fetch(`/api/admin/market/warriors/${warriorId}/trades`);
  if (!res.ok) throw new Error("Failed to load warrior trades");
  return res.json();
}

export type PriceHistorySource = "raid" | "drift" | "swing" | "trade";

export interface PriceHistoryEntry {
  id: number;
  playerName: string;
  server: string;
  price: number;
  delta: number | null;
  source: PriceHistorySource;
  createdAt: number;
}

export interface PriceHistoryResponse {
  entries: PriceHistoryEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getAdminPriceHistory(params: {
  sources: PriceHistorySource[];
  warriorId?: number;
  page: number;
  pageSize: number;
}): Promise<PriceHistoryResponse> {
  const query = new URLSearchParams({
    sources: params.sources.join(","),
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.warriorId !== undefined) query.set("warriorId", String(params.warriorId));
  const res = await fetch(`/api/admin/market/price-history?${query.toString()}`);
  if (!res.ok) throw new Error("Failed to load price history");
  return res.json();
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

export async function adjustAllWalletBalances(delta: number, reason?: string): Promise<void> {
  const res = await fetch("/api/admin/market/wallet-adjust-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delta, reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to adjust wallets");
  }
}

// --- Funds ---------------------------------------------------------------

export interface FundConstituentInput {
  playerName: string;
  server: string;
  stockCount: number;
}

export interface FundConstituentView extends FundConstituentInput {
  warriorId: number;
}

export interface FundView {
  id: number;
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  gainMultiplier: number;
  lossMultiplier: number;
  seedNav: number;
  nav: number;
  poolValue: number;
  sharesOutstanding: number;
  createdAt: number;
  deletedAt: number | null;
}

export interface FundDetailView extends FundView {
  constituents: FundConstituentView[];
}

export interface FundStatsView {
  volatility: number;
  yield7d: number;
  yield30d: number;
  sampleDays: number;
}

export interface CreateFundInput {
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  gainMultiplier: number;
  lossMultiplier: number;
  constituents: FundConstituentInput[];
}

export async function getAdminFunds(): Promise<FundView[]> {
  const res = await fetch("/api/admin/funds");
  if (!res.ok) throw new Error("Failed to load funds");
  return res.json();
}

export async function getAdminFund(id: number): Promise<FundDetailView> {
  const res = await fetch(`/api/admin/funds/${id}`);
  if (!res.ok) throw new Error("Failed to load fund");
  return res.json();
}

export async function createFund(
  input: CreateFundInput,
): Promise<FundView & { skippedConstituents: FundConstituentInput[] }> {
  const res = await fetch("/api/admin/funds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create fund");
  }
  return res.json();
}

export async function updateFund(
  id: number,
  input: Omit<CreateFundInput, "constituents">,
): Promise<FundView> {
  const res = await fetch(`/api/admin/funds/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update fund");
  }
  return res.json();
}

export async function addFundConstituent(fundId: number, input: FundConstituentInput): Promise<void> {
  const res = await fetch(`/api/admin/funds/${fundId}/constituents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to add constituent");
  }
}

export async function removeFundConstituent(fundId: number, warriorId: number): Promise<void> {
  const res = await fetch(`/api/admin/funds/${fundId}/constituents/${warriorId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to remove constituent");
  }
}

export async function updateFundConstituent(
  fundId: number,
  warriorId: number,
  stockCount: number,
): Promise<void> {
  const res = await fetch(`/api/admin/funds/${fundId}/constituents/${warriorId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stockCount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update constituent");
  }
}

export async function deleteFund(id: number, reason?: string): Promise<void> {
  const res = await fetch(`/api/admin/funds/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete fund");
  }
}

export async function getFundStats(id: number): Promise<FundStatsView | null> {
  const res = await fetch(`/api/admin/funds/${id}/stats`);
  if (!res.ok) throw new Error("Failed to load fund stats");
  return res.json();
}

export interface PublicFundView {
  id: number;
  name: string;
  risk: number;
  feePct: number;
  taxPct: number;
  description: string;
  nav: number;
  last7DaysDelta: number;
  allTimeDelta: number;
  sparkline: number[];
}

export interface PublicFundConstituentView {
  playerName: string;
  server: string;
  stockCount: number;
  percentOfFund: number;
  price: number | null;
}

export interface PublicFundDetailView extends PublicFundView {
  constituents: PublicFundConstituentView[];
}

export async function getFunds(): Promise<PublicFundView[]> {
  const res = await fetch("/api/funds");
  if (!res.ok) throw new Error("Failed to load funds");
  return res.json();
}

export async function getFund(id: number): Promise<PublicFundDetailView> {
  const res = await fetch(`/api/funds/${id}`);
  if (!res.ok) throw new Error("Failed to load fund");
  return res.json();
}

export interface FundPositionView {
  fundId: number;
  name: string;
  risk: number;
  shares: number;
  costBasisTotal: number;
  nav: number;
  marketValue: number;
}

export async function getFundPositions(): Promise<FundPositionView[]> {
  const res = await fetch("/api/funds/positions");
  if (!res.ok) throw new Error("Failed to load fund positions");
  return res.json();
}

export interface FundTradeResult {
  shares: number;
  nav: number;
  total: number;
  fee: number;
  tax: number;
}

export async function postFundTrade(
  fundId: number,
  side: "buy" | "sell",
  amount: number,
): Promise<FundTradeResult> {
  const res = await fetch(`/api/funds/${fundId}/trade`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ side, amount }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Trade failed");
  }
  return res.json();
}

export async function estimateFundStats(
  constituents: FundConstituentInput[],
  gainMultiplier: number,
  lossMultiplier: number,
): Promise<FundStatsView | null> {
  const res = await fetch("/api/admin/funds/stats/estimate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ constituents, gainMultiplier, lossMultiplier }),
  });
  if (!res.ok) throw new Error("Failed to estimate fund stats");
  return res.json();
}

// --- Admin Notifications ---------------------------------------------------

export interface AdminNotificationView {
  id: number;
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
  active: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminNotificationInput {
  name: string;
  content: string;
  buttonText: string;
  buttonLink: string;
}

export async function getNotificationPublicLinks(): Promise<string[]> {
  const res = await fetch("/api/admin/notifications/meta/public-links");
  if (!res.ok) throw new Error("Failed to load link options");
  return res.json();
}

export async function getAdminNotifications(): Promise<AdminNotificationView[]> {
  const res = await fetch("/api/admin/notifications");
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
}

export async function getAdminNotification(id: number): Promise<AdminNotificationView> {
  const res = await fetch(`/api/admin/notifications/${id}`);
  if (!res.ok) throw new Error("Failed to load notification");
  return res.json();
}

export async function createAdminNotification(input: AdminNotificationInput): Promise<AdminNotificationView> {
  const res = await fetch("/api/admin/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to create notification");
  }
  return res.json();
}

export async function updateAdminNotification(
  id: number,
  input: AdminNotificationInput,
): Promise<AdminNotificationView> {
  const res = await fetch(`/api/admin/notifications/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to update notification");
  }
  return res.json();
}

export async function activateAdminNotification(id: number): Promise<AdminNotificationView> {
  const res = await fetch(`/api/admin/notifications/${id}/activate`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to activate notification");
  }
  return res.json();
}

export async function deactivateAdminNotification(id: number): Promise<AdminNotificationView> {
  const res = await fetch(`/api/admin/notifications/${id}/deactivate`, { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to deactivate notification");
  }
  return res.json();
}

export async function deleteAdminNotification(id: number): Promise<void> {
  const res = await fetch(`/api/admin/notifications/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to delete notification");
  }
}

export async function uploadNotificationImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch("/api/admin/notifications/upload-image", {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to upload image");
  }
  return res.json();
}
