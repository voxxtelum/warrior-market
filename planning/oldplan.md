# TODO.md items: Admin Characters table, Risk indicator color, Funds trade history, Funds card bug

## Context

`TODO.md` lists 4 independent, unrelated small-to-medium changes to this trading game app (Express backend in `src/`, React client in `client/src/`). They were investigated in parallel via Explore agents and verified by direct file reads. Each item is scoped and planned separately below; there's no shared implementation between them except item 3 touching some of the same trade-history plumbing internally.

---

## Item 1: Admin → Manage App → Characters table

Add Price / Anchor Price / Raid Anchor Price columns, and make the Trades/Holders counts themselves the "view detail" links (removing the separate "View Trades"/"View Shares" button columns).

**Backend — `src/db.ts`**

- `WarriorVolumeEntry` (line 1451): add `price: number | null; anchorPrice: number | null; raidAnchorPrice: number | null;`.
- `getWarriorVolumeOverview()` (line 1478): add `w.anchor_price, w.raid_anchor_price` to the SELECT (query already does `FROM warriors w`); extend the intermediate row type to match. Change line 1516 `const price = totalShares > 0 ? getLatestPrice(r.warrior_id) : null;` to `const price = getLatestPrice(r.warrior_id);` (unconditional — safe, since `totalInvested` is still `0` whenever `totalShares === 0` regardless of price). Add `price, anchorPrice: r.anchor_price, raidAnchorPrice: r.raid_anchor_price` to the returned object.
- No `warriors.price` column exists (verified) — current price only ever comes from `getLatestPrice()` (reads `price_snapshots`), which can be `null` for a never-traded/never-raided warrior. Render `null` as `'–'` client-side, matching the existing convention at `CharactersTab.tsx:205` (`holders.latestPrice`).

**Frontend — `client/src/api.ts`**

- `WarriorVolumeRow` (line 554): add the same 3 fields.

**Frontend — `client/src/components/admin/CharactersTab.tsx`**

- `SortKey` (line 16): add `'price' | 'anchorPrice' | 'raidAnchorPrice'`.
- `COLUMNS` (line 18): prepend `{ key: 'price', label: 'Price' }, { key: 'anchorPrice', label: 'Anchor Price' }, { key: 'raidAnchorPrice', label: 'Raid Anchor Price' }` before the existing 4 — keeps them sortable, consistent with every other numeric column here.
- `sortValue()` (line 25): add cases returning `row.price ?? 0`, `row.anchorPrice ?? 0`, `row.raidAnchorPrice ?? 0`.
- Header right-align check (line 131): extend `col.key === 'volume' || col.key === 'invested'` to also include the 3 new keys.
- Remove the two empty `<th></th>` at lines 139 and 146 (previously hosting the link buttons).
- Empty-state `colSpan={8}` (line 152) → `9` (3 new + Character/Invested/Volume/Trades + Shares/Holders = 9 columns after dropping the 2 button columns).
- Row cells (lines 162–187): prepend 3 right-aligned `<td>` cells rendering `row.price`/`anchorPrice`/`raidAnchorPrice` via `fmtCoin(...)` or `'–'` when null. Replace the `tradeCount` `<td>` + "View Trades" button `<td>` pair with one cell where the count itself is the button:
    ```tsx
    <td>
        <button
            type="button"
            className="text-link text-link-accent"
            onClick={() => toggleDetail(row.warriorId, 'trades')}
        >
            {row.tradeCount}
        </button>
    </td>
    ```
    Leave `totalShares` as a plain `<td>`. Replace the `holderCount` `<td>` + "View Shares" button `<td>` pair the same way, keeping `onClick={() => toggleDetail(row.warriorId, 'shares')}` (this already opens the Holders detail panel, so wiring it to the Holders count is the correct match).

---

## Item 2: Funds risk indicator — color the label text too

**`client/src/components/RiskBar.tsx`** (line 9): add `data-risk={risk}` to the outer `.risk-bar-wrap` span too (keep it on `.risk-bar` as well — harmless duplication):

```tsx
<span className="risk-bar-wrap" data-risk={risk}>
```

**`client/src/styles.css`** (after the existing segment-fill rules around line 991): add

```css
[data-risk='1'] .risk-bar-label {
    color: var(--risk-1);
}
[data-risk='2'] .risk-bar-label {
    color: var(--risk-2);
}
[data-risk='3'] .risk-bar-label {
    color: var(--risk-3);
}
[data-risk='4'] .risk-bar-label {
    color: var(--risk-4);
}
[data-risk='5'] .risk-bar-label {
    color: var(--risk-5);
}
```

Drop the `color: var(--muted);` line from the base `.risk-bar-label` rule (lines 992–997) since it's now always overridden — keep `font-size`/`text-transform`/`letter-spacing`.

This matches the codebase's existing convention (fixed CSS-var stops per risk level, not computed in JS — see the header comment in `RiskBar.tsx`). No changes needed in consumers (`FundCard.tsx`, `WalletPage.tsx`, `FundForm.tsx`, `AdminManageFundsPage.tsx`) — they just render `<RiskBar risk={...} />` with no conflicting overrides.

---

## Item 3: Funds trade history (show in personal + admin views, exclude from public feed, rename column, include P&L)

Currently `transactions` (character trades) and `fund_transactions` (fund trades) are separate tables; only `transactions` is ever read. `listTransactions()` (`src/db.ts:1764`) backs personal history (`GET /transactions/mine`), admin profile view (`GET /users/:userId`), and the public feed (`GET /feed`) — all in `src/routes/trading.ts` and `src/routes/adminMarket.ts`.

**Backend — `src/db.ts`**

- Add `FundTransactionWithContext extends FundTransactionRow { fund_name: string; username: string; avatar: string | null; }`.
- Add `listFundTransactions(opts: { fundId?: number; userId?: string; limit?: number } = {})`, mirroring `listTransactions()` (line 1764) exactly: joins `fund_transactions ft` → `funds f` (no `deleted_at` filter — funds are soft-deleted only, per the comment at line 209, so historical trades must still resolve a fund name) → `users u`.
- Add `listAllFundTransactionsForUser(userId)`, mirroring `listAllTransactionsForUser()` (line 1406): `SELECT * FROM fund_transactions WHERE user_id = ? ORDER BY fund_id ASC, created_at ASC, id ASC` (needed for correct average-cost P&L replay — full unpaginated history, same reasoning as the existing character-trade version).

**Backend — `src/pnl.ts`**

- Generalize `replayRealizedPnl()` (line 9) to take a grouping-key function instead of hardcoding `tx.warrior_id`:
    ```ts
    function replayRealizedPnl<
        T extends {
            id: number;
            side: 'buy' | 'sell' | 'liquidation';
            shares: number;
            total: number;
        },
    >(rows: T[], groupKey: (row: T) => number): Map<number, number> {
        /* same body, state keyed by groupKey(tx) */
    }
    ```
- Keep `computeRealizedPnlByUser()` calling it with `(tx) => tx.warrior_id` — no behavior change for character trades.
- Add `computeRealizedFundPnlByUser(userId)`, calling `replayRealizedPnl(listAllFundTransactionsForUser(userId), (tx) => tx.fund_id)`.

**Backend — `src/routes/trading.ts`**

- Rewrite `/transactions/mine` (line 110) to merge both sources into a unified shape and re-sort/re-slice to the existing 200-row cap:

    ```ts
    tradingRouter.get('/transactions/mine', requireAuth, (req, res) => {
        const userId = req.user!.discord_id;
        const pnlByTxId = computeRealizedPnlByUser(userId);
        const fundPnlByTxId = computeRealizedFundPnlByUser(userId);

        const characterTx = listTransactions({ userId, limit: 200 }).map(
            (tx) => ({
                ...serializeTransaction(tx, req.user),
                targetType: 'character' as const,
                targetName: tx.player_name,
                realizedPnl: pnlByTxId.get(tx.id) ?? null,
            }),
        );
        const fundTx = listFundTransactions({ userId, limit: 200 }).map(
            (tx) => ({
                id: tx.id,
                targetType: 'fund' as const,
                targetName: tx.fund_name,
                side: tx.side,
                shares: tx.shares,
                price: tx.nav,
                total: tx.total,
                createdAt: tx.created_at,
                username: tx.username,
                avatar: tx.avatar,
                isMine: true,
                realizedPnl: fundPnlByTxId.get(tx.id) ?? null,
            }),
        );

        res.json(
            [...characterTx, ...fundTx]
                .sort((a, b) => b.createdAt - a.createdAt)
                .slice(0, 200),
        );
    });
    ```

    (Fetching 200 of each then re-slicing to 200 total avoids silently doubling the existing display cap for active traders.)

- Leave `serializeTransaction()` and `/feed` (line 124) completely untouched — this alone satisfies "must not appear in public feed," since `/feed` only ever calls `listTransactions()`.

**Backend — `src/routes/adminMarket.ts`**

- Apply the same merge pattern inside `/users/:userId` (line 100), replacing the current `listTransactions(...).map(...)` block with a merged `characterTx`/`fundTx` array (limit 500 each, sorted and sliced to 500 total), adding `targetType`/`targetName` and `computeRealizedFundPnlByUser`-sourced `realizedPnl` for fund rows.
- Add `listFundTransactions`, `computeRealizedFundPnlByUser` to imports in both route files.

**Frontend — `client/src/api.ts`**

- Leave `TransactionView` (line 342) as-is — used only by `getTradeFeed()`/`TradeFeedPage.tsx`, unchanged.
- Add `PersonalTransactionView { id, targetType: "character"|"fund", targetName, side, shares, price, total, createdAt, username: string|null, avatar: string|null, isMine, realizedPnl: number|null }`; change `getMyTransactions()` to return `Promise<PersonalTransactionView[]>`.
- `AdminUserTransaction` (line 496): replace `playerName`/`server` with `targetType: "character"|"fund"`, `targetName: string`.

**Frontend — `client/src/pages/WalletPage.tsx`**

- Swap `transactions` state type to `PersonalTransactionView[]`.
- Header (line 180): `Warrior` → `Target`.
- Row `key` (line 197): `key={tx.id}` → ``key={`${tx.targetType}-${tx.id}`}`` (character and fund transaction ids come from separate autoincrement sequences and can collide).
- Cell (line 202): `tx.playerName` → `tx.targetName`.

**Frontend — `client/src/components/PortfolioBreakdownCard.tsx`**

- `recentTransactions` prop type (line 11): replace `playerName: string;` with `targetType: "character"|"fund"; targetName: string;`.
- Line 81 key and line 84 display: same `targetName`/composite-key swap as above. This component is shared by `WalletPage.tsx` and `UsersTab.tsx`, so one change covers both.

**Frontend — `client/src/components/admin/UsersTab.tsx`**

- Header (line 453): `Warrior` → `Target`. Row key (line 470) and cell (line 475): same swap as `WalletPage.tsx`.

**Frontend — `client/src/pages/TradeFeedPage.tsx`**

- No functional change (stays character-only via the untouched `/feed` route and `TransactionView`). Leave the header as `Warrior` — this table can never show a fund row, so the more specific label is preferable to relabeling for consistency with tables that do need the generic term.

**Known scope edge, not fixed here:** `getUserTradeCount()` (wallet-summary "Trades" badge) stays character-only, so once a user has fund trades, the trade-history table can show more rows than the summary badge. Flagging as a pre-existing-shape inconsistency, not part of this request — can be revisited separately if it becomes confusing in practice.

---

## Item 4: Funds card "Last 7 days: 0.00" bug

**Root cause (verified):** `serializeFundSummary()` in `src/routes/funds.ts:41` does `last7DaysDelta: navSevenDaysAgo !== null ? nav - navSevenDaysAgo : 0`. `getFundNavAt()` (`src/db.ts:2442`) returns `null` when no `fund_value_snapshots` row exists at least 7 days old — true for any fund younger (by trading activity) than a week, since snapshots only start once a fund is first traded. `allTimeDelta` (line 42) has no such gap because it compares against `fund.seed_nav`, always present from creation.

**Fix — `src/routes/funds.ts:41`:**

```ts
last7DaysDelta: nav - (navSevenDaysAgo ?? fund.seed_nav),
```

Mirrors `allTimeDelta`'s existing fallback — compares against the earliest available baseline instead of hardcoding a misleading "no change."

**Accepted tradeoff:** for a fund younger than 7 days, `last7DaysDelta` and `allTimeDelta` will render as identical numbers (both vs. `seed_nav`) until the fund has 7+ days of history. This is correct, just not visually distinguished from "genuinely flat over 7 days" — shipping as-is per the bug's scope; no UI changes to `FundCard.tsx` needed.

---

## Verification

- `npm run build` / `tsc` (or whatever the project's typecheck script is) to catch type errors across the `WarriorVolumeEntry`/`WarriorVolumeRow`, `PersonalTransactionView`/`AdminUserTransaction`, and `pnl.ts` generic changes.
- Run the dev server, log in as admin:
    - Admin → Manage App → Characters: confirm Price/Anchor/Raid Anchor columns render (including `–` for untraded warriors), sort correctly, and that clicking a Trades or Holders count opens the same detail panel the old buttons did.
    - Any Funds view (Funds tab, Wallet, Admin Manage Funds): confirm the risk label text is now colored per risk level, matching the bar.
    - Wallet page "My trade history": make a fund trade (buy + sell) and a character trade; confirm both appear with a "Target" column, correct target name, and a populated P&L for sell/liquidation rows (blank/`–` for buys).
    - Admin → user profile trade history: confirm the same for another user, and confirm the public Trade Feed page still shows only character trades under a "Warrior" column.
    - Funds tab: find or create a fund younger than 7 days and confirm "Last 7 days" no longer shows a hardcoded `0.00` when All Time shows real movement.
