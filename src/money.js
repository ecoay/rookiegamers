import { now, newId, DAY, sha256, cleanText, getGame, getPlayer, monthKey, safeJSON } from './db.js';
import { signToken } from './tokens.js';
import { stripe, stripeReady, StripeError } from './stripe.js';
import { pickHouseClip, startPromotion, AD_TERMS_VERSION, CLIP } from './clips.js';

// Money on RookieGamers: portal ads, each game's store, and paying developers.
//
// Ads. A published game asks for ads, and the portal reviews it. Until a game is approved,
// rg.ads.rewarded() and rg.ads.midgame() are safe no-ops. Approved games get ads from, in order:
// direct sponsors the portal sells, an ad network (Google H5 Games Ads, on portal pages only, when
// ADSENSE_CLIENT is set), and house ads for other RookieGamers games, which always fill. Each
// rewarded view the portal counts gets a signed receipt, so a game can grant the reward on trust.
//
// Store. Each game has its own channel of products: one-time items and monthly passes. Products
// can be bought for cash through the portal's Stripe Checkout, unlocked by watching N rewarded
// ads, or (for coin games, later) paid in coin at a discount. The portal is the seller.
//
// Payouts. Every sale and every month of ad revenue lands in a ledger with the developer's share:
// 90% of store sales after Stripe's fee and tax, 70% of ad revenue. Store money clears after a
// 30-day refund hold. On the 1st of each month, developers with a connected Stripe Express
// account and at least $10 cleared are paid by Stripe transfer.

export const SPLIT = { store: 0.9, ads: 0.7 };
export const PAYOUT_MIN_CENTS = 1000;
export const HOLD_DAYS = 30;
export const COIN_DISCOUNT = 2 / 3;            // $15 cash = $10 in coin
export const AD_RULES = {
  rewarded: { minMs: 15000, perDay: 40 },       // per player (or visitor) per game
  midgame: { minMs: 5000, gapMs: 3 * 60 * 1000 },
};
const ADS = ['off', 'requested', 'approved', 'rejected', 'paused'];
const FORMATS = ['rewarded', 'midgame'];
const SKU_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
const MAX_PRODUCTS = 50;

export class MoneyError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, msg) => { throw new MoneyError(status, msg); };

/* ---------- schema ---------- */

const SCHEMA = [
  // A game's store channel. kind 'item' is bought once and kept; 'pass' renews monthly.
  // price_cents null means not sold for cash. ad_unlock > 0 means N rewarded ads unlock it
  // (for ad_days days if it's a pass, for good if it's an item).
  `CREATE TABLE IF NOT EXISTS products (game TEXT NOT NULL, sku TEXT NOT NULL, title TEXT NOT NULL, blurb TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'item', price_cents INTEGER, ad_unlock INTEGER NOT NULL DEFAULT 0, ad_days INTEGER NOT NULL DEFAULT 1,
    coin_ok INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (game, sku))`,
  `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, game TEXT NOT NULL, sku TEXT NOT NULL, player_id TEXT NOT NULL, kind TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'cash', amount_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', stripe_session TEXT, stripe_pi TEXT,
    stripe_sub TEXT, created_at INTEGER NOT NULL, paid_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS orders_player ON orders(player_id, game)`,
  `CREATE INDEX IF NOT EXISTS orders_pi ON orders(stripe_pi)`,
  `CREATE INDEX IF NOT EXISTS orders_sub ON orders(stripe_sub)`,
  // What a player owns. expires_at null = for good.
  `CREATE TABLE IF NOT EXISTS entitlements (player_id TEXT NOT NULL, game TEXT NOT NULL, sku TEXT NOT NULL, source TEXT NOT NULL,
    expires_at INTEGER, order_id TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (player_id, game, sku))`,
  `CREATE TABLE IF NOT EXISTS ad_progress (player_id TEXT NOT NULL, game TEXT NOT NULL, sku TEXT NOT NULL, views INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, game, sku))`,
  // One row per ad shown. who = player id, or a hashed IP for guests (for frequency caps only).
  `CREATE TABLE IF NOT EXISTS ad_views (id TEXT PRIMARY KEY, secret TEXT NOT NULL, game TEXT NOT NULL, who TEXT NOT NULL, player_id TEXT,
    format TEXT NOT NULL, source TEXT NOT NULL, campaign TEXT, sku TEXT, status TEXT NOT NULL DEFAULT 'started', started_at INTEGER NOT NULL, done_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS ad_views_who ON ad_views(game, who, format, started_at)`,
  `CREATE INDEX IF NOT EXISTS ad_views_month ON ad_views(source, status, started_at)`,
  // Ads the portal sells or runs itself. kind 'sponsor' pays cpm_cents per 1000 completed views,
  // up to budget_cents; kind 'house' is free. spent_milli is in thousandths of a cent.
  `CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, headline TEXT NOT NULL, image TEXT,
    click_url TEXT, formats TEXT NOT NULL DEFAULT '["rewarded","midgame"]', games TEXT NOT NULL DEFAULT '[]', cpm_cents INTEGER NOT NULL DEFAULT 0,
    budget_cents INTEGER NOT NULL DEFAULT 0, spent_milli INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`,
  // Ad revenue per game and month, from sponsor views or the ad network's report.
  `CREATE TABLE IF NOT EXISTS ad_reports (month TEXT NOT NULL, game TEXT NOT NULL, source TEXT NOT NULL, views INTEGER NOT NULL,
    gross_cents INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (month, game, source))`,
  // Every amount owed to a developer. dev_cents is their share (negative for refunds).
  // developer null = a game the portal owns itself; it's recorded but never paid out.
  `CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, developer TEXT, game TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
    gross_cents INTEGER NOT NULL, dev_cents INTEGER NOT NULL, month TEXT NOT NULL, available_at INTEGER NOT NULL, payout_id TEXT, created_at INTEGER NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ledger_ref ON ledger(kind, ref)`,
  `CREATE INDEX IF NOT EXISTS ledger_dev ON ledger(developer, payout_id, available_at)`,
  `CREATE INDEX IF NOT EXISTS ledger_game ON ledger(game, month)`,
  `CREATE TABLE IF NOT EXISTS payouts (id TEXT PRIMARY KEY, developer TEXT NOT NULL, amount_cents INTEGER NOT NULL, status TEXT NOT NULL,
    transfer TEXT, error TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS payouts_dev ON payouts(developer, created_at)`,
  // Gameplay clips (30 to 60 seconds) for the cross-promo rotation and paid promotions. See clips.js.
  `CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, game TEXT NOT NULL, title TEXT NOT NULL, seconds REAL NOT NULL, bytes INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', note TEXT, reviewed_at INTEGER, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS clips_game ON clips(game, status)`,
  `CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, at INTEGER NOT NULL)`,
];
const COLUMNS = [
  // ads: off → requested → approved | rejected; approved games can be paused.
  `ALTER TABLE games ADD COLUMN ads TEXT NOT NULL DEFAULT 'off'`,
  'ALTER TABLE games ADD COLUMN ads_note TEXT',
  'ALTER TABLE games ADD COLUMN ads_at INTEGER',
  `ALTER TABLE games ADD COLUMN ad_formats TEXT NOT NULL DEFAULT '["rewarded","midgame"]'`,
  // When the developer accepted the ad terms (the cross-promo agreement), and which version.
  'ALTER TABLE games ADD COLUMN ads_agreed_at INTEGER',
  'ALTER TABLE games ADD COLUMN ads_terms TEXT',
  'ALTER TABLE campaigns ADD COLUMN clip TEXT',
  'ALTER TABLE ad_views ADD COLUMN clip TEXT',
  'ALTER TABLE ad_views ADD COLUMN min_ms INTEGER',
  'ALTER TABLE developers ADD COLUMN stripe_account TEXT',
  'ALTER TABLE developers ADD COLUMN payouts_ready INTEGER NOT NULL DEFAULT 0',
];

export async function migrateMoney(DB) {
  await DB.batch(SCHEMA.map(s => DB.prepare(s)));
  for (const c of COLUMNS) { try { await DB.prepare(c).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
}

/* ---------- ad review ---------- */

export function adsView(g) {
  return { status: g.ads || 'off', note: g.ads_note || null, reviewedAt: g.ads_at || null, formats: safeJSON(g.ad_formats, FORMATS), agreedAt: g.ads_agreed_at || null };
}
const cleanFormats = f => { const list = [].concat(f || []).filter(x => FORMATS.includes(x)); return list.length ? [...new Set(list)] : FORMATS; };

// The developer asks for ads on a live game, and accepts the ad terms (see AD_TERMS in clips.js):
// with no paid ad, their game shows other games' clips unpaid, and their clips run elsewhere free.
export async function requestAds(DB, g, { formats, agree } = {}) {
  if (!g.live) fail(400, 'Publish the game first. Ads are reviewed on live games.');
  if (agree !== true && !g.ads_agreed_at) fail(400, 'Accept the ad terms first: { "agree": true }. With no paid ad, your game shows other games\' clips, unpaid, and your clips run in theirs.');
  if (agree === true) await DB.prepare('UPDATE games SET ads_agreed_at = COALESCE(ads_agreed_at, ?), ads_terms = ? WHERE slug = ?').bind(now(), AD_TERMS_VERSION, g.slug).run();
  if (g.ads === 'approved') return adsView(await getGame(DB, g.slug));
  await DB.prepare(`UPDATE games SET ads = 'requested', ads_note = NULL, ad_formats = ? WHERE slug = ?`).bind(JSON.stringify(cleanFormats(formats)), g.slug).run();
  return adsView(await getGame(DB, g.slug));
}

// The portal's review: approve, reject (with a reason the developer sees), pause or switch off.
export async function reviewAds(DB, slug, { status, note, formats }) {
  const g = await getGame(DB, slug);
  if (!g) fail(404, `There's no game called "${slug}".`);
  if (!ADS.includes(status)) fail(400, `status is one of ${ADS.join(', ')}.`);
  if (status === 'rejected' && !cleanText(note, 300)) fail(400, 'Say why, so the developer can fix it: { "note": "..." }.');
  if (status === 'approved' && !g.ads_agreed_at) fail(400, 'The developer hasn\'t accepted the ad terms yet.');
  await DB.prepare('UPDATE games SET ads = ?, ads_note = ?, ads_at = ?, ad_formats = COALESCE(?, ad_formats) WHERE slug = ?')
    .bind(status, cleanText(note, 300) || null, now(), formats ? JSON.stringify(cleanFormats(formats)) : null, g.slug).run();
  return { slug: g.slug, ...adsView(await getGame(DB, g.slug)) };
}

export async function adsQueue(DB) {
  const rows = (await DB.prepare(`SELECT * FROM games WHERE ads IN ('requested', 'approved', 'paused', 'rejected') ORDER BY CASE ads WHEN 'requested' THEN 0 ELSE 1 END, title`).all()).results;
  return rows.map(g => ({ slug: g.slug, title: g.title, developer: g.developer, live: !!g.live, url: g.url, ...adsView(g) }));
}

/* ---------- serving ads ---------- */

export const adsOn = (g, format) => !!g && !!g.live && g.ads === 'approved' && safeJSON(g.ad_formats, FORMATS).includes(format);

async function whoFor(req, pid) {
  if (pid) return pid;
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  return 'ip:' + (await sha256('rg-ads:' + ip)).slice(0, 20);
}

// A paid ad: a sponsor, or another game's promoted clip (never the game's own).
async function pickSponsor(DB, g, format) {
  const rows = (await DB.prepare(`SELECT p.*, c.seconds AS clip_seconds FROM campaigns p LEFT JOIN clips c ON c.id = p.clip
    WHERE p.active = 1 AND p.kind = 'sponsor' AND p.spent_milli < p.budget_cents * 1000 AND (p.clip IS NULL OR (c.status = 'approved' AND c.game != ?))`).bind(g.slug).all()).results
    .filter(c => safeJSON(c.formats, FORMATS).includes(format) && (() => { const only = safeJSON(c.games, []); return !only.length || only.includes(g.slug); })());
  if (!rows.length) return null;
  // Weighted by price, so higher-paying sponsors show more often.
  let r = Math.random() * rows.reduce((a, c) => a + Math.max(1, c.cpm_cents), 0);
  for (const c of rows) { r -= Math.max(1, c.cpm_cents); if (r <= 0) return c; }
  return rows[rows.length - 1];
}

// Starts an ad. Returns { fill: false, reason } or { fill: true, view, url, format, source, minMs }.
export async function startAd(DB, env, req, site, g, { format, sku, mode }, pid) {
  if (!FORMATS.includes(format)) return { fill: false, reason: 'unknown-format' };
  if (!adsOn(g, format)) return { fill: false, reason: 'not-approved' };
  const who = await whoFor(req, pid);
  const t = now();
  if (format === 'midgame') {
    const last = await DB.prepare(`SELECT MAX(started_at) AS at FROM ad_views WHERE game = ? AND who = ? AND format = 'midgame'`).bind(g.slug, who).first();
    if (last.at && t - last.at < AD_RULES.midgame.gapMs) return { fill: false, reason: 'too-soon' };
  } else {
    const n = await DB.prepare(`SELECT COUNT(*) AS n FROM ad_views WHERE game = ? AND who = ? AND format = 'rewarded' AND started_at > ?`).bind(g.slug, who, t - DAY).first();
    if (n.n >= AD_RULES.rewarded.perDay) return { fill: false, reason: 'daily-limit' };
  }
  let product = null;
  if (sku) {
    product = await DB.prepare('SELECT * FROM products WHERE game = ? AND sku = ? AND active = 1').bind(g.slug, String(sku)).first();
    if (!product || !product.ad_unlock) return { fill: false, reason: 'not-ad-unlockable' };
    if (!pid) return { fill: false, reason: 'signin', signin: true };
  }
  const sponsor = await pickSponsor(DB, g, format);
  const source = sponsor ? 'sponsor' : env.ADSENSE_CLIENT && mode === 'portal' ? 'network' : 'house';
  // The free rotation: another game's clip (rewarded ads only use clips of 30 seconds or less).
  const clip = source === 'house' ? await pickHouseClip(DB, g, { shortOnly: format === 'rewarded' }) : null;
  const ms = minMs(source, format, clip ? clip.seconds : sponsor?.clip_seconds);
  const id = newId('av', 20), secret = newId('', 24);
  await DB.prepare('INSERT INTO ad_views (id, secret, game, who, player_id, format, source, campaign, clip, sku, min_ms, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, await sha256(secret), g.slug, who, pid || null, format, source, sponsor?.id || null, clip?.id || sponsor?.clip || null, product ? product.sku : null, ms, t).run();
  return { fill: true, view: id, url: `${site}/ad/${id}?s=${secret}`, format, source, minMs: ms };
}

// How long an ad has to run before it counts. A rewarded clip runs to its end (30 seconds at most).
const minMs = (source, format, clipSeconds) => {
  if (source === 'network') return 0;
  if (format === 'rewarded' && clipSeconds) return Math.round(Math.min(clipSeconds, CLIP.shortS) * 1000);
  return AD_RULES[format].minMs;
};

async function viewFor(DB, id, secret) {
  if (!/^av[a-f0-9]{20}$/.test(String(id)) || !secret) return null;
  const v = await DB.prepare('SELECT * FROM ad_views WHERE id = ?').bind(id).first();
  return v && v.secret === await sha256(String(secret)) ? v : null;
}

// The ad network had nothing to show: switch to a house ad and start the clock again.
export async function adFallback(DB, id, secret) {
  const v = await viewFor(DB, id, secret);
  if (!v || v.status !== 'started' || v.source !== 'network') return { error: 'Unknown ad.' };
  const g = await getGame(DB, v.game);
  const clip = await pickHouseClip(DB, g, { shortOnly: v.format === 'rewarded' });
  const ms = minMs('house', v.format, clip?.seconds);
  await DB.prepare(`UPDATE ad_views SET source = 'house', clip = ?, min_ms = ?, started_at = ? WHERE id = ?`).bind(clip?.id || null, ms, now(), v.id).run();
  return { source: 'house', minMs: ms, clip: clip ? { id: clip.id, game: clip.game, title: clip.title } : null };
}

// The ad ran to the end. Counts it, pays the sponsor's rate, moves ad unlocks along, and signs
// a receipt the game (or its server) can check against /.well-known/jwks.json.
export async function completeAd(DB, env, id, secret) {
  const v = await viewFor(DB, id, secret);
  if (!v) return { status: 404, error: 'Unknown ad.' };
  if (v.status !== 'started') return { status: 409, error: 'That ad was already counted.' };
  if (now() - v.started_at < (v.min_ms ?? minMs(v.source, v.format)) - 1000) return { status: 400, error: 'The ad hasn\'t finished.' };
  const claim = await DB.prepare(`UPDATE ad_views SET status = 'done', done_at = ? WHERE id = ? AND status = 'started'`).bind(now(), v.id).run();
  if (!claim.meta || !claim.meta.changes) return { status: 409, error: 'That ad was already counted.' };
  if (v.source === 'sponsor' && v.campaign) {
    await DB.prepare('UPDATE campaigns SET spent_milli = spent_milli + cpm_cents WHERE id = ?').bind(v.campaign).run();
    await DB.prepare('UPDATE campaigns SET active = 0 WHERE id = ? AND spent_milli >= budget_cents * 1000').bind(v.campaign).run();
  }
  const out = { shown: true, rewarded: v.format === 'rewarded', view: v.id };
  if (v.sku && v.player_id) Object.assign(out, await adUnlockStep(DB, v.player_id, v.game, v.sku));
  if (out.rewarded) out.receipt = await signToken(DB, env, { sub: v.player_id || 'guest', aud: v.game, use: 'receipt', kind: 'ad', view: v.id, sku: v.sku || undefined }, 3600);
  return out;
}

async function adUnlockStep(DB, pid, game, sku) {
  const p = await DB.prepare('SELECT * FROM products WHERE game = ? AND sku = ?').bind(game, sku).first();
  if (!p || !p.ad_unlock) return {};
  await DB.prepare(`INSERT INTO ad_progress (player_id, game, sku, views) VALUES (?, ?, ?, 1)
    ON CONFLICT (player_id, game, sku) DO UPDATE SET views = views + 1`).bind(pid, game, sku).run();
  const row = await DB.prepare('SELECT views FROM ad_progress WHERE player_id = ? AND game = ? AND sku = ?').bind(pid, game, sku).first();
  if (row.views < p.ad_unlock) return { sku, progress: row.views, needed: p.ad_unlock, unlocked: false };
  await DB.prepare('UPDATE ad_progress SET views = 0 WHERE player_id = ? AND game = ? AND sku = ?').bind(pid, game, sku).run();
  await grant(DB, pid, game, sku, 'ads', p.kind === 'pass' ? now() + p.ad_days * DAY : null);
  return { sku, progress: p.ad_unlock, needed: p.ad_unlock, unlocked: true };
}

/* ---------- sponsor campaigns ---------- */

function cleanCampaign(b, existing) {
  const out = {};
  if (b.name !== undefined || !existing) out.name = cleanText(b.name, 60) || fail(400, 'Give the campaign a name.');
  if (b.kind !== undefined || !existing) out.kind = b.kind === 'house' ? 'house' : 'sponsor';
  if (b.headline !== undefined || !existing) out.headline = cleanText(b.headline, 90) || fail(400, 'Give the ad a headline.');
  if (b.image !== undefined) out.image = /^https:\/\/[^\s"'<>]{1,400}$/.test(b.image || '') ? b.image : null;
  if (b.clickUrl !== undefined) out.click_url = /^https:\/\/[^\s"'<>]{1,400}$/.test(b.clickUrl || '') ? b.clickUrl : null;
  if (b.formats !== undefined) out.formats = JSON.stringify(cleanFormats(b.formats));
  if (b.games !== undefined) out.games = JSON.stringify([].concat(b.games || []).map(String).filter(s => /^[a-z0-9-]{1,32}$/.test(s)).slice(0, 50));
  if (b.cpmCents !== undefined) out.cpm_cents = Math.max(0, Math.round(Number(b.cpmCents)) || 0);
  if (b.budgetCents !== undefined) out.budget_cents = Math.max(0, Math.round(Number(b.budgetCents)) || 0);
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  return out;
}
const campaignView = c => ({ id: c.id, name: c.name, kind: c.kind, headline: c.headline, image: c.image, clickUrl: c.click_url, formats: safeJSON(c.formats, FORMATS),
  games: safeJSON(c.games, []), cpmCents: c.cpm_cents, budgetCents: c.budget_cents, spentCents: Math.floor(c.spent_milli / 1000), active: !!c.active });

export async function createCampaign(DB, b) {
  const f = { id: newId('cmp', 12), created_at: now(), ...cleanCampaign(b) };
  await DB.prepare(`INSERT INTO campaigns (${Object.keys(f).join(', ')}) VALUES (${Object.keys(f).map(() => '?').join(', ')})`).bind(...Object.values(f)).run();
  return campaignView(await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(f.id).first());
}
export async function updateCampaign(DB, id, b) {
  const c = await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!c) fail(404, 'No such campaign.');
  const f = cleanCampaign(b, c);
  if (Object.keys(f).length) await DB.prepare(`UPDATE campaigns SET ${Object.keys(f).map(k => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...Object.values(f), id).run();
  return campaignView(await DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first());
}
export const listCampaigns = async DB => (await DB.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all()).results.map(campaignView);

/* ---------- products and what players own ---------- */

export function productView(p, g) {
  const coin = !!(g && g.coin && p.coin_ok && p.price_cents);
  return { sku: p.sku, title: p.title, blurb: p.blurb, kind: p.kind, priceCents: p.price_cents, currency: 'usd', adUnlock: p.ad_unlock, adDays: p.kind === 'pass' ? p.ad_days : null,
    coinPriceCents: coin ? Math.round(p.price_cents * COIN_DISCOUNT) : null, active: !!p.active };
}

export async function listProducts(DB, g, { all = false } = {}) {
  const rows = (await DB.prepare(`SELECT * FROM products WHERE game = ? ${all ? '' : 'AND active = 1'} ORDER BY created_at`).bind(g.slug).all()).results;
  return rows.map(p => productView(p, g));
}

export async function putProduct(DB, g, sku, b) {
  sku = String(sku || '').toLowerCase();
  if (!SKU_RE.test(sku)) fail(400, 'A sku is up to 40 lowercase letters, numbers, dots, dashes and underscores, like "skin.gold" or "season-pass".');
  const old = await DB.prepare('SELECT * FROM products WHERE game = ? AND sku = ?').bind(g.slug, sku).first();
  if (!old) {
    const n = await DB.prepare('SELECT COUNT(*) AS n FROM products WHERE game = ?').bind(g.slug).first();
    if (n.n >= MAX_PRODUCTS) fail(400, `A game can have up to ${MAX_PRODUCTS} products.`);
  }
  const p = { ...(old || { kind: 'item', price_cents: null, ad_unlock: 0, ad_days: 1, coin_ok: 1, active: 1, blurb: '' }) };
  if (b.title !== undefined || !old) { p.title = cleanText(b.title, 60); if (p.title.length < 2) fail(400, 'Give the product a title.'); }
  if (b.blurb !== undefined) p.blurb = cleanText(b.blurb, 200);
  if (b.kind !== undefined) {
    if (old && old.kind !== b.kind && await DB.prepare('SELECT 1 FROM orders WHERE game = ? AND sku = ? LIMIT 1').bind(g.slug, sku).first()) fail(409, 'This product has been sold, so its kind can\'t change. Make a new sku.');
    p.kind = b.kind === 'pass' ? 'pass' : 'item';
  }
  if (b.priceCents !== undefined) {
    const c = b.priceCents === null || b.priceCents === '' ? null : Math.round(Number(b.priceCents));
    if (c !== null && !(c >= 99 && c <= 50000)) fail(400, 'Prices are from 99 cents to $500, in cents: { "priceCents": 499 }.');
    p.price_cents = c;
  }
  if (b.adUnlock !== undefined) { const n = Math.round(Number(b.adUnlock)) || 0; if (n < 0 || n > 20) fail(400, 'adUnlock is how many rewarded ads unlock it, 0 to 20.'); p.ad_unlock = n; }
  if (b.adDays !== undefined) p.ad_days = Math.min(30, Math.max(1, Math.round(Number(b.adDays)) || 1));
  if (b.coin !== undefined) p.coin_ok = b.coin ? 1 : 0;
  if (b.active !== undefined) p.active = b.active ? 1 : 0;
  if (p.price_cents == null && !p.ad_unlock) fail(400, 'Give it a cash price (priceCents), an ad unlock (adUnlock), or both.');
  await DB.prepare(`INSERT INTO products (game, sku, title, blurb, kind, price_cents, ad_unlock, ad_days, coin_ok, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (game, sku) DO UPDATE SET title = excluded.title, blurb = excluded.blurb, kind = excluded.kind,
    price_cents = excluded.price_cents, ad_unlock = excluded.ad_unlock, ad_days = excluded.ad_days, coin_ok = excluded.coin_ok, active = excluded.active, updated_at = excluded.updated_at`)
    .bind(g.slug, sku, p.title, p.blurb, p.kind, p.price_cents, p.ad_unlock, p.ad_days, p.coin_ok, p.active, old ? old.created_at : now(), now()).run();
  const view = productView(await DB.prepare('SELECT * FROM products WHERE game = ? AND sku = ?').bind(g.slug, sku).first(), g);
  if (p.ad_unlock && !adsOn(g, 'rewarded')) view.note = 'Ad unlocks start working once the game is approved for ads.';
  return view;
}

// Products that were sold are switched off instead of deleted, so owners keep them.
export async function deleteProduct(DB, g, sku) {
  const sold = await DB.prepare('SELECT 1 FROM entitlements WHERE game = ? AND sku = ? LIMIT 1').bind(g.slug, sku).first();
  if (sold) { await DB.prepare('UPDATE products SET active = 0, updated_at = ? WHERE game = ? AND sku = ?').bind(now(), g.slug, sku).run(); return { deleted: false, active: false }; }
  await DB.prepare('DELETE FROM products WHERE game = ? AND sku = ?').bind(g.slug, sku).run();
  return { deleted: true };
}

export async function grant(DB, pid, game, sku, source, expiresAt, orderId = null) {
  // A longer expiry (or for good) always wins over a shorter one.
  await DB.prepare(`INSERT INTO entitlements (player_id, game, sku, source, expires_at, order_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (player_id, game, sku) DO UPDATE SET source = excluded.source, order_id = COALESCE(excluded.order_id, order_id), updated_at = excluded.updated_at,
    expires_at = CASE WHEN expires_at IS NULL OR excluded.expires_at IS NULL THEN NULL ELSE MAX(expires_at, excluded.expires_at) END`)
    .bind(pid, game, sku, source, expiresAt, orderId, now()).run();
}
const revoke = (DB, pid, game, sku) => DB.prepare('DELETE FROM entitlements WHERE player_id = ? AND game = ? AND sku = ?').bind(pid, game, sku).run();

export async function owned(DB, pid, game) {
  const rows = (await DB.prepare('SELECT sku, source, expires_at FROM entitlements WHERE player_id = ? AND game = ? AND (expires_at IS NULL OR expires_at > ?)').bind(pid, game, now()).all()).results;
  return rows.map(r => ({ sku: r.sku, source: r.source, expiresAt: r.expires_at }));
}

// The store as a player sees it: products, what they own, and how far along each ad unlock is.
export async function storeFor(DB, g, pid) {
  const items = await listProducts(DB, g);
  const mine = pid ? await owned(DB, pid, g.slug) : [];
  const progress = pid ? Object.fromEntries((await DB.prepare('SELECT sku, views FROM ad_progress WHERE player_id = ? AND game = ?').bind(pid, g.slug).all()).results.map(r => [r.sku, r.views])) : {};
  const adsReady = adsOn(g, 'rewarded');
  return {
    items: items.map(i => {
      const own = mine.find(m => m.sku === i.sku);
      return { ...i, owned: !!own, expiresAt: own ? own.expiresAt : null, adProgress: i.adUnlock && adsReady ? progress[i.sku] || 0 : null, adUnlock: adsReady ? i.adUnlock : 0 };
    }),
    owned: mine,
  };
}

/* ---------- checkout (the portal's Stripe account is the seller) ---------- */

export async function createCheckout(DB, env, site, g, pid, sku, { method } = {}) {
  if (!g.live) fail(404, 'Unknown game.');
  const p = await DB.prepare('SELECT * FROM products WHERE game = ? AND sku = ? AND active = 1').bind(g.slug, String(sku || '')).first();
  if (!p) fail(404, `There's no product "${sku}".`);
  if (p.price_cents == null) fail(400, 'This one can only be unlocked by watching ads.');
  if (method === 'coin') fail(501, 'Paying with coin is coming soon. Pay with cash for now.');
  if (p.kind === 'item' && (await owned(DB, pid, g.slug)).some(o => o.sku === p.sku)) fail(409, 'You already own this.');
  if (!stripeReady(env)) fail(503, 'The store isn\'t open yet.');
  const player = await getPlayer(DB, pid);
  const id = newId('or', 20);
  const name = `${g.title}: ${p.title}`;
  const meta = { order: id, game: g.slug, sku: p.sku, player: pid };
  const session = await stripe(env, 'POST', '/v1/checkout/sessions', {
    mode: p.kind === 'pass' ? 'subscription' : 'payment',
    client_reference_id: id,
    customer_email: player?.email || undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: p.price_cents, product_data: { name, description: p.blurb || undefined },
      recurring: p.kind === 'pass' ? { interval: 'month' } : undefined } }],
    metadata: meta,
    payment_intent_data: p.kind === 'pass' ? undefined : { metadata: meta, statement_descriptor_suffix: 'ROOKIEGAMERS' },
    subscription_data: p.kind === 'pass' ? { metadata: meta } : undefined,
    automatic_tax: env.STRIPE_TAX === '1' ? { enabled: true } : undefined,
    success_url: `${site}/store/done?order=${id}`,
    cancel_url: `${site}/store/done?order=${id}&cancel=1`,
  }, { idempotencyKey: id });
  await DB.prepare('INSERT INTO orders (id, game, sku, player_id, kind, amount_cents, stripe_session, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, g.slug, p.sku, pid, p.kind, p.price_cents, session.id, now()).run();
  return { order: id, url: session.url };
}

export async function orderStatus(DB, id, pid) {
  const o = /^or[a-f0-9]{20}$/.test(String(id)) && await DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
  if (!o || o.player_id !== pid) return null;
  return { order: o.id, game: o.game, sku: o.sku, status: o.status, paid: o.status === 'paid' };
}

/* ---------- the ledger ---------- */

async function addLedger(DB, { developer, game, kind, ref, gross, dev, available = now(), month = monthKey() }) {
  const r = await DB.prepare(`INSERT OR IGNORE INTO ledger (id, developer, game, kind, ref, gross_cents, dev_cents, month, available_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(newId('lg', 20), developer || null, game, kind, ref, gross, dev, month, available, now()).run();
  return !!(r.meta && r.meta.changes);
}

const estimateFee = cents => Math.round(cents * 0.029) + 30;

// Stripe's fee for a charge. Falls back to the standard card rate if Stripe won't say.
async function feeFor(env, { pi, charge }, amount) {
  try {
    if (pi) {
      const p = await stripe(env, 'GET', `/v1/payment_intents/${pi}`, { expand: ['latest_charge.balance_transaction'] });
      const bt = p.latest_charge && p.latest_charge.balance_transaction;
      if (bt && Number.isFinite(bt.fee)) return bt.fee;
    }
    if (charge) {
      const c = await stripe(env, 'GET', `/v1/charges/${charge}`, { expand: ['balance_transaction'] });
      if (c.balance_transaction && Number.isFinite(c.balance_transaction.fee)) return c.balance_transaction.fee;
    }
  } catch (e) { console.error('stripe fee', e.message); }
  return estimateFee(amount);
}

// A sale: record it with the developer's 90% of what's left after Stripe's fee and tax.
async function recordSale(DB, env, o, { ref, gross, tax = 0, pi, charge }) {
  const g = await getGame(DB, o.game);
  const fee = gross > 0 ? await feeFor(env, { pi, charge }, gross) : 0;
  const net = Math.max(0, gross - tax - fee);
  await addLedger(DB, { developer: g?.owner_id, game: o.game, kind: 'store', ref, gross, dev: Math.floor(net * SPLIT.store), available: now() + HOLD_DAYS * DAY });
}

/* ---------- Stripe webhooks ---------- */

const metaOrder = obj => obj?.metadata?.order || obj?.subscription_details?.metadata?.order || obj?.parent?.subscription_details?.metadata?.order || null;
const getOrder = (DB, id) => (id ? DB.prepare('SELECT * FROM orders WHERE id = ?').bind(String(id)).first() : null);

export async function handleStripeEvent(DB, env, ev) {
  const fresh = await DB.prepare('INSERT OR IGNORE INTO stripe_events (id, type, at) VALUES (?, ?, ?)').bind(String(ev.id), String(ev.type), now()).run();
  if (!fresh.meta || !fresh.meta.changes) return { duplicate: true };
  const obj = ev.data && ev.data.object || {};
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      if (obj.metadata?.kind === 'promo') return obj.payment_status === 'paid' ? startPromotion(DB, env, obj) : { ok: true, waiting: true };
      const o = await getOrder(DB, obj.client_reference_id || metaOrder(obj));
      if (!o || o.status === 'paid') return { ok: true };
      if (obj.payment_status !== 'paid' && obj.payment_status !== 'no_payment_required') return { ok: true, waiting: true };
      await DB.prepare(`UPDATE orders SET status = 'paid', paid_at = ?, stripe_pi = ?, stripe_sub = ?, amount_cents = ? WHERE id = ?`)
        .bind(now(), obj.payment_intent || null, obj.subscription || null, obj.amount_total ?? o.amount_cents, o.id).run();
      if (o.kind === 'pass') {
        // The first invoice records the sale and sets the exact period; until then, a month.
        await grant(DB, o.player_id, o.game, o.sku, 'cash', now() + 32 * DAY, o.id);
      } else {
        await grant(DB, o.player_id, o.game, o.sku, 'cash', null, o.id);
        await recordSale(DB, env, o, { ref: 'pi:' + (obj.payment_intent || o.id), gross: obj.amount_total ?? o.amount_cents, tax: obj.total_details?.amount_tax || 0, pi: obj.payment_intent });
      }
      return { ok: true, fulfilled: o.id };
    }
    case 'invoice.paid': {
      const sub = typeof obj.subscription === 'string' ? obj.subscription : obj.parent?.subscription_details?.subscription || null;
      let o = await getOrder(DB, metaOrder(obj) || obj.lines?.data?.[0]?.metadata?.order);
      if (!o && sub) o = await DB.prepare('SELECT * FROM orders WHERE stripe_sub = ?').bind(sub).first();
      if (!o) return { ok: true, unknown: true };
      if (sub && !o.stripe_sub) await DB.prepare('UPDATE orders SET stripe_sub = ? WHERE id = ?').bind(sub, o.id).run();
      const end = Math.max(...(obj.lines?.data || []).map(l => (l.period?.end || 0) * 1000), now() + 31 * DAY);
      await grant(DB, o.player_id, o.game, o.sku, 'cash', end + DAY, o.id); // a day's grace for renewals
      const tax = obj.tax ?? (obj.total_taxes || []).reduce((a, t) => a + (t.amount || 0), 0);
      await recordSale(DB, env, o, { ref: 'in:' + obj.id, gross: obj.amount_paid || 0, tax: tax || 0, charge: typeof obj.charge === 'string' ? obj.charge : null });
      return { ok: true, renewed: o.id };
    }
    case 'customer.subscription.deleted': {
      const o = await getOrder(DB, metaOrder(obj)) || await DB.prepare('SELECT * FROM orders WHERE stripe_sub = ?').bind(String(obj.id)).first();
      if (o) {
        const end = (obj.current_period_end || obj.items?.data?.[0]?.current_period_end || 0) * 1000 || now();
        await DB.prepare('UPDATE entitlements SET expires_at = ?, updated_at = ? WHERE player_id = ? AND game = ? AND sku = ? AND source = ?').bind(end, now(), o.player_id, o.game, o.sku, 'cash').run();
      }
      return { ok: true };
    }
    case 'charge.refunded': return refund(DB, obj);
    case 'account.updated': {
      const ready = obj.payouts_enabled && (obj.capabilities?.transfers === 'active') ? 1 : 0;
      await DB.prepare('UPDATE developers SET payouts_ready = ? WHERE stripe_account = ?').bind(ready, String(obj.id)).run();
      return { ok: true, ready: !!ready };
    }
  }
  return { ok: true, ignored: ev.type };
}

// A refund takes the same share back from the developer, at once (it isn't held). A full
// refund also takes the item or pass away.
async function refund(DB, charge) {
  const refs = [charge.payment_intent && 'pi:' + charge.payment_intent, charge.invoice && 'in:' + charge.invoice].filter(Boolean);
  const sale = refs.length ? await DB.prepare(`SELECT * FROM ledger WHERE kind = 'store' AND ref IN (${refs.map(() => '?').join(', ')})`).bind(...refs).first() : null;
  if (!sale) return { ok: true, unknown: true };
  const want = -Math.floor(sale.dev_cents * Math.min(1, (charge.amount_refunded || 0) / Math.max(1, charge.amount || sale.gross_cents)));
  const already = await DB.prepare(`SELECT COALESCE(SUM(dev_cents), 0) AS n FROM ledger WHERE kind = 'refund' AND ref LIKE ?`).bind(`${sale.ref}#%`).first();
  if (want < already.n) await addLedger(DB, { developer: sale.developer, game: sale.game, kind: 'refund', ref: `${sale.ref}#${charge.amount_refunded}`, gross: -(charge.amount_refunded || 0), dev: want - already.n });
  if (charge.refunded) {
    const o = charge.payment_intent ? await DB.prepare('SELECT * FROM orders WHERE stripe_pi = ?').bind(charge.payment_intent).first() : null;
    if (o) { await DB.prepare(`UPDATE orders SET status = 'refunded' WHERE id = ?`).bind(o.id).run(); await revoke(DB, o.player_id, o.game, o.sku); }
  }
  return { ok: true, refunded: sale.ref };
}

/* ---------- ad revenue ---------- */

// Sponsor views are priced by the campaign, so a month closes from our own counts.
export async function closeSponsorMonth(DB, month) {
  const [y, m] = month.split('-').map(Number);
  const from = Date.UTC(y, m - 1, 1), to = Date.UTC(y, m, 1);
  if (to > now()) fail(400, 'That month isn\'t over yet.');
  const rows = (await DB.prepare(`SELECT v.game, COUNT(*) AS views, SUM(c.cpm_cents) AS milli FROM ad_views v JOIN campaigns c ON c.id = v.campaign
    WHERE v.source = 'sponsor' AND v.status = 'done' AND v.started_at >= ? AND v.started_at < ? GROUP BY v.game`).bind(from, to).all()).results;
  const out = [];
  for (const r of rows) {
    const gross = Math.floor(r.milli / 1000);
    const g = await getGame(DB, r.game);
    await DB.prepare('INSERT OR IGNORE INTO ad_reports (month, game, source, views, gross_cents, at) VALUES (?, ?, ?, ?, ?, ?)').bind(month, r.game, 'sponsor', r.views, gross, now()).run();
    if (await addLedger(DB, { developer: g?.owner_id, game: r.game, kind: 'ads', ref: `sponsor:${month}:${r.game}`, gross, dev: Math.floor(gross * SPLIT.ads), month })) out.push({ game: r.game, views: r.views, grossCents: gross });
  }
  return { month, games: out };
}

// The ad network pays the portal monthly. Enter what it actually paid for the month, either per
// game or as one total that's split by each game's share of completed network ads.
export async function importNetworkReport(DB, { month, grossCents, rows }) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) fail(400, 'month is like "2026-11".');
  if (await DB.prepare(`SELECT 1 FROM ad_reports WHERE month = ? AND source = 'network' LIMIT 1`).bind(month).first()) fail(409, `The network report for ${month} is already in.`);
  const [y, m] = month.split('-').map(Number);
  const views = (await DB.prepare(`SELECT game, COUNT(*) AS n FROM ad_views WHERE source = 'network' AND status = 'done' AND started_at >= ? AND started_at < ? GROUP BY game`)
    .bind(Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)).all()).results;
  let split;
  if (Array.isArray(rows) && rows.length) split = rows.map(r => ({ game: String(r.game), gross: Math.max(0, Math.round(Number(r.grossCents)) || 0), views: views.find(v => v.game === r.game)?.n || 0 }));
  else {
    const total = Math.max(0, Math.round(Number(grossCents)) || 0), all = views.reduce((a, v) => a + v.n, 0);
    if (!all) fail(400, `No network ads were counted in ${month}, so there's nothing to split. Pass rows per game instead.`);
    // Largest remainder, so the parts add up to the total exactly.
    split = views.map(v => ({ game: v.game, views: v.n, exact: total * v.n / all })).map(r => ({ ...r, gross: Math.floor(r.exact) }));
    let left = total - split.reduce((a, r) => a + r.gross, 0);
    for (const r of [...split].sort((a, b) => (b.exact % 1) - (a.exact % 1))) { if (left-- <= 0) break; r.gross++; }
  }
  for (const r of split) {
    const g = await getGame(DB, r.game);
    if (!g) fail(404, `There's no game called "${r.game}".`);
    await DB.prepare('INSERT INTO ad_reports (month, game, source, views, gross_cents, at) VALUES (?, ?, ?, ?, ?, ?)').bind(month, r.game, 'network', r.views, r.gross, now()).run();
    await addLedger(DB, { developer: g.owner_id, game: r.game, kind: 'ads', ref: `network:${month}:${r.game}`, gross: r.gross, dev: Math.floor(r.gross * SPLIT.ads), month });
  }
  return { month, games: split.map(r => ({ game: r.game, views: r.views, grossCents: r.gross, devCents: Math.floor(r.gross * SPLIT.ads) })) };
}

/* ---------- developer balances and payouts ---------- */

export async function balances(DB, pid) {
  const t = now();
  const r = await DB.prepare(`SELECT COALESCE(SUM(CASE WHEN available_at <= ? THEN dev_cents ELSE 0 END), 0) AS available,
    COALESCE(SUM(CASE WHEN available_at > ? THEN dev_cents ELSE 0 END), 0) AS pending FROM ledger WHERE developer = ? AND payout_id IS NULL`).bind(t, t, pid).first();
  const paid = await DB.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payouts WHERE developer = ? AND status = 'sent'`).bind(pid).first();
  return { availableCents: r.available, pendingCents: r.pending, paidCents: paid.n, minimumCents: PAYOUT_MIN_CENTS, holdDays: HOLD_DAYS };
}

export async function payoutStatus(DB, pid) {
  const d = await DB.prepare('SELECT stripe_account, payouts_ready FROM developers WHERE player_id = ?').bind(pid).first();
  const history = (await DB.prepare('SELECT id, amount_cents, status, error, created_at FROM payouts WHERE developer = ? ORDER BY created_at DESC LIMIT 24').bind(pid).all()).results;
  return { connected: !!d?.stripe_account, ready: !!d?.payouts_ready, ...(await balances(DB, pid)), payouts: history.map(p => ({ id: p.id, amountCents: p.amount_cents, status: p.status, error: p.error, at: p.created_at })) };
}

// A Stripe Express account for the developer, and a link to finish setting it up.
export async function connectLink(DB, env, site, pid, { country } = {}) {
  const d = await DB.prepare('SELECT * FROM developers WHERE player_id = ?').bind(pid).first();
  if (!d) fail(403, 'Become a developer first.');
  let acct = d.stripe_account;
  if (!acct) {
    const p = await getPlayer(DB, pid);
    const cc = /^[A-Z]{2}$/.test(String(country || '').toUpperCase()) ? String(country).toUpperCase() : 'US';
    const a = await stripe(env, 'POST', '/v1/accounts', {
      type: 'express', country: cc, email: p?.email || undefined,
      capabilities: { transfers: { requested: true } },
      // Outside the US, developers are paid as recipients: they get transfers but don't sell on Stripe.
      tos_acceptance: cc === 'US' ? undefined : { service_agreement: 'recipient' },
      business_profile: { product_description: 'Games published on RookieGamers', url: site },
      metadata: { player: pid },
    }, { idempotencyKey: 'acct-' + pid });
    acct = a.id;
    await DB.prepare('UPDATE developers SET stripe_account = ? WHERE player_id = ?').bind(acct, pid).run();
  }
  const link = await stripe(env, 'POST', '/v1/account_links', { account: acct, type: 'account_onboarding', refresh_url: `${site}/dev/payouts/connect`, return_url: `${site}/dev/payouts/return` });
  return { url: link.url };
}

export async function refreshAccount(DB, env, pid) {
  const d = await DB.prepare('SELECT stripe_account FROM developers WHERE player_id = ?').bind(pid).first();
  if (!d?.stripe_account) return { connected: false };
  const a = await stripe(env, 'GET', `/v1/accounts/${d.stripe_account}`);
  const ready = a.payouts_enabled && a.capabilities?.transfers === 'active' ? 1 : 0;
  await DB.prepare('UPDATE developers SET payouts_ready = ? WHERE player_id = ?').bind(ready, pid).run();
  return { connected: true, ready: !!ready };
}

// Pays every developer whose cleared balance is at least $10. Runs on the 1st, or by hand.
export async function runPayouts(DB, env, { dryRun = false } = {}) {
  const t = now();
  const devs = (await DB.prepare('SELECT player_id, stripe_account FROM developers WHERE stripe_account IS NOT NULL AND payouts_ready = 1').all()).results;
  const out = [];
  for (const d of devs) {
    const rows = (await DB.prepare('SELECT id, dev_cents FROM ledger WHERE developer = ? AND payout_id IS NULL AND available_at <= ?').bind(d.player_id, t).all()).results;
    const amount = rows.reduce((a, r) => a + r.dev_cents, 0);
    if (amount < PAYOUT_MIN_CENTS) { out.push({ developer: d.player_id, amountCents: amount, paid: false, reason: 'under-minimum' }); continue; }
    if (dryRun) { out.push({ developer: d.player_id, amountCents: amount, paid: false, reason: 'dry-run' }); continue; }
    const id = newId('po', 20);
    // Claim the rows first, so a second run at the same time can't pay them again.
    for (let i = 0; i < rows.length; i += 50) {
      const part = rows.slice(i, i + 50);
      await DB.prepare(`UPDATE ledger SET payout_id = ? WHERE payout_id IS NULL AND id IN (${part.map(() => '?').join(', ')})`).bind(id, ...part.map(r => r.id)).run();
    }
    const claimed = await DB.prepare('SELECT COALESCE(SUM(dev_cents), 0) AS n FROM ledger WHERE payout_id = ?').bind(id).first();
    try {
      const tr = await stripe(env, 'POST', '/v1/transfers', { amount: claimed.n, currency: 'usd', destination: d.stripe_account, transfer_group: id, description: 'RookieGamers payout', metadata: { payout: id, player: d.player_id } }, { idempotencyKey: id });
      await DB.prepare('INSERT INTO payouts (id, developer, amount_cents, status, transfer, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, d.player_id, claimed.n, 'sent', tr.id, now()).run();
      out.push({ developer: d.player_id, amountCents: claimed.n, paid: true, payout: id, transfer: tr.id });
    } catch (e) {
      // Give the rows back so the next run tries again.
      await DB.prepare('UPDATE ledger SET payout_id = NULL WHERE payout_id = ?').bind(id).run();
      await DB.prepare('INSERT INTO payouts (id, developer, amount_cents, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, d.player_id, claimed.n, 'failed', String(e.message).slice(0, 300), now()).run();
      out.push({ developer: d.player_id, amountCents: claimed.n, paid: false, reason: 'failed', error: e.message });
    }
  }
  return { at: t, dryRun, payouts: out };
}

// Revenue for one game by month: store sales, ads, refunds and the developer's share.
export async function gameMoney(DB, slug) {
  const rows = (await DB.prepare(`SELECT month, kind, COALESCE(SUM(gross_cents), 0) AS gross, COALESCE(SUM(dev_cents), 0) AS dev FROM ledger WHERE game = ? GROUP BY month, kind ORDER BY month DESC`).bind(slug).all()).results;
  const months = {};
  for (const r of rows) { const m = months[r.month] ||= { month: r.month, storeCents: 0, adsCents: 0, refundsCents: 0, devCents: 0 }; m[{ store: 'storeCents', ads: 'adsCents', refund: 'refundsCents' }[r.kind] || 'otherCents'] = r.gross; m.devCents += r.dev; }
  const since = now() - 30 * DAY;
  const ads = (await DB.prepare(`SELECT format, source, COUNT(*) AS n FROM ad_views WHERE game = ? AND status = 'done' AND started_at > ? GROUP BY format, source`).bind(slug, since).all()).results;
  const sales = await DB.prepare(`SELECT COUNT(*) AS n FROM orders WHERE game = ? AND status = 'paid' AND paid_at > ?`).bind(slug, since).first();
  return { months: Object.values(months), last30Days: { adViews: ads.map(a => ({ format: a.format, source: a.source, views: a.n })), sales: sales.n }, split: { store: SPLIT.store, ads: SPLIT.ads } };
}

export async function portalMoney(DB) {
  const rows = (await DB.prepare(`SELECT month, kind, COALESCE(SUM(gross_cents), 0) AS gross, COALESCE(SUM(dev_cents), 0) AS dev FROM ledger GROUP BY month, kind ORDER BY month DESC LIMIT 60`).all()).results;
  const owed = await DB.prepare('SELECT COALESCE(SUM(dev_cents), 0) AS n FROM ledger WHERE payout_id IS NULL AND developer IS NOT NULL').first();
  return { months: rows.map(r => ({ month: r.month, kind: r.kind, grossCents: r.gross, devCents: r.dev, portalCents: r.gross - r.dev })), owedToDevelopersCents: owed.n };
}

/* ---------- the monthly run ---------- */

export async function monthlyMoney(DB, env, month) {
  const out = {};
  try { out.sponsors = await closeSponsorMonth(DB, month); } catch (e) { out.sponsors = { error: e.message }; }
  if (stripeReady(env)) out.payouts = await runPayouts(DB, env);
  return out;
}

export { StripeError };
