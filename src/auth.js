import { createPlayer, newId, sha256, now, safeJSON, cleanText } from './db.js';

// Portal sign-in. Players sign in with an email link today, and with any OpenID Connect provider
// configured through OIDC_* secrets. SceneSpot becomes the main sign-in by setting those secrets,
// with no code change. Each way to sign in is an identity row pointing at one player.

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

export function oidcConfig(env) {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) return null;
  return { id: env.OIDC_ID || 'scenespot', name: env.OIDC_NAME || 'SceneSpot', issuer: env.OIDC_ISSUER.replace(/\/$/, ''), clientId: env.OIDC_CLIENT_ID, secret: env.OIDC_CLIENT_SECRET, scope: env.OIDC_SCOPE || 'openid profile email' };
}

export const providers = env => {
  const o = oidcConfig(env);
  return { email: !!env.RESEND_API_KEY || env.DEV_LOGIN === '1', oidc: o ? { id: o.id, name: o.name } : null };
};

// Find the player for an identity, or attach it. A signed-in player who adds a new provider keeps
// their account (that's "link to SceneSpot with one click"). An identity that already belongs to
// someone signs in as that someone, and accounts are never merged silently.
export async function attachIdentity(DB, { provider, subject, profile = {}, current = null, email = null, name = null }) {
  const row = await DB.prepare('SELECT player_id FROM identities WHERE provider = ? AND subject = ?').bind(provider, subject).first();
  if (row) {
    await DB.prepare('UPDATE identities SET profile = ? WHERE provider = ? AND subject = ?').bind(JSON.stringify(profile), provider, subject).run();
    return row.player_id;
  }
  let pid = current;
  if (!pid && email) pid = (await DB.prepare('SELECT id FROM players WHERE email = ?').bind(email).first())?.id || null;
  if (!pid) pid = await createPlayer(DB, { name: name || (email ? email.split('@')[0] : null) });
  await DB.prepare('INSERT INTO identities (provider, subject, player_id, profile, created_at) VALUES (?, ?, ?, ?, ?)').bind(provider, subject, pid, JSON.stringify(profile), now()).run();
  if (email) await DB.prepare('UPDATE players SET email = ? WHERE id = ? AND email IS NULL AND NOT EXISTS (SELECT 1 FROM players WHERE email = ?)').bind(email, pid, email).run();
  return pid;
}

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
  const pid = await attachIdentity(DB, { provider: 'email', subject: row.email, email: row.email, current });
  return redirect(safeNext(row.next), [await newSession(DB, req, pid)]);
}

/* ---------- OpenID Connect (SceneSpot, or any standard provider) ---------- */

let discovery = null;
async function discover(o) {
  if (discovery?.issuer === o.issuer) return discovery.doc;
  const r = await fetch(`${o.issuer}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error(`OIDC discovery failed: ${r.status}`);
  const doc = await r.json();
  discovery = { issuer: o.issuer, doc };
  return doc;
}

async function pkce() {
  const verifier = newId('', 64);
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { verifier, challenge };
}

export async function oidcStart(env, req) {
  const o = oidcConfig(env);
  if (!o) return redirect('/signin');
  const url = new URL(req.url);
  const doc = await discover(o);
  const state = newId('', 32), nonce = newId('', 32);
  const { verifier, challenge } = await pkce();
  const q = new URLSearchParams({
    client_id: o.clientId, redirect_uri: `${url.origin}/auth/oidc/callback`, response_type: 'code', scope: o.scope,
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  });
  const stash = JSON.stringify({ state, nonce, verifier, next: safeNext(url.searchParams.get('next')) });
  return redirect(`${doc.authorization_endpoint}?${q}`, [setCookie(req, 'rg_oidc', stash, 600)]);
}

export async function oidcCallback(DB, env, req) {
  const o = oidcConfig(env);
  const url = new URL(req.url);
  const stash = safeJSON(cookies(req).rg_oidc || '', {});
  const clear = setCookie(req, 'rg_oidc', '', 0);
  const code = url.searchParams.get('code');
  if (!o || !code || !stash.state || url.searchParams.get('state') !== stash.state) return redirect('/signin?failed=1', [clear]);
  const doc = await discover(o);
  const tr = await fetch(doc.token_endpoint, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${url.origin}/auth/oidc/callback`, client_id: o.clientId, client_secret: o.secret, code_verifier: stash.verifier }),
  });
  if (!tr.ok) { console.error('oidc token', tr.status, await tr.text()); return redirect('/signin?failed=1', [clear]); }
  const tokens = await tr.json();
  // The ID token came straight from the token endpoint over TLS, so its claims can be trusted
  // without checking the signature (OpenID Connect Core 3.1.3.7). We still check who it's for.
  let claims = {};
  try { claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); } catch { /* fall back to userinfo */ }
  if (claims.nonce !== undefined && claims.nonce !== stash.nonce) return redirect('/signin?failed=1', [clear]);
  if (claims.aud && ![].concat(claims.aud).includes(o.clientId)) return redirect('/signin?failed=1', [clear]);
  let info = {};
  if (doc.userinfo_endpoint && tokens.access_token) {
    const ur = await fetch(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
    if (ur.ok) info = await ur.json();
  }
  const sub = String(info.sub || claims.sub || '');
  if (!sub || (claims.sub && info.sub && claims.sub !== info.sub)) return redirect('/signin?failed=1', [clear]);
  const all = { ...claims, ...info };
  const email = all.email && all.email_verified !== false ? String(all.email).toLowerCase() : null;
  // Keep what game features will want from SceneSpot: profile, home city and Scenes.
  const profile = { name: all.name || all.preferred_username || null, picture: all.picture || null, city: all.city || all.locality || all.address?.locality || null, scenes: all.scenes || null };
  const current = await sessionPlayer(DB, req);
  const pid = await attachIdentity(DB, { provider: o.id, subject: sub, profile, current, email, name: cleanText(profile.name, 18) || null });
  return redirect(stash.next || '/', [clear, current === pid ? null : await newSession(DB, req, pid)]);
}
