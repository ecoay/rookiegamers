import { now, newId, sha256, cleanText, safeJSON, getGame, gameView } from './db.js';
import { SLUG_RE, RESERVED } from './catalog.js';
import { gameStats, topScores } from './play.js';

// The developer side: invites, API keys, games, builds and publishing. The REST API, the CLI and
// the MCP server all call these, so an AI agent and a person get exactly the same powers.

export const MAX_BUILD_BYTES = 100 * 1024 * 1024;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_GAMES = 20;
const VERSION_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/i;
const PATH_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\-/ @()+]{1,200}$/;
const ORIGIN_RE = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

export class DevError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, msg) => { throw new DevError(status, msg); };

/* ---------- developers and keys ---------- */

export const isDeveloper = async (DB, pid) => !!(pid && await DB.prepare('SELECT 1 FROM developers WHERE player_id = ?').bind(pid).first());

export async function becomeDeveloper(DB, env, pid, code) {
  if (await isDeveloper(DB, pid)) return true;
  const p = await DB.prepare('SELECT name FROM players WHERE id = ?').bind(pid).first();
  if (env.OPEN_DEVELOPERS !== '1') {
    const inv = code && await DB.prepare('SELECT * FROM dev_invites WHERE code = ? AND used_by IS NULL').bind(String(code)).first();
    if (!inv) fail(403, 'Publishing is invite-only for now. Ask for a developer invite link.');
    await DB.prepare('UPDATE dev_invites SET used_by = ? WHERE code = ?').bind(pid, inv.code).run();
  }
  await DB.prepare('INSERT OR IGNORE INTO developers (player_id, name, created_at) VALUES (?, ?, ?)').bind(pid, p?.name || 'developer', now()).run();
  return true;
}

export async function createInvite(DB, note) {
  const code = newId('inv_', 20);
  await DB.prepare('INSERT INTO dev_invites (code, note, created_at) VALUES (?, ?, ?)').bind(code, cleanText(note, 80) || null, now()).run();
  return code;
}

export async function createKey(DB, pid, label) {
  if (!await isDeveloper(DB, pid)) fail(403, 'Only developers can make API keys.');
  const n = await DB.prepare('SELECT COUNT(*) AS n FROM dev_keys WHERE player_id = ?').bind(pid).first();
  if (n.n >= 10) fail(400, 'You have 10 keys already. Delete one first.');
  const key = newId('rgk_', 40);
  await DB.prepare('INSERT INTO dev_keys (hash, player_id, label, prefix, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(key), pid, cleanText(label, 40) || 'key', key.slice(0, 10), now()).run();
  return key;
}

export async function listKeys(DB, pid) {
  return (await DB.prepare('SELECT prefix, label, created_at, used_at FROM dev_keys WHERE player_id = ? ORDER BY created_at DESC').bind(pid).all()).results;
}
export async function deleteKey(DB, pid, prefix) {
  await DB.prepare('DELETE FROM dev_keys WHERE player_id = ? AND prefix = ?').bind(pid, String(prefix)).run();
}

// Bearer rgk_... → the developer's player id, or null.
export async function keyPlayer(DB, req) {
  const m = /^Bearer\s+(rgk_[a-f0-9]{40})$/i.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  const hash = await sha256(m[1]);
  const row = await DB.prepare('SELECT player_id, used_at FROM dev_keys WHERE hash = ?').bind(hash).first();
  if (!row || !await isDeveloper(DB, row.player_id)) return null;
  if (!row.used_at || now() - row.used_at > 60000) await DB.prepare('UPDATE dev_keys SET used_at = ? WHERE hash = ?').bind(now(), hash).run();
  return row.player_id;
}

/* ---------- games ---------- */

async function ownGame(DB, pid, slug, admin) {
  const g = await getGame(DB, String(slug || ''));
  if (!g) fail(404, `There's no game called "${slug}".`);
  if (!admin && g.owner_id !== pid) fail(403, 'That game belongs to another developer.');
  return g;
}

function cleanGame(b, existing) {
  const out = {};
  if (b.title !== undefined) { out.title = cleanText(b.title, 40); if (out.title.length < 2) fail(400, 'Give the game a title of at least 2 characters.'); }
  if (b.blurb !== undefined) out.blurb = cleanText(b.blurb, 280);
  if (b.tags !== undefined) out.tags = JSON.stringify([].concat(b.tags).map(t => cleanText(t, 20).toLowerCase()).filter(Boolean).slice(0, 8));
  if (b.color !== undefined) out.color = /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : null;
  if (b.cover !== undefined) out.cover = /^https:\/\/[^\s"'<>]{1,400}$/.test(b.cover) || /^[A-Za-z0-9._\-/]{1,200}$/.test(b.cover) ? b.cover : null;
  if (b.devices !== undefined) out.devices = ['mobile', 'desktop', 'both'].includes(b.devices) ? b.devices : 'both';
  if (b.multiplayer !== undefined) out.multiplayer = b.multiplayer ? 1 : 0;
  if (b.coin !== undefined) out.coin = b.coin ? 1 : 0;
  // How a game uses wallets. 'required' puts it in the Web3 Arcade (18+ players only).
  if (b.wallet !== undefined) out.wallet = ['none', 'optional', 'required'].includes(b.wallet) ? b.wallet : null;
  if (b.payoutWallet !== undefined) {
    if (b.payoutWallet && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(b.payoutWallet)) fail(400, 'That doesn\'t look like a Solana address.');
    out.payout_wallet = b.payoutWallet || null;
  }
  if (b.scoreLabel !== undefined) out.score_label = cleanText(b.scoreLabel, 20) || 'Score';
  if (b.scoreOrder !== undefined) out.score_order = b.scoreOrder === 'asc' ? 'asc' : 'desc';
  if (b.scoreMode !== undefined) out.score_mode = b.scoreMode === 'sum' ? 'sum' : 'best';
  if (b.maxScore !== undefined) out.max_score = b.maxScore == null || b.maxScore === '' ? null : Math.max(0, Math.round(Number(b.maxScore)) || 0);
  if (b.url !== undefined) {
    if (b.url && !/^https:\/\/[^\s"'<>]{1,400}$/.test(b.url) && !/^http:\/\/localhost[:/]/.test(b.url)) fail(400, 'A linked game needs an https URL.');
    out.url = b.url || null;
  }
  if (b.origins !== undefined) {
    const list = [].concat(b.origins).map(String).filter(o => ORIGIN_RE.test(o)).map(o => o.toLowerCase()).slice(0, 5);
    out.origins = JSON.stringify(list);
  }
  const kind = b.kind ?? existing?.kind;
  if (kind === 'linked' && !(out.url ?? existing?.url)) fail(400, 'A linked game needs its URL.');
  return out;
}

export async function createGame(DB, pid, b) {
  if (!await isDeveloper(DB, pid)) fail(403, 'Become a developer first.');
  const slug = String(b.slug || '').toLowerCase();
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) fail(400, 'Pick a slug of 1 to 32 lowercase letters, numbers and dashes, like "sky-harvest".');
  if (await getGame(DB, slug)) fail(409, `The slug "${slug}" is taken. Try another.`);
  const n = await DB.prepare('SELECT COUNT(*) AS n FROM games WHERE owner_id = ?').bind(pid).first();
  if (n.n >= MAX_GAMES) fail(400, `Developers can have up to ${MAX_GAMES} games for now.`);
  const kind = b.kind === 'linked' ? 'linked' : 'hosted';
  const f = cleanGame({ title: b.title || slug, ...b, kind });
  if (b.studio !== undefined) f.studio = await checkStudio(DB, pid, b.studio, false);
  if (kind === 'linked' && !f.origins) f.origins = JSON.stringify([new URL(f.url).origin]);
  const dev = await DB.prepare('SELECT name FROM developers WHERE player_id = ?').bind(pid).first();
  const cols = { slug, kind, developer: dev?.name || 'developer', owner_id: pid, live: 0, released_at: now(), created_at: now(), ...f };
  await DB.prepare(`INSERT INTO games (${Object.keys(cols).join(', ')}) VALUES (${Object.keys(cols).map(() => '?').join(', ')})`).bind(...Object.values(cols)).run();
  return devGameView(await getGame(DB, slug));
}

export async function updateGame(DB, pid, slug, b, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  const f = cleanGame(b, g);
  if (b.studio !== undefined) f.studio = await checkStudio(DB, pid, b.studio, admin);
  if (admin && b.developer !== undefined) f.developer = cleanText(b.developer, 40);
  if (admin && b.kind !== undefined) f.kind = b.kind === 'linked' ? 'linked' : 'hosted';
  // Featuring is the portal's call, not the developer's. The most recently featured game shows first.
  if (admin && b.featured !== undefined) f.featured_at = b.featured ? (g.featured_at || now()) : null;
  if (!Object.keys(f).length) return devGameView(g);
  await DB.prepare(`UPDATE games SET ${Object.keys(f).map(k => `${k} = ?`).join(', ')} WHERE slug = ?`).bind(...Object.values(f), g.slug).run();
  return devGameView(await getGame(DB, g.slug));
}

export async function myGames(DB, pid) {
  return (await DB.prepare('SELECT * FROM games WHERE owner_id = ? ORDER BY created_at DESC').bind(pid).all()).results.map(devGameView);
}

export function devGameView(g) {
  return { ...gameView(g), payoutWallet: g.payout_wallet, live: !!g.live, status: gameStatus(g), version: g.version, maxScore: g.max_score, hasServerKey: !!g.key_hash,
    review: g.review ? { status: g.review, note: g.review_note || null, version: g.review_version || null, at: g.review_at || null } : null };
}

// 'live', 'pending' (in the review queue), 'rejected' (turned down, see review.note) or 'draft'.
export const gameStatus = g => g.live ? 'live' : g.review === 'pending' ? 'pending' : g.review === 'rejected' ? 'rejected' : 'draft';

// A secret for the game's own server, used to report trusted scores. Shown once.
export async function rotateServerKey(DB, pid, slug, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  const key = newId('rgs_', 40);
  await DB.prepare('UPDATE games SET key_hash = ? WHERE slug = ?').bind(await sha256(key), g.slug).run();
  return key;
}

/* ---------- cover art ---------- */

const COVER_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };
export const MAX_COVER_BYTES = 5 * 1024 * 1024;

// Upload a cover image (raw body). It's stored in R2 under _covers/ and served from /covers/ on the
// portal, and the game's cover points at it. Each upload gets a new name, so caches never go stale.
// Store an uploaded image in R2 as <prefix>/<slug>/<random>.<ext> and return its file name.
async function putImage(env, prefix, slug, body, type, size) {
  if (!env.GAMES) fail(503, 'Image storage isn\'t set up (no R2 bucket bound).');
  const ext = COVER_TYPES[String(type || '').split(';')[0].trim().toLowerCase()];
  if (!ext) fail(415, 'Images can be PNG, JPEG, WebP, GIF or AVIF.');
  if (!(size > 0)) fail(400, 'The image is empty.');
  if (size > MAX_COVER_BYTES) fail(413, 'Images can be up to 5 MB.');
  const name = `${newId('', 12)}.${ext}`;
  await env.GAMES.put(`${prefix}/${slug}/${name}`, body, { httpMetadata: { contentType: Object.keys(COVER_TYPES).find(t => COVER_TYPES[t] === ext) } });
  return name;
}

export async function putCover(DB, env, pid, slug, body, type, size, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  const name = await putImage(env, '_covers', g.slug, body, type, size);
  const cover = `${siteURL(env)}/covers/${g.slug}/${name}`;
  await DB.prepare('UPDATE games SET cover = ? WHERE slug = ?').bind(cover, g.slug).run();
  return { cover };
}

/* ---------- game studios ---------- */

export const STUDIO_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const getStudio = (DB, slug) => DB.prepare('SELECT * FROM studios WHERE slug = ?').bind(String(slug || '')).first();
export const studioView = s => s && { slug: s.slug, name: s.name, logo: s.logo || null, url: s.url || null, bio: s.bio || '', owner: s.owner_id || null };

// A developer's own studios, or every studio for an admin.
export async function listStudios(DB, pid, admin = false) {
  const q = admin ? DB.prepare('SELECT * FROM studios ORDER BY name') : DB.prepare('SELECT * FROM studios WHERE owner_id = ? ORDER BY name').bind(pid);
  return (await q.all()).results.map(studioView);
}

async function ownStudio(DB, pid, slug, admin) {
  const s = await getStudio(DB, slug);
  if (!s) fail(404, `There's no studio called "${slug}".`);
  if (!admin && s.owner_id !== pid) fail(403, 'That studio belongs to another developer.');
  return s;
}

// Create a studio (new slug) or update one you own: { slug, name, url, bio }.
export async function saveStudio(DB, pid, b, admin = false) {
  if (!admin && !await isDeveloper(DB, pid)) fail(403, 'Become a developer first.');
  const slug = String(b.slug || '').toLowerCase().trim();
  const f = {};
  if (b.name !== undefined) { f.name = cleanText(b.name, 40); if (f.name.length < 2) fail(400, 'Give the studio a name of at least 2 characters.'); }
  if (b.bio !== undefined) f.bio = cleanText(b.bio, 500);
  if (b.url !== undefined) {
    if (b.url && !/^https:\/\/[^\s"'<>]{1,300}$/.test(b.url)) fail(400, 'The studio website needs to be an https link.');
    f.url = b.url || null;
  }
  const s = await getStudio(DB, slug);
  if (s) {
    await ownStudio(DB, pid, slug, admin);
    if (Object.keys(f).length) await DB.prepare(`UPDATE studios SET ${Object.keys(f).map(k => `${k} = ?`).join(', ')} WHERE slug = ?`).bind(...Object.values(f), slug).run();
  } else {
    if (!STUDIO_SLUG_RE.test(slug)) fail(400, 'Pick a studio link name of lowercase letters, numbers and dashes, like "tenacie-games".');
    if (!f.name) fail(400, 'Give the studio a name.');
    if (!admin) {
      const n = await DB.prepare('SELECT COUNT(*) AS n FROM studios WHERE owner_id = ?').bind(pid).first();
      if (n.n >= 5) fail(400, 'Developers can have up to 5 studios for now.');
    }
    await DB.prepare('INSERT INTO studios (slug, name, owner_id, url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(slug, f.name, admin ? (b.owner || pid || null) : pid, f.url ?? null, f.bio ?? '', now()).run();
  }
  return studioView(await getStudio(DB, slug));
}

export async function putStudioLogo(DB, env, pid, slug, body, type, size, admin = false) {
  const s = await ownStudio(DB, pid, slug, admin);
  const name = await putImage(env, '_logos', s.slug, body, type, size);
  const logo = `${siteURL(env)}/logos/${s.slug}/${name}`;
  await DB.prepare('UPDATE studios SET logo = ? WHERE slug = ?').bind(logo, s.slug).run();
  return { logo };
}

export async function deleteStudio(DB, pid, slug, admin = false) {
  const s = await ownStudio(DB, pid, slug, admin);
  await DB.batch([DB.prepare('UPDATE games SET studio = NULL WHERE studio = ?').bind(s.slug), DB.prepare('DELETE FROM studios WHERE slug = ?').bind(s.slug)]);
  return { ok: true };
}

// Credit a game to a studio. Developers can pick their own studios; admins any.
async function checkStudio(DB, pid, studio, admin) {
  if (!studio) return null;
  await ownStudio(DB, pid, studio, admin);
  return String(studio);
}

/* ---------- builds ---------- */

export async function putFile(DB, env, pid, slug, version, path, body, size, admin = false) {
  if (!env.GAMES) fail(503, 'Game hosting isn\'t set up (no R2 bucket bound).');
  const g = await ownGame(DB, pid, slug, admin);
  if (!VERSION_RE.test(version)) fail(400, 'Versions are up to 40 letters, numbers, dots and dashes, like "1.0.3".');
  if (!PATH_RE.test(path)) fail(400, `"${path}" isn't an allowed file path.`);
  if (g.version === version && g.live) fail(409, `Version ${version} is live. Upload a new version, then publish it.`);
  // The build in the review queue is frozen, so what goes live is what was reviewed.
  if (g.review === 'pending' && g.review_version === version) fail(409, `Version ${version} is waiting for review. Upload a new version, then publish it.`);
  if (size > MAX_FILE_BYTES) fail(413, 'Files can be up to 25 MB each.');
  const key = `${g.slug}/${version}/${path}`;
  const [b, old] = await Promise.all([DB.prepare('SELECT bytes FROM builds WHERE game = ? AND version = ?').bind(g.slug, version).first(), env.GAMES.head(key)]);
  if ((b?.bytes || 0) - (old?.size || 0) + size > MAX_BUILD_BYTES) fail(413, 'A build can be up to 100 MB.');
  await env.GAMES.put(key, body, { httpMetadata: { contentType: contentType(path) } });
  await DB.prepare(`INSERT INTO builds (game, version, files, bytes, created_at) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT (game, version) DO UPDATE SET files = files + ?, bytes = bytes + ?`).bind(g.slug, version, size, now(), old ? 0 : 1, size - (old?.size || 0)).run();
  return { path, bytes: size };
}

export async function listBuilds(DB, pid, slug, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  return (await DB.prepare('SELECT version, files, bytes, entry, created_at FROM builds WHERE game = ? ORDER BY created_at DESC LIMIT 20').bind(g.slug).all()).results
    .map(b => ({ ...b, live: b.version === g.version && !!g.live }));
}

// Checks that run before a build goes live. They catch the common mistakes an agent or a person
// makes: no index.html, no SDK, or ad code from outside the portal.
// Sign-in SDKs a game can't ship on RookieGamers. Matched on how they load or sign in, so a game
// can still use, say, Firebase or Supabase for data.
const OTHER_LOGINS = [
  ['Google Sign-In', /accounts\.google\.com\/gsi\/client|apis\.google\.com\/js\/platform\.js|google\.accounts\.id\.initialize/],
  ['Firebase Auth', /firebase-auth(?:-compat)?\.js|["']firebase\/auth["']|\bsignInWithPopup\b|\bsignInWithRedirect\b|\bsignInWithEmailAndPassword\b/],
  ['Supabase Auth', /\.auth\.signIn(?:WithOAuth|WithPassword|WithOtp)?\(/],
  ['Auth0', /cdn\.auth0\.com|auth0-spa-js|\bcreateAuth0Client\b/],
  ['Clerk', /clerk\.browser\.js|@clerk\/clerk-js|\bClerk\.load\(/],
  ['Sign in with Apple', /appleid\.cdn-apple\.com|AppleID\.auth\.init/],
  ['Facebook Login', /connect\.facebook\.net\/[^"']*\/sdk\.js|\bFB\.login\(/],
  ['Discord login', /discord\.com\/(?:api\/)?oauth2\/authorize/],
  ['Twitch login', /id\.twitch\.tv\/oauth2\/authorize/],
  ['Magic', /\bnew Magic\(|auth\.magic\.link/],
  ['Privy', /@privy-io\/|auth\.privy\.io/],
];

export async function checkBuild(env, slug, version) {
  const problems = [], warnings = [];
  const index = await env.GAMES.get(`${slug}/${version}/index.html`);
  if (!index) return { ok: false, problems: ['The build has no index.html at its root.'], warnings };
  const html = await index.text();
  if (!/\/sdk\/v1\.js/.test(html)) warnings.push('index.html doesn\'t load the SDK (/sdk/v1.js). Sign-in, scores and "play next" won\'t work.');
  if (!/<meta[^>]+name=["']viewport/i.test(html)) warnings.push('No viewport meta tag, so the game may not fit phone screens.');
  if (/googlesyndication|adsbygoogle|doubleclick\.net|imasdk\.googleapis|adinplay|gamemonetize|gamedistribution/i.test(html)) problems.push('The build includes outside ad code. The portal serves ads for every game, so remove it.');
  // The RookieGamers account is the only sign-in on RookieGamers. Look through the page and its scripts.
  const code = [html];
  const listed = await env.GAMES.list({ prefix: `${slug}/${version}/`, limit: 1000 });
  for (const o of listed.objects.filter(o => /\.(m?js|html?)$/i.test(o.key) && !o.key.endsWith('/index.html') && o.size < 4e6).slice(0, 60)) {
    const f = await env.GAMES.get(o.key);
    if (f) code.push(await f.text());
  }
  const login = OTHER_LOGINS.filter(([, re]) => code.some(c => re.test(c))).map(([name]) => name);
  if (login.length) problems.push(`The build has its own sign-in (${login.join(', ')}). On RookieGamers, players sign in with their RookieGamers account only: use rg.user.login() and rg.user.token(), and remove the other sign-in.`);
  return { ok: !problems.length, problems, warnings };
}

// A developer's first game waits in the portal's review queue. Once the portal approves one of
// their games, later games and updates go live as soon as they pass the checks. The REST API, the
// CLI and the MCP server all publish through here, so the queue covers every way in.
export async function isTrusted(DB, pid) {
  if (!pid) return false;
  const d = await DB.prepare(`SELECT approved_at, EXISTS (SELECT 1 FROM games WHERE owner_id = d.player_id AND live = 1) AS has_live
    FROM developers d WHERE player_id = ?`).bind(pid).first();
  return !!(d && (d.approved_at || d.has_live));
}

const REVIEW_MESSAGE = 'Your first game is in the review queue. We play every developer\'s first game before it goes live, usually within a day or two. Once it\'s approved, your later games and updates go live right after the checks.';

export async function publish(DB, env, pid, slug, version, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  let check = { problems: [], warnings: [] };
  if (g.kind === 'hosted') {
    if (!version) version = (await DB.prepare('SELECT version FROM builds WHERE game = ? ORDER BY created_at DESC LIMIT 1').bind(g.slug).first())?.version;
    if (!version) fail(400, 'Upload a build before publishing.');
    if (!await DB.prepare('SELECT 1 FROM builds WHERE game = ? AND version = ?').bind(g.slug, version).first()) fail(404, `There's no build ${version}.`);
    check = await checkBuild(env, g.slug, version);
    if (!check.ok) return { live: false, ...check };
  } else version = undefined;
  // Staging (env.STAGING) is for testing, so nothing waits for review there.
  if (!admin && !g.live && env.STAGING !== '1' && !await isTrusted(DB, g.owner_id)) {
    await DB.prepare("UPDATE games SET review = 'pending', review_version = ?, review_note = NULL, review_at = ? WHERE slug = ?").bind(version || null, now(), g.slug).run();
    return { live: false, pending: true, ...(version ? { version } : {}), ...check, message: REVIEW_MESSAGE };
  }
  await goLive(DB, g, version);
  // The portal publishing a game for its developer counts as approving them.
  if (admin && g.owner_id) await trust(DB, g.owner_id);
  return { live: true, ...(version ? { version } : {}), ...check, url: `${siteURL(env)}/play/${g.slug}` };
}

async function goLive(DB, g, version) {
  const review = "review = CASE WHEN review IS NULL THEN NULL ELSE 'approved' END, review_version = NULL";
  if (g.kind === 'hosted') await DB.prepare(`UPDATE games SET version = ?, live = 1, ${review}, released_at = CASE WHEN live = 0 AND version IS NULL THEN ? ELSE released_at END WHERE slug = ?`).bind(version, now(), g.slug).run();
  else await DB.prepare(`UPDATE games SET live = 1, ${review}, released_at = CASE WHEN live = 0 THEN ? ELSE released_at END WHERE slug = ?`).bind(now(), g.slug).run();
}

const trust = (DB, pid) => DB.prepare('UPDATE developers SET approved_at = COALESCE(approved_at, ?) WHERE player_id = ?').bind(now(), pid).run();

/* ---------- the review queue (admin) ---------- */

// A signed link that plays a hosted build that isn't live yet, so the portal can try it before
// approving. Only someone holding ADMIN_TOKEN can make one.
export async function previewSig(env, slug, version) {
  if (!env.ADMIN_TOKEN) return null;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`preview:${slug}:${version}`));
  return [...new Uint8Array(sig)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function previewURL(env, slug, version) {
  const sig = await previewSig(env, slug, version);
  if (!sig) return null;
  const base = env.GAMES_HOST ? `https://${env.GAMES_HOST}` : `${siteURL(env)}/hosted`;
  return `${base}/${slug}/~${sig}/${encodeURIComponent(version)}/?rg_test=1`;
}

export async function reviewQueue(DB, env) {
  const rows = (await DB.prepare(`SELECT g.*, p.email AS owner_email, d.name AS dev_name FROM games g
    LEFT JOIN players p ON p.id = g.owner_id LEFT JOIN developers d ON d.player_id = g.owner_id
    WHERE g.review = 'pending' ORDER BY g.review_at`).all()).results;
  const out = [];
  for (const g of rows) {
    const item = { slug: g.slug, title: g.title, kind: g.kind, blurb: g.blurb, tags: safeJSON(g.tags, []), developer: g.dev_name || g.developer,
      ownerEmail: g.owner_email || null, submittedAt: g.review_at, wallet: g.wallet || null, coin: !!g.coin };
    if (g.kind === 'hosted') {
      item.version = g.review_version;
      item.previewUrl = await previewURL(env, g.slug, g.review_version);
      if (env.GAMES) item.warnings = (await checkBuild(env, g.slug, g.review_version)).warnings;
    } else item.url = g.url;
    out.push(item);
  }
  return out;
}

// The portal's call on a game in the queue: approve puts it live and trusts its developer from then
// on; reject keeps it off the portal and tells the developer why.
export async function reviewGame(DB, env, slug, { status, note } = {}) {
  const g = await getGame(DB, String(slug || ''));
  if (!g) fail(404, `There's no game called "${slug}".`);
  if (g.review !== 'pending') fail(400, `${g.title} isn't waiting for review.`);
  if (status === 'approved') {
    if (g.kind === 'hosted' && !await DB.prepare('SELECT 1 FROM builds WHERE game = ? AND version = ?').bind(g.slug, g.review_version || '').first()) fail(404, `The build ${g.review_version} is gone. Ask the developer to publish again.`);
    await goLive(DB, g, g.review_version);
    await DB.prepare('UPDATE games SET review_note = ?, review_at = ? WHERE slug = ?').bind(cleanText(note, 300) || null, now(), g.slug).run();
    if (g.owner_id) await trust(DB, g.owner_id);
    return { live: true, review: 'approved', url: `${siteURL(env)}/play/${g.slug}` };
  }
  if (status === 'rejected') {
    const why = cleanText(note, 300);
    if (!why) fail(400, 'Say why, so the developer can fix it: { "status": "rejected", "note": "..." }.');
    await DB.prepare("UPDATE games SET review = 'rejected', review_note = ?, review_at = ? WHERE slug = ?").bind(why, now(), g.slug).run();
    return { live: false, review: 'rejected', note: why };
  }
  fail(400, 'Send { "status": "approved" } or { "status": "rejected", "note": "why" }.');
}

export async function unpublish(DB, pid, slug, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  // Taking down a game that's waiting for review withdraws it from the queue.
  await DB.prepare("UPDATE games SET live = 0, review = CASE WHEN review = 'pending' THEN NULL ELSE review END WHERE slug = ?").bind(g.slug).run();
  return { live: false };
}

export async function stats(DB, pid, slug, admin = false) {
  const g = await ownGame(DB, pid, slug, admin);
  return { ...(await gameStats(DB, g.slug)), top: await topScores(DB, g, undefined, 10) };
}

export const siteURL = env => (env.SITE_URL || 'https://rookiegamers.com').replace(/\/$/, '');

const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json', map: 'application/json', txt: 'text/plain; charset=utf-8', xml: 'application/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
  wasm: 'application/wasm', data: 'application/octet-stream', bin: 'application/octet-stream', glb: 'model/gltf-binary', gltf: 'model/gltf+json',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', webmanifest: 'application/manifest+json',
};
export const contentType = path => TYPES[(path.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

