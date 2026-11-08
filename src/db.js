// D1 holds players, sign-in identities, sessions, games, plays, scores and the Hall of Fame.
// The schema is applied on first use, so a fresh database needs no migration step.

import { SEED_GAMES } from './catalog.js';
import { migrateMoney } from './money.js';
import { ICON, iconURI, refundRetired, keepWornRookie } from './icons.js';
import { FRAME } from './frames.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, name TEXT NOT NULL, hue INTEGER NOT NULL DEFAULT 0, email TEXT UNIQUE,
    xp INTEGER NOT NULL DEFAULT 0, title TEXT, adult_at INTEGER, gems INTEGER NOT NULL DEFAULT 0, referred_by TEXT, ref_paid INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, seen_at INTEGER NOT NULL)`,
  // Gems: the portal's reward currency, for linking social accounts and bringing friends. One row per
  // reward; (player, reason, ref) is unique so each reward pays once. Gems are not money and never
  // turn into coin or cash.
  `CREATE TABLE IF NOT EXISTS gems (player_id TEXT NOT NULL, reason TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL,
    at INTEGER NOT NULL, PRIMARY KEY (player_id, reason, ref))`,
  `CREATE INDEX IF NOT EXISTS gems_reason ON gems(reason, at)`,
  // Share links (/s/<id>). Each one credits the player who shared it for visits and sign-ups.
  `CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, game TEXT NOT NULL, score INTEGER, room TEXT, text TEXT,
    clicks INTEGER NOT NULL DEFAULT 0, signups INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS shares_game ON shares(game, created_at)`,
  `CREATE INDEX IF NOT EXISTS shares_player ON shares(player_id, created_at)`,
  // The crypto layer is opt-in and 18+ only (players.adult_at set). Nothing here is needed to play.
  `CREATE TABLE IF NOT EXISTS wallets (player_id TEXT NOT NULL, chain TEXT NOT NULL, address TEXT NOT NULL, verified_at INTEGER NOT NULL,
    PRIMARY KEY (chain, address))`,
  `CREATE INDEX IF NOT EXISTS wallets_player ON wallets(player_id)`,
  // One row per way to sign in. provider is 'email' (subject = the address), 'scenespot', or a social
  // network such as 'google' or 'discord' (subject = that network's user id). Linking one is a new row.
  `CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, player_id TEXT NOT NULL, profile TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS identities_player ON identities(player_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_player ON sessions(player_id)`,
  `CREATE TABLE IF NOT EXISTS login_tokens (token TEXT PRIMARY KEY, email TEXT NOT NULL, next TEXT, expires_at INTEGER NOT NULL)`,
  // Signing keys for player tokens. Games verify tokens against /.well-known/jwks.json.
  `CREATE TABLE IF NOT EXISTS keys (kid TEXT PRIMARY KEY, private_jwk TEXT NOT NULL, public_jwk TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  // coin: the developer opted this game into the RookieGamers coin (Solana). Off by default, and
  // payout_wallet is where their coin share goes. Games with coin off sell for cash and ads only.
  // kind: 'hosted' (files in R2 under <slug>/) or 'linked' (url points at the game's own site).
  // origins: JSON list of origins the game runs on, for postMessage, CORS and the sign-in popup.
  // score_mode: 'best' keeps each player's best score; 'sum' adds up points (server reports only).
  `CREATE TABLE IF NOT EXISTS games (slug TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, url TEXT, origins TEXT NOT NULL DEFAULT '[]',
    developer TEXT NOT NULL, blurb TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', cover TEXT, color TEXT,
    devices TEXT NOT NULL DEFAULT 'both', multiplayer INTEGER NOT NULL DEFAULT 0, score_label TEXT NOT NULL DEFAULT 'Score',
    score_mode TEXT NOT NULL DEFAULT 'best', score_order TEXT NOT NULL DEFAULT 'desc', max_score INTEGER, key_hash TEXT,
    live INTEGER NOT NULL DEFAULT 1, owner_id TEXT, version TEXT, coin INTEGER NOT NULL DEFAULT 0, payout_wallet TEXT, released_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS games_owner ON games(owner_id)`,
  // Developers publish games. Becoming one takes an invite code (or OPEN_DEVELOPERS=1).
  `CREATE TABLE IF NOT EXISTS developers (player_id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS dev_invites (code TEXT PRIMARY KEY, note TEXT, used_by TEXT, created_at INTEGER NOT NULL)`,
  // API keys for the developer API, the CLI and the MCP server. Only the hash is stored.
  `CREATE TABLE IF NOT EXISTS dev_keys (hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, label TEXT NOT NULL, prefix TEXT NOT NULL,
    created_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS dev_keys_player ON dev_keys(player_id)`,
  // Uploaded builds. Files live in R2 at <slug>/<version>/<path>; games.version is the live one.
  `CREATE TABLE IF NOT EXISTS builds (game TEXT NOT NULL, version TEXT NOT NULL, files INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
    entry TEXT NOT NULL DEFAULT 'index.html', created_at INTEGER NOT NULL, PRIMARY KEY (game, version))`,
  // One row per page load of a game. ref is the game that sent the player here (cross-promo).
  `CREATE TABLE IF NOT EXISTS plays (id TEXT PRIMARY KEY, game TEXT NOT NULL, player_id TEXT, ref TEXT, started_at INTEGER NOT NULL,
    ms INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS plays_game ON plays(game, started_at)`,
  `CREATE INDEX IF NOT EXISTS plays_player ON plays(player_id, game)`,
  `CREATE TABLE IF NOT EXISTS scores (game TEXT NOT NULL, month TEXT NOT NULL, player_id TEXT NOT NULL, score INTEGER NOT NULL,
    at INTEGER NOT NULL, PRIMARY KEY (game, month, player_id))`,
  `CREATE INDEX IF NOT EXISTS scores_rank ON scores(game, month, score)`,
  // month = 'all' holds the all-time board.
  `CREATE TABLE IF NOT EXISTS hall (game TEXT NOT NULL, month TEXT NOT NULL, rank INTEGER NOT NULL, player_id TEXT NOT NULL, name TEXT NOT NULL,
    score INTEGER NOT NULL, PRIMARY KEY (game, month, rank))`,
  `CREATE TABLE IF NOT EXISTS titles (player_id TEXT NOT NULL, title TEXT NOT NULL, game TEXT, month TEXT, at INTEGER NOT NULL, PRIMARY KEY (player_id, title))`,
  // Profile icons a player owns. source: 'shop' (bought with gems), 'earned' (a milestone) or 'minted'.
  `CREATE TABLE IF NOT EXISTS icons_owned (player_id TEXT NOT NULL, icon TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (player_id, icon))`,
  // Icon frames a player owns (src/frames.js), same sources as icons.
  `CREATE TABLE IF NOT EXISTS frames_owned (player_id TEXT NOT NULL, frame TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (player_id, frame))`,
  `CREATE TABLE IF NOT EXISTS submits (game TEXT NOT NULL, player_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (game, player_id))`,
];

// Columns added after a table first shipped. Each runs once; "duplicate column" means it's there.
const COLUMNS = [
  'ALTER TABLE players ADD COLUMN gems INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE players ADD COLUMN referred_by TEXT',
  'ALTER TABLE players ADD COLUMN ref_paid INTEGER NOT NULL DEFAULT 0',
  // wallet: 'none', 'optional' or 'required' (an onchain game). Unset means optional for coin games.
  'ALTER TABLE games ADD COLUMN wallet TEXT',
  // featured_at: set by the portal (admin) to feature a game at the top of the home page. Null is not featured.
  'ALTER TABLE games ADD COLUMN featured_at INTEGER',
  // icon: the profile icon the player picked (src/icons.js). Null shows their letter avatar.
  'ALTER TABLE players ADD COLUMN icon TEXT',
  // frame: the icon frame the player wears (src/frames.js). Null is no frame.
  'ALTER TABLE players ADD COLUMN frame TEXT',
];

export async function migrate(DB) {
  await DB.batch(SCHEMA.map(s => DB.prepare(s)));
  for (const c of COLUMNS) { try { await DB.prepare(c).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
  await DB.prepare('CREATE INDEX IF NOT EXISTS players_referred ON players(referred_by)').run();
  await migrateMoney(DB);
  await refundRetired(DB);
  await keepWornRookie(DB);
  // Hand of Nine moved from an uploaded build to a standalone site the portal links and frames.
  await DB.prepare("UPDATE games SET kind = 'linked', url = 'https://handofnine.com/', origins = '[\"https://handofnine.com\"]' WHERE slug = 'handofnine' AND kind = 'hosted'").run();
  const t = now();
  await DB.batch(SEED_GAMES.map(g => DB.prepare(
    `INSERT OR IGNORE INTO games (slug, title, kind, url, origins, developer, blurb, tags, color, devices, multiplayer, score_label, score_mode, score_order, max_score, live, released_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    g.slug, g.title, g.kind, g.url || null, JSON.stringify(g.origins || []), g.developer, g.blurb || '', JSON.stringify(g.tags || []), g.color || null,
    g.devices || 'both', g.multiplayer ? 1 : 0, g.score_label || 'Score', g.score_mode || 'best', g.score_order || 'desc', g.max_score ?? null, g.live === false || !g.url ? 0 : 1, t, t)));
}

let ready = null;
export function db(env) {
  if (!env.DB) return null;
  if (!ready) ready = migrate(env.DB).catch(e => { ready = null; throw e; });
  return ready.then(() => env.DB);
}

export const now = () => Date.now();
export const DAY = 24 * 3600 * 1000;
export const monthKey = (t = now()) => new Date(t).toISOString().slice(0, 7);
export function prevMonth(m) { const [y, mo] = m.split('-').map(Number); return monthKey(Date.UTC(y, mo - 2, 15)); }
export function monthLabel(m) { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1, 15)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }); }
export const newId = (prefix, n = 20) => prefix + [...crypto.getRandomValues(new Uint8Array(n / 2))].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function safeJSON(s, fallback = {}) { try { return JSON.parse(s) ?? fallback; } catch { return fallback; } }
export const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

/* ---------- players ---------- */

export async function createPlayer(DB, { name, hue, email = null } = {}) {
  const id = newId('p');
  await DB.prepare('INSERT INTO players (id, name, hue, email, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, cleanText(name, 18) || 'rookie' + Math.floor(1000 + Math.random() * 9000), Number.isFinite(hue) ? hue : Math.floor(Math.random() * 360), email, now(), now()).run();
  return id;
}

export const getPlayer = (DB, id) => DB.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();

// Portal level grows from playtime and scores in any game. Level n needs 50 * n * (n - 1) XP.
export const levelFor = xp => Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2);

export function publicPlayer(p) {
  if (!p) return null;
  return { id: p.id, name: p.name, hue: p.hue, avatar: avatarFor(p), frame: FRAME[p.frame] ? p.frame : null, level: levelFor(p.xp), xp: p.xp, title: p.title || null, guild: null, adult: !!p.adult_at };
}

// The player's chosen platform icon, or a generated letter avatar. Never a social media picture.
export function avatarFor(p) {
  if (p.icon && ICON[p.icon]) return iconURI(p.icon);
  const letter = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="hsl(${p.hue} 70% 55%)"/><text x="32" y="42" font-family="system-ui,sans-serif" font-size="30" font-weight="700" text-anchor="middle" fill="#fff">${letter.replace(/[<>&"]/g, '')}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/* ---------- games ---------- */

export function gameView(g) {
  if (!g) return null;
  return {
    slug: g.slug, title: g.title, kind: g.kind, url: g.url, origins: safeJSON(g.origins, []), developer: g.developer, blurb: g.blurb,
    tags: safeJSON(g.tags, []), cover: g.cover, color: g.color, devices: g.devices, multiplayer: !!g.multiplayer,
    scoreLabel: g.score_label, scoreMode: g.score_mode, scoreOrder: g.score_order, coin: !!g.coin, wallet: g.wallet || (g.coin ? 'optional' : 'none'), featured: !!g.featured_at, releasedAt: g.released_at,
  };
}

export const getGame = (DB, slug) => DB.prepare('SELECT * FROM games WHERE slug = ?').bind(slug).first();
export async function liveGames(DB) { return (await DB.prepare('SELECT * FROM games WHERE live = 1').all()).results; }
