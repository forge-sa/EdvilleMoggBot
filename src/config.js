import { existsSync } from 'node:fs';

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
};

export const isDev = (userId) => config.devIds.includes(userId);
