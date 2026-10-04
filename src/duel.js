import { InlineKeyboard } from 'grammy';
import { config } from './config.js';
import { displayName, escape } from './card.js';
import { edvillianity, tier } from './score.js';

// Moggduels. How a duel is decided is a secret: nothing in this file may ever
// be shown or explained to users. Only the winner and a vague margin are.
//
// Hidden power of a fighter, 0..1:
//   card      35%  Edvillianity / max points
//   rep       20%  appreciation, squashed so a huge rep can't run away
//   activity  35%  their share of the chat's messages relative to the other
//                  fighter's, when the duel is in a group the bot counts;
//                  random otherwise
//   luck      10%  always random, so no duel is a foregone conclusion
const WEIGHTS = { card: 0.35, rep: 0.2, activity: 0.35, luck: 0.1 };

/**
 * a, b: { user, rep, share } where share is the fighter's share of the chat's
 * messages (0..1) or null when unknown. Returns { winner, loser, margin }.
 */
export function fight(a, b) {
  const known = a.share != null && b.share != null && a.share + b.share > 0;
  const activityA = known ? a.share / (a.share + b.share) : Math.random();
  const activityB = known ? 1 - activityA : Math.random();

  const power = (f, activity) =>
    WEIGHTS.card * (edvillianity(f.user) / config.maxPoints) +
    WEIGHTS.rep * (0.5 + 0.5 * Math.tanh(f.rep / 10)) +
    WEIGHTS.activity * activity +
    WEIGHTS.luck * Math.random();

  const powerA = power(a, activityA);
  const powerB = power(b, activityB);
  const [winner, loser] = powerA >= powerB ? [a.user, b.user] : [b.user, a.user];
  return { winner, loser, margin: Math.abs(powerA - powerB) };
}

const VERDICTS = [
  [0.03, 'won by a single jawline 😮‍💨'],
  [0.1, 'clean mog 🗿'],
  [0.2, 'brutal mog 🔥'],
  [Infinity, 'total annihilation 💀'],
];

export function offerText(challenger, targetUsername) {
  const points = edvillianity(challenger);
  const whom = targetUsername ? `@${escape(targetUsername)}` : '<b>anyone</b>';
  return [
    '⚔️ <b>MOGGDUEL</b>',
    '',
    `<b>${displayName(challenger)}</b> challenges ${whom} to a Moggduel!`,
    `⚡ ${points} · ${tier(points)}`,
    '',
    'Who mogs whom? 🗿',
  ].join('\n');
}

export function resultText({ winner, loser, margin }) {
  const verdict = VERDICTS.find(([max]) => margin < max)[1];
  return [
    '⚔️ <b>MOGGDUEL</b>',
    '',
    `🏆 <b>${displayName(winner)}</b> mogged <b>${displayName(loser)}</b>`,
    `<i>${verdict}</i>`,
  ].join('\n');
}

/** Callback data: du:<challenger>:<nonce>[:<target username, lowercase>] (max 64 bytes). */
export function offerKeyboard(challengerId, nonce, targetUsername) {
  const data = `du:${challengerId}:${nonce}${targetUsername ? `:${targetUsername.toLowerCase()}` : ''}`;
  return new InlineKeyboard().text('⚔️ Accept the duel', data);
}

export const DUEL_DATA = /^du:(\d+):([0-9a-f]+)(?::(\w+))?$/;
