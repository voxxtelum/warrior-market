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

Why two anchors instead of one? Because trading pressure and raid performance should behave differently over time. If a warrior gets bought up hard, that pressure should matter *for a while* — but it shouldn't be permanent the way an actual good raid night is. So every idle tick, the trading anchor quietly creeps back toward the raid anchor (see **Demand anchor decay** below). A raid result instantly snaps both anchors to the same new value, wiping out whatever gap trading had opened up.

---

## Timeline 1: A raid report gets ingested

This is the only thing that "really" moves a price — everything else (drift, trades) is just texture on top of it.

**Step 1 — figure out who's a tank this raid.** For each report, whoever took the most damage (as a share of their own time in combat, so a DPS warrior eating one big hit doesn't get mistaken for a tank) is classified as a tank for *that specific raid*. Someone can be a tank one week and DPS the next.

**Step 2 — check attendance.** Anyone whose active time this raid is far below the raid's top attendee (someone who disconnected, showed up late, etc.) gets flagged as low-attendance. Their raid still shows up in their history, but it can't move their price — it's treated as neutral.

**Step 3 — score cast counts.** For each tracked ability that applies to a warrior's role, they get ranked against their raid-mates: dead last is a full negative score, top of the pack is a full positive score, exactly average is zero. Those per-ability scores get averaged together (weighted by how important each ability is) into one **cast score**.

**Step 4 — score damage, two ways:**
- *Trend score:* how does this warrior's DPS tonight compare to their own recent average in this raid zone? Beating your own recent form scores positive, falling behind it scores negative. Brand new warriors (or warriors new to this raid zone) get this score gradually phased in rather than judged on one data point.
- *Peer score:* how does this warrior's DPS tonight rank against everyone else in their role (tank or DPS) *this specific raid*? Same "last place negative, first place positive, average is zero" ranking as cast score.

Those two get blended into a **damage score**.

**Important:** the trend score gets one more adjustment — it's compared against *this raid's own average trend score* before being used. Why? Because "am I improving?" isn't a fair, self-contained question during a gear-up period — if the whole raid team is genuinely getting better at once, everyone would score positive together and the whole market would inflate every week even though nobody actually out-performed anybody. Subtracting the raid's own average fixes that: only improving *faster than your raid-mates* moves your price up from this. This is why a raid where everyone objectively plays better can still see some prices go down — those are the warriors who improved less than the night's average.

**Step 5 — combine into one report score**, and update the price:

```
damage score  = (damage trend weight × trend score) + (damage peer weight × peer score)
report score  = (damage weight × damage score) + (cast weight × cast score)
new price     = old price × (1 + price sensitivity × report score)
```

(Low-attendance warriors skip straight to `report score = 0` — no move this raid, but the raid still shows up in their history.)

**Step 6 — freeze it.** The new price is permanently recorded, and both anchors (trading anchor and raid anchor) are reset to match it exactly, wiping out any lingering demand pressure from trading between raids.

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `damageWeight` | 0.6 | Damage score's share of the report score. | Raw performance matters more than ability/rotation usage in the final score. |
| `castWeight` | 0.4 | Cast score's share of the report score. | Playing your rotation "correctly" matters more than raw damage numbers. |
| `priceSensitivity` | 0.05 | How much a report score of ±1 (a maximal good/bad raid) moves the price. | Raids swing prices harder — both good and bad nights hit harder. |
| `startingPrice` | 100 | Where a brand-new warrior's price starts. | New warriors start higher on the board before they've proven anything. |
| `damageTrendWeight` | 0.5 | Trend score's share of the damage score. | "Are you personally improving" matters more than "are you beating your raid-mates tonight." |
| `damagePeerWeight` | 0.5 | Peer score's share of the damage score. | "Are you beating your raid-mates tonight" matters more than personal improvement. |
| `damageTrendZClamp` | 4 | Caps how extreme a single trend score can be, before the raid-average subtraction. | A single unusually good or bad night is allowed to swing the trend score further before it gets capped. |
| `dpsEmaAlpha` | 0.15 | How fast a warrior's "recent DPS average" (what trend score compares against) reacts to new raids. | Old raids get forgotten faster — the baseline leans more heavily on just the last night or two. |
| `coldStartReports` | 3 | How many raids in a zone it takes before trend score reaches full strength. | Takes longer for a warrior new to a zone before their trend score counts at full weight. |
| `minBucketSize` | 2 | Minimum eligible raid-mates needed before a cast/DPS ranking counts. | Small raids more often have that night's ranking skipped entirely (safer against noise, but less signal used). |
| `tankTopN` | 4 | Max number of warriors classified as tanks per raid. | More warriors can be labeled a tank on a given night. |
| `tankMinUptimePct` | 0.20 | Minimum share of a warrior's own active time spent taking damage to be classified as a tank. | Stricter bar to count as a tank — fewer warriors qualify. |
| `newPlayerGraceReports` | 2 | How many of a warrior's first raids in a zone get their *negative* cast score softened. | New warriors get the leniency for longer before being judged at full strength. |
| `newPlayerPenaltyLeniency` | 0.3 | How much of a negative cast score still applies during the grace period. | Less forgiveness during the grace period — a new warrior's bad nights count for more (1 = no leniency at all). |
| `minAttendancePct` | 0.3 | Attendance floor (vs. the raid's top attendee) below which a night is excluded from moving price. | Stricter attendance bar — more partial nights get excluded. |
| Ability weights | (per-ability, admin editable) | Each tracked ability's importance and role restriction ("all"/"dps"/"tank") in the cast score. | That specific ability's usage counts for more in the blended cast score. |

---

## Timeline 2: An idle drift tick fires

This runs on a timer (`driftIntervalMs`) whether or not anyone is raiding or trading — it's what gives the market "texture" on quiet nights instead of every price sitting perfectly flat between raids.

Each tick, for every warrior:

**Step 1 — decay the trading anchor toward the raid anchor.** Whatever gap trading has opened up between the two anchors shrinks a little (`demandAnchorDecayPct`). This is the mechanism that makes a demand-driven pump or dump fade over time instead of sticking around forever.

**Step 2 — roll for a rare "overnight swing."** There's a small chance (`swingChancePct`) this warrior gets hit with a much bigger, sudden move instead of the normal small nudge — a random direction, sized around `swingUpMagnitudePct`/`swingDownMagnitudePct` with some randomness added (`swingMagnitudeFuzzPct`). This move ignores the normal per-tick cap entirely, on purpose — it's meant to feel like real news, not routine noise.

There's a safety valve on this, though: if a warrior already got knocked well off their anchor in one direction (further than `swingCooldownGapPct`), another swing in *that same direction* is blocked until the price drifts back closer to the anchor. This stops a warrior from getting unluckily hammered by several swings in a row, stacking into an absurd move. A swing in the *opposite* direction is never blocked — a warrior can always get a bounce back.

**Step 3 — if no swing happened (or one got blocked by the cooldown), do the normal small move instead**, made of three ingredients added together and capped at `driftMaxPct` total:

- **Reversion** — a pull back toward the (possibly just-decayed) trading anchor, strength set by `driftReversionStrength`.
- **Market gravity** — a pull toward the current average price across every tradeable warrior, strength set by `marketGravityStrength`. This is what stops the *entire market* from drifting up (or down) together forever — an individual warrior can still climb relative to everyone else, but the whole roster can't just inflate in lockstep from drift alone.
- **Random noise** — a small random nudge in either direction, size capped at `driftMaxPct`.

```
normal move = reversion + gravity + random noise, clamped to ±driftMaxPct
new price   = current price × (1 + normal move)          [normal tick]
new price   = current price × (1 ± swing magnitude)       [swing tick, no cap]
```

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `driftIntervalMs` | 3,600,000 (1 hour) | How often a tick happens, in milliseconds. | Ticks happen *less* often — this is a time interval, so a bigger number means a slower market. Applies from the very next tick, no restart needed. |
| `driftMaxPct` | 0.5% | The hard cap on a single *normal* tick's move (swings ignore this). | Choppier idle price action — each ordinary tick can move the price further. |
| `driftReversionStrength` | 0.3 | How hard a normal tick pulls back toward the trading anchor. | Price snaps back toward its anchor more aggressively each tick (1 = almost fully anchored every tick; 0 = no pull at all, pure random walk). |
| `demandAnchorDecayPct` | 0.05 (5%) | Share of the gap between the trading anchor and the raid anchor that closes every tick. | Demand-driven pumps/dumps fade faster — trading pressure has to stay sustained to keep sticking. |
| `marketGravityStrength` | 0.03 (3%) | Pull toward the market-wide average price each tick. | Every warrior's price stays closer to the pack — harder for the whole market, or one warrior, to drift far from the group. |
| `swingChancePct` | 1% | Chance, per warrior per tick, of a big overnight swing instead of a normal move. | Swings happen more often (0 disables them entirely). |
| `swingUpMagnitudePct` | 10% | Base size of an upward overnight swing. | Pump swings are bigger on average. |
| `swingDownMagnitudePct` | 10% | Base size of a downward overnight swing. | Crash swings are bigger on average. |
| `swingMagnitudeFuzzPct` | 2% | Random wobble added around the base swing magnitude. | Swing sizes get less predictable — a wider range around the base magnitude (e.g. a 10% base with 5% fuzz lands anywhere from 5-15%). |
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

**Step 3 — update the trading anchor.** The new price becomes the new trading anchor immediately. The raid anchor is left completely untouched — this is exactly the mechanism described up top: a trade's effect is real and immediate, but it's the trading anchor (not the fundamental one) that moved, so idle drift will start quietly unwinding it (via `demandAnchorDecayPct`) unless more trading keeps pushing in the same direction.

### Config that affects this stage

| Setting | Default | What it does | If you set it **higher** |
|---|---|---|---|
| `demandMaxPctPerTrade` | 1.5% | Hard cap on how much a single trade can move a price, no matter how large the trade is. | Large trades ("whales") can move a price further in one shot. |
| `demandLiquidityDenominator` | 50,000 | The coin value that produces roughly a 1% price move (before the cap above applies). | The market gets "thicker" — it takes more coin to move a price the same amount, i.e. less sensitive to trading. |
| `tradeFeePct` | 0.25% | Fee charged on every buy and every sell. | Trading costs more — fast in-and-out flipping gets less attractive. |

---

## Frozen numbers vs. live numbers

This is the part that trips people up when tuning config, so it gets its own section: **not every number on the Stock page comes from the same place.**

- **Frozen** — the actual tradable **Price** column, the price chart, and everything wallet/portfolio-related (holdings value, trade fills). These all come from the permanent `price_snapshots` ledger — the record of every raid result, drift tick, and trade that's ever actually happened. Once a row lands in that ledger, it never changes on its own.
- **Live** — the **Trend** sparkline, the **Change (last raid)** column, and **Growth/raid**. These come from re-running the entire raid-scoring calculation from scratch, from the raw WarcraftLogs data, every single time the Stock page loads — using whatever the config says *right now*. Nothing about them is saved or cached.

That second group is why changing a weight can *look* like it rewrote history: the moment you save new `damageWeight`/`castWeight`/etc. and reload the page, the Trend line, "Change (last raid)," and "Growth/raid" for every warrior immediately reflect the new weights applied across their entire raid history — while the Price column and chart sitting right next to them don't move at all, because those are reading the frozen ledger instead.

## Where to tune all of this

All of the settings above live on the admin **Stock Config** page and apply immediately — no restart needed, no redeploy needed. Every drift tick and every trade always uses whatever the config currently says, and so does the live-recomputed group above.

Once a raid's price has been frozen into a warrior's history, it stays exactly as recorded — changing a config value afterward doesn't rewrite anything in the ledger. The only things that ever recompute a warrior's *entire* price history from scratch and overwrite the frozen ledger with it are deliberate, explicit admin actions: deleting a report, or using "Reset Market." Neither of those happens automatically, and both require confirmation.
