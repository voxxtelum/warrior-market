// Raid-tier progression order (rather than alphabetical) so instance
// pickers always read chronologically. Instances outside this list sort
// after the known ones, in their original order.
export const RAID_ORDER = [
  'Molten Core',
  'Blackwing Lair',
  "Temple of Ahn'Qiraj",
  'Naxxramas',
];

export function raidOrderIndex(instance: string): number {
  const i = RAID_ORDER.indexOf(instance);
  return i === -1 ? RAID_ORDER.length : i;
}
