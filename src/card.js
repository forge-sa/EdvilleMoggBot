import { InlineKeyboard } from 'grammy';
import { FIELDS, FIELD_ORDER } from './fields.js';
import { durationLabel, todayIso } from './dates.js';
import { bar, edvillianity, tier } from './score.js';

export const HTML = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };

export function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function displayName(user) {
  return escape(user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Anonymous Edvillian');
}

const corrected = (user, field) => (user[`${field}_locked`] ? ' 👥' : '');

function line(user, field, extra = '') {
  const def = FIELDS[field];
  return `${def.emoji} ${def.label}: <b>${def.format(user[field])}</b>${extra}${corrected(user, field)}`;
}

export function cardText(user, rep) {
  const points = edvillianity(user);
  const anyCorrected = FIELD_ORDER.some((f) => user[`${f}_locked`]);
  const username = user.username ? ` @${escape(user.username)}` : '';
  const repLabel = rep > 0 ? `+${rep}` : String(rep);

  return [
    '🗿 <b>EDVILLE MOGGMETER</b>',
    '',
    `👤 <b>${displayName(user)}</b>${username}${corrected(user, 'name')}`,
    line(user, 'grade'),
    line(user, 'gpa'),
    line(user, 'since', ` (${durationLabel(user.since, todayIso())})`),
    '',
    `⚡ Edvillianity: <b>${points}</b> / 1000`,
    `<code>${bar(points)}</code>`,
    `🏷 <i>${tier(points)}</i>`,
    '',
    `⬆️ Rep: <b>${repLabel}</b>`,
    ...(anyCorrected ? ['', '<i>👥 corrected by the Edville community</i>'] : []),
  ].join('\n');
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
  return new InlineKeyboard().switchInline('📤 Share my card', '').row().text('✏️ Edit my info', 'edit');
}
