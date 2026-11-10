import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { ABOUT_PAGE, CREATORS_PAGE, AI_PAGE, FAQ_PAGE, FOOTER_LINKS } from '../src/seo/copy.js';
import { ROBOTS_TXT, LLMS_TXT, LLMS_FULL_TXT } from '../src/seo/files.js';
import { STATIC_PATHS, adsTxt } from '../src/seo/dynamic.js';

// worker.js transitively imports docs/SDK.md (Wrangler's Text rule); give plain Node the same rule.
register('./md-loader.mjs', import.meta.url);
const { default: worker } = await import('../src/worker.js');

const SITE = 'https://rookiegamers.com';

const noAsset = { fetch: async () => new Response('Not found', { status: 404 }) };
async function setup(extra = {}) {
  const DB = fakeD1();
  await migrate(DB);
  return { DB, ASSETS: noAsset, ...extra };
}
async function get(env, path, site = SITE) {
  return worker.fetch(new Request(site + path), env, {});
}
const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));

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
    assert.equal(videoGame.isAccessibleForFree, true);
    assert.equal(videoGame.offers.price, '0');
    assert.match(html, /<meta property="og:image" content="https:\/\/rookiegamers\.com\/img\/og\.jpg">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, new RegExp(`<meta property="og:url" content="${SITE}/play/${slug}">`));
  });
}

test('every live game gets VideoGame data, its cover as the preview image, and a meta description', async () => {
  const env = await setup();
  await env.DB.prepare("UPDATE games SET live = 1, url = 'https://handofnine.com/', cover = 'https://handofnine.com/cover.png' WHERE slug = 'handofnine'").run();
  const html = await (await get(env, '/play/handofnine')).text();
  const game = ldBlocks(html)[0]['@graph'].find(n => n['@type'] === 'VideoGame');
  assert.equal(game.name, 'Hand of Nine');
  assert.equal(game.image, 'https://handofnine.com/cover.png');
  assert.deepEqual(game.genre, ['cards', 'puzzle']);
  assert.equal(game.playMode, 'SinglePlayer');
  assert.match(html, /<meta property="og:image" content="https:\/\/handofnine\.com\/cover\.png">/);
  assert.match(html, /<meta name="description" content="Arrange nine cards[^"]*Play free in your browser on RookieGamers\.">/);
  assert.match(html, /<title>Play Hand of Nine free online · RookieGamers<\/title>/);
});

test('a hosted game cover inside its build resolves to an absolute image URL', async () => {
  const { gameImage } = await import('../src/seo/dynamic.js');
  assert.equal(gameImage({}, { slug: 'youcult', kind: 'hosted', cover: 'img/cover.png' }), 'https://rookiegamers.com/hosted/youcult/img/cover.png');
  assert.equal(gameImage({ GAMES_HOST: 'games.example' }, { slug: 'youcult', kind: 'hosted', cover: 'cover.png' }), 'https://games.example/youcult/cover.png');
  assert.equal(gameImage({}, { slug: 'x', kind: 'linked', cover: 'cover.png' }), null);
  assert.equal(gameImage({}, { slug: 'x', kind: 'hosted', cover: '../secret' }), null);
});

test('the home page lists the live games as an ItemList', async () => {
  const env = await setup();
  const list = ldBlocks(await (await get(env, '/')).text()).find(b => b['@type'] === 'ItemList');
  assert.ok(list);
  assert.ok(list.itemListElement.some(i => i.url === SITE + '/play/unsays'));
});

test('pages on the workers.dev copy are kept out of search; rookiegamers.com is indexable', async () => {
  const env = await setup();
  assert.equal((await get(env, '/about', 'https://rookiegamers.ecoay.workers.dev')).headers.get('x-robots-tag'), 'noindex');
  assert.equal((await get(env, '/about')).headers.get('x-robots-tag'), null);
});

test('not-found and share pages are noindex', async () => {
  const env = await setup();
  const res = await get(env, '/play/nope');
  assert.equal(res.status, 404);
  assert.match(await res.text(), /<meta name="robots" content="noindex">/);
});

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

test('/sitemap.xml is application/xml and lists the public pages plus every live game from D1', async () => {
  const env = await setup();
  const res = await get(env, '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/xml/);
  const xml = await res.text();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
  for (const p of STATIC_PATHS) assert.ok(locs.includes(SITE + p), p);
  const live = (await env.DB.prepare('SELECT slug FROM games WHERE live = 1').all()).results.map(r => r.slug);
  assert.deepEqual(locs.filter(l => l.includes('/play/')).sort(), live.map(s => `${SITE}/play/${s}`).sort());
  assert.ok(!locs.includes(SITE + '/play/handofnine'), 'hidden games stay out');
  assert.ok(!locs.includes(SITE + '/signin'));
  assert.match(xml, /<loc>https:\/\/rookiegamers\.com\/play\/unsays<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
});

test('a game that goes live joins the sitemap, llms.txt and llms-full.txt without a deploy', async () => {
  const env = await setup();
  await env.DB.prepare("UPDATE games SET live = 1, url = 'https://handofnine.com/' WHERE slug = 'handofnine'").run();
  assert.match(await (await get(env, '/sitemap.xml')).text(), /\/play\/handofnine<\/loc>/);
  assert.match(await (await get(env, '/llms.txt')).text(), /- \[Hand of Nine\]\(https:\/\/rookiegamers\.com\/play\/handofnine\): Arrange nine cards/);
  assert.match(await (await get(env, '/llms-full.txt')).text(), /- Hand of Nine \(https:\/\/rookiegamers\.com\/play\/handofnine\), by ecoay: Arrange nine cards/);
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

test('/llms.txt and /llms-full.txt are text/plain, built from the fixtures with the live games filled in', async () => {
  const env = await setup();
  const llms = await get(env, '/llms.txt');
  assert.equal(llms.status, 200);
  assert.match(llms.headers.get('content-type'), /text\/plain/);
  const t = await llms.text();
  const [head, tail] = LLMS_TXT.split('{{GAMES}}');
  assert.ok(t.startsWith(head) && t.endsWith(tail));
  assert.ok(!t.includes('{{GAMES}}'));
  assert.match(t, /- \[unsays\]\(https:\/\/rookiegamers\.com\/play\/unsays\): Things you can't unsay/);
  assert.match(t, /- \[BuyYourFriends\]\(https:\/\/rookiegamers\.com\/play\/buyyourfriends\): a free web game by ecoay/);

  const full = await get(env, '/llms-full.txt');
  assert.equal(full.status, 200);
  assert.match(full.headers.get('content-type'), /text\/plain/);
  const f = await full.text();
  const [fh, ft] = LLMS_FULL_TXT.split('{{GAMES}}');
  assert.ok(f.startsWith(fh) && f.endsWith(ft));
  assert.match(f, /- unsays \(https:\/\/rookiegamers\.com\/play\/unsays\), by ecoay: Things you can't unsay/);
});

/* ---------- ads.txt, from settings entered in Cloudflare; MCP must keep working ---------- */

test('/ads.txt with nothing set lists the RookieGamers AdSense account, the owner and a contact', async () => {
  const env = await setup();
  const res = await get(env, '/ads.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const t = await res.text();
  assert.match(t, /^OWNERDOMAIN=rookiegamers\.com$/m);
  assert.match(t, /^contact=support@rookiegamers\.com$/m);
  assert.match(t, /^google\.com, pub-8081136929405133, DIRECT, f08c47fec0942fa0$/m);
  assert.doesNotMatch(t, /RESELLER/);
});

test('/ads.txt adds Google from ADSENSE_CLIENT and other seller lines from ADS_TXT', async () => {
  const env = await setup({ ADSENSE_CLIENT: 'ca-pub-1234567890123456',
    ADS_TXT: 'example-network.com, 9876, RESELLER, abc123\n# a comment\nnot a record\ngoogle.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\nMANAGERDOMAIN=example.com' });
  const t = await (await get(env, '/ads.txt')).text();
  assert.equal(t.match(/^google\.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0$/gm).length, 1, 'no duplicate Google line');
  assert.match(t, /^example-network\.com, 9876, RESELLER, abc123$/m);
  assert.match(t, /^MANAGERDOMAIN=example\.com$/m);
  assert.doesNotMatch(t, /not a record|a comment/);
  assert.doesNotMatch(t, /No ad networks/);
  // An Cloudflare text variable may arrive with literal \n separators.
  assert.match(adsTxt({ ADS_TXT: 'a.com, 1, DIRECT\\nb.com, 2, RESELLER' }), /^a\.com, 1, DIRECT\nb\.com, 2, RESELLER$/m);
  assert.doesNotMatch(adsTxt({ ADSENSE_CLIENT: 'not-a-pub' }), /google\.com/);
});

test('home and /privacy heads include the google-adsense-account meta', async () => {
  const env = await setup();
  const meta = /<meta name="google-adsense-account" content="ca-pub-8081136929405133">/;
  assert.match(await (await get(env, '/')).text(), meta);
  assert.match(await (await get(env, '/privacy')).text(), meta);
  assert.match(await (await get(env, '/about')).text(), meta);
});

test('home and a pages.js page include google-site-verification', async () => {
  const env = await setup();
  const meta = /<meta name="google-site-verification" content="OSHWSdXxLLrQTk12-QAup0nc3IHfnccGLamcxk2hDng">/;
  assert.match(await (await get(env, '/')).text(), meta);
  assert.match(await (await get(env, '/privacy')).text(), meta);
  assert.match(await (await get(env, '/about')).text(), meta);
});

test('/privacy discloses advertising cookies with Google opt-out links', async () => {
  const env = await setup();
  const html = await (await get(env, '/privacy')).text();
  assert.match(html, /Advertising/);
  assert.match(html, /href="https:\/\/www\.google\.com\/settings\/ads"/);
  assert.match(html, /href="https:\/\/www\.aboutads\.info\/choices\/"/);
  assert.match(html, /href="https:\/\/policies\.google\.com\/technologies\/partner-sites"/);
  assert.doesNotMatch(html, /consent (banner|management|CMP)|we (show|display) a consent/i);
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

test('markdown renders headings from Windows (CRLF) files, down to ####', async () => {
  const { markdown } = await import('../src/pages.js');
  const html = markdown('### Cloud saves\r\nText\r\n#### The ad terms\r\n');
  assert.match(html, /<h3 id="cloud-saves">Cloud saves<\/h3>/);
  assert.match(html, /<h4 id="the-ad-terms">The ad terms<\/h4>/);
  assert.ok(!html.includes('\r'));
});
