import { InlineKeyboard } from 'grammy';
import { config, isDev } from './config.js';
import { FIELDS } from './fields.js';
import { durationLabel, todayIso } from './dates.js';
import { bar, edvillianity, tier } from './score.js';

export const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function displayName(user) {
  return escape(user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Anonymous Edvillian');
}

function line(user, field, extra = '') {
  const def = FIELDS[field];
  return `${def.emoji} ${def.label}: <b>${def.format(user[field])}</b>${extra}`;
}

/** stats: { rep, wins, losses, creatorTitle } (creatorTitle: e.g. "Creator Rank III", or null) */
export function cardText(user, { rep, wins, losses, creatorTitle }) {
  const points = edvillianity(user);
  const username = user.username ? ` @${escape(user.username)}` : '';
  const badge =
    (isDev(user.user_id) ? '\n🛠 <i>Moggmeter Developer</i>' : '') + (creatorTitle ? `\n🎨 <b>${creatorTitle}</b>` : '');
  const repLabel = rep > 0 ? `+${rep}` : String(rep);

  return [
    '🗿 <b>EDVILLE MOGGMETER</b>',
    '',
    `👤 <b>${displayName(user)}</b>${username}${badge}`,
    line(user, 'grade'),
    line(user, 'gpa'),
    line(user, 'ielts'),
    line(user, 'sat'),
    line(user, 'since', ` (${durationLabel(user.since, todayIso())})`),
    '',
    `⚡ Edvillianity: <b>${points}</b> / ${config.maxPoints}`,
    `<code>${bar(points)}</code>`,
    `🏷 <i>${tier(points)}</i>`,
    '',
    `⬆️ Rep: <b>${repLabel}</b>`,
    ...(wins + losses ? [`⚔️ Moggduels: <b>${wins}W</b> · <b>${losses}L</b>`] : []),
  ].join('\n');
}

/** Shown instead of the card while its owner has fields to fix. */
export function hiddenCardText(user) {
  return `🗿 <b>EDVILLE MOGGMETER</b>\n\n🚫 <b>${displayName(user)}</b>'s card is being corrected.`;
}

/** The three buttons under a card shared into a chat. */
export function cardKeyboard(userId) {
  return new InlineKeyboard()
    .text('⬆️ Appreciate', `v:${userId}:1`)
    .text('⬇️ Depreciate', `v:${userId}:-1`)
    .text('🙅 Disagree', `d:${userId}`);
}

/** Buttons under your own card in the private chat. */
export function ownCardKeyboard() {
  return new InlineKeyboard()
    .switchInline('📤 Share my card', '')
    .row()
    .switchInline('⚔️ Start a Moggduel', 'duel');
}
