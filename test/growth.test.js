import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame, getPlayer } from '../src/db.js';
import { attachIdentity } from '../src/auth.js';
import { gameEvent } from '../src/play.js';
import { createShare, settleReferral, referralStats, GEMS } from '../src/growth.js';
import { PLAY_GEMS } from '../src/icons.js';
import { checkBuild } from '../src/dev.js';

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  await DB.prepare(`INSERT INTO games (slug, title, kind, developer, score_label, released_at, created_at) VALUES ('dodge', 'Dodge', 'hosted', 'me', 'Points', 0, 0)`).run();
  return DB;
}

// Ten minutes of play for a player, in two five-minute heartbeats.
async function playTen(DB, pid) {
  const g = await getGame(DB, 'dodge');
  const { play } = await gameEvent(DB, g, { type: 'loaded', playerId: pid });
  for (let i = 0; i < 2; i++) {
    await DB.prepare('UPDATE plays SET last_at = last_at - 300000 WHERE id = ?').bind(play).run();
    await gameEvent(DB, g, { type: 'beat', play, playerId: pid });
  }
}

test('a friend who joins through a link and plays pays out once, to both', async () => {
  const DB = await setup();
  const sam = await createPlayer(DB, { name: 'sam' });
  const friend = await attachIdentity(DB, { provider: 'email', subject: 'f@example.com', email: 'f@example.com', via: sam });
  assert.equal((await getPlayer(DB, friend)).referred_by, sam);
  assert.equal(await settleReferral(DB, friend), null, 'nothing before they play');
  await playTen(DB, friend);
  assert.equal((await getPlayer(DB, sam)).gems, GEMS.referrer);
  assert.equal((await getPlayer(DB, friend)).gems, GEMS.friend + PLAY_GEMS.amount, 'welcome gems plus 10 minutes of play');
  await playTen(DB, friend);
  assert.equal((await getPlayer(DB, sam)).gems, GEMS.referrer, 'pays once');
  assert.deepEqual(await referralStats(DB, sam), { joined: 1, played: 1 });
});

test('existing accounts and self-invites are not referrals', async () => {
  const DB = await setup();
  const sam = await attachIdentity(DB, { provider: 'email', subject: 's@example.com', email: 's@example.com' });
  // Sam signs in again from a friend's link: still the same account, no referral.
  const kim = await createPlayer(DB, { name: 'kim' });
  assert.equal(await attachIdentity(DB, { provider: 'email', subject: 's@example.com', email: 's@example.com', via: kim }), sam);
  assert.equal((await getPlayer(DB, sam)).referred_by, null);
});

test('linking a social network pays once per network, and new social accounts need the age check', async () => {
  const DB = await setup();
  const sam = await createPlayer(DB, { name: 'sam' });
  await attachIdentity(DB, { provider: 'discord', subject: 'd1', current: sam });
  await attachIdentity(DB, { provider: 'discord', subject: 'd1', current: sam });
  await attachIdentity(DB, { provider: 'google', subject: 'g1', current: sam });
  assert.equal((await getPlayer(DB, sam)).gems, 2 * GEMS.link);
  assert.equal(await attachIdentity(DB, { provider: 'x', subject: 'x1', allowNew: false }), null);
});

test('share links credit signed-in players and fall back to the game link for guests', async () => {
  const DB = await setup();
  const g = await getGame(DB, 'dodge');
  const sam = await createPlayer(DB, { name: 'sam' });
  const s = await createShare(DB, 'https://rg.test', g, sam, { score: 1234, room: 'abc' });
  assert.match(s.url, /^https:\/\/rg\.test\/s\/s[a-f0-9]{12}$/);
  assert.equal(s.text, 'I scored 1,234 in Dodge. Can you beat it?');
  const guest = await createShare(DB, 'https://rg.test', g, null, { room: 'abc' });
  assert.equal(guest.url, 'https://rg.test/play/dodge?room=abc');
  assert.equal(guest.credited, false);
  const odd = await createShare(DB, 'https://rg.test', g, sam, { room: '<script>' });
  assert.equal((await DB.prepare('SELECT room FROM shares WHERE id = ?').bind(odd.id).first()).room, null);
});

test('publishing blocks builds with their own sign-in', async () => {
  const files = {};
  const GAMES = {
    get: async k => (k in files ? { text: async () => files[k] } : null),
    list: async ({ prefix }) => ({ objects: Object.keys(files).filter(k => k.startsWith(prefix)).map(key => ({ key, size: files[key].length })) }),
  };
  files['g/1/index.html'] = '<meta name="viewport" content="width=device-width"><script src="https://rookiegamers.com/sdk/v1.js"></script><script src="app.js"></script>';
  files['g/1/app.js'] = 'rg.init({ game: "g" }); rg.game.loaded();';
  assert.equal((await checkBuild({ GAMES }, 'g', '1')).ok, true);
  files['g/1/app.js'] += ' import { signInWithPopup } from "firebase/auth";';
  const r = await checkBuild({ GAMES }, 'g', '1');
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /Firebase Auth/);
});

test('signing in with Discord makes an account, credits the inviter, and pays for the link', async () => {
  const { socialStart, socialCallback } = await import('../src/auth.js');
  const DB = await setup();
  const sam = await createPlayer(DB, { name: 'sam' });
  const env = { DISCORD_CLIENT_ID: 'cid', DISCORD_CLIENT_SECRET: 'sec' };
  const start = await socialStart(env, new Request('https://rg.test/auth/discord?next=/play/dodge&age=1'), 'discord');
  const auth = new URL(start.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, 'https://discord.com/oauth2/authorize');
  const stash = start.headers.get('set-cookie').match(/rg_oidc=([^;]+)/)[1];
  const real = globalThis.fetch;
  globalThis.fetch = async (u, o) => {
    if (String(u).includes('/oauth2/token')) { assert.match(String(o.body), /client_secret=sec/); return Response.json({ access_token: 'at' }); }
    if (String(u).endsWith('/users/@me')) return Response.json({ id: '42', username: 'kimmy', global_name: 'Kim', verified: true, email: 'Kim@Example.com' });
    throw new Error('unexpected fetch ' + u);
  };
  try {
    const cb = await socialCallback(DB, env, new Request(`https://rg.test/auth/discord/callback?code=c&state=${auth.searchParams.get('state')}`, {
      headers: { cookie: `rg_oidc=${stash}; rg_via=${sam}` } }), 'discord');
    assert.equal(cb.headers.get('location'), '/play/dodge');
    const kim = await DB.prepare(`SELECT * FROM players WHERE email = 'kim@example.com'`).first();
    assert.equal(kim.name, 'Kim');
    assert.equal(kim.referred_by, sam);
    assert.equal(kim.gems, GEMS.link);
    // Without the age box ticked, a new account isn't made.
    const s2 = await socialStart(env, new Request('https://rg.test/auth/discord'), 'discord');
    const st2 = new URL(s2.headers.get('location')).searchParams.get('state');
    globalThis.fetch = async u => (String(u).includes('/oauth2/token') ? Response.json({ access_token: 'at' }) : Response.json({ id: '43', username: 'new' }));
    const cb2 = await socialCallback(DB, env, new Request(`https://rg.test/auth/discord/callback?code=c&state=${st2}`, { headers: { cookie: `rg_oidc=${s2.headers.get('set-cookie').match(/rg_oidc=([^;]+)/)[1]}` } }), 'discord');
    assert.match(cb2.headers.get('location'), /^\/signin\?age=1/);
  } finally { globalThis.fetch = real; }
});
