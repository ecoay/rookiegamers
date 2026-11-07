// A small Stripe client over fetch: form-encoded requests, idempotency keys, and webhook checks.
// The portal is the seller on every sale (one Stripe account), and developers are paid out
// through Stripe Connect Express accounts.

export class StripeError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }

export const stripeReady = env => !!env.STRIPE_SECRET_KEY;

// Stripe takes nested params as a[b][c]=v, and lists as a[0][b]=v.
export function formEncode(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? formEncode(item, `${key}[${i}]`, out) : out.append(`${key}[]`, String(item))));
    else if (typeof v === 'object') formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe(env, method, path, params, { idempotencyKey } = {}) {
  if (!stripeReady(env)) throw new StripeError(503, 'Payments aren\'t set up yet (no STRIPE_SECRET_KEY).');
  const base = (env.STRIPE_API || 'https://api.stripe.com').replace(/\/$/, '');
  const headers = { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'stripe-version': '2024-06-20' };
  let url = base + path, body;
  if (method === 'GET') { const q = formEncode(params).toString(); if (q) url += (url.includes('?') ? '&' : '?') + q; }
  else { body = formEncode(params).toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  const r = await fetch(url, { method, headers, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new StripeError(r.status, j.error?.message || `Stripe said ${r.status}`, j.error?.code);
  return j;
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg)));
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=...]. Returns the parsed event, or null.
export async function verifyWebhook(env, payload, header, tolerance = 300) {
  if (!env.STRIPE_WEBHOOK_SECRET || !header) return null;
  let t = null; const sigs = [];
  for (const p of String(header).split(',')) {
    const [k, v] = p.split('=');
    if (k === 't') t = Number(v); else if (k === 'v1' && v) sigs.push(v.trim());
  }
  if (!t || !sigs.length || Math.abs(Date.now() / 1000 - t) > tolerance) return null;
  const want = await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${payload}`);
  let match = false;
  for (const s of sigs) { if (s.length === want.length) { let x = 0; for (let i = 0; i < s.length; i++) x |= s.charCodeAt(i) ^ want.charCodeAt(i); if (!x) match = true; } }
  if (!match) return null;
  try { return JSON.parse(payload); } catch { return null; }
}
