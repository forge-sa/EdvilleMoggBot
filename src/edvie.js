import { escape } from './card.js';

// Edvies: collectible creatures made by the community. Nothing here is a
// specific Edvie; they all live in the database, created by users and
// approved by a developer.

// Ordered from the most common to the rarest; an Edvie stores its index.
export const RARITIES = [
  { label: 'Common', emoji: '⚪', colors: ['#9aa5b1', '#4a5560'], price: [50, 100] },
  { label: 'Rare', emoji: '🟢', colors: ['#45d47a', '#14692f'], price: [100, 200] },
  { label: 'Super Rare', emoji: '🔵', colors: ['#4f97ff', '#163f9e'], price: [200, 350] },
  { label: 'Epic', emoji: '🟣', colors: ['#b26bff', '#4f1a96'], price: [350, 600] },
  { label: 'Mythic', emoji: '🔴', colors: ['#ff5a5a', '#8f1414'], price: [600, 1000] },
  { label: 'Legendary', emoji: '🟡', colors: ['#ffd84a', '#a67c00'], price: [1000, 2000] },
];

// Specs: every Edvie splits exactly STAT_TOTAL points over these stats, at
// least STAT_MIN each, so nobody builds a 1-HP sprinter that hits first and
// hard. With three stats that leaves each one between 30 and 40.
export const STATS = [
  { key: 'hp', label: 'Health', short: 'HP', emoji: '❤️' },
  { key: 'dmg', label: 'Damage', short: 'DMG', emoji: '⚔️' },
  { key: 'spd', label: 'Speed', short: 'SPD', emoji: '⚡' },
];
export const STAT_TOTAL = 100;
export const STAT_MIN = 30;

const statNames = (stats) => {
  const names = stats.map((s) => `${s.emoji} ${s.label}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
};

export const rarityLine = (edvie) => `${RARITIES[edvie.rarity].emoji} ${RARITIES[edvie.rarity].label}`;
export const priceRange = (rarity) => `${RARITIES[rarity].price[0]}–${RARITIES[rarity].price[1]} 🪙`;
export const statsLine = (stats) => STATS.map((s) => `${s.emoji} ${stats[s.key]}`).join(' · ');

/** Latin only: the card's font has no other glyphs. */
export function parseName(text) {
  const name = text.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 20 || !/^[A-Za-z0-9]+(?:[ '-][A-Za-z0-9]+)*$/.test(name) || !/[A-Za-z]/.test(name)) {
    return { error: 'A name is 2–20 Latin letters or digits, spaces and hyphens allowed, e.g. <code>Moggzilla</code>.' };
  }
  return { value: name };
}

export function parseCost(text, rarity) {
  const [min, max] = RARITIES[rarity].price;
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    return { error: `${RARITIES[rarity].label} Edvies cost from ${min} to ${max} 🪙.` };
  }
  return { value: n };
}

/** Points left for stats after index i, given the ones already set. */
const pointsLeft = (stats, i) => STAT_TOTAL - STATS.slice(0, i).reduce((sum, s) => sum + stats[s.key], 0);

/**
 * Parses the value for STATS[i]. The last stat is never asked: it gets
 * whatever is left. Returns { value } or { error }.
 */
export function parseStat(text, stats, i) {
  const left = pointsLeft(stats, i);
  const max = left - STAT_MIN * (STATS.length - 1 - i);
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < STAT_MIN || n > max) {
    return { error: `Send a whole number from ${STAT_MIN} to ${max}.` };
  }
  return { value: n };
}

/** Fills in the last stat once all the others are set. */
export function completeStats(stats) {
  const last = STATS.at(-1);
  return { ...stats, [last.key]: pointsLeft(stats, STATS.length - 1) };
}

export function statQuestion(stats, i) {
  const stat = STATS[i];
  const left = pointsLeft(stats, i);
  const max = left - STAT_MIN * (STATS.length - 1 - i);
  const rest = statNames(STATS.slice(i + 1));
  return [
    i === 0
      ? `Every Edvie gets exactly <b>${STAT_TOTAL}</b> points to split between ${statNames(STATS)}, at least ${STAT_MIN} each.`
      : `<b>${left}</b> points left.`,
    `${stat.emoji} How many go to <b>${stat.label}</b>? (${STAT_MIN}–${max})`,
    STATS.length - 1 - i === 1 ? `The rest goes to ${rest}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** The text block that describes an Edvie everywhere it's shown. */
export function describe(edvie, creatorName) {
  return [
    rarityLine(edvie),
    `<b>${escape(edvie.name)}</b>`,
    statsLine(edvie.stats),
    ...(creatorName ? [`🎨 by ${creatorName}`] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Edvie battles: the two take turns hitting each other until one faints.
// The faster one strikes first (a coin flip on equal Speed). A hit deals a
// quarter of the attacker's Damage, so fights last a few turns; hits vary
// ±20% and one in ten is a critical (×1.5).
const HIT_SCALE = 0.25;

export function simulateBattle(a, b) {
  const fighters = [a, b];
  const hp = [a.stats.hp, b.stats.hp];
  const log = [];
  const tie = a.stats.spd === b.stats.spd;
  const first = tie ? (Math.random() < 0.5 ? 0 : 1) : a.stats.spd > b.stats.spd ? 0 : 1;
  let turn = first;

  for (let round = 0; round < 100 && hp[0] > 0 && hp[1] > 0; round++) {
    const target = 1 - turn;
    const crit = Math.random() < 0.1;
    const damage = Math.max(1, Math.round(fighters[turn].stats.dmg * HIT_SCALE * (0.8 + Math.random() * 0.4) * (crit ? 1.5 : 1)));
    hp[target] = Math.max(0, hp[target] - damage);
    log.push({ attacker: turn, damage, crit, left: hp[target] });
    turn = target;
  }

  const winner = hp[1] <= 0 ? 0 : 1;
  return { winner, log, first, tie };
}

/** Battle log lines, trimmed in the middle so the caption stays short. */
export function battleLog(a, b, { log, first, tie }, maxLines = 8) {
  const names = [a.name, b.name].map(escape);
  const opener = tie
    ? `🪙 Equally fast: ${names[first]} strikes first`
    : `⚡ ${names[first]} is faster and strikes first`;
  const lines = log.map(({ attacker, damage, crit, left }) => {
    const verb = crit ? `<b>CRITS</b> ${names[1 - attacker]} for` : `hits ${names[1 - attacker]} for`;
    return `${crit ? '🔥' : '💥'} ${names[attacker]} ${verb} ${damage} → ${left > 0 ? `❤️ ${left}` : '💀'}`;
  });
  if (lines.length <= maxLines) return [opener, ...lines];
  const head = Math.floor(maxLines / 2);
  return [opener, ...lines.slice(0, head), '⋯', ...lines.slice(lines.length - (maxLines - head))];
}
