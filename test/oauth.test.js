import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fakeD1 } from './d1.js';
import { migrate, createPlayer } from '../src/db.js';
import { newSession } from '../src/auth.js';
import { createKey } from '../src/dev.js';

// mcp.js imports docs/SDK.md (Wrangler's Text rule); give plain Node the same rule.
register('./md-loader.mjs', import.meta.url);
const { oauthRoute } = await import('../src/oauth.js');
const { mcp } = await import('../src/mcp.js');

const SITE = 'https://rg.test';
const env = { SITE_URL: SITE, OPEN_DEVELOPERS: '0' };
const call = (DB, path, init = {}) => { const req = new Request(SITE + path, init); return oauthRoute(req, init.env || env, DB, SITE, new URL(req.url)); };
const b64url = buf => Buffer.from(buf).toString('base64url');
const verifier = 'v'.repeat(50);
const challenge = b64url(createHash('sha256').update(verifier).digest());
const rpcBody = (method, params = {}, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const mcpCall = (DB, auth, method, params) => mcp(new Request(SITE + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: rpcBody(method, params) }), env, DB, SITE);

async function setup({ developer = true } = {}) {
  const DB = fakeD1();
  await migrate(DB);
  const pid = await createPlayer(DB, { name: 'dev', email: 'dev@example.com' });
  if (developer) await DB.prepare('INSERT INTO developers (player_id, name, created_at) VALUES (?, ?, 0)').bind(pid, 'dev').run();
  const cookie = (await newSession(DB, new Request(SITE), pid)).split(';')[0];
  return { DB, pid, cookie };
}

async function registerClient(DB, redirect = 'https://claude.ai/api/mcp/auth_callback') {
  const r = await call(DB, '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [redirect] }) });
  assert.equal(r.status, 201);
  return (await r.json()).client_id;
}

// Runs authorize → consent → code, and returns the redirect back to the app.
async function approve(DB, cookie, clientId, { redirect = 'https://claude.ai/api/mcp/auth_callback', extra = {}, form = {} } = {}) {
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', scope: 'games', resource: `${SITE}/mcp`, ...extra });
  const start = await call(DB, `/oauth/authorize?${q}`);
  assert.equal(start.status, 302);
  const next = start.headers.get('location');
  assert.match(next, /^\/oauth\/authorize\?rq=rq_/);
  const rq = new URL(SITE + next).searchParams.get('rq');
  const consent = await call(DB, next, { headers: { cookie } });
  assert.equal(consent.status, 200);
  const fd = new URLSearchParams({ rq, decision: 'allow', ...form });
  return { rq, res: await call(DB, '/oauth/authorize', { method: 'POST', headers: { cookie, origin: SITE, 'content-type': 'application/x-www-form-urlencoded' }, body: fd }), consentHTML: await consent.text() };
}

const exchange = (DB, body) => call(DB, '/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });

test('discovery documents point at each other', async () => {
  const { DB } = await setup();
  const pr = await (await call(DB, '/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(pr.resource, `${SITE}/mcp`);
  assert.deepEqual(pr.authorization_servers, [SITE]);
  const as = await (await call(DB, '/.well-known/oauth-authorization-server')).json();
  assert.equal(as.issuer, SITE);
  assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  assert.equal(as.client_id_metadata_document_supported, true);
  assert.ok(as.registration_endpoint.endsWith('/oauth/register'));
});

test('/mcp without a token answers 401 with the resource metadata', async () => {
  const { DB } = await setup();
  const r = await mcpCall(DB, null, 'initialize', { protocolVersion: '2025-06-18' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata="https:\/\/rg\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
  const bad = await mcpCall(DB, 'Bearer rgo_' + '0'.repeat(40), 'tools/list');
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get('www-authenticate'), /invalid_token/);
});

test('full flow: register, sign in, approve, token, MCP call, refresh rotation', async () => {
  const { DB, cookie } = await setup();
  const clientId = await registerClient(DB);
  const { res, consentHTML } = await approve(DB, cookie, clientId);
  assert.match(consentHTML, /Connect Claude to RookieGamers/);
  assert.match(consentHTML, /claude\.ai/);
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get('location'));
  assert.equal(back.origin + back.pathname, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(back.searchParams.get('state'), 'st8');
  assert.equal(back.searchParams.get('iss'), SITE);
  const code = back.searchParams.get('code');

  // Wrong verifier fails, and burns the code.
  assert.equal((await exchange(DB, { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: 'w'.repeat(50) })).status, 400);
  const again = await approve(DB, cookie, clientId);
  const code2 = new URL(again.res.headers.get('location')).searchParams.get('code');
  const tr = await exchange(DB, { grant_type: 'authorization_code', code: code2, client_id: clientId, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_verifier: verifier, resource: `${SITE}/mcp` });
  assert.equal(tr.status, 200);
  const tok = await tr.json();
  assert.match(tok.access_token, /^rgo_/);
  assert.equal(tok.token_type, 'Bearer');
  // A code works once.
  assert.equal((await exchange(DB, { grant_type: 'authorization_code', code: code2, client_id: clientId, code_verifier: verifier })).status, 400);

  // The token works on /mcp, including developer tools.
  const list = await (await mcpCall(DB, `Bearer ${tok.access_token}`, 'tools/list')).json();
  const names = list.result.tools.map(t => t.name);
  assert.ok(names.includes('publish_game'));
  for (const t of list.result.tools) {
    assert.ok(t.title, `${t.name} has a title`);
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof t.annotations.destructiveHint, 'boolean');
  }
  assert.equal(list.result.tools.find(t => t.name === 'unpublish_game').annotations.destructiveHint, true);
  assert.equal(list.result.tools.find(t => t.name === 'get_sdk_docs').annotations.readOnlyHint, true);
  const mine = await (await mcpCall(DB, `Bearer ${tok.access_token}`, 'tools/call', { name: 'list_my_games', arguments: {} })).json();
  assert.equal(mine.result.isError, undefined);

  // Refresh rotates; the old refresh token then fails and ends the connection.
  const r1 = await (await exchange(DB, { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId })).json();
  assert.match(r1.access_token, /^rgo_/);
  assert.notEqual(r1.refresh_token, tok.refresh_token);
  assert.equal((await exchange(DB, { grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: clientId })).status, 400);
  assert.equal((await mcpCall(DB, `Bearer ${r1.access_token}`, 'tools/list')).status, 401);
});

test('API keys still work', async () => {
  const { DB, pid } = await setup();
  const key = await createKey(DB, pid, 'laptop');
  const r = await mcpCall(DB, `Bearer ${key}`, 'tools/list');
  assert.equal(r.status, 200);
});

test('redirect URIs must be registered; loopback matches on any port', async () => {
  const { DB, cookie } = await setup();
  const id = await registerClient(DB, 'http://localhost:3118/callback');
  const ok = await approve(DB, cookie, id, { redirect: 'http://localhost:51234/callback' });
  assert.match(ok.res.headers.get('location'), /^http:\/\/localhost:51234\/callback\?code=rgc_/);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://evil.example/cb', code_challenge: challenge, code_challenge_method: 'S256' });
  const bad = await call(DB, `/oauth/authorize?${q}`);
  assert.equal(bad.status, 400); // shown on our page, never sent to the unregistered address
  const reg = await call(DB, '/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }) });
  assert.equal(reg.status, 400);
});

test('PKCE is required', async () => {
  const { DB } = await setup();
  const id = await registerClient(DB);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', state: 'x' });
  const r = await call(DB, `/oauth/authorize?${q}`);
  assert.equal(r.status, 302);
  assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'invalid_request');
});

test('signed-out developers are sent to sign in and come back', async () => {
  const { DB } = await setup();
  const id = await registerClient(DB);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256' });
  const next = (await call(DB, `/oauth/authorize?${q}`)).headers.get('location');
  const r = await call(DB, next);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), `/signin?next=${encodeURIComponent(next)}`);
});

test('a player who is not a developer needs an invite, or joins when publishing is open', async () => {
  const { DB, cookie } = await setup({ developer: false });
  const id = await registerClient(DB);
  const closed = await approve(DB, cookie, id);
  assert.equal(closed.res.status, 303);
  assert.match(closed.res.headers.get('location'), /err=/);
  await DB.prepare("INSERT INTO dev_invites (code, created_at) VALUES ('inv_abc', 0)").run();
  const withInvite = await approve(DB, cookie, id, { form: { invite: 'inv_abc' } });
  assert.match(withInvite.res.headers.get('location'), /code=rgc_/);
});

test('cancel sends access_denied back to the app', async () => {
  const { DB, cookie } = await setup();
  const id = await registerClient(DB);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const rq = new URL(SITE + (await call(DB, `/oauth/authorize?${q}`)).headers.get('location')).searchParams.get('rq');
  const r = await call(DB, '/oauth/authorize', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ rq, decision: 'deny' }) });
  assert.equal(new URL(r.headers.get('location')).searchParams.get('error'), 'access_denied');
  // A post from another site is refused.
  const x = await call(DB, '/oauth/authorize', { method: 'POST', headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ rq, decision: 'allow' }) });
  assert.equal(x.status, 400);
});

test('client ID metadata documents (CIMD) work as a client_id', async () => {
  const { DB, cookie } = await setup();
  const doc = 'https://chatgpt.com/oauth/client.json';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async u => String(u) === doc
    ? new Response(JSON.stringify({ client_id: doc, client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] }))
    : new Response('no', { status: 404 });
  try {
    const { res, consentHTML } = await approve(DB, cookie, doc, { redirect: 'https://chatgpt.com/connector_platform_oauth_redirect' });
    assert.match(consentHTML, /Connect ChatGPT/);
    const code = new URL(res.headers.get('location')).searchParams.get('code');
    const tok = await (await exchange(DB, { grant_type: 'authorization_code', code, client_id: doc, code_verifier: verifier })).json();
    assert.match(tok.access_token, /^rgo_/);
  } finally { globalThis.fetch = realFetch; }
});

test('revoking a token ends the connection', async () => {
  const { DB, cookie } = await setup();
  const id = await registerClient(DB);
  const code = new URL((await approve(DB, cookie, id)).res.headers.get('location')).searchParams.get('code');
  const tok = await (await exchange(DB, { grant_type: 'authorization_code', code, client_id: id, code_verifier: verifier })).json();
  assert.equal((await call(DB, '/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: tok.refresh_token }) })).status, 200);
  assert.equal((await mcpCall(DB, `Bearer ${tok.access_token}`, 'tools/list')).status, 401);
});

test('review sign-in: off without the secret, signs into one sandbox developer with it', async () => {
  const { DB } = await setup();
  assert.equal((await call(DB, '/oauth/review')).status, 400);
  const renv = { ...env, REVIEW_LOGIN_CODE: 'review-code-1234567890' };
  const id = await registerClient(DB);
  const q = new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', code_challenge: challenge, code_challenge_method: 'S256' });
  const next = (await call(DB, `/oauth/authorize?${q}`, { env: renv })).headers.get('location');
  const gate = await call(DB, next, { env: renv });
  assert.equal(gate.status, 200);
  assert.match(await gate.text(), /review access code/);
  const rq = new URL(SITE + next).searchParams.get('rq');
  const wrong = await call(DB, `/oauth/review?rq=${rq}`, { env: renv, method: 'POST', body: new URLSearchParams({ code: 'nope' }) });
  assert.equal(wrong.status, 200);
  assert.doesNotMatch(wrong.headers.get('set-cookie') || '', /rg_sid/);
  const ok = await call(DB, `/oauth/review?rq=${rq}`, { env: renv, method: 'POST', body: new URLSearchParams({ code: 'review-code-1234567890' }) });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), `/oauth/authorize?rq=${rq}`);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const consent = await call(DB, `/oauth/authorize?rq=${rq}`, { env: renv, headers: { cookie } });
  assert.match(await consent.text(), /AppReviewer/);
  // Signing in again reuses the same account.
  await call(DB, '/oauth/review', { env: renv, method: 'POST', body: new URLSearchParams({ code: 'review-code-1234567890' }) });
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE provider = 'review'").first()).n, 1);
});

test('MCP: cover, studio and logo tools work with a developer key', async () => {
  const { DB, pid } = await setup();
  const key = await createKey(DB, pid, 'k');
  const call = async (name, args) => JSON.parse((await (await mcpCall(DB, `Bearer ${key}`, 'tools/call', { name, arguments: args })).json()).result.content[0].text);
  const names = (await (await mcpCall(DB, `Bearer ${key}`, 'tools/list')).json()).result.tools.map(t => t.name);
  for (const n of ['upload_cover', 'list_studios', 'save_studio', 'upload_studio_logo']) assert.ok(names.includes(n), n);
  const s = await call('save_studio', { slug: 'mcp-studio', name: 'MCP Studio', bio: 'Made from an agent.' });
  assert.equal(s.name, 'MCP Studio');
  assert.equal((await call('list_studios', {}))[0].slug, 'mcp-studio');
  await call('create_game', { slug: 'mcp-game', title: 'MCP Game', kind: 'linked', url: 'https://mcp.example/' });
  assert.equal((await call('update_game', { slug: 'mcp-game', studio: 'mcp-studio' })).studio, 'mcp-studio');
});
