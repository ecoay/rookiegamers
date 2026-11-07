import { newId, now } from './db.js';

// Short-lived player tokens, signed with ES256 (P-256). A game's server checks them against the
// public keys at /.well-known/jwks.json, so a browser can't pretend to be another player.

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
export const TOKEN_TTL = 15 * 60;

const enc = new TextEncoder();
export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const b64urlDecode = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const b64json = o => b64url(enc.encode(JSON.stringify(o)));

let cached = null;
async function signingKey(DB) {
  if (cached) return cached;
  let row = await DB.prepare('SELECT * FROM keys ORDER BY created_at ASC, kid ASC LIMIT 1').first();
  if (!row) {
    const pair = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
    const kid = newId('k', 16);
    const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
    // Two isolates can race here; the first insert wins and both read it back.
    await DB.prepare('INSERT OR IGNORE INTO keys (kid, private_jwk, public_jwk, created_at) VALUES (?, ?, ?, ?)')
      .bind(kid, JSON.stringify(priv), JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }), now()).run();
    row = await DB.prepare('SELECT * FROM keys ORDER BY created_at ASC, kid ASC LIMIT 1').first();
  }
  const key = await crypto.subtle.importKey('jwk', JSON.parse(row.private_jwk), ALG, false, ['sign']);
  cached = { kid: row.kid, key };
  return cached;
}

export async function jwks(DB) {
  await signingKey(DB);
  const rows = (await DB.prepare('SELECT kid, public_jwk FROM keys').all()).results;
  return { keys: rows.map(r => ({ ...JSON.parse(r.public_jwk), kid: r.kid, alg: 'ES256', use: 'sig' })) };
}

export async function signToken(DB, env, claims, ttl = TOKEN_TTL) {
  const { kid, key } = await signingKey(DB);
  const iat = Math.floor(now() / 1000);
  const body = `${b64json({ alg: 'ES256', typ: 'JWT', kid })}.${b64json({ iss: issuer(env), iat, exp: iat + ttl, ...claims })}`;
  const sig = await crypto.subtle.sign(SIGN, key, enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

// Returns the claims, or null if the token is malformed, expired, or not ours.
export async function verifyToken(DB, env, token, { aud } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let head, claims;
  try { head = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))); } catch { return null; }
  if (head.alg !== 'ES256') return null;
  const row = await DB.prepare('SELECT public_jwk FROM keys WHERE kid = ?').bind(String(head.kid || '')).first();
  if (!row) return null;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(row.public_jwk), ALG, false, ['verify']);
  const ok = await crypto.subtle.verify(SIGN, key, b64urlDecode(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok || claims.iss !== issuer(env) || !(claims.exp > now() / 1000)) return null;
  if (aud && claims.aud !== aud) return null;
  return claims;
}

export const issuer = env => (env.SITE_URL || 'https://rookiegamers.com').replace(/\/$/, '');
