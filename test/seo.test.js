import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { ABOUT_PAGE, CREATORS_PAGE, AI_PAGE, FAQ_PAGE, FOOTER_LINKS } from '../src/seo/copy.js';
import { ROBOTS_TXT, LLMS_TXT, LLMS_FULL_TXT } from '../src/seo/files.js';
import { STATIC_PATHS, adsTxt } from '../src/seo/dynamic.js';
import { createPlayer, sha256, getGame } from '../src/db.js';
import { createShare } from '../src/growth.js';

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
  assert.match(t, /- \[BuyYourFriends\]\(https:\/\/rookiegamers\.com\/play\/buyyourfriends\): Buy your friends\. A social tycoon/);

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

test('/mcp still answers, unaffected by the SEO routes (401 asking for sign-in without a token)', async () => {
  const env = await setup();
  const req = new Request(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) });
  const res = await worker.fetch(req, env, {});
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /resource_metadata=/);
  const meta = await worker.fetch(new Request(SITE + '/.well-known/oauth-protected-resource/mcp'), env, {});
  assert.equal((await meta.json()).resource, SITE + '/mcp');
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

test('home and a pages.js page include impact-site-verification', async () => {
  const env = await setup();
  const meta = /<meta name="impact-site-verification" value="c1bf013b-98e9-4301-81d1-32679b2d3b60">/;
  assert.match(await (await get(env, '/')).text(), meta);
  assert.match(await (await get(env, '/privacy')).text(), meta);
  assert.match(await (await get(env, '/about')).text(), meta);
});

test('the games host serves the SDK for games that load it with a relative path', async () => {
  const seen = [];
  const env = await setup({ GAMES_HOST: 'games.rookiegamers.com', SITE_URL: SITE, ASSETS: { fetch: async r => { seen.push(new URL(r.url).pathname); return new Response('/* sdk */', { headers: { 'content-type': 'text/javascript' } }); } } });
  const res = await get(env, '/sdk/v1.js', 'https://games.rookiegamers.com');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '/* sdk */');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(seen, ['/sdk/v1.js']);
});

/* ---------- Google Analytics 4 on public HTML pages only ---------- */

const GA_SCRIPT = /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-K05JD2HSXT"><\/script>/;
const GA_INLINE = /window\.dataLayer = window\.dataLayer \|\| \[\]; function gtag\(\)\{dataLayer\.push\(arguments\);\} gtag\('js', new Date\(\)\); gtag\('config', 'G-K05JD2HSXT'\);/;
const GA_ID = /G-K05JD2HSXT/;
function assertGa4Head(html, label) {
  assert.match(html, GA_SCRIPT, label);
  assert.match(html, GA_INLINE, label);
  const head = html.match(/<head[\s\S]*?<\/head>/i);
  assert.ok(head, label + ' has a head');
  assert.match(head[0], GA_SCRIPT, label + ' snippet is in <head>');
}

const GA_LAYOUT_PATHS = [
  '/', '/about', '/creators', '/ai', '/faq', '/dev', '/docs', '/hall-of-fame', '/shop',
  '/privacy', '/terms', '/data-deletion', '/play/unsays',
];

test('GA4 snippet is in the head of every listed public HTML page and other layout pages', async () => {
  const env = await setup();
  await env.DB.prepare('INSERT INTO studios (slug, name, owner_id, logo, url, bio, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind('acme', 'Acme Studio', null, null, null, 'A test studio.', 0).run();
  const paths = [...GA_LAYOUT_PATHS, '/studio/acme'];
  for (const path of paths) {
    const res = await get(env, path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type') || '', /text\/html/, path);
    assertGa4Head(await res.text(), path);
  }
});

test('/play/* has GA4 on the outer portal page only, not inside the game iframe element', async () => {
  const env = await setup();
  const html = await (await get(env, '/play/unsays')).text();
  assertGa4Head(html, '/play/unsays');
  const iframe = html.match(/<iframe\b[^>]*>/i);
  assert.ok(iframe, 'play page frames the game');
  assert.doesNotMatch(iframe[0], GA_ID);
  assert.match(iframe[0], /src="https:\/\/unsays\.com\/\?rg=1"/);
  const headEnd = html.indexOf('</head>');
  const iframeAt = html.indexOf('<iframe');
  assert.ok(headEnd !== -1 && iframeAt > headEnd, 'gtag is in the portal head, iframe is in the body');
});

test('hosted game files and the games host do not receive the GA4 snippet', async () => {
  const gameHtml = '<!doctype html><html><head><title>Dodge</title></head><body><p>play</p></body></html>';
  const files = new Map();
  const GAMES = {
    get: async k => {
      if (!files.has(k)) return null;
      const body = files.get(k);
      return { body, httpMetadata: { contentType: 'text/html; charset=utf-8' }, httpEtag: '"g"' };
    },
  };
  files.set('dodge/1.0.0/index.html', gameHtml);
  const env = await setup({ GAMES, GAMES_HOST: 'games.rookiegamers.com' });
  await env.DB.prepare(`INSERT INTO games (slug, title, kind, developer, live, version, released_at, created_at) VALUES ('dodge', 'Dodge', 'hosted', 'me', 1, '1.0.0', 0, 0)`).run();

  const play = await get(env, '/play/dodge');
  assert.equal(play.status, 200);
  const playHtml = await play.text();
  assertGa4Head(playHtml, '/play/dodge');
  assert.match(playHtml, /<iframe\b[^>]*src="https:\/\/games\.rookiegamers\.com\/dodge\/"/);

  const hosted = await get(env, '/hosted/dodge/');
  assert.equal(hosted.status, 200);
  const hostedBody = await hosted.text();
  assert.equal(hostedBody, gameHtml);
  assert.doesNotMatch(hostedBody, GA_ID);
  assert.match(hosted.headers.get('content-security-policy') || '', /sandbox/);

  const origin = await get(env, '/dodge/', 'https://games.rookiegamers.com');
  assert.equal(origin.status, 200);
  const originBody = await origin.text();
  assert.equal(originBody, gameHtml);
  assert.doesNotMatch(originBody, GA_ID);
  assert.equal(origin.headers.get('content-security-policy'), null);
});

test('GA4 is not injected into /mcp, /api or /sdk responses', async () => {
  const env = await setup({
    ASSETS: { fetch: async () => new Response('/* sdk */', { headers: { 'content-type': 'text/javascript; charset=utf-8' } }) },
  });

  const mcp = await worker.fetch(new Request(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) }), env, {});
  assert.equal(mcp.status, 401);
  assert.doesNotMatch(mcp.headers.get('content-type') || '', /text\/html/);
  assert.doesNotMatch(await mcp.text(), GA_ID);

  const api = await get(env, '/api/v1/games');
  assert.equal(api.status, 200);
  assert.match(api.headers.get('content-type') || '', /json/);
  assert.doesNotMatch(await api.text(), GA_ID);

  const sdk = await get(env, '/sdk/v1.js');
  assert.equal(sdk.status, 200);
  const sdkBody = await sdk.text();
  assert.equal(sdkBody, '/* sdk */');
  assert.doesNotMatch(sdkBody, GA_ID);
});

test('/privacy describes Google Analytics honestly, keeps Advertising, and makes no consent-tool claim', async () => {
  const env = await setup();
  const html = await (await get(env, '/privacy')).text();
  assertGa4Head(html, '/privacy');
  assert.match(html, /<h2 id="analytics">Analytics<\/h2>/);
  assert.match(html, /Google Analytics to measure aggregate traffic/);
  assert.match(html, /pages visited/);
  assert.match(html, /device and browser information/);
  assert.match(html, /approximate location/);
  assert.match(html, /href="https:\/\/policies\.google\.com\/technologies\/partner-sites"/);
  assert.match(html, /href="https:\/\/tools\.google\.com\/dlpage\/gaoptout"/);
  assert.match(html, /<h2 id="advertising">Advertising<\/h2>/);
  assert.match(html, /href="https:\/\/www\.google\.com\/settings\/ads"/);
  assert.match(html, /href="https:\/\/www\.aboutads\.info\/choices\/"/);
  assert.doesNotMatch(html, /consent (banner|management|CMP)|we (show|display) a consent/i);
});

test('public HTML pages have no script-src CSP that would require a nonce or hash for the GA4 inline script', async () => {
  const env = await setup();
  for (const path of ['/', '/privacy', '/play/unsays']) {
    const res = await get(env, path);
    assert.equal(res.status, 200, path);
    const csp = res.headers.get('content-security-policy') || '';
    assert.doesNotMatch(csp, /script-src/, path);
    assertGa4Head(await res.text(), path);
  }
});

test('GA4 is absent from /admin, /signin, /oauth/authorize, /auth/telegram, /sdk/connect and /sdk/link', async () => {
  const env = await setup({ TELEGRAM_BOT_NAME: 'rg_bot' });
  const noGa = async (path, status, req = path) => {
    const res = typeof req === 'string' ? await get(env, req) : req;
    assert.equal(res.status, status, path);
    assert.match(res.headers.get('content-type') || '', /text\/html/, path);
    assert.doesNotMatch(await res.text(), GA_ID, path);
  };
  await noGa('/signin', 200);
  await noGa('/oauth/authorize', 400);
  await noGa('/auth/telegram', 200, await get(env, '/auth/telegram'));
  await noGa('/sdk/connect', 400);
  await noGa('/sdk/link', 400);

  const { sha256: hash } = { sha256 };
  async function session(name) {
    const id = await createPlayer(env.DB, { name, email: `${name}@example.com` });
    const tok = 'tok' + 'x'.repeat(30) + name;
    await env.DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, 0)').bind(await hash(tok), id).run();
    return { id, cookie: `rg_sid=${tok}` };
  }
  const player = await session('pat');
  const forbidden = await worker.fetch(new Request(SITE + '/admin', { headers: { cookie: player.cookie } }), env, {});
  await noGa('/admin (not admin)', 403, forbidden);

  const admin = await session('ada');
  env.ADMIN_PLAYERS = admin.id;
  const ok = await worker.fetch(new Request(SITE + '/admin', { headers: { cookie: admin.cookie } }), env, {});
  await noGa('/admin', 200, ok);
});

test('GA4 stays on /u/*, /s/* and the 404 page', async () => {
  const env = await setup();
  const id = await createPlayer(env.DB, { name: 'sam', email: 'sam@example.com' });
  const profile = await get(env, '/u/' + id);
  assert.equal(profile.status, 200);
  assertGa4Head(await profile.text(), '/u/' + id);

  const g = await getGame(env.DB, 'unsays');
  const share = await createShare(env.DB, SITE, g, id, { score: 10 });
  const page = await get(env, '/s/' + share.id);
  assert.equal(page.status, 200);
  assertGa4Head(await page.text(), '/s/' + share.id);

  const missing = await get(env, '/this-page-does-not-exist');
  assert.equal(missing.status, 404);
  assertGa4Head(await missing.text(), '404');
});
