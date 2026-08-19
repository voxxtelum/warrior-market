import { getAllPriceSnapshotsForRepair, updatePriceSnapshotPriceDelta } from "./db";

// One-time repair for a known historical bug (now fixed - see
// undoReportPriceImpact in stock.ts): report deletions used to trigger a
// full computeStock() replay that overwrote every warrior's ENTIRE raid
// ledger, tagging every row 'raid' and stamping in whatever price
// computeStock() produced under whatever stock_config was active at
// rebuild time - regardless of what that raid actually did when it was
// live-committed. Most of those replayed rows land close enough to the
// truth to be harmless, but a warrior's raid can land between two real,
// untouched drift/trade/swing rows and diverge sharply from both,
// producing a visible "raid dip immediately corrected by an oversized
// drift tick" artifact in the chart and price history.
//
// This is fixable exactly where a maximal run of 'raid'-sourced rows for
// one warrior sits between two real (never-rebuilt) non-raid rows: those
// two neighbors are trustworthy ground truth for "the price before" and
// "the price after", so the true total movement across the run is known
// even though how it was split across the individual raid(s) is not. The
// fix distributes that known total evenly across the run and zeroes the
// following row's delta (which had been carrying the whole correction as
// a fake outsized drift):
//
//   before -> raid, raid, ..., raid (n of them) -> after
//   each raid: price := after.price, delta := (after.price - before.price) / n
//   after:     price unchanged,      delta := 0
//
// A warrior's *leading* run of 'raid' rows (before any drift/trade/swing
// has ever happened for them) has no trustworthy "before" anchor and is
// left alone - those are genuinely unrecoverable without a backup that
// predates the corruption, which does not exist for this game.
export interface RaidLedgerCorrectionRow {
  id: number;
  reportCode: string | null;
  oldPrice: number;
  oldDelta: number | null;
  newPrice: number;
  newDelta: number;
}

export interface RaidLedgerCorrection {
  warriorId: number;
  playerName: string;
  server: string;
  beforePrice: number;
  raidRows: RaidLedgerCorrectionRow[];
  afterRow: {
    id: number;
    price: number;
    oldDelta: number | null;
    newDelta: number;
  };
}

export function findRaidLedgerCorrections(): RaidLedgerCorrection[] {
  const rows = getAllPriceSnapshotsForRepair();
  const byWarrior = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!byWarrior.has(row.warrior_id)) byWarrior.set(row.warrior_id, []);
    byWarrior.get(row.warrior_id)!.push(row);
  }

  const corrections: RaidLedgerCorrection[] = [];
  for (const timeline of byWarrior.values()) {
    // Skip the leading run of 'raid' rows with no preceding non-raid row -
    // unfixable, see module comment above.
    let i = 0;
    while (i < timeline.length && timeline[i].source === "raid") i++;

    while (i < timeline.length) {
      if (timeline[i].source !== "raid") {
        i++;
        continue;
      }
      let j = i;
      while (j < timeline.length && timeline[j].source === "raid") j++;
      const before = timeline[i - 1];
      const after = j < timeline.length ? timeline[j] : null;
      if (after) {
        const n = j - i;
        const newDelta = (after.price - before.price) / n;
        const raidRows = timeline.slice(i, j).map((r) => ({
          id: r.id,
          reportCode: r.report_code,
          oldPrice: r.price,
          oldDelta: r.delta,
          newPrice: after.price,
          newDelta,
        }));
        const alreadyCorrect =
          after.delta === 0 && raidRows.every((r) => r.oldPrice === r.newPrice && r.oldDelta === r.newDelta);
        if (!alreadyCorrect) {
          corrections.push({
            warriorId: before.warrior_id,
            playerName: before.player_name,
            server: before.server,
            beforePrice: before.price,
            raidRows,
            afterRow: { id: after.id, price: after.price, oldDelta: after.delta, newDelta: 0 },
          });
        }
      }
      i = j;
    }
  }
  return corrections;
}

export function applyRaidLedgerCorrections(corrections: RaidLedgerCorrection[]): void {
  const updates: { id: number; price: number; delta: number }[] = [];
  for (const c of corrections) {
    for (const r of c.raidRows) updates.push({ id: r.id, price: r.newPrice, delta: r.newDelta });
    updates.push({ id: c.afterRow.id, price: c.afterRow.price, delta: c.afterRow.newDelta });
  }
  updatePriceSnapshotPriceDelta(updates);
}
