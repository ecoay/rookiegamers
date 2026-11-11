import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame, sha256 } from '../src/db.js';
import * as dev from '../src/dev.js';
import { mintFor, socialFor } from '../src/api.js';
import { attachIdentity } from '../src/auth.js';
import { verifyToken } from '../src/tokens.js';

register('./md-loader.mjs', import.meta.url);
const { default: worker } = await import('../src/worker.js');

const SITE = 'https://rg.test';

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  const env = { DB, SITE_URL: SITE, OPEN_DEVELOPERS: '1', X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret' };
  const owner = await createPlayer(DB, { name: 'owner', email: 'owner@example.com' });
  await dev.becomeDeveloper(DB, env, owner);
  // buyyourfriends is in the seed catalog (socialAccounts on); start it off to test both ways.
  await dev.updateGame(DB, null, 'buyyourfriends', { socialAccounts: false }, true);
  await dev.createGame(DB, owner, { slug: 'plain', title: 'Plain', kind: 'linked', url: 'https://plain.example/' });
  // A player who signed in by email and linked X and SceneSpot.
  const pid = await attachIdentity(DB, { provider: 'email', subject: 'dana@example.com', email: 'dana@example.com' });
  await attachIdentity(DB, { provider: 'x', subject: '1449001', profile: { name: 'Dana', handle: 'dana', picture: 'https://pbs.example/d.png' }, current: pid });
  await attachIdentity(DB, { provider: 'scenespot', subject: 'u_93', profile: { name: 'Dana', handle: null, city: 'Austin' }, current: pid });
  const tok = 'tok' + 'y'.repeat(32);
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, 0)').bind(await sha256(tok), pid).run();
  return { DB, env, owner, pid, cookie: `rg_sid=${tok}` };
}

const NO_EMAIL = /dana@example\.com|@example/;

test('socialAccounts is off by default and settable through the developer API', async () => {
  const { DB, owner } = await setup();
  assert.equal(dev.devGameView(await getGame(DB, 'plain')).socialAccounts, false);
  const g = await dev.updateGame(DB, owner, 'plain', { socialAccounts: true });
  assert.equal(g.socialAccounts, true);
  assert.equal((await getGame(DB, 'plain')).social_accounts, 1);
  await dev.updateGame(DB, owner, 'plain', { socialAccounts: false });
  // The seeded Buy Your Friends listing has it on, with its own site as the origin.
  const fresh = fakeD1(); await migrate(fresh);
  const byf = dev.devGameView(await getGame(fresh, 'buyyourfriends'));
  assert.equal(byf.socialAccounts, true);
  assert.equal(byf.url, 'https://buyyourfriends.com/?rg=1');
  assert.deepEqual(byf.origins, ['https://buyyourfriends.com']);
});

test('the token has a social claim only when the game has socialAccounts on, and never email', async () => {
  const { DB, env, owner, pid } = await setup();
  const off = await mintFor(DB, env, pid, 'buyyourfriends');
  assert.equal(off.user.social, undefined);
  assert.equal((await verifyToken(DB, env, off.token, { aud: 'buyyourfriends' })).social, undefined);

  await dev.updateGame(DB, null, 'buyyourfriends', { socialAccounts: true }, true);
  const on = await mintFor(DB, env, pid, 'buyyourfriends');
  const claims = await verifyToken(DB, env, on.token, { aud: 'buyyourfriends' });
  const want = { x: { id: '1449001', handle: 'dana' }, scenespot: { id: 'u_93', handle: null } };
  assert.deepEqual(claims.social, want);
  assert.deepEqual(on.user.social, want);
  assert.doesNotMatch(JSON.stringify(claims), NO_EMAIL);
  assert.doesNotMatch(JSON.stringify(on.user), NO_EMAIL);
  assert.equal(claims.social.email, undefined);

  // Other games still get nothing.
  const plain = await mintFor(DB, env, pid, 'plain');
  assert.equal((await verifyToken(DB, env, plain.token, { aud: 'plain' })).social, undefined);
});

test('handles that look like email addresses are dropped', async () => {
  const { DB, pid } = await setup();
  await attachIdentity(DB, { provider: 'linkedin', subject: 'li1', profile: { handle: 'dana@corp.example' }, current: pid });
  assert.deepEqual((await socialFor(DB, pid)).linkedin, { id: 'li1', handle: null });
});

test('/sdk/link: signs in first, offers the network, then hands the linked player back', async () => {
  const { DB, env, owner, pid, cookie } = await setup();
  const get = (path, c) => worker.fetch(new Request(SITE + path, { headers: c ? { cookie: c } : {} }), env, {});
  const q = '/sdk/link?game=buyyourfriends&provider=x&origin=' + encodeURIComponent('https://buyyourfriends.com');

  assert.match(await (await get(q, cookie)).text(), /doesn't use social accounts/);
  await dev.updateGame(DB, null, 'buyyourfriends', { socialAccounts: true }, true);
  assert.match(await (await get(q.replace('buyyourfriends.com', 'evil.example'), cookie)).text(), /isn't set up/);
  assert.match(await (await get(q.replace('provider=x', 'provider=tiktok'), cookie)).text(), /isn't available/);

  const anon = await get(q);
  assert.equal(anon.status, 302);
  assert.match(anon.headers.get('location'), /\/signin\?game=buyyourfriends&next=%2Fsdk%2Flink/);
  const signin = await (await get(new URL(anon.headers.get('location')).pathname + new URL(anon.headers.get('location')).search)).text();
  assert.match(signin, /This game uses the handles of the social accounts you link/);

  // A player without TikTok... here: a new player without X sees the link button.
  const p2 = await attachIdentity(DB, { provider: 'email', subject: 'sam@example.com', email: 'sam@example.com' });
  const t2 = 'tok' + 'z'.repeat(32);
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, 0)').bind(await sha256(t2), p2).run();
  const offer = await (await get(q, `rg_sid=${t2}`)).text();
  assert.match(offer, /href="\/auth\/x\?next=%2Fsdk%2Flink/);
  assert.match(offer, /This game uses the handles/);

  // Dana already linked X: the popup posts a fresh token with social to the game's origin.
  const done = await (await get(q, cookie)).text();
  assert.match(done, /type:'connect'/);
  assert.match(done, /"social":\{"x":\{"id":"1449001","handle":"dana"\}/);
  assert.match(done, /"https:\/\/buyyourfriends\.com"\)/);
  assert.doesNotMatch(done, NO_EMAIL);
  assert.ok(pid);

  // From the portal frame it just tells the portal page.
  const portal = await (await get(q.replace(encodeURIComponent('https://buyyourfriends.com'), encodeURIComponent(SITE)), cookie)).text();
  assert.match(portal, /type:'linked'/);

  // The play page tells players too.
  const play = await (await get('/play/buyyourfriends')).text();
  assert.match(play, /This game uses the handles of the social accounts you link/);
  assert.doesNotMatch(await (await get('/play/plain')).text(), /handles of the social accounts/);
});

/* ---------- the SDK ---------- */

function loadSDK({ search = '', inFrame = false } = {}) {
  const listeners = {}, opened = [];
  const win = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Promise, JSON, Object, Math, Date, Number, String, Map, Error,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }, removeEventListener: (t, fn) => { listeners[t] = (listeners[t] || []).filter(f => f !== fn); },
    localStorage: { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); }, removeItem(k) { delete this._[k]; } },
    location: { search, hash: '', origin: 'https://buyyourfriends.com', href: 'https://buyyourfriends.com/' + search, pathname: '/' },
    document: { currentScript: { src: 'https://rookiegamers.com/sdk/v1.js', dataset: {} }, visibilityState: 'visible', addEventListener() {} },
    navigator: {}, history: { replaceState() {} },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    open: u => { const w = { closed: false, url: u }; opened.push(w); return w; },
  };
  win.window = win; win.parent = inFrame ? {} : win; win.self = win;
  const ctx = createContext(win);
  new Script(readFileSync(new URL('../public/sdk/v1.js', import.meta.url), 'utf8')).runInContext(ctx);
  const fire = (type, ev) => (listeners[type] || []).slice().forEach(fn => fn(ev));
  return { rg: win.rg, opened, fire };
}

test('SDK test mode: the fake player has social.x, and link() adds a fake network', async () => {
  const { rg } = loadSDK({ search: '?rg_test=1' });
  await rg.init({ game: 'buyyourfriends' });
  const me = await rg.user.get();
  assert.deepEqual(JSON.parse(JSON.stringify(me.social)), { x: { id: 'test-x', handle: 'testplayer' } });
  const after = await rg.user.link('tiktok');
  assert.equal(after.social.tiktok.id, 'test-tiktok');
  assert.equal(after.social.x.id, 'test-x');
});

test('SDK on a game\'s own site: link() opens /sdk/link and resolves to the updated player', async () => {
  const { rg, opened, fire } = loadSDK();
  await rg.init({ game: 'buyyourfriends' });
  const p = rg.user.link('x');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(opened.length, 1);
  assert.match(opened[0].url, /^https:\/\/rookiegamers\.com\/sdk\/link\?game=buyyourfriends&provider=x&origin=https%3A%2F%2Fbuyyourfriends\.com$/);
  const user = { id: 'p1', name: 'Dana', social: { x: { id: '1449001', handle: 'dana' } } };
  fire('message', { origin: 'https://evil.example', data: { rg: 1, type: 'connect', data: { token: 'bad', exp: 9e9, user: { id: 'evil' } } } });
  fire('message', { origin: 'https://rookiegamers.com', data: { rg: 1, type: 'connect', data: { token: 't', exp: Math.floor(Date.now() / 1000) + 900, user } } });
  const me = await p;
  assert.equal(me.id, 'p1');
  assert.equal(me.social.x.handle, 'dana');
  assert.equal((await rg.user.get()).social.x.id, '1449001');

  // Closing the popup without linking resolves to null.
  const p2 = rg.user.link('instagram');
  await new Promise(r => setTimeout(r, 0));
  opened[1].closed = true;
  assert.equal(await p2, null);
});
