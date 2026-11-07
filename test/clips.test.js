import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame } from '../src/db.js';
import * as money from '../src/money.js';
import * as clips from '../src/clips.js';

const env = { SITE_URL: 'https://rg.test', STRIPE_SECRET_KEY: 'sk_test_x', PROMO_CPM_CENTS: '1000' };
const SITE = 'https://rg.test';
const req = (ip = '1.2.3.4') => new Request('https://rg.test/', { headers: { 'cf-connecting-ip': ip } });

// A tiny MP4: an ftyp box and a moov box holding a version 0 mvhd.
function mp4(seconds, v1 = false) {
  const mv = new Uint8Array(v1 ? 120 : 108), dv = new DataView(mv.buffer);
  dv.setUint32(0, mv.length); mv.set([0x6d, 0x76, 0x68, 0x64], 4); mv[8] = v1 ? 1 : 0;
  if (v1) { dv.setUint32(28, 1000); dv.setBigUint64(32, BigInt(Math.round(seconds * 1000))); }
  else { dv.setUint32(20, 1000); dv.setUint32(24, Math.round(seconds * 1000)); }
  const ftyp = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
  const moov = new Uint8Array(8 + mv.length); new DataView(moov.buffer).setUint32(0, moov.length); moov.set([0x6d, 0x6f, 0x6f, 0x76], 4); moov.set(mv, 8);
  const out = new Uint8Array(ftyp.length + moov.length); out.set(ftyp); out.set(moov, ftyp.length);
  return out.buffer;
}
function fakeR2() {
  const m = new Map();
  return { m, put: async (k, v) => { m.set(k, new Uint8Array(v)); }, head: async k => (m.has(k) ? { size: m.get(k).length } : null),
    get: async (k, o) => { const b = m.get(k); if (!b) return null; const r = o?.range ? b.slice(o.range.offset, o.range.offset + o.range.length) : b; return { body: r } } };
}

let calls = [];
const realFetch = globalThis.fetch;
beforeEach(() => { calls = []; globalThis.fetch = async (url, init = {}) => { calls.push({ path: new URL(url).pathname, body: new URLSearchParams(init.body || '') }); return new Response(JSON.stringify({ id: 'cs_p', url: 'https://checkout.stripe.test/p' })); }; });
afterEach(() => { globalThis.fetch = realFetch; });

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  const devs = {};
  for (const slug of ['alpha', 'beta', 'gamma', 'delta']) {
    const pid = await createPlayer(DB, { name: slug });
    devs[slug] = pid;
    await DB.prepare('INSERT INTO developers (player_id, name, created_at) VALUES (?, ?, 0)').bind(pid, slug).run();
    await DB.prepare(`INSERT INTO games (slug, title, kind, developer, owner_id, live, released_at, created_at) VALUES (?, ?, 'hosted', ?, ?, 1, 0, 0)`).bind(slug, slug.toUpperCase(), slug, pid).run();
  }
  const R2 = fakeR2();
  const e = { ...env, GAMES: R2 };
  const join = async slug => { await money.requestAds(DB, await getGame(DB, slug), { agree: true }); await money.reviewAds(DB, slug, { status: 'approved' }); };
  const clip = async (slug, s) => { const c = await clips.uploadClip(DB, e, await getGame(DB, slug), mp4(s), 200); await clips.reviewClip(DB, c.id, { status: 'approved' }); return c; };
  return { DB, e, R2, devs, join, clip, game: s => getGame(DB, s) };
}

test('clip length is read from the MP4 and checked', async () => {
  assert.equal(clips.mp4Seconds(mp4(30)), 30);
  assert.equal(clips.mp4Seconds(mp4(45.5, true)), 45.5);
  assert.equal(clips.mp4Seconds(new TextEncoder().encode('not a video at all, really').buffer), null);
  const { DB, e, join, game } = await setup();
  await assert.rejects(clips.uploadClip(DB, e, await game('alpha'), mp4(30), 200), /Ask for ads first/);
  await join('alpha');
  await assert.rejects(clips.uploadClip(DB, e, await game('alpha'), mp4(12), 200), /30 to 60 seconds/);
  await assert.rejects(clips.uploadClip(DB, e, await game('alpha'), mp4(75), 200), /30 to 60 seconds/);
  const c = await clips.uploadClip(DB, e, await game('alpha'), mp4(31), 200);
  assert.equal(c.status, 'pending');
  assert.ok(e.GAMES.m.has(`_clips/${c.id}.mp4`));
  await assert.rejects(clips.reviewClip(DB, c.id, { status: 'rejected' }), /Say why/);
});

test('with no paid ad, games show each other\'s clips: never their own, only from games in the program', async () => {
  const { DB, e, join, clip, game } = await setup();
  await join('alpha'); await join('beta');
  const a = await clip('alpha', 30);
  // gamma has a clip on file but never joined, so it isn't in the rotation.
  await DB.prepare(`INSERT INTO clips (id, game, title, seconds, bytes, status, created_at) VALUES ('cl0000000000000001', 'gamma', 'g', 30, 1, 'approved', 0)`).run();
  for (let i = 0; i < 20; i++) {
    const s = await money.startAd(DB, e, req('9.9.9.' + i), SITE, await game('beta'), { format: 'midgame' }, null);
    const v = await DB.prepare('SELECT clip, min_ms FROM ad_views WHERE id = ?').bind(s.view).first();
    assert.equal(v.clip, a.id);
    assert.equal(v.min_ms, 5000, 'midgame clips can be skipped after 5 seconds');
  }
  const own = await money.startAd(DB, e, req(), SITE, await game('alpha'), { format: 'midgame' }, null);
  assert.equal((await DB.prepare('SELECT clip FROM ad_views WHERE id = ?').bind(own.view).first()).clip, null, 'not its own clip');
  // delta is in the loop but not monetized yet: it shows clips and its clip runs elsewhere.
  await money.requestAds(DB, await game('delta'), { agree: true });
  const dv = await money.startAd(DB, e, req('8.8.8.8'), SITE, await game('delta'), { format: 'midgame' }, null);
  assert.equal(dv.source, 'house');
  assert.ok((await DB.prepare('SELECT clip FROM ad_views WHERE id = ?').bind(dv.view).first()).clip);
  const d = await clip('delta', 30);
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const s = await money.startAd(DB, e, req('7.7.7.' + i), SITE, await game('beta'), { format: 'midgame' }, null);
    seen.add((await DB.prepare('SELECT clip FROM ad_views WHERE id = ?').bind(s.view).first()).clip);
  }
  assert.ok(seen.has(d.id), 'a game in the loop gets its clip shown before it is monetized');
});

test('rewarded clips run to their end, and only clips of 30 seconds or less are used', async () => {
  const { DB, e, join, clip, game } = await setup();
  await join('alpha'); await join('beta');
  await clip('alpha', 60);
  let s = await money.startAd(DB, e, req(), SITE, await game('beta'), { format: 'rewarded' }, null);
  assert.equal((await DB.prepare('SELECT clip FROM ad_views WHERE id = ?').bind(s.view).first()).clip, null, '60s clip is not used for rewarded');
  const short = await clip('alpha', 30);
  s = await money.startAd(DB, e, req(), SITE, await game('beta'), { format: 'rewarded' }, null);
  assert.equal(s.minMs, 30000);
  assert.equal((await DB.prepare('SELECT clip FROM ad_views WHERE id = ?').bind(s.view).first()).clip, short.id);
  const secret = new URL(s.url).searchParams.get('s');
  await DB.prepare('UPDATE ad_views SET started_at = started_at - 20000 WHERE id = ?').bind(s.view).run();
  assert.equal((await money.completeAd(DB, e, s.view, secret)).status, 400, 'not before the clip ends');
  await DB.prepare('UPDATE ad_views SET started_at = started_at - 10000 WHERE id = ?').bind(s.view).run();
  assert.equal((await money.completeAd(DB, e, s.view, secret)).rewarded, true);
  const st = await clips.crossPromoStats(DB, 'alpha');
  assert.equal(st.yourClipsShownElsewhere, 1);
});

test('the rotation favours games that have hosted more clips than they got', async () => {
  const { DB, e, join, clip, game } = await setup();
  await join('alpha'); await join('beta'); await join('gamma');
  const a = await clip('alpha', 30), b = await clip('beta', 30);
  // beta has shown 30 clips and had none shown; alpha the other way round.
  for (let i = 0; i < 30; i++) {
    await DB.prepare(`INSERT INTO ad_views (id, secret, game, who, format, source, clip, status, started_at) VALUES (?, 'x', 'beta', 'w', 'midgame', 'house', ?, 'done', ?)`).bind('avb' + String(i).padStart(19, '0'), a.id, Date.now()).run();
  }
  let picks = { [a.id]: 0, [b.id]: 0 };
  for (let i = 0; i < 400; i++) picks[(await clips.pickHouseClip(DB, await game('gamma'))).id]++;
  assert.ok(picks[b.id] > picks[a.id] * 4, JSON.stringify(picks));
});

test('a promoted 30-second clip runs as a paid ad in other games, and they earn 70%', async () => {
  const { DB, e, join, clip, game, devs } = await setup();
  await join('alpha'); await join('beta');
  const long = await clip('alpha', 50);
  await assert.rejects(clips.promoteCheckout(DB, e, SITE, await game('alpha'), devs.alpha, { clip: long.id, budgetCents: 5000 }), /30 seconds or less/);
  const c = await clip('alpha', 30);
  await assert.rejects(clips.promoteCheckout(DB, e, SITE, await game('alpha'), devs.alpha, { clip: c.id, budgetCents: 500 }), /\$20/);
  const co = await clips.promoteCheckout(DB, e, SITE, await game('alpha'), devs.alpha, { clip: c.id, budgetCents: 5000 });
  assert.equal(co.url, 'https://checkout.stripe.test/p');
  assert.equal(calls[0].body.get('metadata[kind]'), 'promo');
  const ev = { id: 'evp', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', amount_total: 5000, metadata: { kind: 'promo', promo: co.promo, clip: c.id, budget: '5000' } } } };
  assert.equal((await money.handleStripeEvent(DB, e, ev)).promoted, c.id);
  const promos = await clips.promotions(DB, 'alpha');
  assert.equal(promos[0].budgetCents, 5000);
  assert.equal(promos[0].cpmCents, 1000);
  // Shows in beta as a paid ad, never in alpha itself.
  const s = await money.startAd(DB, e, req(), SITE, await game('beta'), { format: 'rewarded' }, null);
  assert.equal(s.source, 'sponsor');
  assert.equal(s.minMs, 30000);
  const own = await money.startAd(DB, e, req(), SITE, await game('alpha'), { format: 'rewarded' }, null);
  assert.equal(own.source, 'house');
  // The banner shows the promotion first.
  assert.deepEqual(await clips.bannerClip(DB, await game('beta')).then(b => [b.clip.id, b.promoted]), [c.id, true]);
  // Completed views are priced at the CPM; beta's developer earns 70% at month close.
  await DB.prepare(`UPDATE ad_views SET status = 'done', started_at = ? WHERE id = ?`).bind(Date.now() - 40 * 864e5, s.view).run();
  for (let i = 0; i < 99; i++) await DB.prepare(`INSERT INTO ad_views (id, secret, game, who, format, source, campaign, status, started_at) VALUES (?, 'x', 'beta', 'w', 'rewarded', 'sponsor', ?, 'done', ?)`).bind('avp' + String(i).padStart(19, '0'), promos[0].id, Date.now() - 40 * 864e5).run();
  const month = new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 7);
  const closed = await money.closeSponsorMonth(DB, month);
  assert.deepEqual(closed.games, [{ game: 'beta', views: 100, grossCents: 100 }]);
  assert.equal((await money.balances(DB, devs.beta)).availableCents, 70);
});
