import { now, newId, sha256, cleanText, safeJSON, createPlayer } from './db.js';
import { sessionPlayer, newSession } from './auth.js';
import { isDeveloper, becomeDeveloper, DevError } from './dev.js';

// OAuth 2 sign-in for AI apps that connect to the MCP server (/mcp): Claude, ChatGPT, Grok, Claude
// Code, Codex and anything else that speaks MCP authorization. The developer signs in to RookieGamers
// as usual, approves the app on /oauth/authorize, and the app gets a token that acts as them, exactly
// like an rgk_ API key. Public clients only, PKCE S256 required. Apps register themselves with
// dynamic client registration (/oauth/register) or a client ID metadata document (an https client_id).
// Only token hashes are stored. Access tokens last an hour; refresh tokens rotate and last 60 days.

const ACCESS_TTL = 3600 * 1000;
const REFRESH_TTL = 60 * 24 * 3600 * 1000;
const CODE_TTL = 5 * 60 * 1000;
const REQUEST_TTL = 30 * 60 * 1000;
const CIMD_TTL = 24 * 3600 * 1000;
export const SCOPE = 'games';

const TABLES = [
  // redirect_uris: JSON list. id is oc_... for registered apps, or the https URL of a metadata document.
  `CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, uri TEXT, logo TEXT,
    fetched_at INTEGER, created_at INTEGER NOT NULL)`,
  // An authorize request waiting for the developer to sign in and approve it.
  `CREATE TABLE IF NOT EXISTS oauth_requests (id TEXT PRIMARY KEY, params TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, player_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
    challenge TEXT NOT NULL, scope TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  // kind 'access' or 'refresh'. family ties every token from one approval, so reuse of an old refresh
  // token (a sign it leaked) ends the whole connection.
  `CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, family TEXT NOT NULL, client_id TEXT NOT NULL,
    player_id TEXT NOT NULL, scope TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens(family)',
  'CREATE INDEX IF NOT EXISTS oauth_tokens_player ON oauth_tokens(player_id)',
];
const ready = new WeakMap();
export function ensureTables(DB) {
  if (!ready.has(DB)) ready.set(DB, DB.batch(TABLES.map(s => DB.prepare(s))).catch(e => { ready.delete(DB); throw e; }));
  return ready.get(DB);
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra } });
const oerr = (error, error_description, status = 400) => json({ error, error_description }, status);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- discovery ---------- */

export const resourceURL = site => `${site}/mcp`;
export const resourceMetadataURL = site => `${site}/.well-known/oauth-protected-resource/mcp`;

export function protectedResource(site) {
  return { resource: resourceURL(site), authorization_servers: [site], scopes_supported: [SCOPE], bearer_methods_supported: ['header'],
    resource_name: 'RookieGamers', resource_documentation: `${site}/docs` };
}

export function authServer(site) {
  return {
    issuer: site,
    authorization_endpoint: `${site}/oauth/authorize`,
    token_endpoint: `${site}/oauth/token`,
    registration_endpoint: `${site}/oauth/register`,
    revocation_endpoint: `${site}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    service_documentation: `${site}/docs`,
  };
}

/* ---------- clients ---------- */

const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s#]*)?$/i;
function okRedirect(u) {
  if (typeof u !== 'string' || u.length > 500 || u.includes('#')) return false;
  if (LOOPBACK.test(u)) return true;
  try { const x = new URL(u); return x.protocol === 'https:' || /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(x.protocol); } catch { return false; } // https, or an app's own scheme like com.example.app:
}
// Loopback redirects match on everything but the port (native apps pick a free port each time).
function redirectAllowed(list, u) {
  if (list.includes(u)) return true;
  if (!LOOPBACK.test(u)) return false;
  const strip = s => { try { const x = new URL(s); x.port = ''; return x.href; } catch { return s; } };
  return list.some(r => LOOPBACK.test(r) && strip(r) === strip(u));
}

export async function register(req, DB) {
  await ensureTables(DB);
  let b; try { b = await req.json(); } catch { return oerr('invalid_client_metadata', 'Send the client metadata as JSON.'); }
  const uris = [].concat(b?.redirect_uris || []);
  if (!uris.length || uris.length > 10) return oerr('invalid_redirect_uri', 'Give 1 to 10 redirect_uris.');
  const bad = uris.find(u => !okRedirect(u));
  if (bad) return oerr('invalid_redirect_uri', `This redirect URI isn't allowed: ${String(bad).slice(0, 100)}. Use https, a loopback http address, or an app scheme.`);
  const grants = b.grant_types ? [].concat(b.grant_types) : ['authorization_code', 'refresh_token'];
  if (grants.some(g => !['authorization_code', 'refresh_token'].includes(g))) return oerr('invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported.');
  const id = newId('oc_', 32);
  const name = cleanText(b.client_name, 60) || 'An AI app';
  const uri = typeof b.client_uri === 'string' && /^https:\/\//.test(b.client_uri) ? b.client_uri.slice(0, 300) : null;
  await DB.prepare('INSERT INTO oauth_clients (id, name, redirect_uris, uri, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, JSON.stringify(uris), uri, now()).run();
  return json({ client_id: id, client_id_issued_at: Math.floor(now() / 1000), client_name: name, redirect_uris: uris, client_uri: uri || undefined,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }, 201);
}

// A client_id that is an https URL is a metadata document the app hosts (CIMD). Fetch it, check it
// names itself, and cache it for a day.
const isCIMD = id => /^https:\/\/[^\s/]+\/[^\s#]+$/.test(id) && id.length <= 500;
async function getClient(DB, id) {
  if (typeof id !== 'string' || !id) return null;
  const row = await DB.prepare('SELECT * FROM oauth_clients WHERE id = ?').bind(id).first();
  if (!isCIMD(id)) return row ? { ...row, redirect_uris: safeJSON(row.redirect_uris, []) } : null;
  if (row && now() - (row.fetched_at || 0) < CIMD_TTL) return { ...row, redirect_uris: safeJSON(row.redirect_uris, []) };
  let doc;
  try {
    const r = await fetch(id, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const text = await r.text();
    if (text.length > 20000) throw new Error('too big');
    doc = JSON.parse(text);
  } catch (e) {
    console.warn('cimd fetch', id, e?.message);
    return row ? { ...row, redirect_uris: safeJSON(row.redirect_uris, []) } : null;
  }
  if (doc?.client_id !== id) return null;
  const uris = [].concat(doc.redirect_uris || []).filter(okRedirect).slice(0, 20);
  if (!uris.length) return null;
  const name = cleanText(doc.client_name, 60) || new URL(id).hostname;
  const uri = typeof doc.client_uri === 'string' && /^https:\/\//.test(doc.client_uri) ? doc.client_uri.slice(0, 300) : null;
  const logo = typeof doc.logo_uri === 'string' && /^https:\/\//.test(doc.logo_uri) ? doc.logo_uri.slice(0, 300) : null;
  await DB.prepare(`INSERT INTO oauth_clients (id, name, redirect_uris, uri, logo, fetched_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, redirect_uris = excluded.redirect_uris, uri = excluded.uri, logo = excluded.logo, fetched_at = excluded.fetched_at`)
    .bind(id, name, JSON.stringify(uris), uri, logo, now(), now()).run();
  return { id, name, redirect_uris: uris, uri, logo };
}

/* ---------- authorize ---------- */

function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="impact-site-verification" value="c1bf013b-98e9-4301-81d1-32679b2d3b60"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · RookieGamers</title><meta name="robots" content="noindex"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css"></head><body>
<header class="top"><div class="wrap"><a class="logo" href="/"><b>RG</b>RookieGamers</a></div></header>
<main><div class="wrap" style="max-width:560px">${body}</div></main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'" } });
}
const errorPage = msg => page('Can\'t connect', `<h1>Can't connect this app</h1><p class="lede">${esc(msg)}</p><p><a class="btn ghost" href="/dev">Back to RookieGamers</a></p>`, 400);

function backTo(redirectUri, params) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: u.href, 'cache-control': 'no-store' } });
}

const hostOf = u => { try { const x = new URL(u); return x.protocol === 'http:' ? 'this computer' : x.host || x.protocol; } catch { return u; } };

export async function authorize(req, env, DB, site, url) {
  await ensureTables(DB);
  if (req.method === 'POST') return decide(req, env, DB, site);
  let p;
  const rq = url.searchParams.get('rq');
  if (rq) {
    const row = await DB.prepare('SELECT params, expires_at FROM oauth_requests WHERE id = ?').bind(rq).first();
    if (!row || row.expires_at < now()) return errorPage('This sign-in link has expired. Start connecting again from your AI app.');
    p = safeJSON(row.params, {});
  } else {
    const q = k => url.searchParams.get(k) || '';
    p = { client_id: q('client_id'), redirect_uri: q('redirect_uri'), state: q('state'), challenge: q('code_challenge'), method: q('code_challenge_method'),
      scope: q('scope'), resource: q('resource'), response_type: q('response_type') };
    const client = await getClient(DB, p.client_id);
    if (!client) return errorPage('This app isn\'t registered with RookieGamers. Remove the connection in your AI app and add it again.');
    if (!p.redirect_uri && client.redirect_uris.length === 1) p.redirect_uri = client.redirect_uris[0];
    if (!redirectAllowed(client.redirect_uris, p.redirect_uri)) return errorPage('This app asked to return to an address it didn\'t register.');
    // From here on, problems go back to the app as OAuth errors.
    const fail = (error, d) => backTo(p.redirect_uri, { error, error_description: d, state: p.state, iss: site });
    if (p.response_type !== 'code') return fail('unsupported_response_type', 'Only response_type=code is supported.');
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.challenge) || p.method !== 'S256') return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    if (p.resource && !okResource(p.resource, site)) return fail('invalid_target', `The resource must be ${resourceURL(site)}.`);
    if (p.scope && p.scope.split(' ').some(s => s && s !== SCOPE)) return fail('invalid_scope', `The only scope is "${SCOPE}".`);
    p.scope = SCOPE;
    const id = newId('rq_', 24);
    await DB.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now()).run();
    await DB.prepare('INSERT INTO oauth_requests (id, params, expires_at) VALUES (?, ?, ?)').bind(id, JSON.stringify(p), now() + REQUEST_TTL).run();
    // A short, clean URL to come back to after sign-in (the full request can be too long for ?next=).
    return new Response(null, { status: 302, headers: { location: `/oauth/authorize?rq=${id}`, 'cache-control': 'no-store' } });
  }
  const pid = await sessionPlayer(DB, req);
  if (!pid) {
    const signin = `/signin?next=${encodeURIComponent('/oauth/authorize?rq=' + rq)}`;
    if (!reviewOn(env)) return new Response(null, { status: 302, headers: { location: signin, 'cache-control': 'no-store' } });
    return page('Sign in', `<h1>Sign in to connect your AI app</h1><p class="lede">Sign in with your RookieGamers developer account to continue.</p>
<p><a class="btn" href="${esc(signin)}">Sign in</a></p><p class="muted small">App store reviewer? <a href="/oauth/review?rq=${esc(rq)}">Use the review access code</a>.</p>`);
  }
  const client = await getClient(DB, p.client_id);
  if (!client) return errorPage('This app isn\'t registered with RookieGamers anymore. Start connecting again from your AI app.');
  const player = await DB.prepare('SELECT name FROM players WHERE id = ?').bind(pid).first();
  const isDev = await isDeveloper(DB, pid);
  const open = env.OPEN_DEVELOPERS === '1';
  const err = url.searchParams.get('err');
  return page('Connect an AI app', `<h1>Connect ${esc(client.name)} to RookieGamers</h1>
<p class="lede"><b>${esc(client.name)}</b> wants to act as your developer account${player ? `, <b>${esc(player.name)}</b>,` : ''} through the RookieGamers MCP server. It will send you back to <b>${esc(hostOf(p.redirect_uri))}</b>.</p>
<div class="panel"><h3>It will be able to</h3><ul style="margin:0;padding-left:20px;line-height:1.7">
<li>Read the SDK docs and get a starter game</li><li>Create, upload, publish and unpublish your games</li><li>See your games' stats, store products and earnings</li><li>Set store products and ask for ads, when you tell it to</li></ul>
<p class="muted small" style="margin:10px 0 0">It can't see your sign-in methods, change your account, or pay out money. You can disconnect it from the app at any time.</p></div>
${err ? `<div class="note err" style="margin-top:14px">${esc(err)}</div>` : ''}
<form class="form" method="post" action="/oauth/authorize" style="margin-top:18px;max-width:none">
<input type="hidden" name="rq" value="${esc(rq)}">
${isDev ? '' : open ? '<p class="muted">Approving also makes you a RookieGamers developer.</p>' : '<p class="muted">Publishing is invite-only for now. Paste your developer invite code to continue.</p><input name="invite" placeholder="inv_..." aria-label="Invite code" required>'}
<div style="display:flex;gap:10px"><button class="btn" type="submit" name="decision" value="allow">Allow</button><button class="btn ghost" type="submit" name="decision" value="deny" formnovalidate>Cancel</button></div></form>`);
}

const okResource = (r, site) => [resourceURL(site), `${resourceURL(site)}/`, site, `${site}/`].includes(r);

async function decide(req, env, DB, site) {
  // The session cookie is SameSite=Lax, so another site can't post this form as the developer. Check
  // the Origin header too.
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(site).origin && origin !== new URL(req.url).origin) return errorPage('That request came from another site.');
  const f = await req.formData().catch(() => null);
  const rq = String(f?.get('rq') || '');
  const row = rq && await DB.prepare('SELECT params, expires_at FROM oauth_requests WHERE id = ?').bind(rq).first();
  if (!row || row.expires_at < now()) return errorPage('This sign-in link has expired. Start connecting again from your AI app.');
  const p = safeJSON(row.params, {});
  const pid = await sessionPlayer(DB, req);
  if (!pid) return new Response(null, { status: 302, headers: { location: `/signin?next=${encodeURIComponent('/oauth/authorize?rq=' + rq)}` } });
  const client = await getClient(DB, p.client_id);
  if (!client || !redirectAllowed(client.redirect_uris, p.redirect_uri)) return errorPage('This app isn\'t registered with RookieGamers anymore. Start connecting again from your AI app.');
  if (f.get('decision') !== 'allow') {
    await DB.prepare('DELETE FROM oauth_requests WHERE id = ?').bind(rq).run();
    return backTo(p.redirect_uri, { error: 'access_denied', error_description: 'The developer cancelled.', state: p.state, iss: site });
  }
  if (!await isDeveloper(DB, pid)) {
    try { await becomeDeveloper(DB, env, pid, String(f.get('invite') || '').trim()); }
    catch (e) {
      if (e instanceof DevError) return new Response(null, { status: 303, headers: { location: `/oauth/authorize?rq=${rq}&err=${encodeURIComponent(e.message)}` } });
      throw e;
    }
  }
  const code = newId('rgc_', 40);
  await DB.batch([
    DB.prepare('DELETE FROM oauth_requests WHERE id = ?').bind(rq),
    DB.prepare('INSERT INTO oauth_codes (hash, client_id, player_id, redirect_uri, challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(code), p.client_id, pid, p.redirect_uri, p.challenge, p.scope || SCOPE, now() + CODE_TTL),
  ]);
  return backTo(p.redirect_uri, { code, state: p.state, iss: site });
}

/* ---------- tokens ---------- */

async function s256(verifier) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function issue(DB, { client_id, player_id, scope, family = newId('of_', 24) }) {
  const access = newId('rgo_', 40), refresh = newId('rgr_', 40), t = now();
  await DB.batch([
    DB.prepare('INSERT INTO oauth_tokens (hash, kind, family, client_id, player_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(access), 'access', family, client_id, player_id, scope, t + ACCESS_TTL, t),
    DB.prepare('INSERT INTO oauth_tokens (hash, kind, family, client_id, player_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(await sha256(refresh), 'refresh', family, client_id, player_id, scope, t + REFRESH_TTL, t),
    DB.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(t),
  ]);
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope });
}

async function form(req) {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) { const b = await req.json().catch(() => ({})); return k => b?.[k] == null ? '' : String(b[k]); }
  const f = new URLSearchParams(await req.text().catch(() => ''));
  return k => f.get(k) || '';
}

export async function token(req, DB, site) {
  await ensureTables(DB);
  if (req.method !== 'POST') return oerr('invalid_request', 'POST to this endpoint.', 405);
  const q = await form(req);
  // Public clients may still send client_id in a Basic header.
  let clientId = q('client_id');
  const basic = /^Basic\s+(.+)$/i.exec(req.headers.get('authorization') || '');
  if (!clientId && basic) { try { clientId = decodeURIComponent(atob(basic[1]).split(':')[0]); } catch {} }
  const grant = q('grant_type');
  if (q('resource') && !okResource(q('resource'), site)) return oerr('invalid_target', `The resource must be ${resourceURL(site)}.`);

  if (grant === 'authorization_code') {
    const hash = await sha256(q('code'));
    const c = await DB.prepare('SELECT * FROM oauth_codes WHERE hash = ?').bind(hash).first();
    if (c) await DB.prepare('DELETE FROM oauth_codes WHERE hash = ?').bind(hash).run(); // single use, even when the checks below fail
    if (!c || c.expires_at < now()) return oerr('invalid_grant', 'That code is wrong or expired.');
    if (clientId && clientId !== c.client_id) return oerr('invalid_grant', 'That code was issued to another app.');
    if (q('redirect_uri') && q('redirect_uri') !== c.redirect_uri) return oerr('invalid_grant', 'redirect_uri doesn\'t match the authorize request.');
    if (!q('code_verifier') || await s256(q('code_verifier')) !== c.challenge) return oerr('invalid_grant', 'code_verifier doesn\'t match the code_challenge.');
    if (!await isDeveloper(DB, c.player_id)) return oerr('invalid_grant', 'That account is not a developer.');
    return issue(DB, { client_id: c.client_id, player_id: c.player_id, scope: c.scope });
  }

  if (grant === 'refresh_token') {
    const hash = await sha256(q('refresh_token'));
    const t = await DB.prepare("SELECT * FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'").bind(hash).first();
    if (!t || t.expires_at < now()) return oerr('invalid_grant', 'That refresh token is wrong or expired. Connect again.');
    if (clientId && clientId !== t.client_id) return oerr('invalid_grant', 'That refresh token was issued to another app.');
    if (t.used) {
      // An old refresh token came back: someone may have copied it. End the whole connection.
      await DB.prepare('DELETE FROM oauth_tokens WHERE family = ?').bind(t.family).run();
      return oerr('invalid_grant', 'That refresh token was already used. Connect again.');
    }
    const claimed = await DB.prepare('UPDATE oauth_tokens SET used = 1 WHERE hash = ? AND used = 0').bind(hash).run();
    if (!claimed.meta?.changes) return oerr('invalid_grant', 'That refresh token was already used. Connect again.');
    if (!await isDeveloper(DB, t.player_id)) return oerr('invalid_grant', 'That account is not a developer.');
    return issue(DB, { client_id: t.client_id, player_id: t.player_id, scope: t.scope, family: t.family });
  }

  return oerr('unsupported_grant_type', 'Use authorization_code or refresh_token.');
}

// RFC 7009: revoking any token from a connection ends the connection. Always 200.
export async function revoke(req, DB) {
  await ensureTables(DB);
  if (req.method !== 'POST') return oerr('invalid_request', 'POST to this endpoint.', 405);
  const q = await form(req);
  const t = await DB.prepare('SELECT family FROM oauth_tokens WHERE hash = ?').bind(await sha256(q('token'))).first();
  if (t) await DB.prepare('DELETE FROM oauth_tokens WHERE family = ?').bind(t.family).run();
  return new Response(null, { status: 200, headers: CORS });
}

// Bearer rgo_... → the developer's player id, or null.
export async function tokenPlayer(DB, req) {
  const m = /^Bearer\s+(rgo_[a-f0-9]{40})$/i.exec(req.headers.get('authorization') || '');
  if (!m) return null;
  await ensureTables(DB);
  const t = await DB.prepare("SELECT player_id, expires_at FROM oauth_tokens WHERE hash = ? AND kind = 'access'").bind(await sha256(m[1])).first();
  if (!t || t.expires_at < now() || !await isDeveloper(DB, t.player_id)) return null;
  return t.player_id;
}

/* ---------- app store review sign-in ---------- */

// App directories (Claude, ChatGPT, Grok) review a connector with a test account that must sign in
// without email codes or two-factor prompts. When REVIEW_LOGIN_CODE is set (a Cloudflare secret, 16+
// characters), /oauth/review signs anyone who knows it into one sandbox developer account, "App
// Reviewer". Remove the secret to switch it off.
const REVIEWER = 'review-team';
const reviewOn = env => typeof env.REVIEW_LOGIN_CODE === 'string' && env.REVIEW_LOGIN_CODE.trim().length >= 16;
const sameString = (a, b) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

async function reviewSignin(req, env, DB, url) {
  if (!reviewOn(env)) return errorPage('Review sign-in is switched off.');
  const rq = /^rq_[a-f0-9]{24}$/.test(url.searchParams.get('rq') || '') ? url.searchParams.get('rq') : '';
  const form = (msg = '') => page('Review sign-in', `<h1>App review sign-in</h1><p class="lede">For app directory reviewers. This signs you in to a sandbox developer account.</p>
${msg ? `<div class="note err">${esc(msg)}</div>` : ''}<form class="form" method="post" style="margin-top:14px"><input name="code" type="password" placeholder="Review access code" aria-label="Review access code" required autocomplete="off"><button class="btn" type="submit">Sign in</button></form>`);
  if (req.method !== 'POST') return form();
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return errorPage('That request came from another site.');
  const f = await req.formData().catch(() => null);
  const code = String(f?.get('code') || '').trim();
  if (!sameString(code, env.REVIEW_LOGIN_CODE.trim())) return form('That code isn\'t right.');
  let row = await DB.prepare("SELECT player_id FROM identities WHERE provider = 'review' AND subject = ?").bind(REVIEWER).first();
  let pid = row?.player_id;
  if (!pid) {
    pid = await createPlayer(DB, { name: 'AppReviewer' });
    await DB.prepare("INSERT INTO identities (provider, subject, player_id, created_at) VALUES ('review', ?, ?, ?)").bind(REVIEWER, pid, now()).run();
  }
  await DB.prepare('INSERT OR IGNORE INTO developers (player_id, name, created_at) VALUES (?, ?, ?)').bind(pid, 'App Reviewer', now()).run();
  const cookie = await newSession(DB, req, pid);
  return new Response(null, { status: 303, headers: { location: rq ? `/oauth/authorize?rq=${rq}` : '/dev', 'set-cookie': cookie, 'cache-control': 'no-store' } });
}

export function preflight() { return new Response(null, { status: 204, headers: CORS }); }

// Routes under /oauth/ and the OAuth discovery documents. Returns null for anything else.
export async function oauthRoute(req, env, DB, site, url) {
  const path = url.pathname;
  const isWK = path.startsWith('/.well-known/oauth-');
  if (!isWK && !path.startsWith('/oauth/')) return null;
  if (req.method === 'OPTIONS' && path !== '/oauth/authorize') return preflight();
  const cache = { 'cache-control': 'public, max-age=3600' };
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return json(protectedResource(site), 200, cache);
  // RFC 8414 says /.well-known/oauth-authorization-server; some clients also try OIDC discovery.
  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp') return json(authServer(site), 200, cache);
  if (path === '/oauth/register') return req.method === 'POST' ? register(req, DB) : oerr('invalid_request', 'POST client metadata to this endpoint.', 405);
  if (path === '/oauth/authorize') return authorize(req, env, DB, site, url);
  if (path === '/oauth/token') return token(req, DB, site);
  if (path === '/oauth/revoke') return revoke(req, DB);
  if (path === '/oauth/review') { await ensureTables(DB); return reviewSignin(req, env, DB, url); }
  return null;
}
