import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, getPlayer, publicPlayer } from '../src/db.js';
import { buyIcon, equipIcon, ownedIcons, claimEarned, playGems, ICONS } from '../src/icons.js';
import { grantGems } from '../src/growth.js';

async function db(gems = 0) {
  const DB = fakeD1(); await migrate(DB);
  const t = Date.now();
  await DB.prepare("INSERT INTO players (id, name, gems, created_at, seen_at) VALUES ('p1', 'Ada', ?, ?, ?)").bind(gems, t, t).run();
  return DB;
}

test("every icon has its image file", async () => { const { existsSync } = await import("node:fs"); for (const i of ICONS) assert.ok(existsSync(new URL(`../public/icons/${i.file || i.id}.webp`, import.meta.url)), i.id); });

test('buying spends gems once, and you can then wear it', async () => {
  const DB = await db(160);
  assert.equal((await buyIcon(DB, 'p1', 'gray-wojak')).status, 402, 'costs 200');
  const r = await buyIcon(DB, 'p1', 'fishtart-handler-pink');
  assert.equal(r.ok, true); assert.equal(r.gems, 10);
  assert.equal((await buyIcon(DB, 'p1', 'fishtart-handler-pink')).status, 409);
  assert.equal((await getPlayer(DB, 'p1')).gems, 10);
  assert.equal((await equipIcon(DB, 'p1', 'crying-wojak')).status, 403, 'not owned');
  await equipIcon(DB, 'p1', 'fishtart-handler-pink');
  assert.equal(publicPlayer(await getPlayer(DB, 'p1')).avatar, 'https://rookiegamers.com/icons/fishtart-handler-pink.webp');
  assert.equal((await buyIcon(DB, 'p1', 'veteran')).status, 404, 'earned icons are not for sale');
  assert.ok(ICONS.filter(i => i.price).every(i => i.price >= 150), '150 is the cheapest');
});

test('the first set: kept slots carry over, dropped ones are refunded', async () => {
  const DB = await db(0);
  const t = Date.now();
  await DB.prepare("INSERT INTO icons_owned VALUES ('p1', 'gem', 'shop', ?), ('p1', 'bolt', 'shop', ?)").bind(t, t).run();
  await DB.prepare("UPDATE players SET icon = 'bolt' WHERE id = 'p1'").run();
  await migrate(DB);
  const p = await getPlayer(DB, 'p1');
  assert.equal(p.gems, 100); assert.equal(p.icon, null);
  const owned = await ownedIcons(DB, 'p1');
  assert.ok(owned.gem && !owned.bolt);
  await migrate(DB);
  assert.equal((await getPlayer(DB, 'p1')).gems, 100, 'refunds once');
});

test('earned icons unlock from milestones, and the starter is always owned', async () => {
  const DB = await db();
  const o = await ownedIcons(DB, 'p1'); assert.ok(o.rookie && o['rookie-2']);
  await DB.prepare('UPDATE players SET xp = 5000 WHERE id = ?').bind('p1').run();
  await claimEarned(DB, await getPlayer(DB, 'p1'));
  assert.equal((await ownedIcons(DB, 'p1')).veteran, 'earned');
});

test('playing earns 5 gems per 10 minutes, capped at 30 a day', async () => {
  const DB = await db();
  const t = Date.now();
  await DB.prepare("INSERT INTO plays (id, game, player_id, started_at, last_at, ms) VALUES ('x', 'unsays', 'p1', ?, ?, ?)").bind(t, t, 25 * 60 * 1000).run();
  await playGems(DB, 'p1', grantGems); await playGems(DB, 'p1', grantGems);
  assert.equal((await getPlayer(DB, 'p1')).gems, 10);
  await DB.prepare("UPDATE plays SET ms = ? WHERE id = 'x'").bind(300 * 60 * 1000).run();
  await playGems(DB, 'p1', grantGems);
  assert.equal((await getPlayer(DB, 'p1')).gems, 30);
});
