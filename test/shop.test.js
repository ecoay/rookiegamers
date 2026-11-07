import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, getPlayer, publicPlayer } from '../src/db.js';
import { buyIcon, equipIcon, ownedIcons, claimEarned, playGems, iconSVG, ICONS } from '../src/icons.js';
import { grantGems } from '../src/growth.js';

async function db(gems = 0) {
  const DB = fakeD1(); await migrate(DB);
  const t = Date.now();
  await DB.prepare("INSERT INTO players (id, name, gems, created_at, seen_at) VALUES ('p1', 'Ada', ?, ?, ?)").bind(gems, t, t).run();
  return DB;
}

test('every icon draws as SVG', () => { for (const i of ICONS) assert.match(iconSVG(i), /^<svg[\s\S]+<\/svg>$/, i.id); });

test('buying spends gems once, and you can then wear it', async () => {
  const DB = await db(120);
  assert.equal((await buyIcon(DB, 'p1', 'star')).status, 402, 'star costs 150');
  const r = await buyIcon(DB, 'p1', 'bolt');
  assert.equal(r.ok, true); assert.equal(r.gems, 20);
  assert.equal((await buyIcon(DB, 'p1', 'bolt')).status, 409);
  assert.equal((await getPlayer(DB, 'p1')).gems, 20);
  assert.equal((await equipIcon(DB, 'p1', 'heart')).status, 403, 'not owned');
  await equipIcon(DB, 'p1', 'bolt');
  assert.match(publicPlayer(await getPlayer(DB, 'p1')).avatar, /^data:image\/svg\+xml,/);
  assert.equal((await buyIcon(DB, 'p1', 'veteran')).status, 404, 'earned icons are not for sale');
});

test('earned icons unlock from milestones, and the starter is always owned', async () => {
  const DB = await db();
  assert.ok((await ownedIcons(DB, 'p1')).rookie);
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
