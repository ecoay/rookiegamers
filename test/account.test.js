import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { fakeD1 } from './d1.js';
import { migrate } from '../src/db.js';
import { deleteAccount, parseSignedRequest, metaDeletion } from '../src/account.js';

async function db() {
  const DB = fakeD1(); await migrate(DB);
  const t = Date.now();
  await DB.prepare("INSERT INTO players (id, name, email, created_at, seen_at) VALUES ('p1', 'Ada', 'ada@x.test', ?, ?)").bind(t, t).run();
  await DB.prepare("INSERT INTO identities (provider, subject, player_id, profile, created_at) VALUES ('facebook', 'fb9', 'p1', '{}', ?)").bind(t).run();
  await DB.prepare("INSERT INTO identities (provider, subject, player_id, profile, created_at) VALUES ('google', 'g1', 'p1', '{}', ?)").bind(t).run();
  await DB.prepare("INSERT INTO sessions (token, player_id, created_at) VALUES ('h', 'p1', ?)").bind(t).run();
  await DB.prepare("INSERT INTO scores (game, month, player_id, score, at) VALUES ('unsays', 'all', 'p1', 5, ?)").bind(t).run();
  return DB;
}
const count = async (DB, sql) => (await DB.prepare(sql).first()).n;

test('deleting an account removes the player and everything linked to them', async () => {
  const DB = await db();
  assert.equal((await deleteAccount(DB, 'p1')).ok, true);
  for (const t of ['players', 'identities', 'sessions', 'scores']) assert.equal(await count(DB, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
});

test('a developer with games is asked to remove them first', async () => {
  const DB = await db();
  await DB.prepare("INSERT INTO games (slug, title, kind, developer, owner_id, live, released_at, created_at) VALUES ('g', 'G', 'linked', 'Ada Games', 'p1', 1, 0, 0)").run();
  assert.equal((await deleteAccount(DB, 'p1')).status, 409);
  assert.equal(await count(DB, 'SELECT COUNT(*) AS n FROM players'), 1);
});

const SECRET = 'appsecret';
const b64u = b => Buffer.from(b).toString('base64url');
function signed(data, secret = SECRET) {
  const payload = b64u(JSON.stringify(data));
  return b64u(createHmac('sha256', secret).update(payload).digest()) + '.' + payload;
}

test("Meta's signed_request is verified with the app secret", async () => {
  const sr = signed({ algorithm: 'HMAC-SHA256', user_id: 'fb9', issued_at: 1 });
  assert.equal((await parseSignedRequest(sr, SECRET)).user_id, 'fb9');
  assert.equal(await parseSignedRequest(sr, 'wrong'), null);
  assert.equal(await parseSignedRequest(signed({ user_id: 'fb9' }), SECRET), null, 'algorithm is required');
});

test('the Meta deletion callback drops only the Facebook link', async () => {
  const DB = await db();
  const req = new Request('https://rg.test/auth/facebook/deletion', { method: 'POST', body: new URLSearchParams({ signed_request: signed({ algorithm: 'HMAC-SHA256', user_id: 'fb9' }) }) });
  const r = await metaDeletion(DB, { FACEBOOK_CLIENT_SECRET: SECRET }, req, 'https://rg.test');
  const j = await r.json();
  assert.match(j.url, /^https:\/\/rg\.test\/data-deletion\?code=fb[0-9a-f]{16}$/);
  assert.ok(j.confirmation_code);
  assert.equal(await count(DB, "SELECT COUNT(*) AS n FROM identities WHERE provider = 'facebook'"), 0);
  assert.equal(await count(DB, "SELECT COUNT(*) AS n FROM identities WHERE provider = 'google'"), 1);
  const bad = new Request('https://rg.test/x', { method: 'POST', body: new URLSearchParams({ signed_request: signed({ algorithm: 'HMAC-SHA256', user_id: 'fb9' }, 'nope') }) });
  assert.equal((await metaDeletion(DB, { FACEBOOK_CLIENT_SECRET: SECRET }, bad, 'https://rg.test')).status, 400);
});
