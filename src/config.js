import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing required env variable ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}

function number(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function ids(name, fallback) {
  const list = (process.env[name] ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);
  return list.length ? list : fallback;
}

export const config = {
  token: required('BOT_TOKEN'),
  botName: 'Edville Moggmeter',
  gpaMax: number('GPA_MAX', 5),
  timezone: process.env.TIMEZONE?.trim() || 'UTC',
  dbPath: process.env.DB_PATH?.trim() || './data/moggmeter.db',
  // Edville opened on this day; nobody can have joined earlier.
  schoolOpened: '2023-09-01',
  maxPoints: 3000,
  // Developers get a badge on their card and a heavier disagreement.
  devIds: ids('DEV_IDS', [8964334068]),
  // Weighted disagreements needed to flag one field of a card; a developer's
  // disagreement counts as devDisputeWeight. Never shown to users.
  disputeThreshold: 5,
  devDisputeWeight: 5,

  // Edvies. Developers (devIds) are the admins who approve them.
  coinsPerWin: { moggduel: 25, edvieBattle: 40 },
  maxPendingEdvies: 3,
  // An Edvie that fought sits out its trainer's next N battles (fewer when they
  // own fewer Edvies, so there's always one that can fight).
  edvieRestBattles: 3,
  // Public HTTPS address of the Edvies Mini App (collection + shop), served by
  // this process on webappPort. Without it the Mini App is simply off.
  // Always ends in '/', so the page's relative links work under a subpath too.
  webappUrl: process.env.WEBAPP_URL?.trim().replace(/\/*$/, '/').replace(/^\/$/, '') || null,
  webappPort: number('WEBAPP_PORT', 8080),
};

config.spriteDir = join(dirname(config.dbPath), 'edvies');

export const isDev = (userId) => config.devIds.includes(userId);
