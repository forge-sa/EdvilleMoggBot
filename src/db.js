import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { FIELD_ORDER } from './fields.js';

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
    since      TEXT
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

  -- Multi-step dialogs (setup, fix, disagree) survive restarts.
  CREATE TABLE IF NOT EXISTS sessions (
    user_id INTEGER PRIMARY KEY,
    data    TEXT    NOT NULL
  );
`);

// Databases created by earlier versions.
const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [column, type] of [['name', 'TEXT'], ['ielts', 'REAL'], ['sat', 'INTEGER']]) {
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
