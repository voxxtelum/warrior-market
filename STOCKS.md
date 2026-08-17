# How Warrior Stock Prices Work

This is the deep-dive on the pricing engine: exactly what makes a warrior's price move, and what every admin-configurable knob does. If you just want the short version, read the FAQ instead — this doc is for when you're tuning things and need to know exactly what a slider does.

## The short version

Every warrior has one price that only ever changes for three reasons:

1. **A raid report gets ingested** — real WarcraftLogs performance moves the price, and this is permanent (it compounds, raid after raid).
2. **An idle drift tick fires** — a small automatic nudge that happens on a timer between raids, mostly just texture, with a rare chance of a much bigger random swing.
3. **Someone trades** — buying nudges the price up a little, selling nudges it down a little, right at the moment of the trade.

Nothing else moves a price. There's no manual "set price" button — every number on the leaderboard is the end result of one of those three things happening, in order, over time.

## Two prices, not one

Every warrior actually has **three** numbers tracked behind the scenes, and mixing them up is the most common source of confusion:

- **Current price** — the number everyone sees. The latest entry in that warrior's price history.
- **Trading anchor** (`anchor_price`) — where idle drift tries to pull the current price back toward. Raids reset it *and* trades nudge it.
- **Raid anchor** (`raid_anchor_price`) — the "fundamental" value. Only a raid result ever sets this one. Trades never touch it.

Why two anchors instead of one? Because trading pressure and raid performance should behave differently over time. If a warrior gets bought up hard, that pressure should matter *for a while* — but it shouldn't be permanent the way an actual good raid night is. So every idle tick, the trading anchor quietly creeps back toward the raid anchor (see **Demand anchor decay** below), and a trade nudges the trading anchor by its own proportional impact (see Timeline 3) rather than overwriting it outright — so a trade never erases whatever gap a recent raid left behind.

A raid result moves *both* anchors together, but leaves the current price alone. Rather than snapping the market to a new number the instant a report lands, a raid resolves the fundamental value forward and lets idle drift pull the current price toward it over the following ticks (Timeline 2's reversion step) — the same mechanism that already handles a demand-driven gap. The one exception is a warrior's very first-ever raid, which also has to seed their starting price, since nothing else will.

---

## Timeline 1: A raid report gets ingested

This is the only thing that "really" moves a price — everything else (drift, trades) is just texture on top of it.

**Step 1 — figure out who's a tank this raid.** For each report, the top N warriors by raw total damage taken are classified as tanks for *that specific raid* — straight ranking, no other filter. N is instance-specific (`tankTopNByZone`), since a Naxxramas night and a Molten Core night don't need the same number of tanks. Someone can be a tank one week and DPS the next.

**Step 2 — check attendance.** Anyone whose active time this raid is far below the raid's top attendee (someone who disconnected, showed up late, etc.) gets flagged as low-attendance. Their raid still shows up in their history, but it can't move their price — it's treated as neutral.

**Step 3 — score cast counts.** For each tracked ability that applies to a warrior's role, they get ranked against their raid-mates: dead last is a full negative score, top of the pack is a full positive score, exactly average is zero. Those per-ability scores get averaged together (weighted by how important each ability is) into one **cast score**.

**Step 4 — score damage, two ways:**
- *Trend score:* how does this warrior's DPS tonight compare to their own recent average in this raid zone? Beating your own recent form scores positive, falling behind it scores negative. Brand new warriors (or warriors new to this raid zone) get this score gradually phased in rather than judged on one data point.
- *Peer score:* how does this warrior's DPS tonight rank against everyone else in their role (tank or DPS) *this specific raid*? Same "last place negative, first place positive, average is zero" ranking as cast score.

Those two get blended into a **damage score**.

**Step 5 — combine into one report score:**

```
damage score  = (damage trend weight × trend score) + (damage peer weight × peer score)
report score  = (damage weight × damage score) + (cast weight × cast score)
```

(Low-attendance warriors skip straight to `report score = 0` — no move this raid, but the raid still shows up in their history.)

**Step 6 — apply it to the trading anchor, not the live price.** `report score` is added directly to whatever the *trading anchor* currently is — not the live, currently-trading price. The move is a **flat dollar amount** per point of report score, not a percentage — a rookie and a veteran with the same report score move by the same number of dollars, regardless of how expensive either one already is. Gains and losses use separate rates:

```
new anchor = current trading anchor + (price per score point × report score)
```

(`price per score point` is `pricePerScorePointUp` when report score is positive, `pricePerScorePointDown` when it's negative.) The result is floored at a small positive minimum so a very bad night can never drive the anchor to zero or below.

*Both* anchors (trading anchor and raid anchor) reset to this same new value. The live price itself is left exactly where it was — a raid resolves the *fundamental* value forward, and idle drift's reversion step (Timeline 2) is what pulls the actual tradable price toward it over the following ticks, the same way it already handles a demand-driven gap. This is the one moment `price per score point` and the trading anchor interact directly; every other timeline in this doc only ever moves the live price relative to itself.

A raid still writes a permanent, audit-only record of this move to the price history ledger (tagged `raid_anchor`), separate from the live price. The one exception is a warrior's very first-ever raid: since nothing else exists yet to give them a starting price, that one raid *does* set the live price directly (using `report score` applied to `startingPrice`), and it's tagged plain `raid` in the ledger.

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `damageWeight` | 0.6 | Damage score's share of the report score. | Raw performance matters more than ability/rotation usage in the final score. |
| `castWeight` | 0.4 | Cast score's share of the report score. | Playing your rotation "correctly" matters more than raw damage numbers. |
| `pricePerScorePointUp` | 8 | Flat dollars a positive report score of 1.0 moves the price, regardless of current price. | Good nights swing prices harder in dollar terms, independent of tenure. |
| `pricePerScorePointDown` | 8 | Flat dollars a negative report score of 1.0 moves the price, regardless of current price. | Bad nights swing prices harder in dollar terms, independent of tenure. |
| `startingPrice` | 100 | Where a brand-new warrior's price starts. | New warriors start higher on the board before they've proven anything. |
| `damageTrendWeight` | 0.5 | Trend score's share of the damage score. | "Are you personally improving" matters more than "are you beating your raid-mates tonight." |
| `damagePeerWeight` | 0.5 | Peer score's share of the damage score. | "Are you beating your raid-mates tonight" matters more than personal improvement. |
| `damageTrendZClampUp` | 4 | Caps how extreme a single **good**-night trend score can be, before the raid-average subtraction. | An unusually good night is allowed to swing the trend score further upward before it gets capped. |
| `damageTrendZClampDown` | 4 | Caps how extreme a single **bad**-night trend score can be, before the raid-average subtraction. | An unusually bad night is allowed to swing the trend score further downward before it gets capped. |
| `dpsEmaAlpha` | 0.15 | How fast a warrior's "recent DPS average" (what trend score compares against) reacts to new raids. | Old raids get forgotten faster — the baseline leans more heavily on just the last night or two. |
| `coldStartReports` | 3 | How many raids in a zone it takes before trend score reaches full strength. | Takes longer for a warrior new to a zone before their trend score counts at full weight. |
| `minBucketSize` | 2 | Minimum eligible raid-mates needed before a cast/DPS ranking counts. | Small raids more often have that night's ranking skipped entirely (safer against noise, but less signal used). |
| `tankTopN` | 4 | Fallback max number of warriors classified as tanks per raid, for any zone with no entry in `tankTopNByZone`. | More warriors can be labeled a tank on a given night, in zones not covered by the per-zone table. |
| `tankTopNByZone` | MC 3, BWL 3, AQ40 4, Naxx 4 | Per-zone override for `tankTopN`, keyed by exact WCL zone name. Ranking is straight top-N by raw total damage taken this raid — no uptime filter. | More warriors can be labeled a tank on a given night, for that specific zone. |
| `newPlayerGraceReports` | 2 | How many of a warrior's first raids in a zone get their *negative* cast score softened. | New warriors get the leniency for longer before being judged at full strength. |
| `newPlayerPenaltyLeniency` | 0.3 | How much of a negative cast score still applies during the grace period. | Less forgiveness during the grace period — a new warrior's bad nights count for more (1 = no leniency at all). |
| `minAttendancePct` | 0.3 | Attendance floor (vs. the raid's top attendee) below which a night is excluded from moving price. | Stricter attendance bar — more partial nights get excluded. |
| Ability weights | (per-ability, admin editable) | Each tracked ability's importance and role restriction ("all"/"dps"/"tank") in the cast score. | That specific ability's usage counts for more in the blended cast score. |

---

## Timeline 2: An idle drift tick fires

This runs on a timer (`driftIntervalMs`) whether or not anyone is raiding or trading — it's what gives the market "texture" on quiet nights instead of every price sitting perfectly flat between raids.

Each tick, for every warrior:

**Step 1 — decay the trading anchor toward the raid anchor.** Whatever gap trading has opened up between the two anchors shrinks a little (`demandAnchorDecayPct`). This is the mechanism that makes a demand-driven pump or dump fade over time instead of sticking around forever.

**Step 2 — roll for a rare "overnight swing."** There's a small chance (`swingChancePct`) this warrior gets hit with a much bigger, sudden move instead of the normal small nudge — a random direction, sized around a **flat dollar amount** (`swingUpMagnitude`/`swingDownMagnitude`) with some randomness added (`swingMagnitudeFuzz`, also flat dollars). Unlike the normal tick below, a swing is not a percentage of price — a cheap and an expensive warrior get hit by the same number of coins. A small, fixed, non-configurable jitter (±3-5%) is also applied to the final amount so swings don't all land on suspiciously round numbers (a "+20" swing might actually post as "+19.14"). This move ignores the normal per-tick cap entirely, on purpose — it's meant to feel like real news, not routine noise.

There's a safety valve on this, though: if a warrior already got knocked well off their anchor in one direction (further than `swingCooldownGapPct`), another swing in *that same direction* is blocked until the price drifts back closer to the anchor. This stops a warrior from getting unluckily hammered by several swings in a row, stacking into an absurd move. A swing in the *opposite* direction is never blocked — a warrior can always get a bounce back.

**Step 3 — if no swing happened (or one got blocked by the cooldown), do the normal small move instead**, made of three ingredients added together and capped at `driftMaxPct` total:

- **Reversion** — a pull back toward the (possibly just-decayed) trading anchor, strength set by `driftReversionStrength`.
- **Market gravity** — a pull toward the current average price across every tradeable warrior, strength set by `marketGravityStrength`. This is what stops the *entire market* from drifting up (or down) together forever — an individual warrior can still climb relative to everyone else, but the whole roster can't just inflate in lockstep from drift alone.
- **Random noise** — a small random nudge in either direction, sized independently by `driftNoisePct` (not by `driftMaxPct` — see the config table below).

```
normal move = reversion + gravity + random noise, clamped to ±driftMaxPct
new price   = current price × (1 + normal move)           [normal tick, percentage]
new price   = current price ± swing magnitude              [swing tick, flat dollars, no cap]
```

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `driftIntervalMs` | 3,600,000 (1 hour) | How often a tick happens, in milliseconds. | Ticks happen *less* often — this is a time interval, so a bigger number means a slower market. Applies from the very next tick, no restart needed. |
| `driftMaxPct` | 0.5% | The hard cap on a single *normal* tick's **total** move — reversion + gravity + noise combined (swings ignore this). | Reversion/gravity have more headroom to move a price in one tick when a real gap exists, on top of whatever `driftNoisePct` already uses. |
| `driftNoisePct` | 0.5% | The size of just the random noise ingredient, independent of the overall cap above. | Idle price action gets choppier on quiet nights, without changing how far a real reversion/gravity pull can move a price. |
| `driftReversionStrength` | 0.3 | How hard a normal tick pulls back toward the trading anchor. | Price snaps back toward its anchor more aggressively each tick (1 = almost fully anchored every tick; 0 = no pull at all, pure random walk). |
| `demandAnchorDecayPct` | 0.05 (5%) | Share of the gap between the trading anchor and the raid anchor that closes every tick. | Demand-driven pumps/dumps fade faster — trading pressure has to stay sustained to keep sticking. |
| `marketGravityStrength` | 0.03 (3%) | Pull toward the market-wide average price each tick. | Every warrior's price stays closer to the pack — harder for the whole market, or one warrior, to drift far from the group. |
| `swingChancePct` | 1% | Chance, per warrior per tick, of a big overnight swing instead of a normal move. | Swings happen more often (0 disables them entirely). |
| `swingUpMagnitude` | $20 | Flat dollar base size of an upward overnight swing, regardless of current price. | Pump swings are bigger in dollar terms, on average. |
| `swingDownMagnitude` | $20 | Flat dollar base size of a downward overnight swing, regardless of current price. | Crash swings are bigger in dollar terms, on average. |
| `swingMagnitudeFuzz` | $5 | Flat dollar wobble added around the base swing magnitude. | Swing sizes get less predictable — a wider range around the base magnitude (e.g. a $20 base with $10 fuzz lands anywhere from $10-30). |
| `swingCooldownGapPct` | 8% | How far a price must already be displaced from its anchor (in a swing's direction) before another same-direction swing gets blocked. | The safety net kicks in later — same-direction swings can chain more freely before one finally gets blocked. |

---

## Timeline 3: A trade executes

Trades are the only thing that happens instantly, the moment someone clicks buy or sell, rather than on a timer.

**Step 1 — figure out shares and fee.** Buying spends a coin amount at the current price to get however many (fractional) shares that buys. Selling works in reverse — coin's worth of shares, capped at whatever the seller actually holds (selling "everything" is just a large amount, no special case needed). A fee (`tradeFeePct`) is added on top of a buy, or taken out of the proceeds of a sell — so buying and immediately selling back is always a guaranteed small loss, which keeps wash-trading pointless.

**Step 2 — move the price.** This is the demand signal: a buy pushes the price up, a sell pushes it down, sized by how much coin actually changed hands relative to `demandLiquidityDenominator`, capped at `demandMaxPctPerTrade` so no single trade — however large — can move a price more than that in one shot.

```
raw impact     = trade value ÷ demandLiquidityDenominator
capped impact  = min(raw impact, demandMaxPctPerTrade)
new price      = current price × (1 + capped impact)     [buy: positive, sell: negative]
```

**Step 3 — nudge the trading anchor.** The trading anchor moves by this trade's own proportional impact (the same `capped impact` from Step 2) rather than being overwritten to match the new price outright:

```
new anchor = current trading anchor × (1 + capped impact)
```

This is a deliberate choice: since a trade's impact is already a small, bounded percentage, applying it to the anchor's own current value preserves whatever gap a recent raid (or prior trading) left behind, instead of a single trade silently erasing it. The raid anchor is left completely untouched either way — this is exactly the mechanism described up top: a trade's effect is real and immediate, but it's the trading anchor (not the fundamental one) that moved, so idle drift will start quietly unwinding it (via `demandAnchorDecayPct`) unless more trading keeps pushing in the same direction.

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `demandMaxPctPerTrade` | 1.5% | Hard cap on how much a single trade can move a price, no matter how large the trade is. | Large trades ("whales") can move a price further in one shot. |
| `demandLiquidityDenominator` | 50,000 | The coin value that produces roughly a 1% price move (before the cap above applies). | The market gets "thicker" — it takes more coin to move a price the same amount, i.e. less sensitive to trading. |
| `tradeFeePct` | 0.25% | Fee charged on every buy and every sell. | Trading costs more — fast in-and-out flipping gets less attractive. |

---

## Frozen numbers vs. live numbers

This is the part that trips people up when tuning config, so it gets its own section: **not every number on the Stock page comes from the same place.**

- **Frozen** — the actual tradable **Price** column (including the small "change since last raid" figure shown right underneath it, and the same figure in the trade modal), the price chart, and everything wallet/portfolio-related (holdings value, trade fills). The Price column, chart, and portfolio figures come from the permanent `price_snapshots` ledger — the record of every drift tick, trade, and (for a warrior's very first raid only) raid result that's ever actually happened. The "change since last raid" figure instead reads the warrior's raid anchor directly, since a raid (after the first) no longer writes a live-price ledger row at all — see **Two prices, not one** above. Once a row lands in the ledger, it never changes on its own.
- **Live** — the **Trend** sparkline, the **Change (last raid)** *column* (further right in the table, distinct from the small delta under Price), and **Gain/raid**. These come from re-running the entire raid-scoring calculation from scratch, from the raw WarcraftLogs data, every single time the Stock page loads — using whatever the config says *right now*. Nothing about them is saved or cached.

That second group is why changing a weight can *look* like it rewrote history: the moment you save new `damageWeight`/`castWeight`/etc. and reload the page, the Trend line, the "Change (last raid)" column, and "Gain/raid" for every warrior immediately reflect the new weights applied across their entire raid history — while the Price column, its small change figure, and the chart sitting right next to them don't move at all, because those are reading the frozen ledger instead.

Don't mix the two groups together — e.g. comparing the frozen current price against the live-recomputed last-raid value produces a number that matches neither the chart nor the config. The small delta under the Price column and in the trade modal deliberately stay frozen-to-frozen (current price vs. the warrior's raid anchor) for exactly this reason.

Since a raid only ever moves the anchor now (never the live price directly, past a warrior's first raid), the frozen Price column's own "since last raid" figure and the live group's **"Change (last raid)"**/**"Gain/raid"** naturally diverge more, and for longer, than they used to — drift/trading are free to carry the tradable price away from what a raid actually set, for as long as it takes idle reversion to catch back up. That's expected, not a bug: the live group answers "how did this warrior objectively perform, ignoring the market," while the frozen Price answers "what did the market actually pay" — the two are genuinely different questions, not just different data sources for the same one.

## Where to tune all of this

All of the settings above live on the admin **Stock Config** page and apply immediately — no restart needed, no redeploy needed. Every drift tick and every trade always uses whatever the config currently says, and so does the live-recomputed group above.

Once a raid's price has been frozen into a warrior's history, it stays exactly as recorded — changing a config value afterward doesn't rewrite anything in the ledger. The only things that ever recompute a warrior's *entire* price history from scratch and overwrite the frozen ledger with it are deliberate, explicit admin actions: deleting a report, or using "Reset Market." Neither of those happens automatically, and both require confirmation.

## Admin Price History

Every row ever written to the `price_snapshots` ledger — raid, raid anchor, drift, swing, and trade alike — is browsable on the admin **Price History** page, across every warrior, newest first. Each row shows the resulting price and the exact delta from the row before it for that warrior. Drift is excluded by default (it's by far the largest and least interesting slice, given it ticks hourly forever); toggle it on, or narrow to one character, as needed.

Two raid-related sources appear side by side: **`raid`** is a warrior's very first-ever raid, which also seeds their starting live price. **`raid_anchor`** is every raid after that — audit-only rows recording how much the raid moved the anchor, since those raids no longer touch the live price at all. Both are included by default, since together they're a warrior's complete raid history; only `raid_anchor` rows are excluded from the Price column, chart, and every other place that reads "the current live price" (see `getLatestPrice`'s own exclusion).

One caveat: a fix shipped alongside this tab corrected trade-caused rows to record `source: 'trade'` instead of `'drift'` (they were previously indistinguishable from routine idle ticks) and started storing each row's delta directly. Both apply going forward only — historical rows from before the fix still say `'drift'` even where a trade actually caused the move, and couldn't be reliably reclassified after the fact (there's no stored link back to the trade that caused them). Deltas on historical rows *were* backfilled, since those only need the ledger's own price history to compute.
