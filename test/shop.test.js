import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, getPlayer, publicPlayer } from '../src/db.js';
import { buyIcon, equipIcon, ownedIcons, claimEarned, playGems, pickIcon, canPick, ICONS } from '../src/icons.js';
import { grantGems } from '../src/growth.js';

async function db(gems = 0) {
  const DB = fakeD1(); await migrate(DB);
  const t = Date.now();
  await DB.prepare("INSERT INTO players (id, name, gems, created_at, seen_at) VALUES ('p1', 'Ada', ?, ?, ?)").bind(gems, t, t).run();
  return DB;
}

test("every icon has its image file", async () => { const { existsSync } = await import("node:fs"); for (const i of ICONS.filter(i => !i.soon)) assert.ok(existsSync(new URL(`../public/icons/${i.file || i.id}.webp`, import.meta.url)), i.id); });

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

test('players start with only their letter, and earned icons unlock from milestones', async () => {
  const DB = await db();
  assert.deepEqual(await ownedIcons(DB, 'p1'), {});
  assert.match(publicPlayer(await getPlayer(DB, 'p1')).avatar, /^data:image\/svg/);
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

test('at level 5 a player picks one Rookie Gamer, once', async () => {
  const DB = await db();
  assert.equal((await pickIcon(DB, await getPlayer(DB, 'p1'), 'rookie')).status, 403, 'too early');
  await DB.prepare('UPDATE players SET xp = 1000 WHERE id = ?').bind('p1').run();
  let p = await getPlayer(DB, 'p1');
  await claimEarned(DB, p);
  assert.ok(!(await ownedIcons(DB, 'p1')).rookie, 'not granted automatically');
  assert.ok(canPick(p, {}).rookie);
  assert.equal((await pickIcon(DB, p, 'rookie-2')).ok, true);
  assert.equal((await getPlayer(DB, 'p1')).icon, 'rookie-2');
  assert.equal((await pickIcon(DB, p, 'rookie')).status, 409, 'only one');
  assert.ok(!canPick(p, await ownedIcons(DB, 'p1')).rookie);
});

test('a player already wearing a Rookie Gamer keeps it', async () => {
  const DB = await db();
  await DB.prepare("UPDATE players SET icon = 'rookie' WHERE id = 'p1'").run();
  await migrate(DB);
  assert.equal((await ownedIcons(DB, 'p1')).rookie, 'earned');
});

test('frames: earned at milestones, bought with gems, worn on the public profile', async () => {
  const { buyFrame, equipFrame, ownedFrames, claimFrames } = await import('../src/frames.js');
  const DB = await db(250);
  assert.equal((await buyFrame(DB, 'p1', 'inferno')).status, 402, 'costs 400');
  assert.equal((await buyFrame(DB, 'p1', 'neon')).gems, 50);
  assert.equal((await buyFrame(DB, 'p1', 'neon')).status, 409);
  assert.equal((await buyFrame(DB, 'p1', 'bronze')).status, 404, 'earned frames are not for sale');
  assert.equal((await equipFrame(DB, 'p1', 'bronze')).status, 403);
  await DB.prepare('UPDATE players SET xp = 300 WHERE id = ?').bind('p1').run();
  await claimFrames(DB, await getPlayer(DB, 'p1'));
  assert.equal((await ownedFrames(DB, 'p1')).bronze, 'earned');
  await equipFrame(DB, 'p1', 'neon');
  assert.equal(publicPlayer(await getPlayer(DB, 'p1')).frame, 'neon');
});

test('the profile shows your inventory with icons, frames and trophies', async () => {
  const { register } = await import('node:module');
  register('./md-loader.mjs', import.meta.url);
  const { page } = await import('../src/pages.js');
  const { sha256 } = await import('../src/db.js');
  const DB = await db(0);
  const id = 'p' + 'a'.repeat(20), t = Date.now(), tok = 'x'.repeat(40);
  await DB.prepare("INSERT INTO players (id, name, gems, xp, created_at, seen_at) VALUES (?, 'Ada', 0, 300, ?, ?)").bind(id, t, t).run();
  await DB.prepare('INSERT INTO sessions (token, player_id, created_at) VALUES (?, ?, ?)').bind(await sha256(tok), id, t).run();
  const url = new URL(`https://rookiegamers.com/u/${id}`), env = { SITE_URL: 'https://rookiegamers.com' };
  const visitor = await (await page(url.pathname, url, env, DB, new Request(url))).text();
  assert.match(visitor, /<h2>Trophies<\/h2>/, 'visitors see the trophy case');
  assert.ok(!visitor.includes('id="inventory"'), 'only you see your inventory');
  const own = await (await page(url.pathname, url, env, DB, new Request(url, { headers: { cookie: `rg_sid=${tok}` } }))).text();
  assert.match(own, /id="inventory"/);
  assert.match(own, /data-tab="icons"[\s\S]*data-tab="frames"[\s\S]*data-tab="trophies"/);
  assert.match(own, /Your letter/);
  assert.match(own, /data-frame="bronze"/, 'level 3 earned the bronze frame, ready to wear');
});
