import { Bot, GrammyError, InlineKeyboard } from 'grammy';
import { config } from './config.js';
import * as db from './db.js';
import { FIELDS, FIELD_ORDER, consensus } from './fields.js';
import { HTML, cardKeyboard, cardText, displayName, ownCardKeyboard } from './card.js';
import { edvillianity, tier } from './score.js';

const bot = new Bot(config.token);

// Keep names on cards fresh: every update refreshes the sender's name.
bot.use(async (ctx, next) => {
  if (ctx.from && !ctx.from.is_bot) db.touchUser(ctx.from);
  await next();
});

// ---------------------------------------------------------------------------
// Inline mode: "@bot" in any chat offers exactly one result, the caller's own
// card. There is no way to pull up somebody else's.

bot.on('inline_query', async (ctx) => {
  const user = db.getUser(ctx.from.id);
  const opts = { cache_time: 0, is_personal: true };

  if (!db.isComplete(user)) {
    return ctx.answerInlineQuery([], {
      ...opts,
      button: { text: '🗿 Set up your Moggmeter card first', start_parameter: 'setup' },
    });
  }

  const points = edvillianity(user);
  return ctx.answerInlineQuery(
    [
      {
        type: 'article',
        id: 'card',
        title: '🗿 Show my Moggmeter card',
        description: `⚡ ${points}/1000 · ${tier(points)}`,
        input_message_content: { message_text: cardText(user, db.rep(user.user_id)), ...HTML },
        reply_markup: cardKeyboard(user.user_id),
      },
    ],
    opts,
  );
});

// ---------------------------------------------------------------------------
// Appreciate / depreciate. Works on cards in any chat, the bot doesn't need to
// be a member: callbacks from inline messages come straight to the bot.

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
  try {
    await ctx.editMessageText(cardText(target, db.rep(target.user_id)), {
      ...HTML,
      reply_markup: cardKeyboard(target.user_id),
    });
  } catch (err) {
    // Clicking twice fast, or a vote that cancels out, leaves the text unchanged.
    if (!(err instanceof GrammyError && err.description.includes('message is not modified'))) throw err;
  }
}

// ---------------------------------------------------------------------------
// Private chat: setup, editing, disagreeing.

const pm = bot.chatType('private');

pm.command('start', async (ctx) => {
  const dispute = ctx.match.match(/^d_(\d+)$/);
  if (dispute) return startDispute(ctx, Number(dispute[1]));

  const me = db.getUser(ctx.from.id);
  if (db.isComplete(me)) return showOwnCard(ctx, '👋 Welcome back. Here is your card:');
  return startSetup(ctx);
});

pm.command('me', (ctx) => {
  const me = db.getUser(ctx.from.id);
  if (!db.isComplete(me)) return startSetup(ctx);
  return showOwnCard(ctx);
});

pm.command('edit', (ctx) => showEditMenu(ctx));

pm.command('cancel', async (ctx) => {
  db.clearSession(ctx.from.id);
  await ctx.reply('Cancelled.');
});

pm.command('help', (ctx) =>
  ctx.reply(
    [
      '🗿 <b>Edville Moggmeter</b> measures your Edvillianity out of 1000.',
      '',
      `Type <code>@${ctx.me.username}</code> in <b>any</b> chat to drop your card there. The bot doesn't need to be in that chat.`,
      '',
      'Under every card:',
      '⬆️ Appreciate / ⬇️ Depreciate — rate the student (press again to take it back)',
      '🙅 Disagree — think something on the card is wrong? Claim the real value.',
      '',
      '/me — your card',
      '/edit — change your info',
      '/cancel — stop what you were doing',
    ].join('\n'),
    HTML,
  ),
);

pm.callbackQuery('edit', async (ctx) => {
  await ctx.answerCallbackQuery();
  await showEditMenu(ctx);
});

pm.callbackQuery(/^ed:(\w+)$/, async (ctx) => {
  const field = ctx.match[1];
  const me = db.getUser(ctx.from.id);
  if (!FIELDS[field] || !db.isComplete(me)) return ctx.answerCallbackQuery();

  if (db.isLocked(me, field)) {
    return ctx.answerCallbackQuery({
      text: FIELDS[field].yearly
        ? 'The Edville community corrected this one. You can change it yourself again from 1 September.'
        : 'The Edville community corrected this one, so it stays as it is.',
      show_alert: true,
    });
  }
  await ctx.answerCallbackQuery();
  await ask(ctx, { flow: 'edit', fields: [field], i: 0, values: {} });
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

pm.on('message:text', async (ctx) => {
  const session = db.getSession(ctx.from.id);
  if (!session) {
    return ctx.reply(
      `Type <code>@${ctx.me.username}</code> in any chat to show your card there, or /me to see it here.`,
      HTML,
    );
  }

  const field = session.fields[session.i];
  const target = session.flow === 'dispute' ? db.getUser(session.target) : null;
  if (session.flow === 'dispute' && !db.isComplete(target)) {
    db.clearSession(ctx.from.id);
    return ctx.reply('This card no longer exists.');
  }

  const parsed = FIELDS[field].parse(ctx.message.text);
  if (parsed.error) return ctx.reply(`❌ ${parsed.error}\n\n${FIELDS[field].hint()}`, HTML);

  if (target && FIELDS[field].toKey(parsed.value) === FIELDS[field].toKey(target[field])) {
    return ctx.reply("That's exactly what the card already says. Send the value you think is right, or /cancel.");
  }

  session.values[field] = parsed.value;
  session.i += 1;
  if (session.i < session.fields.length) return ask(ctx, session);

  db.clearSession(ctx.from.id);
  return finish(ctx, session);
});

// ---------------------------------------------------------------------------
// Flows

/** Asks for whatever the user's card is still missing (everything, for newcomers). */
async function startSetup(ctx, then = null) {
  const me = db.getUser(ctx.from.id);
  const missing = FIELD_ORDER.filter((f) => me?.[f] == null);
  const intro =
    missing.length === FIELD_ORDER.length
      ? [
          '🗿 <b>Edville Moggmeter</b>',
          '',
          "Let's make your card: your real name, GPA, class, and when you joined Edville.",
          'Your Edvillianity is calculated from them, out of 1000.',
        ]
      : ['🗿 Your card is missing something. Fill it in and it can be shown again.'];
  await ctx.reply(intro.join('\n'), HTML);
  await ask(ctx, { flow: 'setup', fields: missing, i: 0, values: {}, then });
}

/** Saves the dialog state and asks the question for the current field. */
async function ask(ctx, session) {
  db.setSession(ctx.from.id, session);
  const field = FIELDS[session.fields[session.i]];
  const step = session.fields.length > 1 ? `<i>${session.i + 1}/${session.fields.length}</i> ` : '';

  let question;
  if (session.flow === 'dispute') {
    const target = db.getUser(session.target);
    question = `${field.emoji} What is ${displayName(target)}'s real <b>${field.label}</b>?`;
  } else {
    question = `${field.emoji} Your <b>${field.label}</b>?`;
  }
  await ctx.reply(`${step}${question}\n${field.hint()}`, HTML);
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

  const me = db.getUser(ctx.from.id);
  const fields = session.fields.filter((f) => !db.isLocked(me, f));
  for (const field of fields) db.setField(ctx.from.id, field, session.values[field]);
  // Changing your own value can turn earlier agreeing claims into disagreeing ones.
  await resolveDisputes(ctx.from.id, fields);

  await showOwnCard(ctx, session.flow === 'setup' ? '✅ Your card is ready:' : '✅ Saved. Your card now:');
  if (session.then) await startDispute(ctx, session.then);
}

async function startDispute(ctx, targetId) {
  if (targetId === ctx.from.id) {
    return ctx.reply("You can't disagree with your own card 🙃 Use /edit to change your info.");
  }
  const target = db.getUser(targetId);
  if (!db.isComplete(target)) return ctx.reply('This card no longer exists.');

  // Only Edvillians with a card of their own get a say about others.
  if (!db.isComplete(db.getUser(ctx.from.id))) {
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

async function showOwnCard(ctx, intro) {
  const me = db.getUser(ctx.from.id);
  if (intro) await ctx.reply(intro);
  await ctx.reply(cardText(me, db.rep(me.user_id)), { ...HTML, reply_markup: ownCardKeyboard() });
}

async function showEditMenu(ctx) {
  const me = db.getUser(ctx.from.id);
  if (!db.isComplete(me)) return startSetup(ctx);

  const keyboard = new InlineKeyboard();
  for (const field of FIELD_ORDER) {
    const def = FIELDS[field];
    const lock = db.isLocked(me, field) ? ' 🔒' : '';
    keyboard.text(`${def.emoji} ${def.label}: ${def.format(me[field])}${lock}`, `ed:${field}`).row();
  }
  await ctx.reply('What do you want to change?', { reply_markup: keyboard });
}

/**
 * Once enough different users claim a field is wrong, the field takes the
 * community's value (see consensus() in fields.js) and gets locked against
 * the owner's edits.
 */
async function resolveDisputes(targetId, fields) {
  const changed = [];
  for (const field of fields) {
    const def = FIELDS[field];
    const target = db.getUser(targetId);
    const current = def.toKey(target[field]);
    const claims = db.disputeValues(targetId, field).filter((key) => key !== current);
    if (claims.length < config.disputeThreshold) continue;

    const value = consensus(field, claims);
    db.setField(targetId, field, value, { byCommunity: true });
    db.clearDisputes(targetId, field);
    changed.push(`${def.emoji} ${def.label}: <b>${def.format(value)}</b>`);
  }

  if (changed.length) {
    await bot.api
      .sendMessage(
        targetId,
        ['👥 The Edville community corrected your card:', '', ...changed].join('\n'),
        HTML,
      )
      .catch(() => {}); // they may have blocked the bot
  }
}

// ---------------------------------------------------------------------------

bot.catch(({ error, ctx }) => {
  console.error(`Error while handling update ${ctx.update.update_id}:`, error);
});

async function setupProfile() {
  await bot.api.setMyCommands(
    [
      { command: 'me', description: 'Your Moggmeter card' },
      { command: 'edit', description: 'Change your info' },
      { command: 'help', description: 'How it works' },
      { command: 'cancel', description: 'Stop the current dialog' },
    ],
    { scope: { type: 'all_private_chats' } },
  );
  // setMyName is heavily rate limited, so only call it when it would change something.
  if ((await bot.api.getMyName()).name !== config.botName) await bot.api.setMyName(config.botName);
  await bot.api.setMyShortDescription('Measures your Edvillianity out of 1000. Works in any chat via inline mode.');
}

await bot.init();
if (!bot.botInfo.supports_inline_queries) {
  console.warn('⚠️  Inline mode is OFF. Turn it on in @BotFather: /setinline → pick the bot → set a placeholder.');
}
await setupProfile().catch((err) => console.warn('Could not update bot name/commands:', err.message));

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => bot.stop());

await bot.start({
  allowed_updates: ['message', 'inline_query', 'callback_query'],
  onStart: (me) => console.log(`@${me.username} (${config.botName}) is running`),
});
