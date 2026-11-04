import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame, monthKey, prevMonth, levelFor } from '../src/db.js';
import { submitScore, topScores, archiveMonth, fame, playNext, gameEvent } from '../src/play.js';
import { signToken, verifyToken } from '../src/tokens.js';
import { attachIdentity } from '../src/auth.js';

const env = { SITE_URL: 'https://rookiegamers.test' };
async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  await DB.prepare(`INSERT INTO games (slug, title, kind, developer, released_at, created_at) VALUES ('dodge', 'Dodge', 'hosted', 'me', 0, 0), ('race', 'Race', 'hosted', 'me', 0, 0)`).run();
  await DB.prepare(`UPDATE games SET score_order = 'asc', max_score = 100000 WHERE slug = 'race'`).run();
  await DB.prepare(`UPDATE games SET live = 0 WHERE slug NOT IN ('dodge', 'race')`).run();
  return DB;
}

test('best-score boards keep the best and rank ties by who got there first', async () => {
  const DB = await setup();
  const g = await getGame(DB, 'dodge');
  const a = await createPlayer(DB, { name: 'a' }), b = await createPlayer(DB, { name: 'b' });
  assert.equal((await submitScore(DB, g, a, 50, { trusted: true })).best, 50);
  assert.equal((await submitScore(DB, g, a, 20, { trusted: true })).best, 50);
  await new Promise(r => setTimeout(r, 5));
  const r = await submitScore(DB, g, b, 50, { trusted: true });
  assert.equal(r.rank, 2);
  const top = await topScores(DB, g);
  assert.deepEqual(top.map(t => t.player.name), ['a', 'b']);
  assert.equal((await topScores(DB, g, 'all')).length, 2);
});

test('lower-is-better boards, caps and the browser rate limit', async () => {
  const DB = await setup();
  const g = await getGame(DB, 'race');
  const a = await createPlayer(DB);
  assert.equal((await submitScore(DB, g, a, 900, { trusted: false })).best, 900);
  assert.equal((await submitScore(DB, g, a, 800, { trusted: false })).status, 429);
  assert.equal((await submitScore(DB, g, a, 800, { trusted: true })).best, 800);
  assert.equal((await submitScore(DB, g, a, 950, { trusted: true })).best, 800);
  await DB.prepare('DELETE FROM submits').run();
  assert.equal((await submitScore(DB, g, a, 200000, { trusted: false })).status, 400);
  assert.equal((await submitScore(DB, g, a, -1, { trusted: true })).status, 400);
});

test('sum boards add up and only take server scores', async () => {
  const DB = await setup();
  await DB.prepare(`UPDATE games SET score_mode = 'sum' WHERE slug = 'dodge'`).run();
  const g = await getGame(DB, 'dodge');
  const a = await createPlayer(DB);
  assert.equal((await submitScore(DB, g, a, 5, { trusted: false })).status, 403);
  await submitScore(DB, g, a, 5, { trusted: true });
  assert.equal((await submitScore(DB, g, a, 7, { trusted: true })).best, 12);
});

test('sealing a month keeps the top 3 and gives titles, once', async () => {
  const DB = await setup();
  const g = await getGame(DB, 'dodge');
  const last = prevMonth(monthKey());
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const p = await createPlayer(DB, { name: 'p' + i });
    ids.push(p);
    await DB.prepare('INSERT INTO scores (game, month, player_id, score, at) VALUES (?, ?, ?, ?, ?)').bind('dodge', last, p, 100 - i, i).run();
  }
  await archiveMonth(DB, last);
  await archiveMonth(DB, last);
  const rows = await fame(DB, { game: 'dodge' });
  assert.deepEqual(rows.map(r => r.player.name), ['p0', 'p1', 'p2']);
  const champ = await DB.prepare('SELECT title FROM players WHERE id = ?').bind(ids[0]).first();
  assert.match(champ.title, /^Dodge champion · /);
  await archiveMonth(DB, monthKey()); // the current month is never sealed
  assert.equal((await fame(DB, {})).length, 3);
  assert.equal(g.slug, 'dodge');
});

test('play next skips the current game and prefers ones the player has not tried', async () => {
  const DB = await setup();
  await DB.prepare(`INSERT INTO games (slug, title, kind, developer, released_at, created_at) VALUES ('tried', 'Tried', 'hosted', 'me', 0, 0)`).run();
  const p = await createPlayer(DB);
  await gameEvent(DB, await getGame(DB, 'tried'), { type: 'loaded', playerId: p });
  const seen = { race: 0, tried: 0 };
  for (let i = 0; i < 400; i++) seen[(await playNext(DB, 'dodge', p, () => i / 400)).slug]++;
  assert.equal(seen.dodge, undefined);
  assert.ok(seen.race > seen.tried * 2.5, JSON.stringify(seen));
  await DB.prepare(`UPDATE games SET live = 0 WHERE slug != 'dodge'`).run();
  assert.equal(await playNext(DB, 'dodge', p), null);
});

test('playtime counts between start and stop', async () => {
  const DB = await setup();
  const g = await getGame(DB, 'dodge');
  const { play } = await gameEvent(DB, g, { type: 'loaded' });
  await gameEvent(DB, g, { type: 'start', play });
  await DB.prepare('UPDATE plays SET last_at = last_at - 30000 WHERE id = ?').bind(play).run();
  const r = await gameEvent(DB, g, { type: 'stop', play });
  assert.ok(r.ms >= 30000 && r.ms < 31000);
  assert.ok((await gameEvent(DB, g, { type: 'stop', play: 'nope' })).error);
});

test('player tokens verify, and only for their game', async () => {
  const DB = await setup();
  const t = await signToken(DB, env, { sub: 'p1', aud: 'dodge' });
  assert.equal((await verifyToken(DB, env, t, { aud: 'dodge' })).sub, 'p1');
  assert.equal(await verifyToken(DB, env, t, { aud: 'race' }), null);
  assert.equal(await verifyToken(DB, { SITE_URL: 'https://other.test' }, t), null);
  const [h, b, s] = t.split('.');
  assert.equal(await verifyToken(DB, env, `${h}.${b}.${s.slice(0, -4)}AAAA`), null);
  const expired = await signToken(DB, env, { sub: 'p1', aud: 'dodge' }, -10);
  assert.equal(await verifyToken(DB, env, expired), null);
});

test('identities link to one player and never merge accounts', async () => {
  const DB = await setup();
  const a = await attachIdentity(DB, { provider: 'email', subject: 'a@x.com', email: 'a@x.com' });
  assert.equal(await attachIdentity(DB, { provider: 'email', subject: 'a@x.com', email: 'a@x.com' }), a);
  // Signed in as a, connecting SceneSpot links it to a.
  assert.equal(await attachIdentity(DB, { provider: 'scenespot', subject: 's1', current: a }), a);
  // SceneSpot with a verified email that matches finds the same account.
  assert.equal(await attachIdentity(DB, { provider: 'scenespot', subject: 's2', email: 'a@x.com' }), a);
  const b = await attachIdentity(DB, { provider: 'email', subject: 'b@x.com', email: 'b@x.com' });
  // b signing in with s1 (owned by a) signs in as a, without touching b.
  assert.equal(await attachIdentity(DB, { provider: 'scenespot', subject: 's1', current: b }), a);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(100), 2);
  assert.equal(levelFor(300), 3);
});
