# TODO.md items: Admin Characters table, Risk indicator color, Funds trade history, Funds card bug

## Context

`TODO.md` lists 4 independent, unrelated small-to-medium changes to this trading game app (Express backend in `src/`, React client in `client/src/`). This plan supersedes an earlier version from a lost session (recovered as `oldplan.md` and merged back in here) plus a freshly re-investigated version — both were cross-checked against current file contents; where they diverged, the user picked an approach (noted inline). Each item is scoped and planned separately below; there's no shared implementation between them except item 3 touching some of the same trade-history plumbing internally.

---

## Item 1: Admin → Manage App → Characters table

Add Price / Anchor Price / Raid Anchor Price columns, and make the Trades/Holders counts themselves the "view detail" links (removing the separate "View Trades"/"View Shares" button columns).

**Backend — `src/db.ts`**

- `WarriorVolumeEntry` (line 1451): add `price: number | null; anchorPrice: number | null; raidAnchorPrice: number | null;`.
- `getWarriorVolumeOverview()` (line 1478): add `w.anchor_price, w.raid_anchor_price` to the existing SELECT (already `FROM warriors w`) rather than calling `getAnchorPrice()`/`getRaidAnchorPrice()` per row — keeps this a single query instead of adding N extra prepared-statement calls per warrior. Extend the intermediate row type to match. Change line 1516 `const price = totalShares > 0 ? getLatestPrice(r.warrior_id) : null;` to `const price = getLatestPrice(r.warrior_id);` (unconditional — safe, since `totalInvested` stays `0` whenever `totalShares === 0` regardless of price). Add `price, anchorPrice: r.anchor_price, raidAnchorPrice: r.raid_anchor_price` to the returned object.
- No `warriors.price` column exists — current price only ever comes from `getLatestPrice()` (reads `price_snapshots`), which can be `null` for a never-traded/never-raided warrior. Render `null` as `'–'` client-side, matching the existing convention at `CharactersTab.tsx:205` (`holders.latestPrice`).

**Frontend — `client/src/api.ts`**

- `WarriorVolumeRow` (lines 554-564): add the same 3 fields.

**Frontend — `client/src/components/admin/CharactersTab.tsx`**

- `SortKey` (line 16): add `'price' | 'anchorPrice' | 'raidAnchorPrice'`.
- `COLUMNS` (line 18): prepend `{ key: 'price', label: 'Price' }, { key: 'anchorPrice', label: 'Anchor Price' }, { key: 'raidAnchorPrice', label: 'Raid Anchor Price' }` before the existing 4 — keeps them sortable, consistent with every other numeric column in this table.
- `sortValue()` (line 25): add cases returning `row.price ?? 0`, `row.anchorPrice ?? 0`, `row.raidAnchorPrice ?? 0`.
- Header right-align check (line 131): extend `col.key === 'volume' || col.key === 'invested'` to also include the 3 new keys.
- Remove the two empty `<th></th>` at lines 139 and 146 (previously hosting the link buttons).
- Empty-state `colSpan={8}` (line 152) → `9` (3 new + Character/Invested/Volume/Trades + Shares/Holders = 9 columns after dropping the 2 button columns).
- Row cells (lines 162-187): prepend 3 right-aligned `<td>` cells rendering `row.price`/`anchorPrice`/`raidAnchorPrice` via `fmtCoin(...)` or `'–'` when null. Replace the `tradeCount` `<td>` + "View Trades" button `<td>` pair with one cell where the count itself is the button:
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
    Leave `totalShares` as a plain `<td>`. Replace the `holderCount` `<td>` + "View Shares" button `<td>` pair the same way, keeping `onClick={() => toggleDetail(row.warriorId, 'shares')}`.

No changes needed to `src/routes/adminMarket.ts` (already passes `getWarriorVolumeOverview()` through untouched) or `PriceHistoryTab.tsx` (only reads unrelated fields from `WarriorVolumeRow`).

---

## Item 2: Funds risk indicator — color the label text too

**`client/src/components/RiskBar.tsx`** (line 9): add `data-risk={risk}` to the outer `.risk-bar-wrap` span (line 10's inner `.risk-bar` span keeps its own `data-risk` too — harmless duplication, avoids touching the existing segment-color selectors):

```tsx
<span className="risk-bar-wrap" data-risk={risk}>
```

**`client/src/styles.css`** (after the existing segment-fill rules, lines 977-991): add

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

Drop the `color: var(--muted);` line from the base `.risk-bar-label` rule (lines 992-997) since it's now always overridden — keep `font-size`/`text-transform`/`letter-spacing`.

Matches the codebase's existing convention (fixed CSS-var stops per risk level, not computed in JS). No changes needed in consumers (`FundCard.tsx`, `WalletPage.tsx`, `admin/FundForm.tsx`, `AdminManageFundsPage.tsx`) — they just render `<RiskBar risk={...} />`.

---

## Item 3: Funds trade history (show in personal + admin views, exclude from public feed, rename column, include P&L)

Currently `transactions` (character trades) and `fund_transactions` (fund trades, `src/db.ts:2725` `FundTransactionRow`) are separate tables; only `transactions` is ever read anywhere. `listTransactions()` (`src/db.ts:1764-1791`) backs personal history (`GET /transactions/mine`), admin profile view (`GET /users/:userId`), and the public feed (`GET /feed`) — all in `src/routes/trading.ts` and `src/routes/adminMarket.ts`.

User decisions for this item: **fund trades get real computed realized P&L** (not blank), and **the public Trade Feed page keeps its "Warrior" column label** (it can never show a fund row, so the specific label stays accurate there — only the wallet and admin profile tables, which now mix both, get relabeled "Target").

**Backend — `src/db.ts`**

- Add `FundTransactionWithContext extends FundTransactionRow { fund_name: string; username: string; avatar: string | null; }`.
- Add `listFundTransactions(opts: { fundId?: number; userId?: string; limit?: number } = {})`, mirroring `listTransactions()` (line 1764) exactly: joins `fund_transactions ft` → `funds f` (no `deleted_at` filter — funds are soft-deleted only, so historical trades must still resolve a fund name) → `users u` (`u.discord_id = ft.user_id`).
- Add `listAllFundTransactionsForUser(userId)`, mirroring `listAllTransactionsForUser()` (line 1406): `SELECT * FROM fund_transactions WHERE user_id = ? ORDER BY fund_id ASC, created_at ASC, id ASC` (full unpaginated history — needed for correct average-cost P&L replay, same reasoning as the existing character-trade version).

**Backend — `src/pnl.ts`**

- Generalize `replayRealizedPnl()` (line 9) to take a grouping-key function instead of hardcoding `tx.warrior_id` (line 14):
    ```ts
    function replayRealizedPnl<
        T extends {
            id: number;
            side: 'buy' | 'sell' | 'liquidation';
            shares: number;
            total: number;
        },
    >(rows: T[], groupKey: (row: T) => number): Map<number, number> {
        // same body, state keyed by groupKey(tx) instead of tx.warrior_id
    }
    ```
- Update `computeRealizedPnlByUser()` (line 41) to call it with `(tx) => tx.warrior_id` — no behavior change for character trades.
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

- Apply the same merge pattern inside `/users/:userId` (line 100), replacing the current `listTransactions(...).map(...)` block with merged `characterTx`/`fundTx` arrays (limit 500 each, sorted and sliced to 500 total), adding `targetType`/`targetName` and `computeRealizedFundPnlByUser`-sourced `realizedPnl` for fund rows.
- Add `listFundTransactions`, `computeRealizedFundPnlByUser` to imports in both route files.

**Frontend — `client/src/api.ts`**

- Leave `TransactionView` (line 342) as-is — used only by `getTradeFeed()`/`TradeFeedPage.tsx`, unchanged.
- Add `PersonalTransactionView { id, targetType: "character"|"fund", targetName, side, shares, price, total, createdAt, username: string|null, avatar: string|null, isMine, realizedPnl: number|null }`; change `getMyTransactions()` to return `Promise<PersonalTransactionView[]>`.
- `AdminUserTransaction` (lines 496-506): replace `playerName`/`server` with `targetType: "character"|"fund"`, `targetName: string`.

**Frontend — `client/src/pages/WalletPage.tsx`**

- Swap `transactions` state type (lines 16, 27) to `PersonalTransactionView[]`.
- Header (line 180): `Warrior` → `Target`.
- Row `key` (line 197): `key={tx.id}` → ``key={`${tx.targetType}-${tx.id}`}`` — character and fund transaction ids come from separate autoincrement sequences and can collide once merged into one list.
- Cell (line 202): `tx.playerName` → `tx.targetName`.

**Frontend — `client/src/components/PortfolioBreakdownCard.tsx`**

- `recentTransactions` prop type (line 11-17): replace `playerName: string;` with `targetType: "character"|"fund"; targetName: string;`.
- Line 81 key and line 84 display: same `targetName`/composite-key swap as above. This component is shared by `WalletPage.tsx` (line 121) and `UsersTab.tsx` (line 434), so one change covers both.

**Frontend — `client/src/components/admin/UsersTab.tsx`**

- Header (line 453): `Warrior` → `Target`. Row key (line 470) and cell (line 475): same `targetName`/composite-key swap as `WalletPage.tsx`.

**Frontend — `client/src/pages/TradeFeedPage.tsx`**

- No change. Stays character-only via the untouched `/feed` route and `TransactionView`; header stays `Warrior` per the user's decision.

**Known scope edge, not fixed here:** `getUserTradeCount()` (wallet-summary "Trades" badge) stays character-only, so once a user has fund trades, the trade-history table can show more rows than the summary badge. Flagging as a pre-existing-shape inconsistency, not part of this request.

---

## Item 4: Funds card "Last 7 days: 0.00" bug

**Root cause (verified):** `serializeFundSummary()` in `src/routes/funds.ts:41` does `last7DaysDelta: navSevenDaysAgo !== null ? nav - navSevenDaysAgo : 0`. `getFundNavAt()` (`src/db.ts:2442`) returns `null` when no `fund_value_snapshots` row exists at least 7 days old — true for any fund younger (by trading activity) than a week, since snapshots only start accumulating once a fund is first traded. `allTimeDelta` (line 42) has no such gap because it compares against `fund.seed_nav`, always present from creation (`DEFAULT 100`).

**Fix — `src/routes/funds.ts:41`:**

```ts
last7DaysDelta: nav - (navSevenDaysAgo ?? fund.seed_nav),
```

Mirrors `allTimeDelta`'s existing fallback — compares against the earliest available baseline instead of hardcoding a misleading "no change." User confirmed this fallback approach.

**Accepted tradeoff:** for a fund younger than 7 days, `last7DaysDelta` and `allTimeDelta` will render as identical numbers until the fund has 7+ days of history. Correct, just not visually distinguished from "genuinely flat over 7 days" — no `FundCard.tsx` changes needed.

---

## Verification

- `npm run build` / `tsc` (whatever the project's typecheck script is) to catch type errors across the `WarriorVolumeEntry`/`WarriorVolumeRow`, `PersonalTransactionView`/`AdminUserTransaction`, and `pnl.ts` generic changes.
- Run the dev server, log in as admin:
    - Admin → Manage App → Characters: confirm Price/Anchor/Raid Anchor columns render (including `–` for untraded warriors), sort correctly, and that clicking a Trades or Holders count opens the same detail panel the old buttons did.
    - Any Funds view (Funds tab, Wallet, Admin Manage Funds): confirm the risk label text is now colored per risk level, matching the bar.
    - Wallet page "My trade history": make a fund trade (buy + sell) and a character trade; confirm both appear under a "Target" column with correct target name and a populated P&L for sell/liquidation rows (blank for buys).
    - Admin → user profile trade history: confirm the same for another user, and confirm the public Trade Feed page still shows only character trades under a "Warrior" column.
    - Funds tab: find or create a fund younger than 7 days and confirm "Last 7 days" no longer shows a hardcoded `0.00` when All Time shows real movement.
- Update `TODO.md`: remove all 4 completed items.
