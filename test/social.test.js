import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { telegramCheck, blueskyMetadata } from '../src/social-extra.js';
import { providers, socialConfig } from '../src/auth.js';

const BOT = '123:abc';
function signed(fields) {
  const lines = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const hash = createHmac('sha256', createHash('sha256').update(BOT).digest()).update(lines).digest('hex');
  return new URLSearchParams({ ...fields, hash });
}

test('telegram login widget data is verified with the bot token', async () => {
  const now = 1_800_000_000;
  const p = signed({ id: '42', first_name: 'Ada', username: 'ada', auth_date: String(now - 60) });
  assert.equal(await telegramCheck(p, BOT, now), true);
  assert.equal(await telegramCheck(p, '999:wrong', now), false);
  const tampered = new URLSearchParams(p); tampered.set('id', '43');
  assert.equal(await telegramCheck(tampered, BOT, now), false);
  assert.equal(await telegramCheck(p, BOT, now + 2 * 86400), false, 'stale logins are refused');
});

test('bluesky client metadata points back at the portal', () => {
  const m = blueskyMetadata('https://rg.example');
  assert.equal(m.client_id, 'https://rg.example/auth/bluesky/client-metadata.json');
  assert.deepEqual(m.redirect_uris, ['https://rg.example/auth/bluesky/callback']);
  assert.equal(m.dpop_bound_access_tokens, true);
});

test('networks switch on from their keys; Steam and Bluesky need none', () => {
  const names = env => providers(env).social.map(s => s.id);
  assert.deepEqual(names({}), ['steam', 'bluesky']);
  const all = names({ FACEBOOK_CLIENT_ID: 'a', FACEBOOK_CLIENT_SECRET: 'b', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's', TELEGRAM_BOT_TOKEN: BOT, TELEGRAM_BOT_NAME: 'rgbot' });
  for (const id of ['google', 'youtube', 'facebook', 'telegram', 'steam', 'bluesky']) assert.ok(all.includes(id), id);
  assert.equal(socialConfig({ STEAM_LOGIN: '0' }, 'steam'), null);
  assert.equal(socialConfig({ TIKTOK_CLIENT_ID: 'k', TIKTOK_CLIENT_SECRET: 's' }, 'tiktok').clientIdParam, 'client_key');
});

test('Instagram uses Meta Unified Login: the Facebook app keys plus a login configuration', async () => {
  const { socialStart } = await import('../src/auth.js');
  assert.equal(socialConfig({ FACEBOOK_CLIENT_ID: 'a', FACEBOOK_CLIENT_SECRET: 'b' }, 'instagram'), null, 'needs INSTAGRAM_CONFIG_ID');
  const env = { FACEBOOK_CLIENT_ID: 'app1', FACEBOOK_CLIENT_SECRET: 'sec', INSTAGRAM_CONFIG_ID: 'cfg9' };
  const res = await socialStart(env, new Request('https://rg.example/auth/instagram?age=1'), 'instagram');
  const loc = new URL(res.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://www.facebook.com/dialog/oauth');
  assert.equal(loc.searchParams.get('client_id'), 'app1');
  assert.equal(loc.searchParams.get('config_id'), 'cfg9');
  assert.equal(loc.searchParams.get('response_type'), 'code');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://rg.example/auth/instagram/callback');
  assert.equal(loc.searchParams.has('scope'), false, 'permissions come from the configuration');
});

test('SceneSpot is featured in gold on the sign-in page and pays double gems', async () => {
  register('./md-loader.mjs', import.meta.url);
  const { page } = await import('../src/pages.js');
  const { fakeD1 } = await import('./d1.js');
  const { migrate, getPlayer } = await import('../src/db.js');
  const { attachIdentity } = await import('../src/auth.js');
  const { GEMS } = await import('../src/growth.js');
  const DB = fakeD1(); await migrate(DB);
  const env = { SITE_URL: 'https://rookiegamers.com', OIDC_ISSUER: 'https://scenespot.example', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's', DISCORD_CLIENT_ID: 'd', DISCORD_CLIENT_SECRET: 'd' };
  const url = new URL('https://rookiegamers.com/signin');
  const html = await (await page('/signin', url, env, DB, new Request(url))).text();
  assert.match(html, /class="scenespot"[\s\S]*btn gold social[^>]*>Continue with SceneSpot/);
  assert.ok(html.indexOf('Continue with SceneSpot') < html.indexOf('Continue with Discord'));
  assert.ok(!/guest/i.test(html), 'no guest-play copy');
  assert.equal(GEMS.scenespot, GEMS.link * 2);
  const a = await attachIdentity(DB, { provider: 'scenespot', subject: 's1' });
  const b = await attachIdentity(DB, { provider: 'discord', subject: 'd1' });
  assert.equal((await getPlayer(DB, a)).gems, GEMS.scenespot);
  assert.equal((await getPlayer(DB, b)).gems, GEMS.link);
});
