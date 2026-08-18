export const CLASSES = [
  'Druid',
  'Hunter',
  'Mage',
  'Paladin',
  'Priest',
  'Rogue',
  'Shaman',
  'Warlock',
  'Warrior',
] as const;

export type WarriorClass = (typeof CLASSES)[number];

export const CLASS_COLORS: Record<WarriorClass, string> = {
  Druid: '#FF7D0A',
  Hunter: '#ABD473',
  Mage: '#69CCF0',
  Paladin: '#F58CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF569',
  Shaman: '#0070DE',
  Warlock: '#9482C9',
  Warrior: '#C79C6E',
};

export const REALMS = ['Atiesh', 'Azuresong', 'Myzrael', 'OldBlanchy'] as const;

// Every character ever tracked comes from Warrior raid logs, so a character
// with no class set yet is always actually a Warrior - fall back to that
// color rather than treating it as "no color."
export function classColor(characterClass: string | null | undefined): string {
  return CLASS_COLORS[(characterClass as WarriorClass) ?? 'Warrior'] ?? CLASS_COLORS.Warrior;
}

// Used to flavor the Admin Summary page's generated Discord text - real
// Unicode glyphs, not `:shortcode:` text, since Discord only auto-converts
// shortcodes as you type them, not when pasted in as plain text.
export const CLASS_EMOJIS: Record<WarriorClass, string> = {
  Druid: '🐻',
  Hunter: '🏹',
  Mage: '🔮',
  Paladin: '🔨',
  Priest: '✨',
  Rogue: '🗡️',
  Shaman: '⚡',
  Warlock: '👹',
  Warrior: '⚔️',
};

export function classEmoji(characterClass: string | null | undefined): string {
  return CLASS_EMOJIS[(characterClass as WarriorClass) ?? 'Warrior'] ?? CLASS_EMOJIS.Warrior;
}
