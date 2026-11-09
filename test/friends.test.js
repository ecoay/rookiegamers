import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { apiV1 } from '../src/api.js';
import { signToken } from '../src/tokens.js';
import { deleteAccount } from '../src/account.js';
import { recordReferral } from '../src/growth.js';
import { friendAction, friendState, listFriends, addGameXp, GAME_XP } from '../src/friends.js';

const env = { SITE_URL: 'https://rookiegamers.test' };
const base = 'https://rookiegamers.test/api/v1';
const A = 'p' + 'a'.repeat(20), B = 'p' + 'b'.repeat(20), C = 'p' + 'c'.repeat(20);

// One database for the file: the signing key is cached per process.
let shared;
async function setup() {
  if (!shared) { shared = fakeD1(); await migrate(shared); }
  const DB = shared, t = Date.now();
  for (const tb of ['friends', 'game_xp', 'scores', 'plays']) await DB.prepare(`DELETE FROM ${tb}`).run();
  await DB.prepare('DELETE FROM players').run();
  await DB.prepare('INSERT INTO players (id, name, xp, created_at, seen_at) VALUES (?, ?, 0, ?, ?), (?, ?, 0, ?, ?), (?, ?, 0, ?, ?)').bind(A, 'Ada', t, t, B, 'Bo', t, t, C, 'Cy', t, t).run();
  return DB;
}
const call = async (DB, method, path, token, body) => {
  const url = new URL(base + path);
  const req = new Request(url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const r = await apiV1(req, env, DB, url);
  return { status: r.status, j: await r.json() };
};

test('friends: a request, then accept, then remove', async () => {
  const DB = await setup();
  assert.equal((await friendAction(DB, A, B, 'add')).state, 'sent');
  assert.equal(await friendState(DB, A, B), 'sent');
  assert.equal(await friendState(DB, B, A), 'received');
  assert.equal((await friendAction(DB, A, B, 'accept')).status, 404, 'you can\'t accept your own request');
  assert.deepEqual(await listFriends(DB, A), [], 'not friends until accepted');
  assert.equal((await friendAction(DB, B, A, 'accept')).state, 'friends');
  assert.deepEqual((await listFriends(DB, A)).map(f => f.name), ['Bo']);
  assert.equal((await friendAction(DB, A, A, 'add')).status, 404, 'not yourself');
  assert.equal((await friendAction(DB, A, 'p' + '0'.repeat(20), 'add')).status, 404, 'not a player who doesn\'t exist');
  await friendAction(DB, B, A, 'remove');
  assert.equal(await friendState(DB, A, B), 'none');
});

test('friends: adding someone who already asked you makes you friends', async () => {
  const DB = await setup();
  await friendAction(DB, A, C, 'add');
  assert.equal((await friendAction(DB, C, A, 'add')).state, 'friends');
});

test('friends: joining through an invite link makes you friends', async () => {
  const DB = await setup();
  assert.equal(await recordReferral(DB, C, A), true);
  assert.equal(await friendState(DB, A, C), 'friends');
});

test('friends in a game: the list says who plays it and their level there, and the board can be friends only', async () => {
  const DB = await setup();
  await friendAction(DB, A, B, 'add'); await friendAction(DB, B, A, 'add');
  await friendAction(DB, C, A, 'add');
  await addGameXp(DB, 'unsays', B, 300);
  await DB.prepare("INSERT INTO plays (id, player_id, game, ms, started_at, last_at) VALUES ('pl1', ?, 'unsays', 60000, ?, ?)").bind(B, Date.now(), Date.now()).run();
  const ada = await signToken(DB, env, { sub: A, aud: 'unsays' });
  assert.equal((await call(DB, 'GET', '/friends?game=unsays')).status, 401);
  const r = await call(DB, 'GET', '/friends?game=unsays', ada);
  assert.equal(r.status, 200);
  assert.equal(r.j.friends.length, 1);
  assert.equal(r.j.friends[0].name, 'Bo'); assert.equal(r.j.friends[0].gameLevel, 3); assert.equal(r.j.friends[0].plays, true);
  assert.deepEqual(r.j.requests.map(p => p.name), ['Cy']);
  // Accept Cy from inside the game.
  assert.equal((await call(DB, 'POST', '/friends', ada, { game: 'unsays', player: C, action: 'accept' })).j.state, 'friends');
  // Friends-only leaderboard: Cy is a friend now, so remove them to check the filter.
  await friendAction(DB, A, C, 'remove');
  const m = new Date().toISOString().slice(0, 7);
  for (const [p, s] of [[A, 10], [B, 20], [C, 30]]) await DB.prepare('INSERT INTO scores (game, month, player_id, score, at) VALUES (?, ?, ?, ?, ?)').bind('unsays', m, p, s, Date.now()).run();
  const all = await call(DB, 'GET', '/scores/unsays');
  assert.equal(all.j.rows.length, 3);
  const fr = await call(DB, 'GET', '/scores/unsays?friends=1', ada);
  assert.deepEqual(fr.j.rows.map(x => x.player.name), ['Bo', 'Ada']);
  assert.equal((await call(DB, 'GET', '/scores/unsays?friends=1')).status, 401);
});

test('game levels: XP per game, daily caps, and a tenth toward the RookieGamers level', async () => {
  const DB = await setup();
  const bo = await signToken(DB, env, { sub: B, aud: 'unsays' });
  assert.equal((await call(DB, 'POST', '/level', bo, { game: 'unsays', xp: 0 })).status, 400);
  assert.equal((await call(DB, 'POST', '/level', bo, { game: 'unsays', xp: 5000 })).status, 400);
  const r = await call(DB, 'POST', '/level', bo, { game: 'unsays', xp: 100 });
  assert.equal(r.j.level, 2); assert.equal(r.j.levelUp, true); assert.equal(r.j.rgXp, 10);
  assert.equal((await DB.prepare('SELECT xp FROM players WHERE id = ?').bind(B).first()).xp, 10);
  for (let i = 0; i < 12; i++) await addGameXp(DB, 'unsays', B, 1000);
  const g = await call(DB, 'GET', '/level?game=unsays', bo);
  assert.equal(g.j.xp, GAME_XP.perDay, 'capped per day');
  assert.equal((await DB.prepare('SELECT xp FROM players WHERE id = ?').bind(B).first()).xp, GAME_XP.rgPerDay, 'RookieGamers share capped per day');
  assert.equal((await addGameXp(DB, 'unsays', B, 1)).status, 429);
  // Another game has its own level.
  assert.equal((await addGameXp(DB, 'buyyourfriends', B, 10)).xp, 10);
});

test('deleting an account removes its friendships and game levels', async () => {
  const DB = await setup();
  await friendAction(DB, A, B, 'add'); await friendAction(DB, B, A, 'add');
  await addGameXp(DB, 'unsays', B, 50);
  await deleteAccount(DB, B);
  assert.deepEqual(await listFriends(DB, A), []);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM game_xp WHERE player_id = ?').bind(B).first()).n, 0);
});

test('profiles: Add friend on someone else\'s page, friends and requests on your own', async () => {
  const { register } = await import('node:module');
  register('./md-loader.mjs', import.meta.url);
  const { page } = await import('../src/pages.js');
  const { sha256 } = await import('../src/db.js');
  const DB = await setup();
  const tok = 'y'.repeat(40);
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, ?)').bind(await sha256(tok), A, Date.now()).run();
  const get = async id => { const url = new URL(`https://rookiegamers.com/u/${id}`); return (await page(url.pathname, url, { SITE_URL: 'https://rookiegamers.com' }, DB, new Request(url, { headers: { cookie: `rg_sid=${tok}` } }))).text(); };
  assert.match(await get(B), /data-act="add">Add friend/);
  await friendAction(DB, A, B, 'add');
  assert.match(await get(B), /Requested/);
  await friendAction(DB, C, A, 'add');
  const own = await get(A);
  assert.match(own, /Friend requests[\s\S]*Cy[\s\S]*data-act="accept"/);
  await friendAction(DB, B, A, 'accept');
  assert.match(await get(A), /id="friends"[\s\S]*Bo/);
  assert.match(await get(B), /Friends ✓/);
});
