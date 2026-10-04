import { randomBytes } from 'node:crypto';
import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { config, isDev } from './config.js';
import * as db from './db.js';
import { FIELDS, FIELD_ORDER, consensus } from './fields.js';
import { HTML, cardKeyboard, cardText, displayName, hiddenCardText, ownCardKeyboard } from './card.js';
import { DUEL_DATA, fight, offerKeyboard, offerText, resultText } from './duel.js';
import { edvillianity, tier } from './score.js';

export const bot = new Bot(config.token);

const stats = (userId) => ({ rep: db.rep(userId), ...db.duelRecord(userId) });

// Keep names on cards fresh: every update refreshes the sender's name.
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) db.touchUser(ctx.from);
  await next();
});

// ---------------------------------------------------------------------------
// Groups the bot is a member of: count messages per person (feeds duels), and
// remember which group a duel offer was posted in.

bot.chatType(['group', 'supergroup']).on('message', async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) db.countMessage(ctx.chat.id, ctx.from.id);

  if (ctx.message.via_bot?.id === ctx.me.id) {
    const data = ctx.message.reply_markup?.inline_keyboard
      .flat()
      .find((button) => button.callback_data?.startsWith('du:'))?.callback_data;
    const nonce = data?.match(DUEL_DATA)?.[2];
    if (nonce) db.rememberDuelChat(nonce, ctx.chat.id);
  }
  await next();
});

// ---------------------------------------------------------------------------
// Inline mode: "@bot" in any chat offers the caller's own card and a duel.
// There is no way to pull up somebody else's card.

bot.on('inline_query', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  const opts = { cache_time: 0, is_personal: true };

  if (!db.isComplete(user)) {
    return ctx.answerInlineQuery([], {
      ...opts,
      button: { text: '🗿 Press to create your card', start_parameter: 'setup' },
    });
  }
  if (db.isHidden(user.user_id)) {
    return ctx.answerInlineQuery([], {
      ...opts,
      button: { text: '⚠️ Your card needs fixing. Press here', start_parameter: 'fix' },
    });
  }

  // "@bot @someone" challenges that person only.
  const query = ctx.inlineQuery.query.trim();
  let target = query.match(/@([A-Za-z0-9_]{4,32})/)?.[1] ?? null;
  if (target && target.toLowerCase() === user.username?.toLowerCase()) target = null;
  const nonce = randomBytes(4).toString('hex');
  const points = edvillianity(user);

  const card = {
    type: 'article',
    id: 'card',
    title: '🗿 Press to send your card',
    description: `⚡ ${points}/${config.maxPoints} · ${tier(points)}`,
    input_message_content: { message_text: cardText(user, stats(user.user_id)), ...HTML },
    reply_markup: cardKeyboard(user.user_id),
  };
  const duel = {
    type: 'article',
    id: 'duel',
    title: target ? `⚔️ Press to challenge @${target} to a Moggduel` : '⚔️ Press to start a Moggduel',
    description: target ? 'Only they can accept' : 'Anyone with a card can accept. Type @username to pick someone',
    input_message_content: { message_text: offerText(user, target), ...HTML },
    reply_markup: offerKeyboard(user.user_id, nonce, target),
  };

  return ctx.answerInlineQuery(query ? [duel, card] : [card, duel], opts);
});

// ---------------------------------------------------------------------------
// Buttons under a card. They work in any chat, the bot doesn't need to be a
// member: callbacks from inline messages come straight to the bot.

bot.callbackQuery(/^v:(\d+):(-?1)$/, async (ctx) => {
  const targetId = Number(ctx.match[1]);
  const value = Number(ctx.match[2]);

  if (targetId === ctx.from.id) {
    return ctx.answerCallbackQuery({ text: "You can't vote on your own card 🗿" });
  }
  const target = db.getUser(targetId);
  if (!db.isComplete(target)) {
    return ctx.answerCallbackQuery({ text: 'This card no longer exists.' });
  }
  if (db.isHidden(targetId)) {
    await ctx.answerCallbackQuery({ text: '🚫 This card is being corrected right now.' });
    return refreshCard(ctx, target);
  }

  const result = db.vote(targetId, ctx.from.id, value);
  await ctx.answerCallbackQuery({
    text: result === 0 ? 'Vote removed' : result > 0 ? '⬆️ Appreciated' : '⬇️ Depreciated',
  });
  await refreshCard(ctx, target);
});

// Disagreeing needs typing, which only works in the bot's private chat, so the
// button opens it with the card's owner as the start parameter.
bot.callbackQuery(/^d:(\d+)$/, async (ctx) => {
  const targetId = Number(ctx.match[1]);
  if (targetId === ctx.from.id) {
    return ctx.answerCallbackQuery({ text: "You can't disagree with your own card 🙃" });
  }
  await ctx.answerCallbackQuery({ url: `https://t.me/${ctx.me.username}?start=d_${targetId}` });
});

async function refreshCard(ctx, target) {
  const text = db.isHidden(target.user_id) ? hiddenCardText(target) : cardText(target, stats(target.user_id));
  await editQuietly(ctx, text, { ...HTML, reply_markup: cardKeyboard(target.user_id) });
}

async function editQuietly(ctx, text, options) {
  try {
    await ctx.editMessageText(text, options);
  } catch (err) {
    // Clicking twice fast, or a vote that cancels out, leaves the text unchanged.
    if (!(err instanceof GrammyError && err.description.includes('message is not modified'))) throw err;
  }
}

// ---------------------------------------------------------------------------
// Moggduels

bot.callbackQuery(DUEL_DATA, async (ctx) => {
  const challengerId = Number(ctx.match[1]);
  const nonce = ctx.match[2];
  const target = ctx.match[3];
  const inlineId = ctx.callbackQuery.inline_message_id;
  const alert = (text) => ctx.answerCallbackQuery({ text, show_alert: true });

  if (!inlineId || db.isDuelOver(inlineId)) return ctx.answerCallbackQuery({ text: 'This duel is already over.' });
  if (ctx.from.id === challengerId) return ctx.answerCallbackQuery({ text: "You can't duel yourself 🗿" });
  if (target && ctx.from.username?.toLowerCase() !== target) return alert(`This duel is for @${target} only.`);

  const opponent = db.getUser(ctx.from.id);
  if (!db.isComplete(opponent)) {
    return ctx.answerCallbackQuery({ url: `https://t.me/${ctx.me.username}?start=setup` });
  }
  if (db.isHidden(opponent.user_id)) return alert('Your card is being corrected. Fix it in the bot first.');

  const challenger = db.getUser(challengerId);
  if (!db.isComplete(challenger) || db.isHidden(challengerId)) {
    return alert("The challenger's card isn't available right now.");
  }

  const chatId = db.duelChat(nonce);
  const fighter = (user) => ({
    user,
    rep: db.rep(user.user_id),
    share: chatId == null ? null : db.messageShare(chatId, user.user_id),
  });
  const result = fight(fighter(challenger), fighter(opponent));

  if (!db.recordDuel(inlineId, challengerId, opponent.user_id, result.winner.user_id)) {
    return ctx.answerCallbackQuery({ text: 'This duel is already over.' });
  }
  await ctx.answerCallbackQuery({
    text: result.winner.user_id === opponent.user_id ? '🏆 You won!' : '💀 You got mogged.',
  });
  // No reply_markup: the accept button disappears.
  await editQuietly(ctx, resultText(result), HTML);
});

// ---------------------------------------------------------------------------
// Private chat: setup, fixing, disagreeing.

const pm = bot.chatType('private');

pm.command('start', async (ctx) => {
  const dispute = ctx.match.match(/^d_(\d+)$/);
  if (dispute) return startDispute(ctx, Number(dispute[1]));
  return showOwnCard(ctx, '👋 Welcome back. Here is your card:');
});

pm.command('me', (ctx) => showOwnCard(ctx));

pm.command('fix', async (ctx) => {
  if (!db.isHidden(ctx.from.id)) return ctx.reply('Nothing to fix, your card is fine 🗿');
  return startFix(ctx);
});

pm.command('edit', (ctx) =>
  ctx.reply(
    "Your info can't be changed by hand. If other Edvillians disagree with something on your card, I'll ask you to fix it.",
  ),
);

pm.command('cancel', async (ctx) => {
  db.clearSession(ctx.from.id);
  await ctx.reply('Cancelled.');
});

pm.command('help', (ctx) =>
  ctx.reply(
    [
      `🗿 <b>Edville Moggmeter</b> measures your Edvillianity out of ${config.maxPoints}.`,
      '',
      `Type <code>@${ctx.me.username}</code> in <b>any</b> chat and press:`,
      '🗿 <b>Send your card</b>, to show it off',
      '⚔️ <b>Start a Moggduel</b>, anyone with a card can accept. Add <code>@username</code> to challenge someone specific.',
      '',
      'Under every card:',
      '⬆️ Appreciate / ⬇️ Depreciate: rate the student (press again to take it back)',
      '🙅 Disagree: think something on the card is wrong? Claim the real value.',
      '',
      "You can't change your own info. If others disagree with your card, it gets hidden until you fix it.",
      '',
      '/me: your card',
      '/fix: fix your card when asked to',
      '/cancel: stop what you were doing',
    ].join('\n'),
    HTML,
  ),
);

pm.callbackQuery('fix', async (ctx) => {
  await ctx.answerCallbackQuery();
  if (db.isHidden(ctx.from.id)) await startFix(ctx);
});

// "Didn't take it" under an exam question.
pm.callbackQuery('none', async (ctx) => {
  await ctx.answerCallbackQuery();
  await answer(ctx, null);
});

pm.callbackQuery(/^dp:(\d+):(\w+)$/, async (ctx) => {
  const targetId = Number(ctx.match[1]);
  const choice = ctx.match[2];
  const target = db.getUser(targetId);
  await ctx.answerCallbackQuery();

  if (targetId === ctx.from.id || !db.isComplete(target)) return;
  const fields = choice === 'all' ? FIELD_ORDER : FIELDS[choice] ? [choice] : null;
  if (!fields) return;

  await ask(ctx, { flow: 'dispute', target: targetId, fields, i: 0, values: {} });
});

pm.on('message:text', (ctx) => answer(ctx, ctx.message.text));

// ---------------------------------------------------------------------------
// Flows. A session is { flow: 'setup' | 'fix' | 'dispute', fields, i, values,
// target?, then? } and walks through `fields` one question at a time.

/** text is null when the "didn't take it" button was pressed. */
async function answer(ctx, text) {
  const session = db.getSession(ctx.from.id);
  if (!session) {
    if (text === null) return;
    return ctx.reply(
      `Type <code>@${ctx.me.username}</code> in any chat to show your card or start a Moggduel, or /me to see your card here.`,
      HTML,
    );
  }

  const field = session.fields[session.i];
  const def = FIELDS[field];
  const target = session.flow === 'dispute' ? db.getUser(session.target) : null;
  if (session.flow === 'dispute' && !db.isComplete(target)) {
    db.clearSession(ctx.from.id);
    return ctx.reply('This card no longer exists.');
  }

  if (text === null && !def.optional) return; // stale button from an earlier question
  const parsed = text === null ? { value: 0 } : def.parse(text);
  if (parsed.error) return ctx.reply(`❌ ${parsed.error}\n\n${def.hint()}`, HTML);

  const key = def.toKey(parsed.value);
  if (target && key === def.toKey(target[field])) {
    return ctx.reply("That's exactly what the card already says. Send the value you think is right, or /cancel.");
  }
  if (session.flow === 'fix' && key === def.toKey(db.getUser(ctx.from.id)[field])) {
    return ctx.reply("That's the value people disagree with. Send the correct one.");
  }

  session.values[field] = parsed.value;
  session.i += 1;
  if (session.i < session.fields.length) return ask(ctx, session);

  db.clearSession(ctx.from.id);
  return finish(ctx, session);
}

/** Asks for whatever the user's card is still missing (everything, for newcomers). */
async function startSetup(ctx, then = null) {
  const me = db.getUser(ctx.from.id);
  const missing = FIELD_ORDER.filter((f) => me?.[f] == null);
  const intro =
    missing.length === FIELD_ORDER.length
      ? [
          '🗿 <b>Edville Moggmeter</b>',
          '',
          "Let's make your card: your real name, class, GPA, IELTS, SAT, and when you joined Edville.",
          `Your Edvillianity is calculated from them, out of ${config.maxPoints}.`,
          '',
          '⚠️ Be honest: once your card is made, you can only change it if other Edvillians disagree with it.',
        ]
      : ['🗿 Your card is missing something. Fill it in and it can be shown again.'];
  await ctx.reply(intro.join('\n'), HTML);
  await ask(ctx, { flow: 'setup', fields: missing, i: 0, values: {}, then });
}

async function startFix(ctx) {
  await ctx.reply('⚠️ Other Edvillians disagree with your card. It stays hidden until you fix it.');
  await ask(ctx, { flow: 'fix', fields: db.flags(ctx.from.id).map((f) => f.field), i: 0, values: {} });
}

/** Saves the dialog state and asks the question for the current field. */
async function ask(ctx, session) {
  db.setSession(ctx.from.id, session);
  const field = session.fields[session.i];
  const def = FIELDS[field];
  const step = session.fields.length > 1 ? `<i>${session.i + 1}/${session.fields.length}</i> ` : '';

  let question;
  if (session.flow === 'dispute') {
    const name = displayName(db.getUser(session.target));
    question = `${def.emoji} ${def.disputeQuestion?.(name) ?? `What is ${name}'s real <b>${def.label}</b>?`}`;
  } else {
    question = `${def.emoji} ${def.ownQuestion ?? `Your <b>${def.label}</b>?`}`;
  }
  if (session.flow === 'fix') {
    const me = db.getUser(ctx.from.id);
    const suggestion = db.flags(ctx.from.id).find((f) => f.field === field)?.suggestion;
    question += `\nPeople disagree with <b>${def.format(me[field])}</b>`;
    if (suggestion != null) question += ` and think it's <b>${def.format(def.fromKey(suggestion))}</b>`;
    question += '.';
  }

  const keyboard = def.optional
    ? new InlineKeyboard().text(session.flow === 'dispute' ? "❌ They didn't take it" : "❌ Didn't take it", 'none')
    : undefined;
  await ctx.reply(`${step}${question}\n${def.hint()}`, { ...HTML, reply_markup: keyboard });
}

async function finish(ctx, session) {
  if (session.flow === 'dispute') {
    for (const field of session.fields) {
      db.putDispute(session.target, field, ctx.from.id, FIELDS[field].toKey(session.values[field]));
    }
    await resolveDisputes(session.target, session.fields);
    // Purposely vague: how many disagreements it takes stays a secret.
    return ctx.reply('🙅 Your claim is recorded. The Edville community will decide.');
  }

  for (const field of session.fields) db.setField(ctx.from.id, field, session.values[field]);

  if (session.flow === 'fix') {
    // Claims were about the old values; they've done their job.
    for (const field of session.fields) {
      db.unflag(ctx.from.id, field);
      db.clearDisputes(ctx.from.id, field);
    }
    if (db.isHidden(ctx.from.id)) return startFix(ctx); // flagged again meanwhile
    return showOwnCard(ctx, '✅ Fixed. Your card is visible again:');
  }

  await showOwnCard(ctx, '✅ Your card is ready:');
  if (session.then) await startDispute(ctx, session.then);
}

async function startDispute(ctx, targetId) {
  if (targetId === ctx.from.id) {
    return ctx.reply("You can't disagree with your own card 🙃");
  }
  const target = db.getUser(targetId);
  if (!db.isComplete(target)) return ctx.reply('This card no longer exists.');

  // Only Edvillians with a card of their own get a say about others.
  if (!isDev(ctx.from.id) && !db.isComplete(db.getUser(ctx.from.id))) {
    await ctx.reply(`Before you can disagree with ${displayName(target)}, make your own card.`, HTML);
    return startSetup(ctx, targetId);
  }

  const keyboard = new InlineKeyboard();
  for (const field of FIELD_ORDER) {
    const def = FIELDS[field];
    keyboard.text(`${def.emoji} ${def.label}: ${def.format(target[field])}`, `dp:${targetId}:${field}`).row();
  }
  keyboard.text('🙅 Everything', `dp:${targetId}:all`);

  await ctx.reply(`What's wrong on <b>${displayName(target)}</b>'s card?`, { ...HTML, reply_markup: keyboard });
}

/** The card, or whatever stands between the user and having one. */
async function showOwnCard(ctx, intro) {
  const me = db.getUser(ctx.from.id);
  if (!db.isComplete(me)) return startSetup(ctx);
  if (db.isHidden(me.user_id)) return startFix(ctx);
  if (intro) await ctx.reply(intro);
  await ctx.reply(cardText(me, stats(me.user_id)), { ...HTML, reply_markup: ownCardKeyboard() });
}

const disputeWeight = (userId) => (isDev(userId) ? config.devDisputeWeight : 1);

/**
 * Once the weighted disagreements on a field reach the threshold, the field
 * gets flagged: the owner's card is hidden until they enter a new value. The
 * community's suggestion (see consensus() in fields.js) is shown to them.
 */
async function resolveDisputes(targetId, fields) {
  const alreadyFlagged = new Set(db.flags(targetId).map((f) => f.field));
  const target = db.getUser(targetId);
  const flagged = [];

  for (const field of fields) {
    if (alreadyFlagged.has(field)) continue;
    const def = FIELDS[field];
    const current = def.toKey(target[field]);
    const weighted = db
      .disputeClaims(targetId, field)
      .filter((claim) => claim.value !== current)
      .flatMap((claim) => Array(disputeWeight(claim.disputer_id)).fill(claim.value));
    if (weighted.length < config.disputeThreshold) continue;

    const suggestion = consensus(field, weighted);
    db.flag(targetId, field, def.toKey(suggestion));
    flagged.push(
      `${def.emoji} ${def.label}: <b>${def.format(target[field])}</b>, they think it's <b>${def.format(suggestion)}</b>`,
    );
  }

  if (flagged.length) {
    await bot.api
      .sendMessage(
        targetId,
        [
          '⚠️ Other Edvillians disagree with your Moggmeter card:',
          '',
          ...flagged,
          '',
          'Your card is hidden until you fix it.',
        ].join('\n'),
        { ...HTML, reply_markup: new InlineKeyboard().text('🛠 Fix my card', 'fix') },
      )
      .catch(() => {}); // they may have blocked the bot
  }
}

// ---------------------------------------------------------------------------

bot.catch(({ error, ctx }) => {
  console.error(`Error while handling update ${ctx.update.update_id}:`, error);
});

export async function setupProfile() {
  await bot.api.setMyCommands(
    [
      { command: 'me', description: 'Your Moggmeter card' },
      { command: 'fix', description: 'Fix your card when asked to' },
      { command: 'help', description: 'How it works' },
      { command: 'cancel', description: 'Stop the current dialog' },
    ],
    { scope: { type: 'all_private_chats' } },
  );
  // setMyName is heavily rate limited, so only call it when it would change something.
  if ((await bot.api.getMyName()).name !== config.botName) await bot.api.setMyName(config.botName);
  await bot.api.setMyShortDescription(
    `Measures your Edvillianity out of ${config.maxPoints}. Works in any chat via inline mode.`,
  );
}
