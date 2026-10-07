import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { config } from './config.js';
import * as db from './db.js';
import { RARITIES, STATS, creatorRank } from './edvie.js';

// The Edvies Mini App: a page with the user's collection and the shop, plus a
// tiny JSON API behind it. Every API call carries Telegram's signed initData,
// which proves who is asking; nothing else is trusted.

const page = readFileSync(new URL('./webapp/index.html', import.meta.url));
const secret = createHmac('sha256', 'WebAppData').update(config.token).digest();

/** The Telegram user behind initData, or null if it's forged or older than a day. */
function verifyInitData(initData) {
  if (typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash') ?? '';
  params.delete('hash');
  const fields = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  // Newer clients add a "signature" field; accept the hash computed with or without it.
  const candidates = [fields, fields.filter(([key]) => key !== 'signature')].map((list) =>
    createHmac('sha256', secret)
      .update(list.map(([key, value]) => `${key}=${value}`).join('\n'))
      .digest('hex'),
  );
  const valid = candidates.some(
    (expected) => expected.length === hash.length && timingSafeEqual(Buffer.from(expected), Buffer.from(hash)),
  );
  if (!valid || Date.now() / 1000 - Number(params.get('auth_date')) > 86_400) return null;
  try {
    return JSON.parse(params.get('user'));
  } catch {
    return null;
  }
}

/** "Elon Musk (III)": the creator's name with their creator rank, if any. */
const creatorName = (edvie) => {
  const user = db.getUser(edvie.creator_id);
  const name = user?.name ?? user?.first_name ?? 'someone';
  const rank = user && creatorRank(db.approvedCount(user.user_id));
  return rank ? `${name} (${rank})` : name;
};

const publicEdvie = (edvie) => ({
  id: edvie.id,
  name: edvie.name,
  rarity: edvie.rarity,
  cost: edvie.cost,
  stats: edvie.stats,
  creator: creatorName(edvie),
});

function state(userId) {
  const owned = new Set(db.ownedEdvies(userId).map((e) => e.id));
  const released = db.releasedEdvies();
  return {
    coins: db.coins(userId),
    rarities: RARITIES.map(({ label, colors }) => ({ label, colors })),
    stats: STATS,
    collection: released.filter((e) => owned.has(e.id)).map(publicEdvie).reverse(),
    shop: released.map((e) => ({ ...publicEdvie(e), owned: owned.has(e.id) })),
  };
}

const ERRORS = { coins: 'Not enough coins', owned: 'You already have it', missing: 'Not available' };

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16_384) throw new Error('body too large');
  }
  return JSON.parse(body || '{}');
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, page, 'text/html; charset=utf-8');
  }

  const sprite = url.pathname.match(/^\/sprite\/(\d+)\.png$/);
  if (req.method === 'GET' && sprite) {
    const edvie = db.getEdvie(Number(sprite[1]));
    const file = join(config.spriteDir, `${sprite[1]}.png`);
    if (edvie?.status !== 'approved' || !existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
    return createReadStream(file).pipe(res);
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
    const body = await readJson(req);
    const user = verifyInitData(body.initData);
    if (!user) return send(res, 401, { error: 'Open this page from Telegram.' });

    if (url.pathname === '/api/state') return send(res, 200, state(user.id));
    if (url.pathname === '/api/buy') {
      const result = db.buyEdvie(user.id, Number(body.id));
      if (result.error) return send(res, 400, { error: ERRORS[result.error], ...state(user.id) });
      return send(res, 200, state(user.id));
    }
  }

  send(res, 404, { error: 'not found' });
}

export function startWebApp() {
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('Mini App request failed:', err);
      if (!res.headersSent) send(res, 500, { error: 'Something went wrong' });
    });
  });
  server.listen(config.webappPort, () => console.log(`Edvies Mini App on port ${config.webappPort} → ${config.webappUrl}`));
  return server;
}
