import { db, monthKey, prevMonth } from './db.js';
import { emailVerify, socialStart, socialCallback, NETWORK_IDS } from './auth.js';
import { EXTRA, extraStart, extraCallback, blueskyMetadata } from './social-extra.js';
import { metaDeletion } from './account.js';
import { jwks } from './tokens.js';
import { apiV1, apiPortal, apiDev, json, CORS } from './api.js';
import { mcp } from './mcp.js';
import { page, notFoundPage } from './pages.js';
import { archiveMonth } from './play.js';
import { siteURL, contentType } from './dev.js';
import { stripeWebhook, moneyPage } from './money-api.js';
import { monthlyMoney } from './money.js';
import { ROBOTS_TXT, SITEMAP_XML, LLMS_TXT, LLMS_FULL_TXT } from './seo/files.js';

// Routes for rookiegamers.com: the portal pages, the SDK API (/api/v1), the developer API
// (/api/dev), the MCP server (/mcp), and hosted game files (on GAMES_HOST, or /hosted/ locally).

const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

// Hosted builds live in R2 at <slug>/<version>/<path>. Only the live version is served.
async function hosted(env, DB, slug, rest) {
  if (!env.GAMES) return new Response('Game hosting is not set up.', { status: 503 });
  const g = await DB.prepare('SELECT version, live FROM games WHERE slug = ? AND kind = ?').bind(slug, 'hosted').first();
  if (!g || !g.live || !g.version) return new Response('Not found', { status: 404 });
  const path = !rest || rest.endsWith('/') ? (rest || '') + 'index.html' : rest;
  if (path.includes('..')) return new Response('Not found', { status: 404 });
  const obj = await env.GAMES.get(`${slug}/${g.version}/${path}`);
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers({ 'content-type': obj.httpMetadata?.contentType || contentType(path), etag: obj.httpEtag,
    'cache-control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*' });
  return new Response(obj.body, { headers: h });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const DB = await Promise.resolve(db(env)).catch(e => { console.error('db', e); return null; });
    if (!DB) return json({ error: 'The portal database is offline.' }, 503);

    // The separate games host serves hosted builds and nothing else.
    if (env.GAMES_HOST && url.hostname === env.GAMES_HOST) {
      const m = path.match(/^\/([a-z0-9-]{1,32})(?:\/(.*))?$/);
      if (!m) return new Response('Not found', { status: 404 });
      if (m[2] === undefined) return Response.redirect(`${url.origin}/${m[1]}/`, 301);
      return hosted(env, DB, m[1], decodeURIComponent(m[2]));
    }

    try {
      if (path === '/robots.txt') return new Response(ROBOTS_TXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (path === '/sitemap.xml') return new Response(SITEMAP_XML, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
      if (path === '/llms.txt') return new Response(LLMS_TXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (path === '/llms-full.txt') return new Response(LLMS_FULL_TXT, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
      if (path === '/.well-known/jwks.json') return json(await jwks(DB), 200, { ...CORS, 'cache-control': 'public, max-age=300' });
      if (path === '/mcp') return mcp(req, env, DB, siteURL(env));
      if (path.startsWith('/api/v1/') || path === '/api/v1') return await apiV1(req, env, DB, url);
      if (path.startsWith('/api/dev/games') || path.startsWith('/api/dev/payouts')) return await apiDev(req, env, DB, url);
      if (path === '/stripe/webhook') return await stripeWebhook(req, env, DB);
      if (path.startsWith('/api/admin/')) {
        const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        if (!env.ADMIN_TOKEN || !timingSafeEqual(tok, env.ADMIN_TOKEN)) return json({ error: 'Admin only.' }, 401);
        return await apiDev(req, env, DB, url, { admin: true });
      }
      if (path.startsWith('/api/')) return await apiPortal(req, env, DB, url);
      if (path === '/auth/email') return await emailVerify(DB, req);
      let m;
      // /auth/oidc is SceneSpot; /auth/google, /auth/discord and the rest are social networks.
      if ((m = path.match(/^\/auth\/([a-z]{1,16})(\/callback)?$/)) && (m[1] === 'oidc' || NETWORK_IDS.includes(m[1]))) {
        if (EXTRA.includes(m[1])) return m[2] ? await extraCallback(DB, env, req, m[1]) : await extraStart(env, req, m[1]);
        return m[2] ? await socialCallback(DB, env, req, m[1]) : await socialStart(env, req, m[1]);
      }
      if (path === '/auth/facebook/deletion' && req.method === 'POST') return await metaDeletion(DB, env, req, url.origin);
      if (path === '/auth/bluesky/client-metadata.json') return json(blueskyMetadata(url.origin));

      if ((m = path.match(/^\/hosted\/([a-z0-9-]{1,32})(?:\/(.*))?$/))) {
        if (m[2] === undefined) return Response.redirect(`${url.origin}/hosted/${m[1]}/`, 301);
        const res = await hosted(env, DB, m[1], decodeURIComponent(m[2]));
        // Served from the portal origin, so keep it locked in an opaque-origin sandbox.
        const out = new Response(res.body, res);
        out.headers.set('content-security-policy', 'sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock');
        return out;
      }

      const mp = await moneyPage(path, url, env, DB, req);
      if (mp) return mp;
      const res = await page(path, url, env, DB, req);
      if (res) return res;
    } catch (e) {
      console.error(e);
      return path.startsWith('/api/') || path === '/mcp' ? json({ error: 'Something went wrong. Try again.' }, 500) : new Response('Something went wrong.', { status: 500 });
    }

    const asset = await env.ASSETS.fetch(req);
    if (asset.status !== 404) {
      if (path.startsWith('/sdk/')) {
        const out = new Response(asset.body, asset);
        out.headers.set('access-control-allow-origin', '*');
        out.headers.set('cache-control', 'public, max-age=300');
        return out;
      }
      return asset;
    }
    return notFoundPage(DB, req);
  },

  // Just after midnight UTC on the 1st, seal last month into the Hall of Fame.
  async scheduled(event, env, ctx) {
    const DB = await Promise.resolve(db(env)).catch(() => null);
    // Then close last month's sponsor ads and pay developers.
    if (DB) ctx.waitUntil(archiveMonth(DB, prevMonth(monthKey())).then(() => monthlyMoney(DB, env, prevMonth(monthKey()))));
  },
};
