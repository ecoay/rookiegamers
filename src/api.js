import { now, getGame, getPlayer, publicPlayer, gameView, monthKey, sha256, cleanText } from './db.js';
import { sessionPlayer, signOut, emailStart, providers } from './auth.js';
import { signToken, verifyToken, TOKEN_TTL } from './tokens.js';
import { gameEvent, submitScore, topScores, rankOf, fame, playNext, frontPage, sealIfDue } from './play.js';
import * as dev from './dev.js';
import { createShare } from './growth.js';
import { deleteAccount } from './account.js';
import { SHOWN, EARN, iconURI, ownedIcons, claimEarned, buyIcon, equipIcon, pickIcon, canPick } from './icons.js';
import { moneyV1, moneyDev } from './money-api.js';

export const json = (data, status = 200, extra = {}) => {
  const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra });
  if (extra['set-cookie']) { h.delete('set-cookie'); for (const c of [].concat(extra['set-cookie'])) if (c) h.append('set-cookie', c); }
  return new Response(JSON.stringify(data), { status, headers: h });
};
export async function readJSON(req) { try { return await req.json(); } catch { return {}; } }

/* ---------- /api/v1: what the SDK calls, from any game origin ---------- */

// The SDK API authenticates with Bearer tokens, never cookies, so it's safe to open to any origin.
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' };
export const cjson = (data, status = 200) => { if (data && 'status' in data) { const { status: _, ...rest } = data; data = rest; } return json(data, status, CORS); };

export async function bearerPlayer(DB, env, req, game) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.get('authorization') || '');
  if (!m || m[1].startsWith('rgs_') || m[1].startsWith('rgk_')) return null;
  const c = await verifyToken(DB, env, m[1], { aud: game });
  // Ad and purchase receipts are signed with the same keys but are never player tokens.
  return c && !c.use ? c.sub : null;
}

// Mint a player token for a game. Called from the portal itself (same origin, session cookie).
export async function mintFor(DB, env, pid, slug) {
  const p = await getPlayer(DB, pid);
  if (!p) return null;
  const user = { ...publicPlayer(p), gems: p.gems };
  const token = await signToken(DB, env, { sub: pid, aud: slug, name: p.name });
  return { token, exp: Math.floor(now() / 1000) + TOKEN_TTL, user };
}

export async function apiV1(req, env, DB, url) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const path = url.pathname.slice('/api/v1'.length), method = req.method;

  // Token for the framed game. Same-origin only: the SDK never calls this, the portal page does.
  if (path === '/token' && method === 'POST') {
    const site = req.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin') return json({ error: 'Not allowed.' }, 403);
    const g = await getGame(DB, String((await readJSON(req)).game || ''));
    if (!g) return json({ error: 'Unknown game.' }, 404);
    const pid = await sessionPlayer(DB, req);
    return json(pid ? await mintFor(DB, env, pid, g.slug) : { token: null, user: null });
  }

  if (path.startsWith('/games/') && method === 'GET') {
    const g = await getGame(DB, path.slice(7));
    return g && g.live ? cjson({ game: gameView(g) }) : cjson({ error: 'Unknown game.' }, 404);
  }
  if (path === '/games' && method === 'GET') return cjson({ games: await frontPage(DB) });

  if (path === '/events' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g) return cjson({ error: 'Unknown game.' }, 404);
    const pid = await bearerPlayer(DB, env, req, g.slug);
    const r = await gameEvent(DB, g, { type: String(b.type || ''), play: b.play, ref: b.ref, playerId: pid });
    return cjson(r, r.error ? 400 : 200);
  }

  if (path === '/scores' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g) return cjson({ error: 'Unknown game.' }, 404);
    const auth = req.headers.get('authorization') || '';
    // A game's server, with its secret key, reporting for a player.
    if (/^Bearer rgs_/.test(auth)) {
      if (!g.key_hash || await sha256(auth.slice(7).trim()) !== g.key_hash) return cjson({ error: 'Wrong server key.' }, 401);
      const pid = String(b.player || '');
      if (!await getPlayer(DB, pid)) return cjson({ error: 'Unknown player.' }, 404);
      const r = await submitScore(DB, g, pid, b.score, { trusted: true });
      return cjson(r, r.status);
    }
    const pid = await bearerPlayer(DB, env, req, g.slug);
    if (!pid) return cjson({ error: 'Sign in to save scores.', signin: true }, 401);
    const r = await submitScore(DB, g, pid, b.score, { trusted: false });
    return cjson(r, r.status);
  }

  let m;
  if ((m = path.match(/^\/scores\/([a-z0-9-]{1,32})(\/me)?$/)) && method === 'GET') {
    const g = await getGame(DB, m[1]);
    if (!g) return cjson({ error: 'Unknown game.' }, 404);
    const board = url.searchParams.get('board') === 'alltime' ? 'all' : (/^\d{4}-\d{2}$/.test(url.searchParams.get('month') || '') ? url.searchParams.get('month') : monthKey());
    if (m[2]) {
      const pid = await bearerPlayer(DB, env, req, g.slug);
      if (!pid) return cjson({ error: 'Sign in first.', signin: true }, 401);
      const row = await DB.prepare('SELECT score FROM scores WHERE game = ? AND month = ? AND player_id = ?').bind(g.slug, board, pid).first();
      return cjson({ rank: row ? await rankOf(DB, g, board, pid) : null, score: row ? row.score : null });
    }
    return cjson({ board: board === 'all' ? 'alltime' : 'monthly', month: board === 'all' ? null : board, label: g.score_label, rows: await topScores(DB, g, board, Number(url.searchParams.get('limit')) || 10) });
  }

  if (path === '/fame' && method === 'GET') {
    await sealIfDue(DB);
    const slug = url.searchParams.get('game');
    return cjson({ rows: await fame(DB, { game: slug && /^[a-z0-9-]{1,32}$/.test(slug) ? slug : null }) });
  }

  if (path === '/promo' && method === 'GET') {
    const slug = String(url.searchParams.get('game') || '');
    const pid = slug ? await bearerPlayer(DB, env, req, slug) : null;
    return cjson({ game: await playNext(DB, slug, pid) });
  }

  // A share link. With a player token it credits the player; without one it's the plain game link.
  if (path === '/shares' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g || !g.live) return cjson({ error: 'Unknown game.' }, 404);
    const pid = await bearerPlayer(DB, env, req, g.slug);
    const r = await createShare(DB, dev.siteURL(env), g, pid, b);
    return cjson(r, r.status || 200);
  }

  if ((m = path.match(/^\/players\/(p[a-f0-9]{20})$/)) && method === 'GET') {
    const p = await getPlayer(DB, m[1]);
    return p ? cjson({ player: publicPlayer(p) }) : cjson({ error: 'Unknown player.' }, 404);
  }

  // Ads and the store.
  if (path.startsWith('/ads/') || path.startsWith('/store/')) {
    const r = await moneyV1(req, env, DB, url, path);
    if (r) return r;
  }
  return cjson({ error: 'Not found' }, 404);
}

/* ---------- /api: the portal's own pages (same origin, session cookie) ---------- */

export async function apiPortal(req, env, DB, url) {
  const path = url.pathname, method = req.method;
  // Browsers only send JSON cross-site after a CORS preflight we never grant, so this blocks CSRF.
  if (method !== 'GET' && !(req.headers.get('content-type') || '').includes('application/json')) return json({ error: 'Send JSON.' }, 415);
  const pid = await sessionPlayer(DB, req);

  if (path === '/api/me' && method === 'GET') {
    const p = pid && await getPlayer(DB, pid);
    return json({ me: p ? { ...publicPlayer(p), gems: p.gems, email: p.email, developer: await dev.isDeveloper(DB, pid) } : null, providers: providers(env) });
  }
  // The portal's own share button and the share sheet for framed games.
  if (path === '/api/share' && method === 'POST') {
    const b = await readJSON(req);
    const g = await getGame(DB, String(b.game || ''));
    if (!g || !g.live) return json({ error: 'Unknown game.' }, 404);
    const r = await createShare(DB, dev.siteURL(env), g, pid, b);
    return json(r, r.status || 200);
  }
  if (path === '/api/auth/email' && method === 'POST') {
    const r = await emailStart(DB, env, req, await readJSON(req));
    return json(r, r.status);
  }
  if (path === '/api/auth/signout' && method === 'POST') return json({ ok: true }, 200, { 'set-cookie': await signOut(DB, req) });
  if (!pid) return json({ error: 'Sign in first.', signin: true }, 401);

  // The Diamond Shop: platform icons bought with gems, or earned by milestones.
  if (path === '/api/shop' && method === 'GET') {
    const p = await getPlayer(DB, pid);
    await claimEarned(DB, p);
    const owned = await ownedIcons(DB, pid);
    const pickable = canPick(p, owned);
    return json({ gems: p.gems, equipped: p.icon || null, icons: SHOWN.map(i => ({ id: i.id, name: i.name, price: i.price || null, earn: i.earn ? EARN[i.earn] : null, owned: !!owned[i.id], pickable: !!(i.pick && pickable[i.pick]), image: iconURI(i) })) });
  }
  if (path === '/api/shop/pick' && method === 'POST') {
    const r = await pickIcon(DB, await getPlayer(DB, pid), String((await readJSON(req)).icon || ''));
    return json(r, r.status);
  }
  if (path === '/api/shop/buy' && method === 'POST') {
    const r = await buyIcon(DB, pid, String((await readJSON(req)).icon || ''));
    return json(r, r.status);
  }
  if (path === '/api/shop/equip' && method === 'POST') {
    const r = await equipIcon(DB, pid, String((await readJSON(req)).icon || ''));
    return json(r, r.status);
  }
  // Deleting the account is final. The body must say {"confirm":"DELETE"} so it can't happen by accident.
  if (path === '/api/me/delete' && method === 'POST') {
    const b = await readJSON(req);
    if (b.confirm !== 'DELETE') return json({ error: 'Type DELETE to confirm.' }, 400);
    const r = await deleteAccount(DB, pid);
    return json(r, r.status, r.ok ? { 'set-cookie': await signOut(DB, req) } : {});
  }
  if (path === '/api/me' && method === 'POST') {
    const b = await readJSON(req);
    const sets = [], vals = [];
    const name = cleanText(b.name, 18);
    if (name.length >= 2) { sets.push('name = ?'); vals.push(name); }
    if (Number.isFinite(Number(b.hue))) { sets.push('hue = ?'); vals.push(Math.abs(Number(b.hue) | 0) % 360); }
    if (b.title !== undefined) {
      const own = b.title && await DB.prepare('SELECT 1 FROM titles WHERE player_id = ? AND title = ?').bind(pid, String(b.title)).first();
      sets.push('title = ?'); vals.push(own ? String(b.title) : null);
    }
    // 18+ unlocks the optional crypto layer later. It's a self-declaration, recorded with a time.
    if (b.adult === true) { sets.push('adult_at = COALESCE(adult_at, ?)'); vals.push(now()); }
    if (sets.length) await DB.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, pid).run();
    return json({ me: publicPlayer(await getPlayer(DB, pid)) });
  }

  if (path === '/api/dev/join' && method === 'POST') {
    return devCall(async () => { await dev.becomeDeveloper(DB, env, pid, (await readJSON(req)).invite); return { ok: true }; });
  }
  if (path === '/api/dev/keys' && method === 'GET') return json({ keys: await dev.listKeys(DB, pid) });
  if (path === '/api/dev/keys' && method === 'POST') return devCall(async () => ({ key: await dev.createKey(DB, pid, (await readJSON(req)).label) }));
  if (path === '/api/dev/keys' && method === 'DELETE') { await dev.deleteKey(DB, pid, (await readJSON(req)).prefix); return json({ ok: true }); }

  return json({ error: 'Not found' }, 404);
}
async function devCall(fn) {
  try { return json(await fn()); } catch (e) {
    if (e instanceof dev.DevError) return json({ error: e.message }, e.status);
    throw e;
  }
}

/* ---------- /api/dev: the developer API (Bearer rgk_ key, or the portal session) ---------- */

export async function apiDev(req, env, DB, url, { admin = false } = {}) {
  const path = url.pathname.replace(/^\/api\/(dev|admin)/, ''), method = req.method;
  let pid = null;
  if (!admin) {
    pid = await dev.keyPlayer(DB, req);
    if (!pid) {
      // The /dev page uses the session cookie; it sends JSON or PUTs a file, which browsers only send
      // cross-site after a CORS preflight this API never grants, so cross-site requests can't reach here.
      const s = await sessionPlayer(DB, req);
      if (s && await dev.isDeveloper(DB, s) && (method === 'GET' || method === 'PUT' || (req.headers.get('content-type') || '').includes('application/json'))) pid = s;
    }
    if (!pid) return json({ error: 'Send a developer API key: Authorization: Bearer rgk_... (make one at /dev).' }, 401);
  }
  try {
    let m;
    if (path === '/games' && method === 'GET') return json({ games: admin ? (await DB.prepare('SELECT * FROM games ORDER BY created_at').all()).results.map(dev.devGameView) : await dev.myGames(DB, pid) });
    if (path === '/games' && method === 'POST' && !admin) return json({ game: await dev.createGame(DB, pid, await readJSON(req)) }, 201);
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})$/)) && method === 'PATCH') return json({ game: await dev.updateGame(DB, pid, m[1], await readJSON(req), admin) });
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/builds$/)) && method === 'GET') return json({ builds: await dev.listBuilds(DB, pid, m[1], admin) });
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/builds\/([^/]{1,40})\/files\/(.+)$/)) && method === 'PUT') {
      const size = Number(req.headers.get('content-length'));
      const body = Number.isFinite(size) && size > 0 ? req.body : await req.arrayBuffer();
      const len = Number.isFinite(size) && size > 0 ? size : body.byteLength;
      return json(await dev.putFile(DB, env, pid, m[1], m[2], decodeURIComponent(m[3]), body, len, admin));
    }
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/publish$/)) && method === 'POST') {
      const r = await dev.publish(DB, env, pid, m[1], (await readJSON(req)).version, admin);
      return json(r, r.live ? 200 : 422);
    }
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/unpublish$/)) && method === 'POST') return json(await dev.unpublish(DB, pid, m[1], admin));
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/server-key$/)) && method === 'POST') return json({ key: await dev.rotateServerKey(DB, pid, m[1], admin) });
    if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/stats$/)) && method === 'GET') return json(await dev.stats(DB, pid, m[1], admin));

    if (admin) {
      if (path === '/invites' && method === 'POST') return json({ invite: await dev.createInvite(DB, (await readJSON(req)).note), url: `${dev.siteURL(env)}/dev?invite=` });
      if ((m = path.match(/^\/games\/([a-z0-9-]{1,32})\/owner$/)) && method === 'POST') {
        const b = await readJSON(req);
        const p = await DB.prepare('SELECT id FROM players WHERE email = ? OR id = ?').bind(String(b.email || '').toLowerCase(), String(b.player || '')).first();
        if (!p) return json({ error: 'No player with that email or id. They need to sign in once first.' }, 404);
        await dev.becomeDeveloper(DB, { OPEN_DEVELOPERS: '1' }, p.id);
        await DB.prepare('UPDATE games SET owner_id = ? WHERE slug = ?').bind(p.id, m[1]).run();
        return json({ ok: true, owner: p.id });
      }
    }
    // Products, ad review, revenue and payouts.
    const r = await moneyDev(req, env, DB, url, path, pid, admin);
    if (r) return r;
  } catch (e) {
    if (e instanceof dev.DevError) return json({ error: e.message }, e.status);
    throw e;
  }
  return json({ error: 'Not found' }, 404);
}

