import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { apiV1 } from '../src/api.js';
import { signToken } from '../src/tokens.js';
import { deleteAccount } from '../src/account.js';
import { SAVE_LIMITS } from '../src/saves.js';

const env = { SITE_URL: 'https://rookiegamers.test' };
const base = 'https://rookiegamers.test/api/v1';

// One database for the file: the signing key is cached per process.
let shared;
async function setup() {
  if (!shared) { shared = fakeD1(); await migrate(shared); }
  const DB = shared, t = Date.now();
  await DB.prepare('DELETE FROM saves').run();
  await DB.prepare("INSERT OR IGNORE INTO players (id, name, created_at, seen_at) VALUES ('p1', 'Ada', ?, ?), ('p2', 'Bo', ?, ?)").bind(t, t, t, t).run();
  return DB;
}
const call = async (DB, method, path, token, body) => {
  const url = new URL(base + path);
  const req = new Request(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const r = await apiV1(req, env, DB, url);
  return { status: r.status, j: await r.json() };
};

test('cloud saves: a signed-in player saves, loads and deletes per game', async () => {
  const DB = await setup();
  const ada = await signToken(DB, env, { sub: 'p1', aud: 'unsays' });
  assert.equal((await call(DB, 'GET', '/saves?game=unsays')).status, 401, 'guests have no cloud saves');
  const w = await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'progress', value: { level: 3, coins: [1, 2] }, base: 0 });
  assert.equal(w.status, 200); assert.equal(w.j.version, 1);
  const r = await call(DB, 'GET', '/saves?game=unsays', ada);
  assert.deepEqual(r.j.saves.progress.value, { level: 3, coins: [1, 2] });
  assert.equal(r.j.saves.progress.version, 1);
  // Another player and another game see nothing.
  const bo = await signToken(DB, env, { sub: 'p2', aud: 'unsays' });
  assert.deepEqual((await call(DB, 'GET', '/saves?game=unsays', bo)).j.saves, {});
  assert.equal((await call(DB, 'GET', '/saves?game=buyyourfriends', ada)).status, 401, 'a token only works for its own game');
  await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'progress', value: null, base: 1 });
  assert.deepEqual((await call(DB, 'GET', '/saves?game=unsays', ada)).j.saves, {});
});

test('cloud saves: a stale write loses to the newer save', async () => {
  const DB = await setup();
  const ada = await signToken(DB, env, { sub: 'p1', aud: 'unsays' });
  await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 's', value: 1, base: 0 });
  await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 's', value: 2, base: 1 });
  const stale = await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 's', value: 'old tab', base: 1 });
  assert.equal(stale.status, 409); assert.equal(stale.j.conflict, true);
  assert.deepEqual(stale.j.current, { value: 2, version: 2 });
  assert.equal((await call(DB, 'GET', '/saves?game=unsays', ada)).j.saves.s.value, 2);
});

test('cloud saves: size limits, bad keys, and account deletion', async () => {
  const DB = await setup();
  const ada = await signToken(DB, env, { sub: 'p1', aud: 'unsays' });
  assert.equal((await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'bad key!', value: 1 })).status, 400);
  assert.equal((await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'big', value: 'x'.repeat(SAVE_LIMITS.valueBytes) })).status, 413);
  for (let i = 0; i < 4; i++) assert.equal((await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'k' + i, value: 'x'.repeat(250 * 1024) })).status, 200);
  assert.equal((await call(DB, 'POST', '/saves', ada, { game: 'unsays', key: 'k4', value: 'x'.repeat(250 * 1024) })).status, 413, '1 MB per game');
  await deleteAccount(DB, 'p1');
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM saves WHERE player_id = 'p1'").first()).n, 0);
});
