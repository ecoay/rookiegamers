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
