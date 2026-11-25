import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./md-loader.mjs', import.meta.url);
const { packSnipeChat } = await import('../src/twitch-bot.js');

test('a burst of snipes becomes one line that names everyone', () => {
  const lines = ['denfynne', 'leiderhosenlad', 'zarliaus'].map(t => ({ channel: '1', message: '@ecoay sniped @' + t + ' from @sevensparxx.' }));
  assert.deepEqual(packSnipeChat(lines), [
    { channel: '1', message: '@ecoay sniped @denfynne, @leiderhosenlad and @zarliaus from @sevensparxx.' },
  ]);
});

test('sellers, unowned snipes and channels stay apart', () => {
  const out = packSnipeChat([
    { channel: '1', message: '@ecoay sniped @a from @seller.' },
    { channel: '1', message: '@ecoay sniped @b.' },
    { channel: '2', message: '@ecoay just sniped @a from you.' },
    { channel: '2', message: '@ecoay just sniped @c from you.' },
    { channel: '1', message: 'something else' },
  ]);
  assert.deepEqual(out, [
    { channel: '1', message: 'something else' },
    { channel: '1', message: '@ecoay sniped @a from @seller.' },
    { channel: '1', message: '@ecoay sniped @b.' },
    { channel: '2', message: '@ecoay just sniped @a and @c from you.' },
  ]);
});

test('long bursts split under the chat limit without losing anyone', () => {
  const targets = Array.from({ length: 60 }, (_, i) => 'player_number_' + i);
  const out = packSnipeChat(targets.map(t => ({ channel: '1', message: '@ecoay sniped @' + t + ' from @sevensparxx.' })));
  assert.ok(out.length > 1);
  for (const { message } of out) assert.ok(message.length <= 480, message.length);
  const named = out.flatMap(({ message }) => message.match(/@player_number_\d+/g));
  assert.equal(named.length, 60);
});
