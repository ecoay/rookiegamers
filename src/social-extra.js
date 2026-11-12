import { newId, sha256 } from './db.js';
import { cookies, setCookie, redirect, safeNext, finishSocial } from './auth.js';

// Sign-in networks that don't use plain OAuth 2: Steam (OpenID 2.0), Telegram (the login widget)
// and Bluesky (AT Protocol OAuth, with PAR and DPoP). Steam and Bluesky need no keys; Telegram
// needs a bot (TELEGRAM_BOT_NAME and TELEGRAM_BOT_TOKEN, with the portal's domain set in BotFather).
// Each ends in finishSocial, so they sign in, link and earn gems like every other network.

export const EXTRA = ['steam', 'telegram', 'bluesky'];

const stashCookie = (req, url, route, more = {}) => {
  const stash = { state: newId('', 32), route, age: url.searchParams.get('age') === '1', next: safeNext(url.searchParams.get('next')), ...more };
  return { stash, cookie: setCookie(req, 'rg_oidc', JSON.stringify(stash), 600) };
};
const readStash = req => { try { return JSON.parse(cookies(req).rg_oidc || '{}'); } catch { return {}; } };
const failTo = (stash, clear, why = 'failed') => redirect(`/signin?${why}=1&next=${encodeURIComponent(stash.next || '/')}`, [clear]);

export function extraStart(env, req, route) {
  if (route === 'steam') return steamStart(req);
  if (route === 'telegram') return telegramStart(env, req);
  if (route === 'bluesky') return blueskyStart(req);
  return redirect('/signin');
}

export async function extraCallback(DB, env, req, route) {
  const stash = readStash(req);
  const clear = setCookie(req, 'rg_oidc', '', 0);
  const o = { id: route, route };
  let who = null;
  try {
    if (stash.route !== route) return failTo(stash, clear);
    if (route === 'steam') who = await steamWho(env, req, stash);
    else if (route === 'telegram') who = await telegramWho(env, req, stash);
    else if (route === 'bluesky') who = await blueskyWho(req, stash);
  } catch (e) { console.error(route, 'sign-in', e && e.message); who = null; }
  if (!who || !who.sub) return failTo(stash, clear);
  return finishSocial(DB, req, o, stash, who, clear);
}

/* ---------- Steam: OpenID 2.0 ---------- */

const STEAM = 'https://steamcommunity.com/openid/login';

function steamStart(req) {
  const url = new URL(req.url);
  const { stash, cookie } = stashCookie(req, url, 'steam');
  const back = `${url.origin}/auth/steam/callback?state=${stash.state}`;
  const q = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup', 'openid.return_to': back, 'openid.realm': url.origin,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  return redirect(`${STEAM}?${q}`, [cookie]);
}

async function steamWho(env, req, stash) {
  const url = new URL(req.url), p = url.searchParams;
  if (p.get('state') !== stash.state || p.get('openid.mode') !== 'id_res' || p.get('openid.op_endpoint') !== STEAM) return null;
  if (!String(p.get('openid.return_to') || '').startsWith(`${url.origin}/auth/steam/callback?`)) return null;
  const m = String(p.get('openid.claimed_id') || '').match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{5,20})$/);
  if (!m) return null;
  // Ask Steam to confirm it really signed this.
  const check = new URLSearchParams();
  for (const [k, v] of p) if (k.startsWith('openid.')) check.set(k, v);
  check.set('openid.mode', 'check_authentication');
  const r = await fetch(STEAM, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: check });
  if (!r.ok || !/is_valid\s*:\s*true/.test(await r.text())) return null;
  const who = { sub: m[1], name: null, picture: null };
  if (env.STEAM_API_KEY) {
    const pr = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(env.STEAM_API_KEY)}&steamids=${m[1]}`);
    const pl = pr.ok ? ((await pr.json()).response?.players || [])[0] : null;
    if (pl) Object.assign(who, { name: pl.personaname || null, picture: pl.avatarfull || null });
  }
  return who;
}

/* ---------- Telegram: the login widget ---------- */

function telegramStart(env, req) {
  const url = new URL(req.url);
  const { cookie } = stashCookie(req, url, 'telegram');
  const bot = String(env.TELEGRAM_BOT_NAME || '').replace(/[^A-Za-z0-9_]/g, '');
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="impact-site-verification" value="c1bf013b-98e9-4301-81d1-32679b2d3b60"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in with Telegram · RookieGamers</title>
<link rel="stylesheet" href="/site.css"></head><body><main style="max-width:420px;margin:12vh auto;text-align:center;padding:0 16px"><h1>Sign in with Telegram</h1>
<p class="muted">Confirm in Telegram, and you'll come straight back.</p>
<script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="${bot}" data-size="large" data-auth-url="${url.origin}/auth/telegram/callback" data-request-access="write"></script>
<p><a href="/signin">Back</a></p></main></body></html>`;
  const h = new Headers({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  h.append('set-cookie', cookie);
  return new Response(page, { headers: h });
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

// https://core.telegram.org/widgets/login#checking-authorization
export async function telegramCheck(params, botToken, nowSec = Math.floor(Date.now() / 1000)) {
  const hash = params.get('hash');
  if (!hash || !botToken) return false;
  const lines = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(lines)));
  const age = nowSec - Number(params.get('auth_date') || 0);
  return sig === hash && age >= 0 && age < 86400;
}

async function telegramWho(env, req) {
  const p = new URL(req.url).searchParams;
  if (!(await telegramCheck(p, env.TELEGRAM_BOT_TOKEN))) return null;
  const name = [p.get('first_name'), p.get('last_name')].filter(Boolean).join(' ') || p.get('username');
  const photo = p.get('photo_url');
  return { sub: p.get('id'), name, handle: p.get('username') || null, picture: photo && /^https:\/\//.test(photo) ? photo : null };
}

/* ---------- Bluesky: AT Protocol OAuth ---------- */

// The portal is a public OAuth client: its client id is the URL of this metadata document.
export function blueskyMetadata(origin) {
  return {
    client_id: `${origin}/auth/bluesky/client-metadata.json`, client_name: 'RookieGamers', client_uri: origin,
    application_type: 'web', grant_types: ['authorization_code'], response_types: ['code'], scope: 'atproto',
    redirect_uris: [`${origin}/auth/bluesky/callback`], dpop_bound_access_tokens: true, token_endpoint_auth_method: 'none',
  };
}

const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uText = s => b64u(new TextEncoder().encode(s));
const ENTRYWAY = 'https://bsky.social';

async function getJSON(u) {
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
}

async function didDoc(did) {
  if (/^did:plc:[a-z2-7]{24}$/.test(did)) return getJSON(`https://plc.directory/${did}`);
  const web = did.match(/^did:web:([a-z0-9.-]+)$/i);
  if (web) return getJSON(`https://${web[1]}/.well-known/did.json`);
  throw new Error('unsupported DID');
}
const pdsOf = doc => { const s = (doc.service || []).find(x => x.id === '#atproto_pds' || x.id === `${doc.id}#atproto_pds`); return s && s.serviceEndpoint; };
async function authServerFor(pds) {
  const pr = await getJSON(`${String(pds).replace(/\/$/, '')}/.well-known/oauth-protected-resource`);
  return pr.authorization_servers && pr.authorization_servers[0];
}
const asMeta = iss => getJSON(`${iss.replace(/\/$/, '')}/.well-known/oauth-authorization-server`);

async function dpopKey() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d };
}
async function dpopProof(jwk, htm, htu, nonce) {
  const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
  const body = { jti: newId('', 24), htm, htu, iat: Math.floor(Date.now() / 1000), ...(nonce ? { nonce } : {}) };
  const input = `${b64uText(JSON.stringify(head))}.${b64uText(JSON.stringify(body))}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${b64u(sig)}`;
}
// POST with a DPoP proof, retrying once with the server's nonce when it asks for one.
async function dpopPost(u, form, jwk, nonce) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', dpop: await dpopProof(jwk, 'POST', u, nonce) }, body: new URLSearchParams(form) });
    const next = r.headers.get('dpop-nonce') || nonce;
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { json: j, nonce: next };
    if (j.error === 'use_dpop_nonce' && next && next !== nonce && i === 0) { nonce = next; continue; }
    throw new Error(`${u}: ${r.status} ${j.error || ''}`);
  }
  throw new Error('dpop retry failed');
}

async function blueskyStart(req) {
  const url = new URL(req.url);
  try {
    // With ?handle= we find that account's own server; otherwise Bluesky's main sign-in page.
    const handle = String(url.searchParams.get('handle') || '').trim().replace(/^@/, '').toLowerCase();
    let iss = ENTRYWAY;
    if (handle) {
      if (!/^[a-z0-9.-]{3,253}$/.test(handle)) return redirect('/signin?failed=1');
      const { did } = await getJSON(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
      iss = await authServerFor(pdsOf(await didDoc(did)));
    }
    const meta = await asMeta(iss);
    if (meta.issuer !== iss.replace(/\/$/, '')) throw new Error('issuer mismatch');
    const jwk = await dpopKey();
    const verifier = newId('', 64);
    const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const md = blueskyMetadata(url.origin);
    const state = newId('', 32);
    const form = { client_id: md.client_id, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state, redirect_uri: md.redirect_uris[0], scope: 'atproto', ...(handle ? { login_hint: handle } : {}) };
    const { json, nonce } = await dpopPost(meta.pushed_authorization_request_endpoint, form, jwk);
    const stash = { state, route: 'bluesky', age: url.searchParams.get('age') === '1', next: safeNext(url.searchParams.get('next')), iss: meta.issuer, token: meta.token_endpoint, verifier, jwk, nonce };
    const q = new URLSearchParams({ client_id: md.client_id, request_uri: json.request_uri });
    return redirect(`${meta.authorization_endpoint}?${q}`, [setCookie(req, 'rg_oidc', JSON.stringify(stash), 600)]);
  } catch (e) {
    console.error('bluesky start', e && e.message);
    return redirect(`/signin?failed=1&next=${encodeURIComponent(safeNext(url.searchParams.get('next')))}`);
  }
}

async function blueskyWho(req, stash) {
  const url = new URL(req.url), p = url.searchParams;
  if (!p.get('code') || p.get('state') !== stash.state || p.get('iss') !== stash.iss) return null;
  const md = blueskyMetadata(url.origin);
  const { json } = await dpopPost(stash.token, { grant_type: 'authorization_code', code: p.get('code'), redirect_uri: md.redirect_uris[0], code_verifier: stash.verifier, client_id: md.client_id }, stash.jwk, stash.nonce);
  const did = String(json.sub || '');
  if (!/^did:(plc|web):/.test(did) || !String(json.scope || '').split(' ').includes('atproto')) return null;
  // The account's own DID document has to point at the server that signed it in.
  const iss = await authServerFor(pdsOf(await didDoc(did)));
  if (String(iss).replace(/\/$/, '') !== stash.iss) return null;
  const prof = await getJSON(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`).catch(() => ({}));
  return { sub: did, name: prof.displayName || prof.handle || null, handle: prof.handle || null, picture: prof.avatar || null };
}

export const _test = { sha256 };
