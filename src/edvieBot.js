import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Composer, GrammyError, InlineKeyboard, InputFile } from 'grammy';
import { config, isDev } from './config.js';
import * as db from './db.js';
import { HTML, displayName, escape } from './card.js';
import {
  RARITIES,
  STATS,
  battleLog,
  completeStats,
  creatorRank,
  creatorTitle,
  describe,
  parseCost,
  parseName,
  parseStat,
  priceRange,
  simulateBattle,
  statQuestion,
  statsLine,
} from './edvie.js';
import { normalizeSprite, renderCard } from './edvieImage.js';

// Everything about Edvies in Telegram: making one, the developers' review,
// the shop and collection in the private chat, and battles in any chat.
// Developers (config.devIds) are the admins.

export const edvies = new Composer();
const pm = edvies.chatType('private');

const CAPTION = { parse_mode: 'HTML' };
const spritePath = (id) => join(config.spriteDir, `${id}.png`);
const draftPath = (userId) => join(config.spriteDir, `draft-${userId}.png`);

/** "Elon Musk (III)": the creator's name with their creator rank, if any. */
function creatorName(edvie) {
  const user = db.getUser(edvie.creator_id);
  if (!user) return 'someone';
  const rank = creatorRank(db.approvedCount(user.user_id));
  return rank ? `${displayName(user)} (${rank})` : displayName(user);
}

const ignoreNotModified = (err) => {
  if (!(err instanceof GrammyError && err.description.includes('message is not modified'))) throw err;
};

// ---------------------------------------------------------------------------
// Hub, shop and collection (private chat)

export async function showHub(ctx) {
  const keyboard = new InlineKeyboard()
    .text('🎴 My collection', 'gal:c:0')
    .text('🛒 Shop', 'gal:s:0')
    .row()
    .text('🎨 Create an Edvie', 'mk');
  if (config.webappUrl) keyboard.row().webApp('📱 Open the Edvies app', config.webappUrl);

  await ctx.reply(
    [
      '🐉 <b>EDVIES</b>',
      '',
      `🪙 Coins: <b>${db.coins(ctx.from.id)}</b>`,
      `🎴 Collection: <b>${db.ownedEdvies(ctx.from.id).length}</b>`,
      '',
      `Win Moggduels (+${config.coinsPerWin.moggduel} 🪙) and Edvie battles (+${config.coinsPerWin.edvieBattle} 🪙) to earn coins.`,
      `Type <code>@${ctx.me.username}</code> in any chat to show off an Edvie or send it into battle.`,
    ].join('\n'),
    { ...HTML, reply_markup: keyboard },
  );
}

/** kind: 's' (shop) or 'c' (collection). Returns null when there's nothing to show. */
function galleryView(kind, userId, index) {
  const items = kind === 's' ? db.releasedEdvies() : db.ownedEdvies(userId);
  if (!items.length) return null;
  const i = ((index % items.length) + items.length) % items.length;
  const edvie = items[i];
  const header =
    kind === 's'
      ? `🛒 <b>EDVIE SHOP</b>\n🪙 You have <b>${db.coins(userId)}</b>`
      : `🎴 <b>YOUR COLLECTION</b>`;
  const caption = [header, '', describe(edvie, creatorName(edvie)), ...(kind === 's' ? [`💰 <b>${edvie.cost} 🪙</b>`] : [])];

  const keyboard = new InlineKeyboard();
  if (items.length > 1) {
    keyboard.text('◀️', `gal:${kind}:${i - 1}`).text(`${i + 1} / ${items.length}`, 'noop').text('▶️', `gal:${kind}:${i + 1}`).row();
  }
  if (kind === 's') {
    if (db.ownsEdvie(userId, edvie.id)) keyboard.text('✅ In your collection', 'noop');
    else keyboard.text(`🪙 Buy for ${edvie.cost}`, `buy:${edvie.id}:${i}`);
    keyboard.row().text('🎴 My collection', 'gal:c:0');
  } else {
    keyboard.switchInline('📤 Send to a chat', edvie.name).row().text('🛒 Shop', 'gal:s:0');
  }
  return { fileId: edvie.card_file_id, caption: caption.join('\n'), keyboard };
}

export async function sendGallery(ctx, kind, index = 0) {
  const view = galleryView(kind, ctx.from.id, index);
  if (!view) {
    return kind === 's'
      ? ctx.reply('🛒 The shop is empty for now. Be the first to make an Edvie: /newedvie')
      : ctx.reply("🎴 You don't have any Edvies yet.", {
          reply_markup: new InlineKeyboard().text('🛒 Shop', 'gal:s:0'),
        });
  }
  await ctx.replyWithPhoto(view.fileId, { ...CAPTION, caption: view.caption, reply_markup: view.keyboard });
}

/** Flips the gallery message in place, or sends a new one under a text message. */
async function showGalleryPage(ctx, kind, index) {
  const view = galleryView(kind, ctx.from.id, index);
  if (!view || !ctx.callbackQuery.message?.photo) return sendGallery(ctx, kind, index);
  await ctx
    .editMessageMedia(
      { type: 'photo', media: view.fileId, caption: view.caption, ...CAPTION },
      { reply_markup: view.keyboard },
    )
    .catch(ignoreNotModified);
}

pm.command('edvies', showHub);
pm.command('shop', (ctx) => sendGallery(ctx, 's'));
pm.command('collection', (ctx) => sendGallery(ctx, 'c'));

edvies.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());

pm.callbackQuery(/^gal:([sc]):(-?\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  await showGalleryPage(ctx, ctx.match[1], Number(ctx.match[2]));
});

pm.callbackQuery(/^buy:(\d+):(\d+)$/, async (ctx) => {
  const edvie = db.getEdvie(Number(ctx.match[1]));
  const result = db.buyEdvie(ctx.from.id, edvie?.id ?? 0);
  if (result.error === 'coins') {
    return ctx.answerCallbackQuery({
      text: `Not enough coins: ${edvie.name} costs ${edvie.cost} 🪙, you have ${db.coins(ctx.from.id)}. Win Moggduels and Edvie battles to earn more.`,
      show_alert: true,
    });
  }
  if (result.error) return ctx.answerCallbackQuery({ text: result.error === 'owned' ? 'You already have it.' : 'Not available.' });
  await ctx.answerCallbackQuery({ text: `🎉 ${edvie.name} is yours!` });
  await showGalleryPage(ctx, 's', Number(ctx.match[2]));
});

// ---------------------------------------------------------------------------
// Making an Edvie: rarity → name → cost → sprite → specs → preview → review.
// Session: { flow: 'edvie', step, draft: { rarity, name, cost, stats }, statIndex }

const rarityKeyboard = (prefix) => {
  const keyboard = new InlineKeyboard();
  RARITIES.forEach((r, i) => keyboard.text(`${r.emoji} ${r.label} · ${priceRange(i)}`, `${prefix}:${i}`).row());
  return keyboard;
};

export async function startCreate(ctx) {
  const pending = db.pendingCount(ctx.from.id);
  if (pending >= config.maxPendingEdvies) {
    return ctx.reply(`⏳ You already have ${pending} Edvies waiting for review. Wait until they're reviewed.`);
  }
  db.setSession(ctx.from.id, { flow: 'edvie', step: 'rarity', draft: { stats: {} } });
  await ctx.reply(
    [
      '🎨 <b>NEW EDVIE</b>',
      '',
      "Make your own Edvie. Once it's approved it goes into the shop for everyone, and you get one for free.",
      '',
      '💎 How <b>rare</b> is it? Rarer Edvies cost more.',
    ].join('\n'),
    { ...HTML, reply_markup: rarityKeyboard('er') },
  );
}

async function askStep(ctx, session) {
  const { draft } = session;
  switch (session.step) {
    case 'name':
      return ctx.reply(
        '✏️ What is its <b>name</b>?\n2–20 Latin letters or digits, spaces and hyphens allowed, e.g. <code>Moggzilla</code>.',
        HTML,
      );
    case 'cost':
      return ctx.reply(
        `💰 How much should it <b>cost</b>? ${RARITIES[draft.rarity].label} Edvies cost ${priceRange(draft.rarity)}.`,
        HTML,
      );
    case 'sprite':
      return ctx.reply(
        [
          '🖼 Send its <b>sprite</b>: a picture of your Edvie.',
          'Tip: a PNG with a transparent background, sent as a file (📎 → File), looks best on the card.',
        ].join('\n'),
        HTML,
      );
    case 'stats':
      return ctx.reply(`📊 <b>Specs</b>\n${statQuestion(draft.stats, session.statIndex)}`, HTML);
    case 'confirm': {
      const card = await renderCard(draft, await readFile(draftPath(ctx.from.id)));
      return ctx.replyWithPhoto(new InputFile(card, 'edvie.jpg'), {
        ...CAPTION,
        caption: ['👀 <b>PREVIEW</b>', '', describe(draft), `💰 ${draft.cost} 🪙`, '', 'Send it for review?'].join('\n'),
        reply_markup: new InlineKeyboard()
          .text('✅ Send for review', 'mk:send')
          .row()
          .text('🔁 Start over', 'mk')
          .text('❌ Cancel', 'mk:cancel'),
      });
    }
  }
}

pm.command('newedvie', startCreate);
pm.callbackQuery('mk', async (ctx) => {
  await ctx.answerCallbackQuery();
  await startCreate(ctx);
});

pm.callbackQuery(/^er:(\d)$/, async (ctx) => {
  const session = db.getSession(ctx.from.id);
  await ctx.answerCallbackQuery();
  if (session?.flow !== 'edvie' || session.step !== 'rarity' || !RARITIES[ctx.match[1]]) return;
  session.draft.rarity = Number(ctx.match[1]);
  session.step = 'name';
  db.setSession(ctx.from.id, session);
  await askStep(ctx, session);
});

pm.callbackQuery('mk:cancel', async (ctx) => {
  await ctx.answerCallbackQuery();
  db.clearSession(ctx.from.id);
  await ctx.editMessageReplyMarkup().catch(() => {});
  await ctx.reply('Cancelled.');
});

pm.callbackQuery('mk:send', async (ctx) => {
  const session = db.getSession(ctx.from.id);
  if (session?.flow !== 'edvie' || session.step !== 'confirm') {
    return ctx.answerCallbackQuery({ text: 'This preview is outdated.' });
  }
  const { draft } = session;
  if (db.edvieNameTaken(draft.name)) {
    return ctx.answerCallbackQuery({ text: 'Someone took that name meanwhile. Start over with another one.', show_alert: true });
  }
  if (db.pendingCount(ctx.from.id) >= config.maxPendingEdvies) {
    return ctx.answerCallbackQuery({ text: 'You have too many Edvies waiting for review.', show_alert: true });
  }

  const id = db.createEdvie({ ...draft, creatorId: ctx.from.id });
  await rename(draftPath(ctx.from.id), spritePath(id));
  db.clearSession(ctx.from.id);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => {});
  await ctx.reply("📨 Sent for review! I'll message you once a developer has looked at it.");
  await sendReview(ctx.api, db.getEdvie(id), config.devIds);
});

// Typed answers in the making flow, and the developers' edits and reasons.
pm.on('message:text', async (ctx, next) => {
  const session = db.getSession(ctx.from.id);
  if (!session?.flow?.startsWith('edvie') || ctx.message.text.startsWith('/')) return next();
  const text = ctx.message.text;
  if (session.flow === 'edvie-admin') return adminEdit(ctx, session, text);
  if (session.flow === 'edvie-reason') return sendReason(ctx, session, text);

  const { draft } = session;
  let parsed;
  switch (session.step) {
    case 'name':
      parsed = parseName(text);
      if (!parsed.error && db.edvieNameTaken(parsed.value)) parsed = { error: 'An Edvie with that name already exists.' };
      if (!parsed.error) [draft.name, session.step] = [parsed.value, 'cost'];
      break;
    case 'cost':
      parsed = parseCost(text, draft.rarity);
      if (!parsed.error) [draft.cost, session.step] = [parsed.value, 'sprite'];
      break;
    case 'stats':
      parsed = parseStat(text, draft.stats, session.statIndex);
      if (!parsed.error) {
        draft.stats[STATS[session.statIndex].key] = parsed.value;
        if (session.statIndex < STATS.length - 2) session.statIndex += 1;
        else [draft.stats, session.step] = [completeStats(draft.stats), 'confirm'];
      }
      break;
    case 'sprite':
      return ctx.reply('🖼 I need a picture here, not text.');
    default:
      return ctx.reply('Use the buttons above, or /cancel.');
  }
  if (parsed.error) return ctx.reply(`❌ ${parsed.error}`, HTML);
  db.setSession(ctx.from.id, session);
  await askStep(ctx, session);
});

pm.on(['message:photo', 'message:document'], async (ctx, next) => {
  const session = db.getSession(ctx.from.id);
  if (session?.flow !== 'edvie' || session.step !== 'sprite') return next();

  const doc = ctx.message.document;
  if (doc && !['image/png', 'image/jpeg'].includes(doc.mime_type)) return ctx.reply('❌ Send a PNG or JPEG picture.');
  if ((doc?.file_size ?? 0) > 10 * 1024 * 1024) return ctx.reply('❌ That file is too big, keep it under 10 MB.');

  const file = await ctx.getFile();
  const response = await fetch(`https://api.telegram.org/file/bot${config.token}/${file.file_path}`);
  if (!response.ok) throw new Error(`Downloading a sprite failed: HTTP ${response.status}`);
  let png;
  try {
    png = await normalizeSprite(Buffer.from(await response.arrayBuffer()));
  } catch {
    return ctx.reply("❌ I couldn't read that picture. Try a PNG or JPEG.");
  }
  await mkdir(config.spriteDir, { recursive: true });
  await writeFile(draftPath(ctx.from.id), png);

  Object.assign(session, { step: 'stats', statIndex: 0 });
  session.draft.stats = {};
  db.setSession(ctx.from.id, session);
  await askStep(ctx, session);
});

// ---------------------------------------------------------------------------
// Review by the developers

function reviewKeyboard(id) {
  return new InlineKeyboard()
    .text('✅ Approve', `ea:ok:${id}`)
    .text('❌ Reject', `ea:no:${id}`)
    .row()
    .text('✏️ Name', `ea:name:${id}`)
    .text('✏️ Rarity', `ea:rarity:${id}`)
    .row()
    .text('✏️ Cost', `ea:cost:${id}`)
    .text('✏️ Specs', `ea:stats:${id}`);
}

/** Sends the current state of a pending Edvie, rendered, to each of chatIds. */
async function sendReview(api, edvie, chatIds) {
  const creator = db.getUser(edvie.creator_id);
  const card = await renderCard(edvie, await readFile(spritePath(edvie.id)));
  const caption = [
    `🆕 <b>EDVIE FOR REVIEW</b> #${edvie.id}`,
    '',
    describe(edvie),
    `💰 ${edvie.cost} 🪙`,
    `🎨 by ${creatorName(edvie)}${creator?.username ? ` @${escape(creator.username)}` : ''}`,
  ].join('\n');
  for (const chatId of chatIds) {
    await api
      .sendPhoto(chatId, new InputFile(card, 'edvie.jpg'), { ...CAPTION, caption, reply_markup: reviewKeyboard(edvie.id) })
      .catch((err) => console.warn(`Could not send review #${edvie.id} to ${chatId}:`, err.message));
  }
}

const admins = edvies.filter((ctx) => isDev(ctx.from?.id));

admins.chatType('private').command('review', async (ctx) => {
  const pending = db.pendingEdvies();
  if (!pending.length) return ctx.reply('Nothing to review 🎉');
  await ctx.reply(`${pending.length} Edvie(s) waiting.${pending.length > 10 ? ' Here are the first 10.' : ''}`);
  for (const edvie of pending.slice(0, 10)) await sendReview(ctx.api, edvie, [ctx.from.id]);
});

edvies.callbackQuery(/^ea:(ok|no|name|rarity|cost|stats):(\d+)$/, async (ctx) => {
  if (!isDev(ctx.from.id)) return ctx.answerCallbackQuery({ text: 'Only developers can review Edvies.' });
  const [action, id] = [ctx.match[1], Number(ctx.match[2])];
  const edvie = db.getEdvie(id);
  if (edvie?.status !== 'pending') {
    await ctx.editMessageReplyMarkup().catch(() => {});
    return ctx.answerCallbackQuery({ text: 'Already reviewed.' });
  }
  await ctx.answerCallbackQuery();
  const closeReview = (verdict) =>
    ctx.editMessageCaption({ caption: `${ctx.callbackQuery.message.caption}\n\n${verdict}` }).catch(() => {});

  if (action === 'ok') {
    // The released card's file id is what inline mode and the shop show.
    const card = await renderCard(edvie, await readFile(spritePath(id)));
    const released = await ctx.replyWithPhoto(new InputFile(card, 'edvie.jpg'), {
      ...CAPTION,
      caption: `✅ <b>Released:</b> ${escape(edvie.name)}`,
    });
    const rankBefore = creatorRank(db.approvedCount(edvie.creator_id));
    if (!db.reviewEdvie(id, 'approved', released.photo.at(-1).file_id)) return;
    db.grantEdvie(edvie.creator_id, id);
    const rankAfter = creatorRank(db.approvedCount(edvie.creator_id));
    await closeReview('✅ Approved');
    await ctx.api
      .sendPhoto(edvie.creator_id, released.photo.at(-1).file_id, {
        ...CAPTION,
        caption: [
          `🎉 Your Edvie <b>${escape(edvie.name)}</b> was approved and is in the shop now!`,
          'You got one for free: /collection',
          ...(rankAfter !== rankBefore ? ['', `🎨 You're now <b>${creatorTitle(rankAfter)}</b>!`] : []),
        ].join('\n'),
      })
      .catch(() => {});
    return;
  }

  if (action === 'no') {
    if (!db.reviewEdvie(id, 'rejected')) return;
    await closeReview('❌ Rejected');
    await ctx.api
      .sendMessage(edvie.creator_id, `😔 Your Edvie <b>${escape(edvie.name)}</b> wasn't approved.`, HTML)
      .catch(() => {});
    db.setSession(ctx.from.id, { flow: 'edvie-reason', id });
    return ctx.reply('Want to tell them why? Send the reason, or skip.', {
      reply_markup: new InlineKeyboard().text('Skip', 'ea:skip'),
    });
  }

  if (action === 'rarity') {
    return ctx.reply(`💎 New rarity for <b>${escape(edvie.name)}</b>?`, {
      ...HTML,
      reply_markup: rarityKeyboard(`ear:${id}`),
    });
  }

  db.setSession(ctx.from.id, { flow: 'edvie-admin', id, field: action, statIndex: 0, stats: {} });
  const prompts = {
    name: `✏️ New name for <b>${escape(edvie.name)}</b>?`,
    cost: `💰 New cost? ${RARITIES[edvie.rarity].label} Edvies cost ${priceRange(edvie.rarity)}.`,
    stats: `📊 New specs for <b>${escape(edvie.name)}</b>.\n${statQuestion({}, 0)}`,
  };
  await ctx.reply(prompts[action], HTML);
});

edvies.callbackQuery(/^ear:(\d+):(\d)$/, async (ctx) => {
  const edvie = db.getEdvie(Number(ctx.match[1]));
  const rarity = Number(ctx.match[2]);
  if (!isDev(ctx.from.id) || edvie?.status !== 'pending' || !RARITIES[rarity]) return ctx.answerCallbackQuery();
  // Keep the cost inside the new rarity's range.
  const [min, max] = RARITIES[rarity].price;
  db.updateEdvie(edvie.id, { rarity, cost: Math.min(max, Math.max(min, edvie.cost)) });
  await ctx.answerCallbackQuery({ text: 'Updated' });
  await sendReview(ctx.api, db.getEdvie(edvie.id), [ctx.from.id]);
});

edvies.callbackQuery('ea:skip', async (ctx) => {
  db.clearSession(ctx.from.id);
  await ctx.answerCallbackQuery({ text: 'OK' });
  await ctx.editMessageReplyMarkup().catch(() => {});
});

async function adminEdit(ctx, session, text) {
  const edvie = db.getEdvie(session.id);
  if (!isDev(ctx.from.id) || edvie?.status !== 'pending') {
    db.clearSession(ctx.from.id);
    return ctx.reply('That Edvie was already reviewed.');
  }

  let parsed;
  if (session.field === 'name') {
    parsed = parseName(text);
    if (!parsed.error && db.edvieNameTaken(parsed.value, edvie.id)) parsed = { error: 'That name is taken.' };
    if (!parsed.error) db.updateEdvie(edvie.id, { name: parsed.value });
  } else if (session.field === 'cost') {
    parsed = parseCost(text, edvie.rarity);
    if (!parsed.error) db.updateEdvie(edvie.id, { cost: parsed.value });
  } else {
    parsed = parseStat(text, session.stats, session.statIndex);
    if (!parsed.error) {
      session.stats[STATS[session.statIndex].key] = parsed.value;
      if (session.statIndex < STATS.length - 2) {
        session.statIndex += 1;
        db.setSession(ctx.from.id, session);
        return ctx.reply(statQuestion(session.stats, session.statIndex), HTML);
      }
      db.updateEdvie(edvie.id, { stats: completeStats(session.stats) });
    }
  }
  if (parsed.error) return ctx.reply(`❌ ${parsed.error}`, HTML);

  db.clearSession(ctx.from.id);
  await sendReview(ctx.api, db.getEdvie(edvie.id), [ctx.from.id]);
}

async function sendReason(ctx, session, text) {
  db.clearSession(ctx.from.id);
  const edvie = db.getEdvie(session.id);
  await ctx.api
    .sendMessage(edvie.creator_id, `💬 Why <b>${escape(edvie.name)}</b> wasn't approved: ${escape(text)}`, HTML)
    .catch(() => {});
  await ctx.reply('Sent.');
}

// ---------------------------------------------------------------------------
// Inline mode: showing Edvies off and battling them

const INLINE_PAGE = 48;

/**
 * The user's Edvies as photo results, filtered by name. Each one sent into a
 * chat carries a "Battle" button that lets anyone there fight it, as long as
 * it isn't resting.
 */
export function showcaseResults(user, filter, offset) {
  const needle = filter?.toLowerCase();
  const resting = db.restingEdvies(user.user_id);
  const all = db.ownedEdvies(user.user_id).filter((e) => !needle || e.name.toLowerCase().includes(needle));
  const page = all.slice(offset, offset + INLINE_PAGE);
  const results = page.map((edvie) => ({
    type: 'photo',
    id: `e${edvie.id}`,
    photo_file_id: edvie.card_file_id,
    title: `${RARITIES[edvie.rarity].emoji} ${edvie.name}`,
    description: `${statsLine(edvie.stats)} · ${RARITIES[edvie.rarity].label}${resting.has(edvie.id) ? ' · 😴 resting' : ''}`,
    caption: [describe(edvie, creatorName(edvie)), '', `👤 ${displayName(user)}'s Edvie`].join('\n'),
    ...CAPTION,
    reply_markup: new InlineKeyboard().switchInlineCurrent(`⚔️ Battle ${edvie.name}`, `vs ${user.user_id}.${edvie.id}`),
  }));
  const nextOffset = offset + INLINE_PAGE < all.length ? String(offset + INLINE_PAGE) : '';
  return { results, nextOffset };
}

// Older Battle buttons carried a third, random part; it's ignored now.
export const BATTLE_QUERY = /^vs (\d+)\.(\d+)(?:\.[0-9a-f]{8})?$/;

const firstName = (user) => (user.name ?? user.first_name).split(' ')[0];

/** "😴 X is resting…" when the Edvie has to sit out more battles, else null. */
function restingNote(edvie, owner) {
  const left = db.restingEdvies(owner.user_id).get(edvie.id);
  if (!left) return null;
  return `😴 ${edvie.name} is resting after a fight. It can fight again after ${left} more of ${firstName(owner)}'s battles.`;
}

const fighterLine = (edvie, owner) =>
  `${RARITIES[edvie.rarity].emoji} <b>${escape(edvie.name)}</b> · ${displayName(owner)}\n${statsLine(edvie.stats)}`;

/**
 * "@bot vs <owner>.<edvie>": the user picks which of their Edvies fights.
 * Resting ones aren't offered. The "Random fighter" article on top also keeps
 * Telegram from showing the Edvies as a bare picture grid: a list with at
 * least one text result shows every picture's title and specs next to it.
 */
export function battlePickResults(user, match) {
  const [ownerId, edvieId] = [Number(match[1]), Number(match[2])];
  const unavailable = (text) => ({ results: [], button: { text, start_parameter: 'edvies' } });
  if (ownerId === user.user_id) return unavailable("⚔️ You can't battle your own Edvie");

  const theirs = db.getEdvie(edvieId);
  const owner = db.getUser(ownerId);
  if (!theirs || !owner || !db.ownsEdvie(ownerId, edvieId)) return unavailable('⚔️ This Edvie is no longer available');
  if (db.restingEdvies(ownerId).has(edvieId)) return unavailable(`😴 ${theirs.name} is resting, try again later`);

  const owned = db.ownedEdvies(user.user_id);
  if (!owned.length) return { results: [], button: { text: '🐉 Get an Edvie to battle with', start_parameter: 'shop' } };
  const resting = db.restingEdvies(user.user_id);
  const mine = owned.filter((edvie) => !resting.has(edvie.id));

  const intro = (mineLine) => ['⚔️ <b>EDVIE BATTLE</b>', '', fighterLine(theirs, owner), '🆚', mineLine].join('\n');
  const fightButton = (mineId) => new InlineKeyboard().text('⚔️ Fight!', `eb:${ownerId}:${edvieId}:${user.user_id}:${mineId}`);

  const random = {
    type: 'article',
    id: 'random',
    title: '🎲 Random fighter',
    description: `vs ${theirs.name} (${statsLine(theirs.stats)}). Let fate pick one of your ${mine.length} ready Edvies`,
    input_message_content: { message_text: intro(`🎲 <b>A random fighter</b> · ${displayName(user)}`), ...HTML },
    reply_markup: fightButton(0),
  };
  const picks = mine.slice(0, 49).map((edvie) => ({
    type: 'photo',
    id: `b${edvie.id}`,
    photo_file_id: edvie.card_file_id,
    title: `${RARITIES[edvie.rarity].emoji} ${edvie.name}`,
    description: `${statsLine(edvie.stats)} · ${RARITIES[edvie.rarity].label}`,
    caption: intro(fighterLine(edvie, user)),
    ...CAPTION,
    reply_markup: fightButton(edvie.id),
  }));
  return { results: [random, ...picks] };
}

// Each Fight message is fought once; the Battle button it came from can be used again.
// The challenger's Edvie id is 0 for "Random fighter": it's picked when the fight starts.
edvies.callbackQuery(/^eb:(\d+):(\d+):(\d+):(\d+)$/, async (ctx) => {
  const messageId = ctx.callbackQuery.inline_message_id;
  const [ownerA, edvieA, ownerB, chosenB] = ctx.match.slice(1, 5).map(Number);
  if (![ownerA, ownerB].includes(ctx.from.id)) {
    return ctx.answerCallbackQuery({ text: 'Only the two trainers can start this fight.' });
  }
  if (!messageId || db.isEdvieBattleOver(messageId)) return ctx.answerCallbackQuery({ text: 'This battle is already over.' });

  let edvieB = chosenB;
  if (chosenB === 0) {
    const resting = db.restingEdvies(ownerB);
    const ready = db.ownedEdvies(ownerB).filter((edvie) => !resting.has(edvie.id));
    if (!ready.length) return ctx.answerCallbackQuery({ text: 'No Edvie is ready to fight.', show_alert: true });
    edvieB = ready[Math.floor(Math.random() * ready.length)].id;
  }

  const [a, b] = [db.getEdvie(edvieA), db.getEdvie(edvieB)];
  const [userA, userB] = [db.getUser(ownerA), db.getUser(ownerB)];
  if (!a || !b || !db.ownsEdvie(ownerA, edvieA) || !db.ownsEdvie(ownerB, edvieB)) {
    return ctx.answerCallbackQuery({ text: "One of these Edvies isn't available anymore.", show_alert: true });
  }
  // They may have fought elsewhere since this Fight message was sent.
  const resting = restingNote(a, userA) ?? restingNote(b, userB);
  if (resting) return ctx.answerCallbackQuery({ text: resting, show_alert: true });

  // Two copies of the same Edvie get their trainer's first name to tell them apart.
  const [nameA, nameB] =
    a.name === b.name ? [`${a.name} (${firstName(userA)})`, `${b.name} (${firstName(userB)})`] : [a.name, b.name];

  const result = simulateBattle(a, b);
  const { winner } = result;
  const [winnerId, loserId] = winner === 0 ? [ownerA, ownerB] : [ownerB, ownerA];
  if (!db.recordEdvieBattle(messageId, ownerA, edvieA, ownerB, edvieB, winnerId)) {
    return ctx.answerCallbackQuery({ text: 'This battle is already over.' });
  }
  const paid = db.reward(winnerId, loserId, 'edvieBattle', config.coinsPerWin.edvieBattle);
  await ctx.answerCallbackQuery({ text: ctx.from.id === winnerId ? '🏆 You won!' : '💀 You lost.' });

  const winnerName = displayName(winner === 0 ? userA : userB);
  const caption = [
    '⚔️ <b>EDVIE BATTLE</b>',
    '',
    `${RARITIES[a.rarity].emoji} <b>${escape(nameA)}</b> 🆚 ${RARITIES[b.rarity].emoji} <b>${escape(nameB)}</b>`,
    '',
    ...battleLog({ name: nameA }, { name: nameB }, result),
    '',
    `🏆 ${winnerName}'s <b>${escape(winner === 0 ? a.name : b.name)}</b> wins!${paid ? ` +${paid} 🪙` : ''}`,
  ].join('\n');
  // No reply_markup: the Fight button disappears. A random fight was sent as text, not a photo.
  const edited = chosenB === 0 ? ctx.editMessageText(caption, HTML) : ctx.editMessageCaption({ caption, ...CAPTION });
  await edited.catch(ignoreNotModified);
});
