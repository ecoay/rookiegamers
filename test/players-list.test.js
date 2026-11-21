import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, sha256 } from '../src/db.js';
import * as dev from '../src/dev.js';
import { attachIdentity } from '../src/auth.js';

register('./md-loader.mjs', import.meta.url);
const { default: worker } = await import('../src/worker.js');

const SITE = 'https://rg.test';
const KEY = 'rgs_' + 'k'.repeat(40);

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  const env = { DB, SITE_URL: SITE, OPEN_DEVELOPERS: '1' };
  const owner = await createPlayer(DB, { name: 'owner', email: 'owner@example.com' });
  await dev.becomeDeveloper(DB, env, owner);
  await dev.updateGame(DB, null, 'buyyourfriends', { socialAccounts: true }, true);
  await DB.prepare('UPDATE games SET key_hash = ? WHERE slug = ?').bind(await sha256(KEY), 'buyyourfriends').run();
  await dev.createGame(DB, owner, { slug: 'plain', title: 'Plain', kind: 'linked', url: 'https://plain.example/' });
  await DB.prepare('UPDATE games SET key_hash = ? WHERE slug = ?').bind(await sha256(KEY), 'plain').run();
  const ids = [owner];
  for (const name of ['amy', 'ben', 'cal', 'dee']) ids.push(await createPlayer(DB, { name, email: `${name}@example.com` }));
  // Linked accounts are never part of the list.
  await attachIdentity(DB, { provider: 'x', subject: '77', profile: { name: 'Amy', handle: 'amy_x' }, current: ids[1] });
  return { DB, env, ids };
}

const call = (env, path, key = KEY) =>
  worker.fetch(new Request(`${SITE}/api/v1${path}`, { headers: key ? { authorization: `Bearer ${key}` } : {} }), env, { waitUntil() {} });

test('a game built on accounts lists every player, a page at a time, public fields only', async () => {
  const { env, ids } = await setup();
  const seen = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const res = await call(env, `/games/buyyourfriends/players?limit=2${after ? `&after=${after}` : ''}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const p of body.players) {
      assert.deepEqual(Object.keys(p).sort(), ['avatar', 'id', 'level', 'name']);
      assert.match(p.avatar, /^(https:|data:image\/svg)/);
      seen.push(p.id);
    }
    if (!body.next) break;
    after = body.next;
  }
  assert.deepEqual(seen.sort(), [...ids].sort());
  const text = JSON.stringify(await (await call(env, '/games/buyyourfriends/players')).json());
  assert.doesNotMatch(text, /@example\.com|amy_x/);
});

test('Twitch profile pictures for up to 100 ids, with the server key, public fields only', async () => {
  const { env } = await setup();
  env.TWITCH_BOT_CLIENT_ID = 'cid';
  env.TWITCH_BOT_CLIENT_SECRET = 'secret';
  const realFetch = globalThis.fetch;
  let asked = '';
  globalThis.fetch = async (input) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) return Response.json({ access_token: 'app', expires_in: 3600 });
    if (url.startsWith('https://api.twitch.tv/helix/users')) {
      asked = url;
      return Response.json({ data: [
        { id: '111', login: 'viewerone', profile_image_url: 'https://static-cdn.jtvnw.net/a.png', email: 'x@example.com' },
        { id: '222', login: 'viewertwo', profile_image_url: 'http://insecure.example/b.png' },
      ] });
    }
    return realFetch(input);
  };
  try {
    const res = await call(env, '/games/buyyourfriends/twitch-users?ids=111,222,bad,111');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(asked, 'https://api.twitch.tv/helix/users?id=111&id=222');
    assert.deepEqual(body.users, [
      { id: '111', login: 'viewerone', avatar: 'https://static-cdn.jtvnw.net/a.png' },
      { id: '222', login: 'viewertwo', avatar: null },
    ]);
    assert.equal((await call(env, '/games/buyyourfriends/twitch-users?ids=111', null)).status, 401);
    assert.equal((await call(env, '/games/plain/twitch-users?ids=111')).status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('it needs the game\'s server key, and only games built on accounts can use it', async () => {
  const { env } = await setup();
  assert.equal((await call(env, '/games/buyyourfriends/players', null)).status, 401);
  assert.equal((await call(env, '/games/buyyourfriends/players', 'rgs_wrong')).status, 401);
  assert.equal((await call(env, '/games/nope/players')).status, 401);
  assert.equal((await call(env, '/games/plain/players')).status, 403);
});
