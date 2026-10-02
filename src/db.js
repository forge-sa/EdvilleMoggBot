import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { FIELDS, FIELD_ORDER } from './fields.js';
import { schoolYearStart, todayIso } from './dates.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
  -- <field>_locked holds the date the community overwrote that field, or NULL.
  CREATE TABLE IF NOT EXISTS users (
    user_id      INTEGER PRIMARY KEY,
    first_name   TEXT    NOT NULL DEFAULT '',
    last_name    TEXT,
    username     TEXT,
    name         TEXT,
    gpa          REAL,
    grade        INTEGER,
    since        TEXT,
    name_locked  TEXT,
    gpa_locked   TEXT,
    grade_locked TEXT,
    since_locked TEXT
  );

  CREATE TABLE IF NOT EXISTS votes (
    target_id INTEGER NOT NULL,
    voter_id  INTEGER NOT NULL,
    value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
    PRIMARY KEY (target_id, voter_id)
  );

  -- One standing claim per (card, field, disagreeing user); a new claim from
  -- the same user replaces the old one, so nobody can stack votes.
  CREATE TABLE IF NOT EXISTS disputes (
    target_id   INTEGER NOT NULL,
    field       TEXT    NOT NULL,
    disputer_id INTEGER NOT NULL,
    value       TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (target_id, field, disputer_id)
  );

  -- Multi-step dialogs (setup, edit, disagree) survive restarts.
  CREATE TABLE IF NOT EXISTS sessions (
    user_id INTEGER PRIMARY KEY,
    data    TEXT    NOT NULL
  );
`);

// Databases created before the real-name field existed.
const columns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const column of ['name', 'name_locked']) {
  if (!columns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} TEXT`);
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
    FIELD_ORDER.map((f) => [f, db.prepare(`UPDATE users SET ${f} = ?, ${f}_locked = ? WHERE user_id = ?`)]),
  ),
  getVote: db.prepare('SELECT value FROM votes WHERE target_id = ? AND voter_id = ?'),
  putVote: db.prepare('INSERT OR REPLACE INTO votes (target_id, voter_id, value) VALUES (?, ?, ?)'),
  dropVote: db.prepare('DELETE FROM votes WHERE target_id = ? AND voter_id = ?'),
  rep: db.prepare('SELECT COALESCE(SUM(value), 0) AS rep FROM votes WHERE target_id = ?'),
  putDispute: db.prepare(
    'INSERT OR REPLACE INTO disputes (target_id, field, disputer_id, value, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  disputeValues: db.prepare('SELECT value FROM disputes WHERE target_id = ? AND field = ? ORDER BY created_at'),
  clearDisputes: db.prepare('DELETE FROM disputes WHERE target_id = ? AND field = ?'),
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

/** Owners can't edit a field the community corrected (yearly ones unlock on 1 Sept). */
export function isLocked(user, field) {
  const lockedAt = user?.[`${field}_locked`];
  if (!lockedAt) return false;
  return !FIELDS[field].yearly || lockedAt >= schoolYearStart();
}

export function setField(userId, field, value, { byCommunity = false } = {}) {
  q.setField[field].run(value, byCommunity ? todayIso() : null, userId);
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

export function disputeValues(targetId, field) {
  return q.disputeValues.all(targetId, field).map((row) => row.value);
}

export function clearDisputes(targetId, field) {
  q.clearDisputes.run(targetId, field);
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
