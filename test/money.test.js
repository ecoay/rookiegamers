import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer, getGame, DAY } from '../src/db.js';
import { verifyToken } from '../src/tokens.js';
import { bearerPlayer } from '../src/api.js';
import * as money from '../src/money.js';
import { verifyWebhook, hmacHex } from '../src/stripe.js';

const env = { SITE_URL: 'https://rg.test', STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' };
const SITE = 'https://rg.test';
const req = (ip = '1.2.3.4') => new Request('https://rg.test/api/v1/ads/start', { headers: { 'cf-connecting-ip': ip } });

// Stripe stand-in: records calls and answers by path.
let calls = [], answers = {};
const realFetch = globalThis.fetch;
beforeEach(() => {
  calls = []; answers = {};
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, path: u.pathname, body: init.body ? new URLSearchParams(init.body) : u.searchParams, headers: init.headers });
    const a = answers[`${init.method} ${u.pathname}`];
    const out = typeof a === 'function' ? a() : a;
    if (out instanceof Error) return new Response(JSON.stringify({ error: { message: out.message } }), { status: 400 });
    return new Response(JSON.stringify(out || {}), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

async function setup() {
  const DB = fakeD1();
  await migrate(DB);
  const devId = await createPlayer(DB, { name: 'dev', email: 'dev@example.com' });
  await DB.prepare('INSERT INTO developers (player_id, name, created_at) VALUES (?, ?, 0)').bind(devId, 'dev').run();
  for (const slug of ['dodge', 'other']) {
    await DB.prepare(`INSERT INTO games (slug, title, kind, developer, owner_id, live, released_at, created_at) VALUES (?, ?, 'hosted', 'dev', ?, 1, 0, 0)`).bind(slug, slug, devId).run();
  }
  const player = await createPlayer(DB, { name: 'sam', email: 'sam@example.com' });
  return { DB, devId, player, game: () => getGame(DB, 'dodge') };
}
const rewind = (DB, view, ms) => DB.prepare('UPDATE ad_views SET started_at = started_at - ? WHERE id = ?').bind(ms, view).run();
const approve = async (DB, slug) => { await DB.prepare('UPDATE games SET ads_agreed_at = 1 WHERE slug = ?').bind(slug).run(); return money.reviewAds(DB, slug, { status: 'approved' }); };
const secretOf = start => new URL(start.url).searchParams.get('s');

test('ads stay off until the portal approves the game', async () => {
  const { DB, game } = await setup();
  assert.deepEqual(await money.startAd(DB, env, req(), SITE, await game(), { format: 'rewarded' }, null), { fill: false, reason: 'not-approved' });
  await DB.prepare('UPDATE games SET live = 0 WHERE slug = ?').bind('dodge').run();
  await assert.rejects(money.requestAds(DB, await game()), /Publish the game first/);
  await DB.prepare('UPDATE games SET live = 1 WHERE slug = ?').bind('dodge').run();
  await assert.rejects(money.requestAds(DB, await game(), { formats: ['rewarded'] }), /ad terms/);
  await assert.rejects(money.reviewAds(DB, 'dodge', { status: 'approved' }), /hasn't accepted/);
  const asked = await money.requestAds(DB, await game(), { formats: ['rewarded'], agree: true });
  assert.equal(asked.status, 'requested');
  assert.ok(asked.agreedAt);
  assert.equal((await money.adsQueue(DB))[0].status, 'requested');
  await assert.rejects(money.reviewAds(DB, 'dodge', { status: 'rejected' }), /Say why/);
  await money.reviewAds(DB, 'dodge', { status: 'approved' });
  const s = await money.startAd(DB, env, req(), SITE, await game(), { format: 'rewarded' }, null);
  assert.equal(s.fill, true);
  assert.equal(s.source, 'house');
  // Only the formats asked for are on.
  assert.equal((await money.startAd(DB, env, req(), SITE, await game(), { format: 'midgame' }, null)).reason, 'not-approved');
});

test('a rewarded ad has to run its time, counts once, and signs a receipt that is not a login', async () => {
  const { DB, game, player } = await setup();
  await approve(DB, 'dodge');
  const s = await money.startAd(DB, env, req(), SITE, await game(), { format: 'rewarded' }, player);
  assert.equal((await money.completeAd(DB, env, s.view, secretOf(s))).status, 400, 'too early');
  assert.equal((await money.completeAd(DB, env, s.view, 'wrong')).status, 404);
  await rewind(DB, s.view, 15000);
  const r = await money.completeAd(DB, env, s.view, secretOf(s));
  assert.equal(r.rewarded, true);
  const claims = await verifyToken(DB, env, r.receipt, { aud: 'dodge' });
  assert.equal(claims.sub, player);
  assert.equal(claims.use, 'receipt');
  assert.equal((await money.completeAd(DB, env, s.view, secretOf(s))).status, 409, 'once');
  const fake = new Request('https://rg.test', { headers: { authorization: 'Bearer ' + r.receipt } });
  assert.equal(await bearerPlayer(DB, env, fake, 'dodge'), null, 'a receipt never signs anyone in');
});

test('midgame ads are spaced out, and ad unlocks grant the item', async () => {
  const { DB, game, player } = await setup();
  await approve(DB, 'dodge');
  const m1 = await money.startAd(DB, env, req(), SITE, await game(), { format: 'midgame' }, null);
  assert.equal(m1.fill, true);
  assert.equal((await money.startAd(DB, env, req(), SITE, await game(), { format: 'midgame' }, null)).reason, 'too-soon');
  assert.equal((await money.startAd(DB, env, req('5.6.7.8'), SITE, await game(), { format: 'midgame' }, null)).fill, true, 'another visitor');

  await money.putProduct(DB, await game(), 'skin.gold', { title: 'Gold skin', adUnlock: 2, priceCents: 199 });
  assert.equal((await money.startAd(DB, env, req(), SITE, await game(), { format: 'rewarded', sku: 'skin.gold' }, null)).reason, 'signin');
  for (let i = 1; i <= 2; i++) {
    const s = await money.startAd(DB, env, req(), SITE, await game(), { format: 'rewarded', sku: 'skin.gold' }, player);
    await rewind(DB, s.view, 15000);
    const r = await money.completeAd(DB, env, s.view, secretOf(s));
    assert.equal(r.progress, i);
    assert.equal(r.unlocked, i === 2);
  }
  assert.deepEqual((await money.owned(DB, player, 'dodge')).map(o => [o.sku, o.source]), [['skin.gold', 'ads']]);
  const store = await money.storeFor(DB, await game(), player);
  assert.equal(store.items[0].owned, true);
});

test('products check their prices and keep sold items', async () => {
  const { DB, game, player } = await setup();
  await assert.rejects(money.putProduct(DB, await game(), 'Bad Sku!', { title: 'x' }), /sku/);
  await assert.rejects(money.putProduct(DB, await game(), 'cheap', { title: 'Cheap', priceCents: 10 }), /99 cents/);
  await assert.rejects(money.putProduct(DB, await game(), 'free', { title: 'Free' }), /cash price/);
  const p = await money.putProduct(DB, await game(), 'pass', { title: 'Season pass', kind: 'pass', priceCents: 499, adUnlock: 3 });
  assert.equal(p.kind, 'pass');
  assert.match(p.note, /approved for ads/);
  await money.grant(DB, player, 'dodge', 'pass', 'cash', Date.now() + DAY);
  assert.deepEqual(await money.deleteProduct(DB, await game(), 'pass'), { deleted: false, active: false });
  assert.equal((await money.listProducts(DB, await game())).length, 0);
  // A coin game shows the coin price ($15 cash = $10 coin).
  await DB.prepare('UPDATE games SET coin = 1 WHERE slug = ?').bind('dodge').run();
  assert.equal((await money.putProduct(DB, await game(), 'big', { title: 'Big', priceCents: 1500 })).coinPriceCents, 1000);
});

test('a sale through Stripe grants the item, credits 90% after fees with a hold, and a refund takes it back', async () => {
  const { DB, game, player, devId } = await setup();
  await money.putProduct(DB, await game(), 'skin.gold', { title: 'Gold skin', priceCents: 999 });
  answers['POST /v1/checkout/sessions'] = { id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' };
  const co = await money.createCheckout(DB, env, SITE, await game(), player, 'skin.gold');
  assert.equal(co.url, 'https://checkout.stripe.test/cs_1');
  const sent = calls[0].body;
  assert.equal(sent.get('mode'), 'payment');
  assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '999');
  assert.equal(sent.get('client_reference_id'), co.order);
  assert.equal(calls[0].headers['idempotency-key'], co.order);

  answers['GET /v1/payment_intents/pi_1'] = { latest_charge: { balance_transaction: { fee: 59 } } };
  const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: co.order, payment_status: 'paid', payment_intent: 'pi_1', amount_total: 999, total_details: { amount_tax: 0 } } } };
  await money.handleStripeEvent(DB, env, ev);
  assert.deepEqual(await money.handleStripeEvent(DB, env, ev), { duplicate: true });
  assert.equal((await money.orderStatus(DB, co.order, player)).paid, true);
  assert.equal((await money.owned(DB, player, 'dodge'))[0].sku, 'skin.gold');
  const b = await money.balances(DB, devId);
  assert.equal(b.pendingCents, Math.floor((999 - 59) * 0.9));
  assert.equal(b.availableCents, 0, 'held for 30 days');
  await assert.rejects(money.createCheckout(DB, env, SITE, await game(), player, 'skin.gold'), /already own/);

  await money.handleStripeEvent(DB, env, { id: 'evt_2', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_1', amount: 999, amount_refunded: 999, refunded: true } } });
  const after = await money.balances(DB, devId);
  assert.equal(after.pendingCents + after.availableCents, 0);
  assert.equal((await money.owned(DB, player, 'dodge')).length, 0);
});

test('a monthly pass renews from invoices and ends when the subscription does', async () => {
  const { DB, game, player, devId } = await setup();
  await money.putProduct(DB, await game(), 'vip', { title: 'VIP', kind: 'pass', priceCents: 499 });
  answers['POST /v1/checkout/sessions'] = { id: 'cs_2', url: 'https://checkout.stripe.test/cs_2' };
  const co = await money.createCheckout(DB, env, SITE, await game(), player, 'vip');
  assert.equal(calls[0].body.get('mode'), 'subscription');
  assert.equal(calls[0].body.get('line_items[0][price_data][recurring][interval]'), 'month');
  await money.handleStripeEvent(DB, env, { id: 'e1', type: 'checkout.session.completed', data: { object: { client_reference_id: co.order, payment_status: 'paid', subscription: 'sub_1', amount_total: 499 } } });
  const end = Math.floor((Date.now() + 40 * DAY) / 1000);
  answers['GET /v1/charges/ch_9'] = { balance_transaction: { fee: 44 } };
  await money.handleStripeEvent(DB, env, { id: 'e2', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1', amount_paid: 499, tax: 0, charge: 'ch_9', lines: { data: [{ period: { end } }] } } } });
  const own = await money.owned(DB, player, 'dodge');
  assert.ok(own[0].expiresAt >= end * 1000);
  assert.equal((await money.balances(DB, devId)).pendingCents, Math.floor((499 - 44) * 0.9));
  await money.handleStripeEvent(DB, env, { id: 'e3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', current_period_end: Math.floor(Date.now() / 1000) - 10 } } });
  assert.equal((await money.owned(DB, player, 'dodge')).length, 0);
});

test('webhook signatures are checked', async () => {
  const body = JSON.stringify({ id: 'evt', type: 'ping' });
  const t = Math.floor(Date.now() / 1000);
  const good = `t=${t},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${t}.${body}`)}`;
  assert.equal((await verifyWebhook(env, body, good)).id, 'evt');
  assert.equal(await verifyWebhook(env, body, `t=${t},v1=${'0'.repeat(64)}`), null);
  assert.equal(await verifyWebhook(env, body + ' ', good), null);
  const old = t - 3600;
  assert.equal(await verifyWebhook(env, body, `t=${old},v1=${await hmacHex(env.STRIPE_WEBHOOK_SECRET, `${old}.${body}`)}`), null);
});

test('ad revenue: sponsors are priced from views, and the network report splits by views, 70% to developers', async () => {
  const { DB, game, devId } = await setup();
  for (const slug of ['dodge', 'other']) await approve(DB, slug);
  const lastMonth = new Date(Date.now() - 32 * DAY);
  const month = lastMonth.toISOString().slice(0, 7);
  const at = Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth(), 10);
  const cmp = await money.createCampaign(DB, { name: 'Acme', headline: 'Acme chairs', cpmCents: 800, budgetCents: 100 });
  const views = [['dodge', 'network'], ['dodge', 'network'], ['dodge', 'network'], ['other', 'network'], ['dodge', 'sponsor'], ['dodge', 'sponsor']];
  for (const [i, [g, source]] of views.entries()) {
    await DB.prepare(`INSERT INTO ad_views (id, secret, game, who, format, source, campaign, status, started_at) VALUES (?, 'x', ?, 'w', 'rewarded', ?, ?, 'done', ?)`)
      .bind('av' + String(i).padStart(20, '0'), g, source, source === 'sponsor' ? cmp.id : null, at).run();
  }
  const sp = await money.closeSponsorMonth(DB, month);
  assert.deepEqual(sp.games, [{ game: 'dodge', views: 2, grossCents: 1 }]);
  assert.equal((await money.closeSponsorMonth(DB, month)).games.length, 0, 'once');
  await assert.rejects(money.closeSponsorMonth(DB, new Date().toISOString().slice(0, 7)), /isn't over/);

  const net = await money.importNetworkReport(DB, { month, grossCents: 1001 });
  assert.deepEqual(net.games.map(g => [g.game, g.grossCents]).sort(), [['dodge', 751], ['other', 250]]);
  await assert.rejects(money.importNetworkReport(DB, { month, grossCents: 5 }), /already in/);
  const b = await money.balances(DB, devId);
  assert.equal(b.availableCents, Math.floor(751 * 0.7) + Math.floor(250 * 0.7) + Math.floor(1 * 0.7));
  const gm = await money.gameMoney(DB, (await game()).slug);
  assert.equal(gm.months[0].adsCents, 752);
});

test('payouts: monthly over $10 by Stripe transfer, once, and failures are retried', async () => {
  const { DB, devId } = await setup();
  await DB.prepare(`UPDATE developers SET stripe_account = 'acct_1', payouts_ready = 1 WHERE player_id = ?`).bind(devId).run();
  const add = (ref, dev, available = Date.now() - 1000) => DB.prepare(`INSERT INTO ledger (id, developer, game, kind, ref, gross_cents, dev_cents, month, available_at, created_at) VALUES (?, ?, 'dodge', 'store', ?, 0, ?, '2026-10', ?, 0)`).bind('lg' + ref, devId, ref, dev, available).run();
  await add('a', 600);
  await add('held', 5000, Date.now() + DAY);
  assert.equal((await money.runPayouts(DB, env)).payouts[0].reason, 'under-minimum');
  await add('b', 500);
  assert.equal((await money.runPayouts(DB, env, { dryRun: true })).payouts[0].amountCents, 1100);

  answers['POST /v1/transfers'] = new Error('Insufficient funds in the platform balance.');
  const failed = await money.runPayouts(DB, env);
  assert.equal(failed.payouts[0].reason, 'failed');
  assert.equal((await money.balances(DB, devId)).availableCents, 1100, 'given back');

  answers['POST /v1/transfers'] = { id: 'tr_1' };
  const paid = await money.runPayouts(DB, env);
  assert.deepEqual(paid.payouts[0], { developer: devId, amountCents: 1100, paid: true, payout: paid.payouts[0].payout, transfer: 'tr_1' });
  const tr = calls.filter(c => c.path === '/v1/transfers').pop();
  assert.equal(tr.body.get('amount'), '1100');
  assert.equal(tr.body.get('destination'), 'acct_1');
  const st = await money.payoutStatus(DB, devId);
  assert.equal(st.paidCents, 1100);
  assert.equal(st.availableCents, 0);
  assert.equal(st.pendingCents, 5000);
  assert.equal((await money.runPayouts(DB, env)).payouts[0].reason, 'under-minimum', 'nothing paid twice');
});

test('a Stripe account update turns payouts on', async () => {
  const { DB, devId } = await setup();
  answers['POST /v1/accounts'] = { id: 'acct_9' };
  answers['POST /v1/account_links'] = { url: 'https://connect.stripe.test/onboard' };
  assert.equal((await money.connectLink(DB, env, SITE, devId, { country: 'gb' })).url, 'https://connect.stripe.test/onboard');
  const acct = calls.find(c => c.path === '/v1/accounts').body;
  assert.equal(acct.get('type'), 'express');
  assert.equal(acct.get('country'), 'GB');
  assert.equal(acct.get('tos_acceptance[service_agreement]'), 'recipient');
  await money.handleStripeEvent(DB, env, { id: 'e', type: 'account.updated', data: { object: { id: 'acct_9', payouts_enabled: true, capabilities: { transfers: 'active' } } } });
  assert.equal((await money.payoutStatus(DB, devId)).ready, true);
});
