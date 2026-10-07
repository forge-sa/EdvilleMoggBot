import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { FIELD_ORDER } from './fields.js';
import { todayIso } from './dates.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    user_id    INTEGER PRIMARY KEY,
    first_name TEXT    NOT NULL DEFAULT '',
    last_name  TEXT,
    username   TEXT,
    name       TEXT,
    grade      INTEGER,
    gpa        REAL,
    ielts      REAL,
    sat        INTEGER,
    since      TEXT,
    coins      INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS votes (
    target_id INTEGER NOT NULL,
    voter_id  INTEGER NOT NULL,
    value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
    PRIMARY KEY (target_id, voter_id)
  );

  -- One standing claim per (card, field, disagreeing user); a new claim from
  -- the same user replaces the old one, so nobody can stack disagreements.
  CREATE TABLE IF NOT EXISTS disputes (
    target_id   INTEGER NOT NULL,
    field       TEXT    NOT NULL,
    disputer_id INTEGER NOT NULL,
    value       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (target_id, field, disputer_id)
  );

  -- Fields the community disagreed with enough. While a user has any, their
  -- card is hidden and they must fix those fields. suggestion is a field key.
  CREATE TABLE IF NOT EXISTS flags (
    user_id    INTEGER NOT NULL,
    field      TEXT    NOT NULL,
    suggestion TEXT    NOT NULL,
    PRIMARY KEY (user_id, field)
  );

  -- One row per finished duel; the inline message id makes accepting twice impossible.
  CREATE TABLE IF NOT EXISTS duels (
    inline_message_id TEXT    PRIMARY KEY,
    challenger_id     INTEGER NOT NULL,
    opponent_id       INTEGER NOT NULL,
    winner_id         INTEGER NOT NULL,
    created_at        INTEGER NOT NULL
  );

  -- Message counts in groups the bot is a member of. Counts only, no content.
  CREATE TABLE IF NOT EXISTS activity (
    chat_id  INTEGER NOT NULL,
    user_id  INTEGER NOT NULL,
    messages INTEGER NOT NULL,
    PRIMARY KEY (chat_id, user_id)
  );

  -- Which group a duel offer was posted in, learned from the "via @bot"
  -- message the bot sees there. Inline callbacks don't carry the chat.
  CREATE TABLE IF NOT EXISTS duel_chats (
    nonce   TEXT    PRIMARY KEY,
    chat_id INTEGER NOT NULL
  );

  -- Chats a user's card has been shown in; you can only duel where you have.
  -- An inline message doesn't tell the bot its chat, so there are two keys:
  -- 'c:<chat id>'       the card's "via @bot" message, seen in a group the bot is in
  -- 'i:<chat_instance>' someone pressed a button on the card, in any chat
  CREATE TABLE IF NOT EXISTS card_sightings (
    user_id  INTEGER NOT NULL,
    chat_key TEXT    NOT NULL,
    PRIMARY KEY (user_id, chat_key)
  );

  -- Edvies: made by users, released once a developer approves them.
  -- stats is JSON ({ hp, dmg }); the sprite lives at <data dir>/edvies/<id>.png.
  CREATE TABLE IF NOT EXISTS edvies (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    rarity       INTEGER NOT NULL,
    cost         INTEGER NOT NULL,
    stats        TEXT    NOT NULL,
    creator_id   INTEGER NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    card_file_id TEXT,
    created_at   INTEGER NOT NULL,
    reviewed_at  INTEGER
  );

  CREATE TABLE IF NOT EXISTS owned_edvies (
    user_id     INTEGER NOT NULL,
    edvie_id    INTEGER NOT NULL,
    acquired_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, edvie_id)
  );

  -- One row per fought Edvie battle, keyed by the Fight message, which can
  -- only be fought once. Recent rows decide which Edvies are resting.
  CREATE TABLE IF NOT EXISTS edvie_battles (
    message_id TEXT    PRIMARY KEY,
    owner_a    INTEGER NOT NULL,
    edvie_a    INTEGER NOT NULL,
    owner_b    INTEGER NOT NULL,
    edvie_b    INTEGER NOT NULL,
    winner_id  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Coins for a win are paid once per winner, loser, kind and day, so two
  -- friends can't farm coins by fighting each other all day.
  CREATE TABLE IF NOT EXISTS rewards (
    winner_id INTEGER NOT NULL,
    loser_id  INTEGER NOT NULL,
    kind      TEXT    NOT NULL,
    day       TEXT    NOT NULL,
    PRIMARY KEY (winner_id, loser_id, kind, day)
  );

  -- Multi-step dialogs (setup, fix, disagree, Edvie making) survive restarts.
  CREATE TABLE IF NOT EXISTS sessions (
    user_id INTEGER PRIMARY KEY,
    data    TEXT    NOT NULL
  );
`);

// Databases created by earlier versions.
const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
// Battles used to be keyed by the offer; now by the Fight message.
const battleColumns = new Set(db.prepare('PRAGMA table_info(edvie_battles)').all().map((c) => c.name));
if (battleColumns.has('nonce')) db.exec('ALTER TABLE edvie_battles RENAME COLUMN nonce TO message_id');

for (const [column, type] of [['name', 'TEXT'], ['ielts', 'REAL'], ['sat', 'INTEGER'], ['coins', 'INTEGER NOT NULL DEFAULT 0']]) {
  if (!columns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${type}`);
}

const q = {
  touchUser: db.prepare(`
    INSERT INTO users (user_id, first_name, last_name, username) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name  = excluded.last_name,
      username   = excluded.username`),
  getUser: db.prepare('SELECT * FROM users WHERE user_id = ?'),
  setField: Object.fromEntries(
    FIELD_ORDER.map((f) => [f, db.prepare(`UPDATE users SET ${f} = ? WHERE user_id = ?`)]),
  ),
  getVote: db.prepare('SELECT value FROM votes WHERE target_id = ? AND voter_id = ?'),
  putVote: db.prepare('INSERT OR REPLACE INTO votes (target_id, voter_id, value) VALUES (?, ?, ?)'),
  dropVote: db.prepare('DELETE FROM votes WHERE target_id = ? AND voter_id = ?'),
  rep: db.prepare('SELECT COALESCE(SUM(value), 0) AS rep FROM votes WHERE target_id = ?'),
  putDispute: db.prepare(
    'INSERT OR REPLACE INTO disputes (target_id, field, disputer_id, value, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  disputeClaims: db.prepare(
    'SELECT disputer_id, value FROM disputes WHERE target_id = ? AND field = ? ORDER BY created_at',
  ),
  clearDisputes: db.prepare('DELETE FROM disputes WHERE target_id = ? AND field = ?'),
  flags: db.prepare('SELECT field, suggestion FROM flags WHERE user_id = ?'),
  flag: db.prepare('INSERT OR REPLACE INTO flags (user_id, field, suggestion) VALUES (?, ?, ?)'),
  unflag: db.prepare('DELETE FROM flags WHERE user_id = ? AND field = ?'),
  recordDuel: db.prepare(
    `INSERT OR IGNORE INTO duels (inline_message_id, challenger_id, opponent_id, winner_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ),
  duelOver: db.prepare('SELECT 1 FROM duels WHERE inline_message_id = ?'),
  duelRecord: db.prepare(`
    SELECT COALESCE(SUM(winner_id = $id), 0) AS wins, COALESCE(SUM(winner_id != $id), 0) AS losses
    FROM duels WHERE challenger_id = $id OR opponent_id = $id`),
  countMessage: db.prepare(`
    INSERT INTO activity (chat_id, user_id, messages) VALUES (?, ?, 1)
    ON CONFLICT(chat_id, user_id) DO UPDATE SET messages = messages + 1`),
  chatTotal: db.prepare('SELECT COALESCE(SUM(messages), 0) AS n FROM activity WHERE chat_id = ?'),
  userMessages: db.prepare('SELECT messages FROM activity WHERE chat_id = ? AND user_id = ?'),
  rememberDuelChat: db.prepare('INSERT OR IGNORE INTO duel_chats (nonce, chat_id) VALUES (?, ?)'),
  duelChat: db.prepare('SELECT chat_id FROM duel_chats WHERE nonce = ?'),
  sawCard: db.prepare('INSERT OR IGNORE INTO card_sightings (user_id, chat_key) VALUES (?, ?)'),
  cardSeen: db.prepare('SELECT 1 FROM card_sightings WHERE user_id = ? AND chat_key = ?'),
  coins: db.prepare('SELECT coins FROM users WHERE user_id = ?'),
  addCoins: db.prepare('UPDATE users SET coins = coins + ? WHERE user_id = ?'),
  spendCoins: db.prepare('UPDATE users SET coins = coins - ? WHERE user_id = ? AND coins >= ?'),
  reward: db.prepare('INSERT OR IGNORE INTO rewards (winner_id, loser_id, kind, day) VALUES (?, ?, ?, ?)'),
  createEdvie: db.prepare(
    `INSERT INTO edvies (name, rarity, cost, stats, creator_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  getEdvie: db.prepare('SELECT * FROM edvies WHERE id = ?'),
  updateEdvie: db.prepare('UPDATE edvies SET name = ?, rarity = ?, cost = ?, stats = ? WHERE id = ?'),
  reviewEdvie: db.prepare(
    "UPDATE edvies SET status = ?, card_file_id = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'",
  ),
  nameTaken: db.prepare(
    "SELECT 1 FROM edvies WHERE lower(name) = lower(?) AND status != 'rejected' AND id != ?",
  ),
  pendingByCreator: db.prepare("SELECT COUNT(*) AS n FROM edvies WHERE creator_id = ? AND status = 'pending'"),
  pending: db.prepare("SELECT * FROM edvies WHERE status = 'pending' ORDER BY id"),
  released: db.prepare(
    "SELECT * FROM edvies WHERE status = 'approved' AND card_file_id IS NOT NULL ORDER BY rarity, cost, id",
  ),
  owned: db.prepare(`
    SELECT e.* FROM owned_edvies o JOIN edvies e ON e.id = o.edvie_id
    WHERE o.user_id = ? AND e.status = 'approved' AND e.card_file_id IS NOT NULL
    ORDER BY e.rarity DESC, e.cost DESC, e.id`),
  owns: db.prepare('SELECT 1 FROM owned_edvies WHERE user_id = ? AND edvie_id = ?'),
  grantEdvie: db.prepare('INSERT OR IGNORE INTO owned_edvies (user_id, edvie_id, acquired_at) VALUES (?, ?, ?)'),
  recordEdvieBattle: db.prepare(
    `INSERT OR IGNORE INTO edvie_battles (message_id, owner_a, edvie_a, owner_b, edvie_b, winner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ),
  edvieBattleOver: db.prepare('SELECT 1 FROM edvie_battles WHERE message_id = ?'),
  recentBattles: db.prepare(`
    SELECT owner_a, edvie_a, edvie_b FROM edvie_battles
    WHERE owner_a = $id OR owner_b = $id
    ORDER BY created_at DESC, rowid DESC LIMIT $limit`),
  getSession: db.prepare('SELECT data FROM sessions WHERE user_id = ?'),
  putSession: db.prepare('INSERT OR REPLACE INTO sessions (user_id, data) VALUES (?, ?)'),
  dropSession: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
};

export function touchUser(from) {
  q.touchUser.run(from.id, from.first_name ?? '', from.last_name ?? null, from.username ?? null);
}

export function getUser(userId) {
  return q.getUser.get(userId);
}

export function isComplete(user) {
  return !!user && FIELD_ORDER.every((f) => user[f] != null);
}

export function setField(userId, field, value) {
  q.setField[field].run(value, userId);
}

/** Reddit-style: same button again removes the vote. Returns the new vote (-1, 0, 1). */
export function vote(targetId, voterId, value) {
  const current = q.getVote.get(targetId, voterId)?.value;
  if (current === value) {
    q.dropVote.run(targetId, voterId);
    return 0;
  }
  q.putVote.run(targetId, voterId, value);
  return value;
}

export function rep(targetId) {
  return q.rep.get(targetId).rep;
}

export function putDispute(targetId, field, disputerId, key) {
  q.putDispute.run(targetId, field, disputerId, key, Date.now());
}

/** [{ disputer_id, value }], oldest first. */
export function disputeClaims(targetId, field) {
  return q.disputeClaims.all(targetId, field);
}

export function clearDisputes(targetId, field) {
  q.clearDisputes.run(targetId, field);
}

/** [{ field, suggestion }] the user has to fix before their card shows again. */
export function flags(userId) {
  return q.flags.all(userId);
}

export function isHidden(userId) {
  return flags(userId).length > 0;
}

export function flag(userId, field, suggestionKey) {
  q.flag.run(userId, field, suggestionKey);
}

export function unflag(userId, field) {
  q.unflag.run(userId, field);
}

/** False if this duel message was already fought. */
export function recordDuel(inlineMessageId, challengerId, opponentId, winnerId) {
  return q.recordDuel.run(inlineMessageId, challengerId, opponentId, winnerId, Date.now()).changes > 0;
}

export function isDuelOver(inlineMessageId) {
  return !!q.duelOver.get(inlineMessageId);
}

export function duelRecord(userId) {
  const { wins, losses } = q.duelRecord.get({ id: userId });
  return { wins, losses };
}

export function countMessage(chatId, userId) {
  q.countMessage.run(chatId, userId);
}

/** Share (0..1) of the chat's counted messages written by the user, or null without data. */
export function messageShare(chatId, userId) {
  const total = q.chatTotal.get(chatId).n;
  if (!total) return null;
  return (q.userMessages.get(chatId, userId)?.messages ?? 0) / total;
}

export function rememberDuelChat(nonce, chatId) {
  q.rememberDuelChat.run(nonce, chatId);
}

export function duelChat(nonce) {
  return q.duelChat.get(nonce)?.chat_id ?? null;
}

export function sawCard(userId, chatKey) {
  q.sawCard.run(userId, chatKey);
}

/** Whether the user's card was shown in the chat known by any of chatKeys. */
export function hasShownCard(userId, chatKeys) {
  return chatKeys.some((key) => q.cardSeen.get(userId, key));
}

// ---------------------------------------------------------------------------
// Coins and Edvies

export function coins(userId) {
  return q.coins.get(userId)?.coins ?? 0;
}

/** Pays the winner unless they already beat this loser at this kind today. Returns the coins paid. */
export function reward(winnerId, loserId, kind, amount) {
  if (q.reward.run(winnerId, loserId, kind, todayIso()).changes === 0) return 0;
  q.addCoins.run(amount, winnerId);
  return amount;
}

const edvieRow = (row) => row && { ...row, stats: JSON.parse(row.stats) };

export function createEdvie({ name, rarity, cost, stats, creatorId }) {
  return Number(q.createEdvie.run(name, rarity, cost, JSON.stringify(stats), creatorId, Date.now()).lastInsertRowid);
}

export function getEdvie(id) {
  return edvieRow(q.getEdvie.get(id));
}

/** Changes name / rarity / cost / stats of an Edvie, keeping the rest. */
export function updateEdvie(id, changes) {
  const e = { ...getEdvie(id), ...changes };
  q.updateEdvie.run(e.name, e.rarity, e.cost, JSON.stringify(e.stats), id);
}

/** Approves (with the released card's file id) or rejects a pending Edvie. False if it wasn't pending. */
export function reviewEdvie(id, status, cardFileId = null) {
  return q.reviewEdvie.run(status, cardFileId, Date.now(), id).changes > 0;
}

export function edvieNameTaken(name, exceptId = 0) {
  return !!q.nameTaken.get(name, exceptId);
}

export function pendingCount(creatorId) {
  return q.pendingByCreator.get(creatorId).n;
}

export function pendingEdvies() {
  return q.pending.all().map(edvieRow);
}

/** Everything in the shop, cheapest rarity first. */
export function releasedEdvies() {
  return q.released.all().map(edvieRow);
}

/** A user's collection, rarest first. */
export function ownedEdvies(userId) {
  return q.owned.all(userId).map(edvieRow);
}

export function ownsEdvie(userId, edvieId) {
  return !!q.owns.get(userId, edvieId);
}

export function grantEdvie(userId, edvieId) {
  q.grantEdvie.run(userId, edvieId, Date.now());
}

/** { ok: true } or { error: 'missing' | 'owned' | 'coins' }. */
export function buyEdvie(userId, edvieId) {
  const edvie = getEdvie(edvieId);
  if (!edvie || edvie.status !== 'approved') return { error: 'missing' };
  db.exec('BEGIN IMMEDIATE');
  try {
    let result = { ok: true };
    if (q.owns.get(userId, edvieId)) result = { error: 'owned' };
    else if (q.spendCoins.run(edvie.cost, userId, edvie.cost).changes === 0) result = { error: 'coins' };
    else q.grantEdvie.run(userId, edvieId, Date.now());
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** False if this Fight message was already fought. */
export function recordEdvieBattle(messageId, ownerA, edvieA, ownerB, edvieB, winnerId) {
  return q.recordEdvieBattle.run(messageId, ownerA, edvieA, ownerB, edvieB, winnerId, Date.now()).changes > 0;
}

export function isEdvieBattleOver(messageId) {
  return !!q.edvieBattleOver.get(messageId);
}

/**
 * Edvies that fought recently rest: one sits out its trainer's next
 * min(edvieRestBattles, Edvies owned − 1) battles, so with one Edvie nothing
 * rests and there's always at least one that can fight.
 * Returns Map(edvie id → battles it still has to sit out).
 */
export function restingEdvies(userId) {
  const limit = Math.min(config.edvieRestBattles, ownedEdvies(userId).length - 1);
  const resting = new Map();
  if (limit <= 0) return resting;
  q.recentBattles.all({ id: userId, limit }).forEach((battle, i) => {
    const edvieId = battle.owner_a === userId ? battle.edvie_a : battle.edvie_b;
    if (!resting.has(edvieId)) resting.set(edvieId, limit - i);
  });
  return resting;
}

export function getSession(userId) {
  const row = q.getSession.get(userId);
  return row ? JSON.parse(row.data) : null;
}

export function setSession(userId, data) {
  q.putSession.run(userId, JSON.stringify(data));
}

export function clearSession(userId) {
  q.dropSession.run(userId);
}
