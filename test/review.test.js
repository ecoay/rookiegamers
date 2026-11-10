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
