import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame } from '../src/db.js';
import * as dev from '../src/dev.js';
import { apiDev } from '../src/api.js';

// worker.js imports docs/SDK.md as text; teach node the same rule (see md-loader.mjs).
register('./md-loader.mjs', import.meta.url);
const { default: worker } = await import('../src/worker.js');

// An R2 stand-in with what dev.js and the hosted route use.
function fakeR2() {
  const m = new Map();
  const obj = (k, v) => ({ key: k, size: v.body.length, body: v.body, httpMetadata: v.meta, httpEtag: '"e"', text: async () => v.body });
  return {
    put: async (k, body, o = {}) => { m.set(k, { body: body instanceof ArrayBuffer ? new TextDecoder().decode(body) : String(body), meta: o.httpMetadata || {} }); },
    get: async k => (m.has(k) ? obj(k, m.get(k)) : null),
    head: async k => (m.has(k) ? obj(k, m.get(k)) : null),
    list: async ({ prefix }) => ({ objects: [...m].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => obj(k, v)) }),
  };
}

const GOOD = '<!doctype html><meta name="viewport" content="width=device-width"><script src="https://rookiegamers.com/sdk/v1.js"></script><p>hi</p>';

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  const env = { DB, GAMES: fakeR2(), ADMIN_TOKEN: 'admintoken', SITE_URL: 'https://rg.test' };
  const newDev = async name => {
    const id = await createPlayer(DB, { name, email: `${name}@example.com` });
    await dev.becomeDeveloper(DB, { OPEN_DEVELOPERS: '1' }, id);
    return id;
  };
  const upload = (pid, slug, version, html = GOOD) => dev.putFile(DB, env, pid, slug, version, 'index.html', html, html.length);
  return { DB, env, newDev, upload };
}

test('a developer\'s first game waits for review, then later games go live straight away', async () => {
  const { DB, env, newDev, upload } = await setup();
  const pid = await newDev('ana');
  await dev.createGame(DB, pid, { slug: 'sky-harvest', title: 'Sky Harvest' });
  await upload(pid, 'sky-harvest', '1.0.0');

  const r = await dev.publish(DB, env, pid, 'sky-harvest');
  assert.equal(r.live, false);
  assert.equal(r.pending, true);
  assert.equal(r.version, '1.0.0');
  assert.match(r.message, /review/);
  let g = await getGame(DB, 'sky-harvest');
  assert.equal(g.live, 0);
  assert.equal(dev.devGameView(g).status, 'pending');

  // The build under review is frozen.
  await assert.rejects(upload(pid, 'sky-harvest', '1.0.0'), /waiting for review/);

  const [item] = await dev.reviewQueue(DB, env);
  assert.equal(item.slug, 'sky-harvest');
  assert.equal(item.version, '1.0.0');
  assert.equal(item.ownerEmail, 'ana@example.com');
  assert.match(item.previewUrl, /^https:\/\/rg\.test\/hosted\/sky-harvest\/~[a-f0-9]{32}\/1\.0\.0\/\?rg_test=1$/);

  const ok = await dev.reviewGame(DB, env, 'sky-harvest', { status: 'approved' });
  assert.equal(ok.live, true);
  g = await getGame(DB, 'sky-harvest');
  assert.equal(g.live, 1);
  assert.equal(g.version, '1.0.0');
  assert.equal(dev.devGameView(g).status, 'live');
  assert.equal(await dev.isTrusted(DB, pid), true);
  assert.deepEqual(await dev.reviewQueue(DB, env), []);

  // Updates and the next game skip the queue.
  await upload(pid, 'sky-harvest', '1.0.1');
  assert.equal((await dev.publish(DB, env, pid, 'sky-harvest')).live, true);
  assert.equal((await getGame(DB, 'sky-harvest')).version, '1.0.1');
  await dev.createGame(DB, pid, { slug: 'moon-mine', title: 'Moon Mine', kind: 'linked', url: 'https://moonmine.example/' });
  assert.equal((await dev.publish(DB, env, pid, 'moon-mine')).live, true);
});

test('failed checks never reach the queue', async () => {
  const { DB, env, newDev, upload } = await setup();
  const pid = await newDev('bo');
  await dev.createGame(DB, pid, { slug: 'adgame', title: 'Ad Game' });
  await upload(pid, 'adgame', '1', GOOD + '<script src="https://pagead2.googlesyndication.com/x.js"></script>');
  const r = await dev.publish(DB, env, pid, 'adgame');
  assert.equal(r.live, false);
  assert.equal(r.pending, undefined);
  assert.equal((await getGame(DB, 'adgame')).review, null);
});

test('rejecting needs a reason, the developer sees it, and publishing again resubmits', async () => {
  const { DB, env, newDev } = await setup();
  const pid = await newDev('cy');
  await dev.createGame(DB, pid, { slug: 'linky', title: 'Linky', kind: 'linked', url: 'https://linky.example/' });
  const r = await dev.publish(DB, env, pid, 'linky');
  assert.equal(r.pending, true);
  assert.equal((await dev.reviewQueue(DB, env))[0].url, 'https://linky.example/');

  await assert.rejects(dev.reviewGame(DB, env, 'linky', { status: 'rejected' }), /Say why/);
  await dev.reviewGame(DB, env, 'linky', { status: 'rejected', note: 'It runs its own Google sign-in.' });
  const [mine] = await dev.myGames(DB, pid);
  assert.equal(mine.status, 'rejected');
  assert.equal(mine.review.note, 'It runs its own Google sign-in.');
  assert.equal(mine.live, false);
  assert.equal(await dev.isTrusted(DB, pid), false);
  await assert.rejects(dev.reviewGame(DB, env, 'linky', { status: 'approved' }), /isn't waiting/);

  assert.equal((await dev.publish(DB, env, pid, 'linky')).pending, true);
  assert.equal((await dev.myGames(DB, pid))[0].review.note, null);

  // Taking it down withdraws it.
  await dev.unpublish(DB, pid, 'linky');
  assert.equal((await dev.myGames(DB, pid))[0].status, 'draft');
  assert.deepEqual(await dev.reviewQueue(DB, env), []);
});

test('developers with live games before the queue, and admin publishes, are trusted', async () => {
  const { DB, env, newDev } = await setup();
  const old = await newDev('old');
  await DB.prepare(`INSERT INTO games (slug, title, kind, url, developer, owner_id, live, released_at, created_at) VALUES ('oldie', 'Oldie', 'linked', 'https://oldie.example/', 'old', ?, 1, 0, 0)`).bind(old).run();
  await migrate(DB);
  const d = await DB.prepare('SELECT approved_at FROM developers WHERE player_id = ?').bind(old).first();
  assert.ok(d.approved_at != null);
  await dev.createGame(DB, old, { slug: 'newer', title: 'Newer', kind: 'linked', url: 'https://newer.example/' });
  assert.equal((await dev.publish(DB, env, old, 'newer')).live, true);

  const fresh = await newDev('fresh');
  await dev.createGame(DB, fresh, { slug: 'fresh-one', title: 'Fresh', kind: 'linked', url: 'https://fresh.example/' });
  assert.equal((await dev.publish(DB, env, null, 'fresh-one', undefined, true)).live, true);
  assert.equal(await dev.isTrusted(DB, fresh), true);
});

test('admin API: queue, approve, and a 202 for a pending publish', async () => {
  const { DB, env, newDev } = await setup();
  const pid = await newDev('dee');
  const key = await dev.createKey(DB, pid, 'cli');
  await dev.createGame(DB, pid, { slug: 'dee-game', title: 'Dee Game', kind: 'linked', url: 'https://dee.example/' });
  const call = (method, path, body, auth) => apiDev(new Request('https://rg.test' + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, DB, new URL('https://rg.test' + path), { admin: path.startsWith('/api/admin') });

  const pub = await call('POST', '/api/dev/games/dee-game/publish', {}, `Bearer ${key}`);
  assert.equal(pub.status, 202);
  assert.equal((await pub.json()).pending, true);
  const q = await (await call('GET', '/api/admin/review')).json();
  assert.equal(q.queue.length, 1);
  const bad = await call('POST', '/api/admin/games/dee-game/review', { status: 'rejected' });
  assert.equal(bad.status, 400);
  const ok = await call('POST', '/api/admin/games/dee-game/review', { status: 'approved' });
  assert.equal(ok.status, 200);
  assert.equal((await getGame(DB, 'dee-game')).live, 1);
});

test('the signed preview link plays a waiting build, and nothing else does', async () => {
  const { DB, env, newDev, upload } = await setup();
  const pid = await newDev('eve');
  await dev.createGame(DB, pid, { slug: 'eve-game', title: 'Eve Game' });
  await upload(pid, 'eve-game', '2.0');
  await dev.publish(DB, env, pid, 'eve-game');
  const [item] = await dev.reviewQueue(DB, env);
  const get = u => worker.fetch(new Request(u), env, {});

  const r = await get(item.previewUrl);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /<p>hi<\/p>/);
  assert.match(r.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await get(item.previewUrl.replace(/~[a-f0-9]{4}/, '~0000'))).status, 404);
  assert.equal((await get('https://rg.test/hosted/eve-game/')).status, 404);
});

/* ---------- the /admin page ---------- */

async function signedIn(DB, name) {
  const { sha256 } = await import('../src/db.js');
  const id = await createPlayer(DB, { name, email: `${name}@example.com` });
  const tok = 'tok' + 'x'.repeat(30) + name;
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, 0)').bind(await sha256(tok), id).run();
  return { id, cookie: `rg_sid=${tok}` };
}

test('the admin page and its API work for listed admins only, by session', async () => {
  const { DB, env, newDev } = await setup();
  const admin = await signedIn(DB, 'boss'), other = await signedIn(DB, 'rando');
  env.ADMIN_PLAYERS = `${admin.id}, pnotreal`;
  const get = (path, cookie, init = {}) => worker.fetch(new Request('https://rg.test' + path, { ...init, headers: { cookie, ...(init.headers || {}) } }), env, {});

  const page = await get('/admin', admin.cookie);
  assert.equal(page.status, 200);
  const text = await page.text();
  assert.match(text, /Review queue/);
  assert.match(text, /data-slug="unsays"/);
  assert.equal((await get('/admin', other.cookie)).status, 403);
  assert.equal((await get('/admin', '')).status, 302);

  const json = { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
  const patch = await get('/api/admin/games/unsays', admin.cookie, { method: 'PATCH', headers: json, body: JSON.stringify({ blurb: 'New blurb', featured: true }) });
  assert.equal(patch.status, 200);
  assert.equal((await getGame(DB, 'unsays')).blurb, 'New blurb');
  assert.equal((await get('/api/admin/games/unsays', other.cookie, { method: 'PATCH', headers: json, body: '{}' })).status, 401);
  // A cross-site form post can't use the admin's cookie.
  assert.equal((await get('/api/admin/games/unsays', admin.cookie, { method: 'PATCH', headers: { ...json, 'sec-fetch-site': 'cross-site' }, body: '{}' })).status, 401);

  const inv = await (await get('/api/admin/invites', admin.cookie, { method: 'POST', headers: json, body: JSON.stringify({ note: 'Chris' }) })).json();
  assert.match(inv.invite, /^inv_/);
});

test('cover uploads are stored, served and shown, and build paths work as covers', async () => {
  const { DB, env, newDev, upload } = await setup();
  const admin = await signedIn(DB, 'boss2');
  env.ADMIN_PLAYERS = admin.id;
  const r = await worker.fetch(new Request('https://rg.test/api/admin/games/unsays/cover', { method: 'PUT', headers: { cookie: admin.cookie, 'content-type': 'image/png' }, body: 'PNGDATA' }), env, {});
  assert.equal(r.status, 200);
  const { cover } = await r.json();
  assert.match(cover, /^https:\/\/rg\.test\/covers\/unsays\/[a-f0-9]{12}\.png$/);
  const img = await worker.fetch(new Request(cover), env, {});
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal(await img.text(), 'PNGDATA');
  const bad = await worker.fetch(new Request('https://rg.test/api/admin/games/unsays/cover', { method: 'PUT', headers: { cookie: admin.cookie, 'content-type': 'text/html' }, body: '<x>' }), env, {});
  assert.equal(bad.status, 415);

  const { coverSrc, coverAbs } = await import('../src/db.js');
  assert.equal(coverSrc({ slug: 'yc', kind: 'hosted', cover: 'img/cover.png' }), '/hosted/yc/img/cover.png');
  assert.equal(coverAbs('https://rg.test', { slug: 'yc', kind: 'hosted', cover: 'cover.png' }), 'https://rg.test/hosted/yc/cover.png');
  assert.equal(coverSrc({ slug: 'yc', kind: 'hosted', cover: '../x.png' }), null);
  assert.equal(coverSrc({ slug: 'l', kind: 'linked', cover: 'cover.png' }), null);
});

test('game studios: developers make their own, credit games, and get a public studio page', async () => {
  const { DB, env, newDev } = await setup();
  const ana = await newDev('ana'), bo = await newDev('bo');
  const s = await dev.saveStudio(DB, ana, { slug: 'tenacie-games', name: 'Tenacie Games', url: 'https://tenacie.example', bio: 'Weird little games.' });
  assert.equal(s.name, 'Tenacie Games');
  await assert.rejects(dev.saveStudio(DB, ana, { slug: 'Bad Slug!', name: 'Xavier' }), /link name/);
  await assert.rejects(dev.saveStudio(DB, bo, { slug: 'tenacie-games', name: 'Mine now' }), /another developer/);
  await assert.rejects(dev.saveStudio(DB, ana, { slug: 'tenacie-games', url: 'http://insecure.example' }), /https/);

  // Logos upload like covers and are served from /logos/.
  const { logo } = await dev.putStudioLogo(DB, env, ana, 'tenacie-games', 'PNGDATA', 'image/png', 7);
  assert.match(logo, /^https:\/\/rg\.test\/logos\/tenacie-games\/[a-f0-9]{12}\.png$/);
  const img = await worker.fetch(new Request(logo), env, {});
  assert.equal(img.status, 200);
  assert.equal(await img.text(), 'PNGDATA');

  // Developers credit only their own games to their own studios; admins can credit any game.
  await dev.createGame(DB, ana, { slug: 'sky-harvest', title: 'Sky Harvest', kind: 'linked', url: 'https://sky.example/' });
  await dev.createGame(DB, bo, { slug: 'bo-game', title: 'Bo Game', kind: 'linked', url: 'https://bo.example/' });
  assert.equal((await dev.updateGame(DB, ana, 'sky-harvest', { studio: 'tenacie-games' })).studio, 'tenacie-games');
  await assert.rejects(dev.updateGame(DB, bo, 'bo-game', { studio: 'tenacie-games' }), /another developer/);
  await assert.rejects(dev.updateGame(DB, ana, 'sky-harvest', { studio: 'nope' }), /no studio/);
  assert.equal((await dev.updateGame(DB, null, 'unsays', { studio: 'tenacie-games' }, true)).studio, 'tenacie-games');

  // The play page shows the studio and links to its page, which lists its live games.
  const play = await (await worker.fetch(new Request('https://rg.test/play/unsays'), env, {})).text();
  assert.match(play, /class="studio-by" href="\/studio\/tenacie-games"/);
  assert.match(play, /by ecoay<\/span>/); // the developer still shows beside the studio
  const home = await (await worker.fetch(new Request('https://rg.test/'), env, {})).text();
  assert.match(home, /class="by" href="\/studio\/tenacie-games"><img src="https:\/\/rg\.test\/logos\//);
  assert.match(play, /"creator":\{"@type":"Organization","name":"Tenacie Games"/);
  const page = await worker.fetch(new Request('https://rg.test/studio/tenacie-games'), env, {});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<h1>Tenacie Games<\/h1>/);
  assert.match(html, /Weird little games\./);
  assert.match(html, /href="\/play\/unsays"/);
  assert.doesNotMatch(html, /href="\/play\/sky-harvest"/); // not live
  assert.equal((await worker.fetch(new Request('https://rg.test/studio/nobody'), env, {})).status, 404);
  assert.match(await (await worker.fetch(new Request('https://rg.test/sitemap.xml'), env, {})).text(), /\/studio\/tenacie-games/);

  // The developer API lists your own studios; deleting one uncredits its games.
  const res = await apiDev(new Request('https://rg.test/api/dev/studios', { headers: { authorization: 'Bearer ' + await dev.createKey(DB, bo, 'k') } }), env, DB, new URL('https://rg.test/api/dev/studios'));
  assert.deepEqual((await res.json()).studios, []);
  await dev.deleteStudio(DB, ana, 'tenacie-games');
  assert.equal((await getGame(DB, 'unsays')).studio, null);
});

test('the admin and developer pages show the studio forms, and their scripts parse', async () => {
  const { DB, env } = await setup();
  const { Script } = await import('node:vm');
  const admin = await signedIn(DB, 'boss3');
  await dev.becomeDeveloper(DB, { OPEN_DEVELOPERS: '1' }, admin.id);
  await dev.saveStudio(DB, admin.id, { slug: 'boss-studio', name: 'Boss Studio' });
  env.ADMIN_PLAYERS = admin.id;
  for (const path of ['/admin', '/dev']) {
    const html = await (await worker.fetch(new Request('https://rg.test' + path, { headers: { cookie: admin.cookie } }), env, {})).text();
    assert.match(html, /data-studio="boss-studio"/, path);
    assert.match(html, /id="newStudio"/, path);
    assert.match(html, /<script src="\/crop\.js">/, path);
    for (const [, js] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(js); // throws on a syntax error
  }
  new Script((await import('node:fs')).readFileSync(new URL('../public/crop.js', import.meta.url), 'utf8'));
});

test('staging: a banner on every page, no review wait, and localhost sign-in', async () => {
  const { DB, env, newDev, upload } = await setup();
  Object.assign(env, { STAGING: '1', DEV_LOGIN: '1' });
  const page = await (await worker.fetch(new Request('https://rg.test/'), env, {})).text();
  assert.match(page, /Staging: test data only/);
  const api = await worker.fetch(new Request('https://rg.test/api/v1/games'), env, {});
  assert.doesNotMatch(await api.text(), /Staging/); // JSON is left alone

  const pid = await newDev('stagey');
  await dev.createGame(DB, pid, { slug: 'local-game', title: 'Local Game', kind: 'linked', url: 'http://localhost:5173/' });
  const r = await dev.publish(DB, env, pid, 'local-game');
  assert.equal(r.live, true); // a first game goes live on staging without review

  const connect = await worker.fetch(new Request('https://rg.test/sdk/connect?game=local-game&origin=' + encodeURIComponent('http://127.0.0.1:8080')), env, {});
  assert.doesNotMatch(await connect.text(), /Can't sign in here/);

  // Without STAGING, production is unchanged.
  delete env.STAGING; delete env.DEV_LOGIN;
  assert.doesNotMatch(await (await worker.fetch(new Request('https://rg.test/'), env, {})).text(), /Staging: test data only/);
  const g2 = await dev.createGame(DB, pid, { slug: 'local-two', title: 'Local Two', kind: 'linked', url: 'http://localhost:5174/' });
  assert.equal(g2.slug, 'local-two');
  const prod = await worker.fetch(new Request('https://rg.test/sdk/connect?game=local-game&origin=' + encodeURIComponent('http://127.0.0.1:8080')), env, {});
  assert.match(await prod.text(), /Can't sign in here/);
});
