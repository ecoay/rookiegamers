import { now, newId, DAY, cleanText, getGame } from './db.js';
import { stripe, stripeReady } from './stripe.js';

// Game clips and the cross-promo agreement.
//
// Every game in the ad loop can submit gameplay clips, 30 to 60 seconds long, which the portal
// reviews like the game itself. To join the loop, the developer agrees to the cross-promo terms.
// The game is in the loop from the moment they accept, before it's approved for paid ads:
//
// - When no paid ad is available, their game shows other games' clips, unpaid. Their own clip runs
//   in other games the same way. Nobody pays and nobody is paid for these. Games that host more
//   clips than they get shown are shown more, so the swap stays fair.
// - A clip of 30 seconds or less can also be promoted: the developer pays (through the portal's
//   Stripe) and it runs as a paid ad in other games, ahead of the free rotation. The games that
//   show it earn their usual 70% of ad revenue from it, like any sponsor.
// - Clips also rotate in the banner on game pages: paid promotions first, then the free rotation.
//
// Clip files live in R2 under _clips/<id>.mp4 (slugs can't start with "_", so they never collide
// with game builds) and are served from /clips/<id>.mp4.

export const CLIP = { minS: 30, maxS: 60, shortS: 30, maxBytes: 25 * 1024 * 1024 };
export const PROMO = { minCents: 2000, maxCents: 500000, defaultCpmCents: 600 };
export const AD_TERMS_VERSION = '2026-11b';
export const AD_TERMS = [
  'RookieGamers serves every ad in your game. You don\'t add ad code of your own.',
  'Accepting these terms puts your game in the ad loop right away. Until your game passes review for paid ads, it shows only other games\' clips, unpaid, and your clips run in theirs.',
  'Once your game is approved for paid ads, it also shows sponsor and network ads.',
  'You keep 70% of what paid ads in your game earn, paid monthly.',
  'When there\'s no paid ad, your game shows clips of other RookieGamers games. Neither side is paid for these.',
  'Your approved clips run in other games the same way, for free.',
  'Clips of 30 seconds or less can be promoted as paid ads. Games that show them earn their 70% share.',
];

export class ClipError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, msg) => { throw new ClipError(status, msg); };

/* ---------- reading an mp4's length ---------- */

// The movie header box (mvhd) holds the timescale and duration. It's inside moov, which can be
// at the start or the end of the file, so look through the whole thing.
export function mp4Seconds(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 16 || String.fromCharCode(b[4], b[5], b[6], b[7]) !== 'ftyp') return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 8; i + 32 < b.length; i++) {
    if (b[i] !== 0x6d || b[i + 1] !== 0x76 || b[i + 2] !== 0x68 || b[i + 3] !== 0x64) continue; // "mvhd"
    const v = b[i + 4];
    if (v === 0) { const ts = dv.getUint32(i + 16); return ts ? dv.getUint32(i + 20) / ts : null; }
    if (v === 1 && i + 36 <= b.length) { const ts = dv.getUint32(i + 24); return ts ? Number(dv.getBigUint64(i + 28)) / ts : null; }
    return null;
  }
  return null;
}

/* ---------- clips ---------- */

export const clipURL = (site, c) => `${site}/clips/${c.id}.mp4`;
export function clipView(c, site) {
  return { id: c.id, game: c.game, title: c.title, seconds: Math.round(c.seconds * 10) / 10, short: c.seconds <= CLIP.shortS + 0.5, status: c.status, note: c.note || null,
    url: site ? clipURL(site, c) : undefined, createdAt: c.created_at };
}

export async function uploadClip(DB, env, g, body, size, { title } = {}) {
  if (!env.GAMES) fail(503, 'Clip uploads aren\'t set up (no R2 bucket bound).');
  if (g.ads !== 'approved' && g.ads !== 'requested') fail(400, 'Ask for ads first (and accept the ad terms). Clips run in the ad rotation.');
  if (!size || size > CLIP.maxBytes) fail(413, 'Clips are MP4 files up to 25 MB.');
  const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(await new Response(body).arrayBuffer());
  const seconds = mp4Seconds(bytes);
  if (seconds == null) fail(400, 'Upload an MP4 file (H.264 video plays everywhere).');
  if (seconds < CLIP.minS - 0.5 || seconds > CLIP.maxS + 0.5) fail(400, `Clips are ${CLIP.minS} to ${CLIP.maxS} seconds long. This one is ${Math.round(seconds)} seconds.`);
  const n = await DB.prepare(`SELECT COUNT(*) AS n FROM clips WHERE game = ? AND status != 'removed'`).bind(g.slug).first();
  if (n.n >= 5) fail(400, 'A game can have up to 5 clips. Remove one first.');
  const id = newId('cl', 16);
  await env.GAMES.put(`_clips/${id}.mp4`, bytes, { httpMetadata: { contentType: 'video/mp4' } });
  await DB.prepare('INSERT INTO clips (id, game, title, seconds, bytes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, g.slug, cleanText(title, 60) || g.title, seconds, bytes.byteLength, 'pending', now()).run();
  return DB.prepare('SELECT * FROM clips WHERE id = ?').bind(id).first();
}

export async function listClips(DB, { game, status } = {}) {
  const where = [], vals = [];
  if (game) { where.push('game = ?'); vals.push(game); }
  if (status) { where.push('status = ?'); vals.push(status); } else where.push(`status != 'removed'`);
  return (await DB.prepare(`SELECT * FROM clips ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 200`).bind(...vals).all()).results;
}

export async function reviewClip(DB, id, { status, note }) {
  const c = await DB.prepare('SELECT * FROM clips WHERE id = ?').bind(String(id)).first();
  if (!c) fail(404, 'No such clip.');
  if (!['approved', 'rejected', 'pending'].includes(status)) fail(400, 'status is approved, rejected or pending.');
  if (status === 'rejected' && !cleanText(note, 300)) fail(400, 'Say why, so the developer can fix it: { "note": "..." }.');
  await DB.prepare('UPDATE clips SET status = ?, note = ?, reviewed_at = ? WHERE id = ?').bind(status, cleanText(note, 300) || null, now(), c.id).run();
  if (status !== 'approved') await DB.prepare('UPDATE campaigns SET active = 0 WHERE clip = ?').bind(c.id).run();
  return DB.prepare('SELECT * FROM clips WHERE id = ?').bind(c.id).first();
}

export async function removeClip(DB, g, id) {
  const r = await DB.prepare(`UPDATE clips SET status = 'removed' WHERE id = ? AND game = ?`).bind(String(id), g.slug).run();
  if (!r.meta || !r.meta.changes) fail(404, 'No such clip.');
  await DB.prepare('UPDATE campaigns SET active = 0 WHERE clip = ?').bind(String(id)).run();
  return { removed: true };
}

// Serves a clip with HTTP range support, which video players (Safari above all) need.
export async function serveClip(env, DB, id, req) {
  const c = env.GAMES && /^cl[a-f0-9]{16}$/.test(id) && await DB.prepare('SELECT status FROM clips WHERE id = ?').bind(id).first();
  if (!c || c.status === 'removed') return new Response('Not found', { status: 404 });
  const key = `_clips/${id}.mp4`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
  const head = await env.GAMES.head(key);
  if (!head) return new Response('Not found', { status: 404 });
  const h = { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' };
  if (!range) { const obj = await env.GAMES.get(key); return new Response(obj.body, { headers: { ...h, 'content-length': String(head.size) } }); }
  let start = range[1] === '' ? head.size - Number(range[2]) : Number(range[1]);
  let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : head.size - 1;
  start = Math.max(0, start); end = Math.min(end, head.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { ...h, 'content-range': `bytes */${head.size}` } });
  const obj = await env.GAMES.get(key, { range: { offset: start, length: end - start + 1 } });
  return new Response(obj.body, { status: 206, headers: { ...h, 'content-range': `bytes ${start}-${end}/${head.size}`, 'content-length': String(end - start + 1) } });
}

/* ---------- the free rotation ---------- */

// A clip from another game in the cross-promo rotation. Games that have shown more clips than
// theirs have been shown get picked more often (and the other way round), within 4x either way.
export async function pickHouseClip(DB, g, { shortOnly = false } = {}) {
  const clips = (await DB.prepare(`SELECT c.* FROM clips c JOIN games g ON g.slug = c.game
    WHERE c.status = 'approved' AND c.game != ? AND g.live = 1 AND g.ads IN ('requested', 'approved') AND g.ads_agreed_at IS NOT NULL ${shortOnly ? 'AND c.seconds <= ?' : ''}`)
    .bind(...[g.slug, ...(shortOnly ? [CLIP.shortS + 0.5] : [])]).all()).results;
  if (!clips.length) return null;
  const since = now() - 30 * DAY;
  const hosted = Object.fromEntries((await DB.prepare(`SELECT game, COUNT(*) AS n FROM ad_views WHERE source = 'house' AND clip IS NOT NULL AND status = 'done' AND started_at > ? GROUP BY game`).bind(since).all()).results.map(r => [r.game, r.n]));
  const got = Object.fromEntries((await DB.prepare(`SELECT c.game, COUNT(*) AS n FROM ad_views v JOIN clips c ON c.id = v.clip WHERE v.source = 'house' AND v.status = 'done' AND v.started_at > ? GROUP BY c.game`).bind(since).all()).results.map(r => [r.game, r.n]));
  const weight = c => Math.min(4, Math.max(0.25, (1 + (hosted[c.game] || 0)) / (1 + (got[c.game] || 0))));
  let r = Math.random() * clips.reduce((a, c) => a + weight(c), 0);
  for (const c of clips) { r -= weight(c); if (r <= 0) return c; }
  return clips[clips.length - 1];
}

export async function crossPromoStats(DB, slug) {
  const since = now() - 30 * DAY;
  const hosted = await DB.prepare(`SELECT COUNT(*) AS n FROM ad_views WHERE game = ? AND source = 'house' AND clip IS NOT NULL AND status = 'done' AND started_at > ?`).bind(slug, since).first();
  const got = await DB.prepare(`SELECT COUNT(*) AS n FROM ad_views v JOIN clips c ON c.id = v.clip WHERE c.game = ? AND v.game != ? AND v.status = 'done' AND v.started_at > ?`).bind(slug, slug, since).first();
  return { days: 30, clipsShownInYourGame: hosted.n, yourClipsShownElsewhere: got.n };
}

/* ---------- the banner on game pages ---------- */

// Paid promotions first (not billed for banner showings, which come free with a promotion),
// then the free rotation. Never the game's own clip. Games not yet monetized show only the free
// rotation, like their in-game ads.
export async function bannerClip(DB, g, { paid = true } = {}) {
  const promos = !paid ? [] : (await DB.prepare(`SELECT c.* FROM campaigns p JOIN clips c ON c.id = p.clip WHERE p.active = 1 AND p.spent_milli < p.budget_cents * 1000 AND c.status = 'approved' AND c.game != ?`).bind(g.slug).all()).results;
  if (promos.length) return { clip: promos[Math.floor(Math.random() * promos.length)], promoted: true };
  const c = await pickHouseClip(DB, g);
  return c ? { clip: c, promoted: false } : null;
}

/* ---------- paid promotion ---------- */

export async function promoteCheckout(DB, env, site, g, pid, { clip, budgetCents }) {
  const c = await DB.prepare('SELECT * FROM clips WHERE id = ? AND game = ?').bind(String(clip || ''), g.slug).first();
  if (!c) fail(404, 'Pick one of this game\'s clips.');
  if (c.status !== 'approved') fail(400, 'That clip hasn\'t been approved yet.');
  if (c.seconds > CLIP.shortS + 0.5) fail(400, `Only clips of ${CLIP.shortS} seconds or less can be promoted as paid ads.`);
  const budget = Math.round(Number(budgetCents));
  if (!(budget >= PROMO.minCents && budget <= PROMO.maxCents)) fail(400, `Promotions are $${PROMO.minCents / 100} to $${PROMO.maxCents / 100}, in cents: { "budgetCents": 5000 }.`);
  if (!stripeReady(env)) fail(503, 'Promotions open once payments are set up.');
  const id = newId('pr', 16);
  const session = await stripe(env, 'POST', '/v1/checkout/sessions', {
    mode: 'payment', client_reference_id: id,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: budget, product_data: { name: `Promote ${g.title} on RookieGamers`, description: `Your ${Math.round(c.seconds)}-second clip runs as a paid ad in other games until the budget is spent.` } } }],
    metadata: { kind: 'promo', promo: id, game: g.slug, clip: c.id, player: pid, budget: String(budget) },
    payment_intent_data: { metadata: { kind: 'promo', promo: id, game: g.slug } },
    success_url: `${site}/dev?promo=${id}#money`, cancel_url: `${site}/dev#money`,
  }, { idempotencyKey: id });
  return { promo: id, url: session.url };
}

// Called from the Stripe webhook once a promotion is paid: start the campaign.
export async function startPromotion(DB, env, obj) {
  const m = obj.metadata || {};
  const c = await DB.prepare('SELECT * FROM clips WHERE id = ?').bind(String(m.clip || '')).first();
  const g = c && await getGame(DB, c.game);
  if (!c || !g) return { ok: true, unknown: true };
  if (await DB.prepare('SELECT 1 FROM campaigns WHERE id = ?').bind('cmp' + String(m.promo).slice(2, 14)).first()) return { ok: true, duplicate: true };
  // The budget is what they paid, less any sales tax.
  const budget = Math.max(0, (obj.amount_total ?? Number(m.budget)) - (obj.total_details?.amount_tax || 0));
  const cpm = Math.max(1, Number(env.PROMO_CPM_CENTS) || PROMO.defaultCpmCents);
  await DB.prepare(`INSERT INTO campaigns (id, name, kind, headline, image, click_url, formats, games, cpm_cents, budget_cents, spent_milli, active, created_at, clip)
    VALUES (?, ?, 'sponsor', ?, NULL, ?, '["rewarded","midgame"]', '[]', ?, ?, 0, 1, ?, ?)`)
    .bind('cmp' + String(m.promo).slice(2, 14), `Promo: ${g.title}`, g.title, `${(env.SITE_URL || 'https://rookiegamers.com').replace(/\/$/, '')}/play/${g.slug}`, cpm, budget, now(), c.id).run();
  return { ok: true, promoted: c.id };
}

export async function promotions(DB, slug) {
  const rows = (await DB.prepare(`SELECT p.* FROM campaigns p JOIN clips c ON c.id = p.clip WHERE c.game = ? ORDER BY p.created_at DESC`).bind(slug).all()).results;
  return rows.map(p => ({ id: p.id, clip: p.clip, budgetCents: p.budget_cents, spentCents: Math.floor(p.spent_milli / 1000), cpmCents: p.cpm_cents, active: !!p.active }));
}
