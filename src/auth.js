import { createPlayer, newId, sha256, now, safeJSON, cleanText } from './db.js';
import { GEMS, linkGems, grantGems, recordReferral, VIA_COOKIE, SHARE_COOKIE } from './growth.js';

// Portal sign-in. Players sign in with an email link, SceneSpot (any OpenID Connect provider set
// through OIDC_* secrets), or a social network (NETWORKS below). The OAuth networks are each switched
// on by their <NAME>_CLIENT_ID and <NAME>_CLIENT_SECRET secrets. Steam, Bluesky and Telegram use
// their own protocols (social-extra.js); Steam and Bluesky need no keys at all. Each way to sign in is an identity
// row pointing at one player, and linking another network to your account earns gems.

const COOKIE = 'rg_sid';
const YEAR = 365 * 24 * 3600;
const LINK_TTL = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,}$/i;

export function cookies(req) {
  const out = {};
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}
const isSecure = req => new URL(req.url).protocol === 'https:';
export const setCookie = (req, name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isSecure(req) ? '; Secure' : ''}`;

export const redirect = (to, setCookies = []) => {
  const h = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const c of setCookies) if (c) h.append('set-cookie', c);
  return new Response(null, { status: 302, headers: h });
};

// Only same-site paths are allowed as a place to return to after sign-in.
export const safeNext = n => (typeof n === 'string' && /^\/(?![/\\])[^\s]*$/.test(n) ? n.slice(0, 500) : '/');

export async function sessionPlayer(DB, req) {
  const tok = cookies(req)[COOKIE];
  if (!tok || tok.length < 20) return null;
  const row = await DB.prepare('SELECT player_id FROM sessions WHERE token = ?').bind(await sha256(tok)).first();
  return row ? row.player_id : null;
}

export async function newSession(DB, req, playerId) {
  const tok = newId('', 48);
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, ?)').bind(await sha256(tok), playerId, now()).run();
  await DB.prepare('UPDATE players SET seen_at = ? WHERE id = ?').bind(now(), playerId).run();
  return setCookie(req, COOKIE, tok, YEAR);
}

export async function signOut(DB, req) {
  const tok = cookies(req)[COOKIE];
  if (tok) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(await sha256(tok)).run();
  return setCookie(req, COOKIE, '', 0);
}

// Social networks. OpenID Connect ones are found by discovery; the others list their endpoints and
// how to read a user from their API. Redirect URI for each: https://rookiegamers.com/auth/<id>/callback
const NETWORKS = {
  google: { name: 'Google', issuer: 'https://accounts.google.com', scope: 'openid profile email' },
  discord: {
    name: 'Discord', scope: 'identify email', authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', userinfo: 'https://discord.com/api/users/@me',
    user: u => ({ sub: u.id, name: u.global_name || u.username, handle: u.username, email: u.verified ? u.email : null, picture: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null }),
  },
  x: {
    name: 'X', scope: 'users.read tweet.read', authorize: 'https://twitter.com/i/oauth2/authorize', token: 'https://api.twitter.com/2/oauth2/token',
    userinfo: 'https://api.twitter.com/2/users/me?user.fields=profile_image_url', basicAuth: true,
    user: j => ({ sub: j.data && j.data.id, name: j.data && j.data.name, handle: j.data && j.data.username, picture: j.data && j.data.profile_image_url }),
  },
  twitch: { name: 'Twitch', issuer: 'https://id.twitch.tv/oauth2', scope: 'openid' },
  facebook: {
    name: 'Facebook', scope: 'public_profile', authorize: 'https://www.facebook.com/v19.0/dialog/oauth', token: 'https://graph.facebook.com/v19.0/oauth/access_token',
    userinfo: 'https://graph.facebook.com/v19.0/me?fields=id,name,picture.type(large)', pkce: false, tokenInQuery: true,
    user: u => ({ sub: u.id, name: u.name, picture: u.picture && u.picture.data && !u.picture.data.is_silhouette ? u.picture.data.url : null }),
  },
  // Instagram API with Unified Login: Meta's required flow for new apps. It runs through the
  // Facebook Login for Business dialog on the Meta (Facebook) app's own ID and secret, with the
  // permissions set in a login configuration (INSTAGRAM_CONFIG_ID) instead of a scope. It works for
  // Instagram professional (Business and Creator) accounts, and needs Meta's app review for the public.
  instagram: {
    name: 'Instagram', keys: 'FACEBOOK', configEnv: 'INSTAGRAM_CONFIG_ID',
    authorize: 'https://www.facebook.com/dialog/oauth', token: 'https://graph.facebook.com/v26.0/oauth/access_token', tokenGet: true,
    userinfo: 'https://graph.facebook.com/v26.0/me/assigned_instagram_accounts?fields=id,username', pkce: false, tokenInQuery: true,
    user: j => { const a = j.data && j.data[0]; return a ? { sub: String(a.id), name: a.username, handle: a.username } : null; },
  },
  threads: {
    name: 'Threads', scope: 'threads_basic', authorize: 'https://threads.net/oauth/authorize', token: 'https://graph.threads.net/oauth/access_token',
    userinfo: 'https://graph.threads.net/v1.0/me?fields=id,username,name,threads_profile_picture_url', pkce: false, tokenInQuery: true,
    user: u => ({ sub: u.id, name: u.name || u.username, handle: u.username, picture: u.threads_profile_picture_url || null }),
  },
  // TikTok calls the client id "client_key" and splits scopes with commas.
  tiktok: {
    name: 'TikTok', scope: 'user.info.basic', authorize: 'https://www.tiktok.com/v2/auth/authorize/', token: 'https://open.tiktokapis.com/v2/oauth/token/',
    userinfo: 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url', pkce: false, clientIdParam: 'client_key',
    user: j => { const u = j.data && j.data.user || {}; return { sub: u.open_id, name: u.display_name, picture: u.avatar_url || null }; },
  },
  reddit: {
    name: 'Reddit', scope: 'identity', authorize: 'https://www.reddit.com/api/v1/authorize', token: 'https://www.reddit.com/api/v1/access_token',
    userinfo: 'https://oauth.reddit.com/api/v1/me', basicAuth: true, pkce: false, extra: { duration: 'temporary' },
    user: u => ({ sub: u.id, name: u.name, handle: u.name, picture: u.icon_img ? String(u.icon_img).split('?')[0] : null }),
  },
  // YouTube uses the Google app's keys, and links the player's channel.
  youtube: {
    name: 'YouTube', keys: 'GOOGLE', scope: 'https://www.googleapis.com/auth/youtube.readonly', authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    userinfo: 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    user: j => { const c = j.items && j.items[0]; return c ? { sub: c.id, name: c.snippet.title, handle: c.snippet.customUrl || null, picture: c.snippet.thumbnails && c.snippet.thumbnails.default && c.snippet.thumbnails.default.url } : null; },
  },
  snapchat: {
    name: 'Snapchat', scope: 'https://auth.snapchat.com/oauth2/api/user.display_name https://auth.snapchat.com/oauth2/api/user.bitmoji.avatar',
    authorize: 'https://accounts.snapchat.com/accounts/oauth2/auth', token: 'https://accounts.snapchat.com/accounts/oauth2/token', basicAuth: true,
    userinfo: 'https://kit.snapchat.com/v1/me?query=' + encodeURIComponent('{me{externalId displayName bitmoji{avatar}}}'),
    user: j => { const m = j.data && j.data.me || {}; return { sub: m.externalId, name: m.displayName, picture: m.bitmoji && m.bitmoji.avatar || null }; },
  },
  linkedin: { name: 'LinkedIn', issuer: 'https://www.linkedin.com/oauth', scope: 'openid profile email', pkce: false },
  kick: {
    name: 'Kick', scope: 'user:read', authorize: 'https://id.kick.com/oauth/authorize', token: 'https://id.kick.com/oauth/token', userinfo: 'https://api.kick.com/public/v1/users',
    user: j => { const u = j.data && j.data[0] || {}; return { sub: u.user_id != null ? String(u.user_id) : null, name: u.name, handle: u.name, picture: u.profile_picture || null }; },
  },
  // No OAuth app: Steam uses OpenID 2.0, Telegram its login widget, Bluesky atproto OAuth (src/social-extra.js).
  steam: { name: 'Steam', special: true, enabled: env => env.STEAM_LOGIN !== '0' },
  telegram: { name: 'Telegram', special: true, enabled: env => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_NAME) },
  bluesky: { name: 'Bluesky', special: true, enabled: env => env.BLUESKY_LOGIN !== '0' },
  github: {
    name: 'GitHub', scope: 'read:user', authorize: 'https://github.com/login/oauth/authorize', token: 'https://github.com/login/oauth/access_token', userinfo: 'https://api.github.com/user',
    user: u => ({ sub: u.id != null ? String(u.id) : null, name: u.name || u.login, handle: u.login, picture: u.avatar_url }),
  },
};
export const NETWORK_IDS = Object.keys(NETWORKS);

export function oidcConfig(env) {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) return null;
  return { id: env.OIDC_ID || 'scenespot', name: env.OIDC_NAME || 'SceneSpot', issuer: env.OIDC_ISSUER.replace(/\/$/, ''), clientId: env.OIDC_CLIENT_ID, secret: env.OIDC_CLIENT_SECRET, scope: env.OIDC_SCOPE || 'openid profile email', route: 'oidc' };
}

// The config for one sign-in route (/auth/<route>), or null when it isn't switched on.
export function socialConfig(env, route) {
  if (route === 'oidc') return oidcConfig(env);
  const n = NETWORKS[route];
  if (n && n.special) return n.enabled(env) ? { ...n, id: route, route } : null;
  const key = n && n.keys || route.toUpperCase();
  if (!n || !env[key + '_CLIENT_ID'] || !env[key + '_CLIENT_SECRET']) return null;
  if (n.configEnv && !env[n.configEnv]) return null;
  const extra = n.configEnv ? { ...(n.extra || {}), config_id: env[n.configEnv] } : n.extra;
  return { ...n, extra, id: route, route, clientId: env[key + '_CLIENT_ID'], secret: env[key + '_CLIENT_SECRET'] };
}

export const providers = env => {
  const o = oidcConfig(env);
  const social = [o, ...NETWORK_IDS.map(id => socialConfig(env, id))].filter(Boolean).map(c => ({ id: c.id, route: c.route, name: c.name }));
  return { email: !!env.RESEND_API_KEY || env.DEV_LOGIN === '1', oidc: o ? { id: o.id, name: o.name } : null, social };
};

// Find the player for an identity, or attach it. A signed-in player who adds a new provider keeps
// their account (that's "link to SceneSpot with one click"). An identity that already belongs to
// someone signs in as that someone, and accounts are never merged silently.
// A new account needs the player to have said they're 13 or older (allowNew). Pass via and share
// from the visitor's cookies so a new account counts as a referral.
export async function attachIdentity(DB, { provider, subject, profile = {}, current = null, email = null, name = null, allowNew = true, via = null, share = null }) {
  const row = await DB.prepare('SELECT player_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first();
  if (row) {
    await DB.prepare('UPDATE identities SET profile = ? WHERE provider = ? AND subject = ?').bind(JSON.stringify(profile), provider, subject).run();
    return row.player_id;
  }
  let pid = current, created = false;
  if (!pid && email) pid = (await DB.prepare('SELECT id FROM players WHERE email = ?').bind(email).first())?.id || null;
  if (!pid) {
    if (!allowNew) return null;
    pid = await createPlayer(DB, { name: name || (email ? email.split('@')[0] : null) });
    created = true;
  }
  await DB.prepare('INSERT INTO identities (provider, subject, player_id, profile, created_at) VALUES (?, ?, ?, ?, ?)').bind(provider, subject, pid, JSON.stringify(profile), now()).run();
  if (email) await DB.prepare('UPDATE players SET email = ? WHERE id = ? AND email IS NULL AND NOT EXISTS (SELECT 1 FROM players WHERE email = ?)').bind(email, pid, email).run();
  if (provider !== 'email') await grantGems(DB, pid, linkGems(provider), 'link', provider);
  if (created && via) await recordReferral(DB, pid, via, share);
  return pid;
}
const referralFrom = req => { const c = cookies(req); return { via: c[VIA_COOKIE] || null, share: c[SHARE_COOKIE] || null }; };
const clearReferral = req => [setCookie(req, VIA_COOKIE, '', 0), setCookie(req, SHARE_COOKIE, '', 0)];

/* ---------- email link ---------- */

export async function emailStart(DB, env, req, body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { status: 400, error: 'That email address doesn\'t look right.' };
  if (!body.age) return { status: 400, error: 'RookieGamers accounts are for players 13 and up. Under 13? You can still play every game as a guest.' };
  const recent = await DB.prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND expires_at > ?').bind(email, now()).first();
  if (recent.n >= 3) return { status: 429, error: 'We already sent a few links. Check your inbox, or try again in 15 minutes.' };
  const tok = newId('', 48);
  await DB.prepare('INSERT INTO login_tokens (token, email, next, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(tok), email, safeNext(body.next), now() + LINK_TTL).run();
  const link = `${new URL(req.url).origin}/auth/email?token=${tok}`;
  // Local testing: with DEV_LOGIN=1 and no mail key, the link comes back in the response.
  if (!env.RESEND_API_KEY) return env.DEV_LOGIN === '1' ? { status: 200, ok: true, devLink: link } : { status: 503, error: 'Email sign-in isn\'t set up yet.' };
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || 'RookieGamers <login@rookiegamers.com>', to: [email], subject: 'Your RookieGamers sign-in link',
      text: `Tap this link to sign in to RookieGamers:\n\n${link}\n\nIt works once and expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p>Tap the button to sign in to RookieGamers.</p><p><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#ff5c39;color:#fff;text-decoration:none;font-weight:700">Sign in</a></p><p style="color:#666">It works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
    }),
  });
  if (!r.ok) { console.error('resend', r.status, await r.text()); return { status: 502, error: 'We couldn\'t send the email. Try again in a minute.' }; }
  return { status: 200, ok: true };
}

export async function emailVerify(DB, req) {
  const tok = new URL(req.url).searchParams.get('token') || '';
  const hash = await sha256(tok);
  const row = await DB.prepare('SELECT email, next, expires_at FROM login_tokens WHERE token = ?').bind(hash).first();
  await DB.prepare('DELETE FROM login_tokens WHERE token = ? OR expires_at < ?').bind(hash, now()).run();
  if (!row || row.expires_at < now()) return redirect('/signin?expired=1');
  const current = await sessionPlayer(DB, req);
  const pid = await attachIdentity(DB, { provider: 'email', subject: row.email, email: row.email, current, ...referralFrom(req) });
  return redirect(safeNext(row.next), [await newSession(DB, req, pid), ...clearReferral(req)]);
}

/* ---------- SceneSpot and social networks (OpenID Connect or OAuth 2) ---------- */

const discovered = new Map();
async function discover(o) {
  if (discovered.has(o.issuer)) return discovered.get(o.issuer);
  const r = await fetch(`${o.issuer}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
  const doc = await r.json();
  discovered.set(o.issuer, doc);
  return doc;
}
async function endpoints(o) {
  if (!o.issuer) return { authorization_endpoint: o.authorize, token_endpoint: o.token, userinfo_endpoint: o.userinfo };
  return discover(o);
}

async function pkce() {
  const verifier = newId('', 64);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

// /auth/<route>?next=...&age=1. age=1 means the player ticked "I'm 13 or older", which a new
// account needs. A signed-in player uses the same route to link another network.
export async function socialStart(env, req, route) {
  const o = socialConfig(env, route);
  if (!o) return redirect('/signin');
  const url = new URL(req.url);
  const doc = await endpoints(o);
  const state = newId('', 32), nonce = newId('', 32);
  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({
    [o.clientIdParam || 'client_id']: o.clientId, redirect_uri: `${url.origin}/auth/${o.route}/callback`, response_type: 'code', ...(o.scope ? { scope: o.scope } : {}), state,
    ...(o.pkce === false ? {} : { code_challenge: challenge, code_challenge_method: 'S256' }), ...(o.extra || {}),
  });
  if (o.issuer) q.set('nonce', nonce);
  const stash = JSON.stringify({ state, nonce, verifier, route: o.route, age: url.searchParams.get('age') === '1', next: safeNext(url.searchParams.get('next')) });
  return redirect(`${doc.authorization_endpoint}?${q}`, [setCookie(req, 'rg_oidc', stash, 600)]);
}

const b64json = s => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))));

export async function socialCallback(DB, env, req, route) {
  const o = socialConfig(env, route);
  const url = new URL(req.url);
  const stash = safeJSON(cookies(req).rg_oidc || '', {});
  const clear = setCookie(req, 'rg_oidc', '', 0);
  const code = url.searchParams.get('code');
  const fail = (why = 'failed') => redirect(`/signin?${why}=1&next=${encodeURIComponent(stash.next || '/')}`, [clear]);
  if (!o || !code || !stash.state || stash.route !== o.route || url.searchParams.get('state') !== stash.state) return fail();
  const doc = await endpoints(o);
  const form = { grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/auth/${o.route}/callback`, [o.clientIdParam || 'client_id']: o.clientId };
  if (o.pkce !== false) form.code_verifier = stash.verifier;
  const headers = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' };
  if (o.basicAuth) headers.authorization = 'Basic ' + btoa(`${o.clientId}:${o.secret}`); else form.client_secret = o.secret;
  // Meta's Unified Login documents the code exchange as a GET with the params in the query.
  const tr = o.tokenGet ? await fetch(`${doc.token_endpoint}?${new URLSearchParams(form)}`, { headers: { accept: 'application/json' } })
    : await fetch(doc.token_endpoint, { method: 'POST', headers, body: new URLSearchParams(form) });
  if (!tr.ok) { console.error(o.id, 'token', tr.status, await tr.text()); return fail(); }
  const tokens = await tr.json();
  let who;
  if (o.issuer) {
    // The ID token came straight from the token endpoint over TLS, so its claims can be trusted
    // without checking the signature (OpenID Connect Core 3.1.3.7). We still check who it's for.
    let claims = {};
    try { claims = b64json(tokens.id_token.split('.')[1]); } catch { /* fall back to userinfo */ }
    if (claims.nonce !== undefined && claims.nonce !== stash.nonce) return fail();
    if (claims.aud && ![].concat(claims.aud).includes(o.clientId)) return fail();
    let info = {};
    if (doc.userinfo_endpoint && tokens.access_token) {
      const ur = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (ur.ok) info = await ur.json();
    }
    if (claims.sub && info.sub && claims.sub !== info.sub) return fail();
    const all = { ...claims, ...info };
    // Keep what game features will want from SceneSpot: profile, home city and Scenes.
    who = {
      sub: String(all.sub || ''), name: all.name || all.preferred_username || null, handle: all.preferred_username || null, picture: all.picture || null,
      email: all.email && all.email_verified !== false && all.email_verified !== 'false' ? String(all.email) : null,
      city: all.city || all.locality || all.address?.locality || null, scenes: all.scenes || null,
    };
  } else {
    if (!tokens.access_token) return fail();
    // Meta's Graph APIs want the token as a query parameter.
    const infoURL = o.tokenInQuery ? `${doc.userinfo_endpoint}${doc.userinfo_endpoint.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(tokens.access_token)}` : doc.userinfo_endpoint;
    const ur = await fetch(infoURL, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json', 'user-agent': 'RookieGamers' } });
    if (!ur.ok) { console.error(o.id, 'user', ur.status, await ur.text()); return fail(); }
    who = o.user(await ur.json());
  }
  if (!who || !who.sub) return fail();
  return finishSocial(DB, req, o, stash, who, clear);
}

// Signs the player in (or links the network to the signed-in player) once a network says who
// they are. Shared by the OAuth networks and by Steam, Bluesky and Telegram.
export async function finishSocial(DB, req, o, stash, who, clear) {
  const fail = (why = 'failed') => redirect(`/signin?${why}=1&next=${encodeURIComponent(stash.next || '/')}`, [clear]);
  const email = who.email ? String(who.email).toLowerCase() : null;
  const profile = { name: who.name || null, handle: who.handle || null, picture: who.picture || null };
  if (who.city !== undefined) Object.assign(profile, { city: who.city, scenes: who.scenes });
  const current = await sessionPlayer(DB, req);
  const pid = await attachIdentity(DB, { provider: o.id, subject: String(who.sub), profile, current, email, name: cleanText(who.name, 18) || null, allowNew: !!stash.age, ...referralFrom(req) });
  if (!pid) return fail('age');
  return redirect(stash.next || '/', [clear, current === pid ? null : await newSession(DB, req, pid), ...(current ? [] : clearReferral(req))]);
}
