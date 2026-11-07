import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { ABOUT_PAGE, CREATORS_PAGE, AI_PAGE, FAQ_PAGE, FOOTER_LINKS } from '../src/seo/copy.js';
import { ROBOTS_TXT, SITEMAP_XML, LLMS_TXT, LLMS_FULL_TXT } from '../src/seo/files.js';

// worker.js transitively imports docs/SDK.md (Wrangler's Text rule); give plain Node the same rule.
register('./md-loader.mjs', import.meta.url);
const { default: worker } = await import('../src/worker.js');

const SITE = 'https://rookiegamers.com';

const noAsset = { fetch: async () => new Response('Not found', { status: 404 }) };
async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  return { DB, ASSETS: noAsset };
}
async function get(env, path) {
  return worker.fetch(new Request(SITE + path), env, {});
}

/* ---------- the four new pages ---------- */

const NEW_PAGES = { '/about': ABOUT_PAGE, '/creators': CREATORS_PAGE, '/ai': AI_PAGE, '/faq': FAQ_PAGE };

for (const [path, page] of Object.entries(NEW_PAGES)) {
  test(`${path} is 200 with the COPY.md title, canonical and JSON-LD`, async () => {
    const env = await setup();
    const res = await get(env, path);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await res.text();
    assert.match(html, new RegExp(`<title>${page.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</title>`));
    assert.match(html, new RegExp(`<meta name="description" content="${page.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}${path}">`));
    assert.match(html, new RegExp(`<h1>${page.h1}</h1>`));

    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    assert.deepEqual(blocks, page.jsonld);
  });
}

test('the home page links /about and the four new pages are in every footer', async () => {
  const env = await setup();
  const home = await (await get(env, '/')).text();
  assert.match(home, /href="\/about">Why we exist<\/a>/);
  for (const [href, label] of FOOTER_LINKS) {
    assert.match(home, new RegExp(`<a href="${href.replace('/', '\\/')}">${label}</a>`));
  }
  const about = await (await get(env, '/about')).text();
  for (const [href, label] of FOOTER_LINKS) {
    assert.match(about, new RegExp(`<a href="${href.replace('/', '\\/')}">${label}</a>`));
  }
});

/* ---------- /play/*: VideoGame must be the mainEntity of a WebPage, breadcrumb on the WebPage ---------- */

for (const slug of ['unsays', 'buyyourfriends']) {
  test(`/play/${slug} puts the VideoGame as mainEntity of a WebPage, with the BreadcrumbList on the WebPage`, async () => {
    const env = await setup();
    const res = await get(env, `/play/${slug}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`<link rel="canonical" href="${SITE}/play/${slug}">`));
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    assert.equal(blocks.length, 1);
    const graph = blocks[0]['@graph'];
    const webPage = graph.find(n => n['@type'] === 'WebPage');
    const videoGame = graph.find(n => n['@type'] === 'VideoGame');
    const breadcrumb = graph.find(n => n['@type'] === 'BreadcrumbList');
    assert.ok(webPage && videoGame && breadcrumb);
    assert.equal(webPage.mainEntity['@id'], videoGame['@id']);
    assert.equal(webPage.breadcrumb['@id'], breadcrumb['@id']);
    assert.equal(videoGame.breadcrumb, undefined, 'breadcrumb must not be on the VideoGame');
  });
}

/* ---------- /signin ---------- */

test('/signin is 200, crawlable, noindex,follow, and makes no saved-score promise', async () => {
  const env = await setup();
  const res = await get(env, '/signin');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.doesNotMatch(html, /your scores (are|will be) saved/i);
});

test('robots.txt does not disallow /signin', async () => {
  const env = await setup();
  const robots = await (await get(env, '/robots.txt')).text();
  assert.doesNotMatch(robots, /Disallow:\s*\/signin/);
});

/* ---------- root text files ---------- */

test('/robots.txt is text/plain and matches the bundled fixture, with a Sitemap line', async () => {
  const env = await setup();
  const res = await get(env, '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.equal(await res.text(), ROBOTS_TXT);
  assert.match(ROBOTS_TXT, /^Sitemap: https:\/\/rookiegamers\.com\/sitemap\.xml$/m);
});

test('/sitemap.xml is application/xml, valid, and has exactly 13 <loc> entries', async () => {
  const env = await setup();
  const res = await get(env, '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  const xml = await res.text();
  assert.equal(xml, SITEMAP_XML);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  assert.equal(locs.length, 13);
  for (const loc of locs) assert.match(loc, /^https:\/\/rookiegamers\.com/);
  assert.ok(!locs.includes('https://rookiegamers.com/signin'));
});

test('every sitemap URL actually resolves to 200', async () => {
  const env = await setup();
  const xml = await (await get(env, '/sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname);
  for (const path of locs) {
    const res = await get(env, path);
    assert.equal(res.status, 200, `${path} should be 200`);
  }
});

test('/llms.txt and /llms-full.txt are text/plain and match the bundled fixtures', async () => {
  const env = await setup();
  const llms = await get(env, '/llms.txt');
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get('content-type'), /text\/plain/);
  assert.equal(await llms.text(), LLMS_TXT);

  const full = await get(env, '/llms-full.txt');
  assert.equal(full.status, 200);
  assert.match(full.headers.get('content-type'), /text\/plain/);
  assert.equal(await full.text(), LLMS_FULL_TXT);
});

/* ---------- ads.txt must stay 404; MCP must keep working ---------- */

test('/ads.txt is still 404', async () => {
  const env = await setup();
  assert.equal((await get(env, '/ads.txt')).status, 404);
});

test('/mcp still answers initialize and tools/list, unaffected by the SEO routes', async () => {
  const env = await setup();
  const req = new Request(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.serverInfo.name, 'rookiegamers');

  const req2 = new Request(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
  const res2 = await worker.fetch(req2, env, {});
  const body2 = await res2.json();
  assert.ok(body2.result.tools.some(t => t.name === 'list_portal_games'));
});

/* ---------- review corrections: claim wording and schema logo ---------- */

const PUBLIC_TEXT_PATHS = ['/', '/about', '/creators', '/ai', '/faq', '/dev', '/docs', '/llms.txt', '/llms-full.txt'];

test('no public copy asserts ChatGPT integration does not exist; it says not verified', async () => {
  const env = await setup();
  let sawUnverified = false;
  for (const p of PUBLIC_TEXT_PATHS) {
    const t = await (await get(env, p)).text();
    assert.doesNotMatch(t, /ChatGPT integration (does not exist|yet)|no ChatGPT integration/i, p);
    if (/not verified a ChatGPT setup|any ChatGPT setup, have not been verified/.test(t)) sawUnverified = true;
  }
  assert.ok(sawUnverified);
});

test('/ai, /faq and llms files separate the live MCP server from unverified client setups', async () => {
  const env = await setup();
  for (const p of ['/ai', '/faq', '/llms.txt', '/llms-full.txt']) {
    const t = await (await get(env, p)).text();
    assert.match(t, /https:\/\/rookiegamers\.com\/mcp|MCP server is live/, p);
    assert.match(t, /not been verified end to end/, p);
  }
});

test('JSON-LD Organization has no logo pointing at the missing favicon', async () => {
  const env = await setup();
  for (const p of ['/', '/about', '/creators', '/ai', '/faq', '/dev', '/docs', '/hall-of-fame']) {
    const t = await (await get(env, p)).text();
    for (const m of t.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g))
      assert.doesNotMatch(m[1], /"logo"/, p);
  }
});

test('public SEO copy makes no sign-in on/off claim (deployment-dependent)', async () => {
  const env = await setup();
  for (const p of ['/about', '/faq', '/llms.txt', '/llms-full.txt']) {
    const t = await (await get(env, p)).text();
    assert.doesNotMatch(t, /sign-in is not switched on/i, p);
    assert.doesNotMatch(t, /as a guest|never need (one|an account)|guests can/i, p);
  }
});
