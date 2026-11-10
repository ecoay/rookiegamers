import { db, monthKey, prevMonth } from './db.js';
import { emailVerify, socialStart, socialCallback, NETWORK_IDS } from './auth.js';
import { EXTRA, extraStart, extraCallback, blueskyMetadata } from './social-extra.js';
import { metaDeletion } from './account.js';
import { jwks } from './tokens.js';
import { apiV1, apiPortal, apiDev, json, CORS } from './api.js';
import { mcp } from './mcp.js';
import { oauthRoute } from './oauth.js';
import { adminPage, adminSession } from './admin.js';
import { page, notFoundPage } from './pages.js';
import { archiveMonth } from './play.js';
import { siteURL, contentType, previewSig } from './dev.js';
import { stripeWebhook, moneyPage } from './money-api.js';
import { monthlyMoney } from './money.js';
import { ROBOTS_TXT, LLMS_TXT, LLMS_FULL_TXT } from './seo/files.js';
import { liveCatalog, sitemapXML, llmsGameLines, llmsFullGameLines, adsTxt } from './seo/dynamic.js';

// Routes for rookiegamers.com: the portal pages, the SDK API (/api/v1), the developer API
// (/api/dev), the MCP server (/mcp), and hosted game files (on GAMES_HOST, or /hosted/ locally).

const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

// Hosted builds live in R2 at <slug>/<version>/<path>. Only the live version is served, plus
// builds opened with a signed review link (~<sig>/<version>/...) from the admin review queue.
async function hosted(env, DB, slug, rest) {
  if (!env.GAMES) return new Response('Game hosting is not set up.', { status: 503 });
  let version, pm;
  if ((pm = /^~([a-f0-9]{32})\/([^/]{1,40})\/(.*)$/.exec(rest || ''))) {
    const exists = await DB.prepare('SELECT 1 FROM builds WHERE game = ? AND version = ?').bind(slug, pm[2]).first();
    if (!exists || pm[1] !== await previewSig(env, slug, pm[2])) return new Response('Not found', { status: 404 });
    version = pm[2]; rest = pm[3];
  } else {
    const g = await DB.prepare('SELECT version, live FROM games WHERE slug = ? AND kind = ?').bind(slug, 'hosted').first();
    if (!g || !g.live || !g.version) return new Response('Not found', { status: 404 });
    version = g.version;
  }
  const path = !rest || rest.endsWith('/') ? (rest || '') + 'index.html' : rest;
  if (path.includes('..')) return new Response('Not found', { status: 404 });
  const obj = await env.GAMES.get(`${slug}/${version}/${path}`);
  if (!obj) return new Response('Not found', { status: 404 });
  const h = new Headers({ 'content-type': obj.httpMetadata?.contentType || contentType(path), etag: obj.httpEtag,
    'cache-control': path.endsWith('.html') ? 'no-cache' : 'public, max-age=300', 'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'cross-origin', 'access-control-allow-origin': '*' });
  return new Response(obj.body, { headers: h });
}

// Copies of the site on other hosts (the workers.dev address, preview URLs) stay out of search
// results. Their pages already point their canonical tag at rookiegamers.com.
const INDEXED_HOSTS = new Set(['rookiegamers.com', 'localhost', '127.0.0.1']);
function keepOffSearch(res) {
  if (res.headers.has('x-robots-tag')) return res;
  const out = new Response(res.body, res);
  out.headers.set('x-robots-tag', 'noindex');
  return out;
}

// Staging (STAGING=1 in wrangler.jsonc env.staging) is a separate copy of the site with its own
// database and storage, for developers testing games from localhost. Every page says so.
const STAGING_BAR = '<div style="position:sticky;top:0;z-index:9999;background:#f5b82e;color:#14110a;font:600 14px system-ui,sans-serif;text-align:center;padding:6px 12px">Staging: test data only, separate from rookiegamers.com, and it may be wiped at any time. <a href="/docs#staging" style="color:inherit">How to test here</a></div>';
async function stagingBanner(res) {
  if (!(res.headers.get('content-type') || '').startsWith('text/html')) return res;
  const html = (await res.text()).replace(/<body[^>]*>/, m => m + STAGING_BAR);
  const out = new Response(html, res);
  out.headers.delete('content-length');
  return out;
}

async function handle(req, env, ctx) {
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
    const text = (body, type = 'text/plain') => new Response(body, { headers: { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'public, max-age=600' } });
    if (path === '/robots.txt') return text(ROBOTS_TXT);
    if (path === '/ads.txt') return text(adsTxt(env));
    if (path === '/sitemap.xml') return text(sitemapXML(await liveCatalog(DB)), 'application/xml');
    if (path === '/llms.txt') { const games = await liveCatalog(DB); return text(LLMS_TXT.replace('{{GAMES}}', () => llmsGameLines(games))); }
    if (path === '/llms-full.txt') { const games = await liveCatalog(DB); return text(LLMS_FULL_TXT.replace('{{GAMES}}', () => llmsFullGameLines(games))); }
    if (path === '/.well-known/jwks.json') return json(await jwks(DB), 200, { ...CORS, 'cache-control': 'public, max-age=300' });
    if (path === '/mcp') return mcp(req, env, DB, siteURL(env));
    // OAuth for AI apps connecting to /mcp, and OpenAI's domain check for the ChatGPT plugin directory
    // (OPENAI_APPS_CHALLENGE is the token the OpenAI Platform shows, set in the Cloudflare dashboard).
    if (path.startsWith('/oauth/') || path.startsWith('/.well-known/oauth-')) { const r = await oauthRoute(req, env, DB, siteURL(env), url); if (r) return r; }
    if (path === '/.well-known/openai-apps-challenge') return env.OPENAI_APPS_CHALLENGE ? new Response(String(env.OPENAI_APPS_CHALLENGE).trim(), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }) : new Response('Not found', { status: 404 });
    if (path.startsWith('/api/v1/') || path === '/api/v1') return await apiV1(req, env, DB, url);
    if (path.startsWith('/api/dev/games') || path.startsWith('/api/dev/payouts')) return await apiDev(req, env, DB, url);
    if (path === '/stripe/webhook') return await stripeWebhook(req, env, DB);
    if (path.startsWith('/api/admin/')) {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      // The ADMIN_TOKEN (scripts, curl) or a signed-in admin on the /admin page.
      const ok = (env.ADMIN_TOKEN && timingSafeEqual(tok, env.ADMIN_TOKEN)) || (!tok && await adminSession(DB, env, req));
      if (!ok) return json({ error: 'Admin only.' }, 401);
      return await apiDev(req, env, DB, url, { admin: true });
    }
    if (path.startsWith('/api/')) return await apiPortal(req, env, DB, url);
    if (path === '/auth/email') return await emailVerify(DB, req);
    if (path === '/admin') return await adminPage(DB, env, req);
    let m;
    // Uploaded cover art and studio logos (src/dev.js). Names are unique per upload, so they cache forever.
    if ((m = path.match(/^\/(covers|logos)\/([a-z0-9-]{1,32})\/([a-z0-9]{12}\.(?:png|jpg|webp|gif|avif))$/))) {
      m = [m[0], m[2], m[3], m[1]];
      const obj = env.GAMES && await env.GAMES.get(`_${m[3]}/${m[1]}/${m[2]}`);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || contentType(m[2]), 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
    }
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
    return path.startsWith('/api/') || path === '/mcp' || path.startsWith('/oauth/') ? json({ error: 'Something went wrong. Try again.' }, 500) : new Response('Something went wrong.', { status: 500 });
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
}

export default {
  async fetch(req, env, ctx) {
    let res = await handle(req, env, ctx);
    if (env.STAGING === '1') res = await stagingBanner(res);
    const host = new URL(req.url).hostname;
    if (INDEXED_HOSTS.has(host) || (env.GAMES_HOST && host === env.GAMES_HOST)) return res;
    return keepOffSearch(res);
  },

  // Just after midnight UTC on the 1st, seal last month into the Hall of Fame.
  async scheduled(event, env, ctx) {
    const DB = await Promise.resolve(db(env)).catch(() => null);
    // Then close last month's sponsor ads and pay developers.
    if (DB) ctx.waitUntil(archiveMonth(DB, prevMonth(monthKey())).then(() => monthlyMoney(DB, env, prevMonth(monthKey()))));
  },
};
