import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { register } from 'node:module';
register('./md-loader.mjs', import.meta.url);
const { twitchBotRoute } = await import('../src/twitch-bot.js');

test('Twitch callback answers only a signed, fresh verification challenge', async () => {
  const env = {
    TWITCH_BOT_CLIENT_ID: 'unit-test',
    TWITCH_BOT_CLIENT_SECRET: 'unit-test-client-secret',
    TWITCH_EVENTSUB_SECRET: 'unit-test-eventsub-secret',
  };
  const url = new URL('https://rookiegamers.com/api/twitch-bot/events');
  const make = (body, signatureBody = body, timestamp = new Date().toISOString()) => new Request(url, {
    method: 'POST',
    headers: {
      'twitch-eventsub-message-id': 'test-event',
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-type': 'webhook_callback_verification',
      'twitch-eventsub-message-signature': 'sha256=' + createHmac('sha256', env.TWITCH_EVENTSUB_SECRET)
        .update('test-event' + timestamp + signatureBody).digest('hex'),
    },
    body,
  });
  const signed = JSON.stringify({ challenge: 'verified' });
  const ok = await twitchBotRoute(make(signed), env, {}, url);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'verified');
  assert.equal((await twitchBotRoute(make('{"challenge":"tampered"}', signed), env, {}, url)).status, 403);
  assert.equal((await twitchBotRoute(make(signed, signed, new Date(0).toISOString()), env, {}, url)).status, 403);
});
