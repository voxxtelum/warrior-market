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
}

export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const res = await fetch("/api/admin/users");
  return res.json();
}

export async function setUserAdmin(discordId: string, isAdmin: boolean): Promise<void> {
  await fetch(`/api/admin/users/${encodeURIComponent(discordId)}/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isAdmin }),
  });
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
  cast_score: number;
  dps: number;
  excluded_low_attendance: boolean;
}

export interface PlayerStock {
  player_name: string;
  server: string;
  series: StockPoint[];
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
}

export async function getStockConfig(): Promise<StockConfig> {
  const res = await fetch("/api/stock/config");
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
  return res.json();
}

export async function setPlayerHidden(playerName: string, server: string, hidden: boolean): Promise<void> {
  await fetch("/api/players/hidden", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_name: playerName, server, hidden }),
  });
}
