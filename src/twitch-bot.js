import { cookies, redirect, sessionPlayer, setCookie } from './auth.js';
import { isAdmin } from './admin.js';
import { json } from './api.js';
import { sha256 } from './db.js';
import { signToken } from './tokens.js';

const AUTH = 'https://id.twitch.tv/oauth2';
const HELIX = 'https://api.twitch.tv/helix';
const ROOT = '/api/twitch-bot';
const STATE_COOKIE = 'rg_twitch_bot_state';
const VALID_ID = /^\d{1,32}$/;
const encoder = new TextEncoder();
let appToken;

function tokenRequest(env, fields) {
  return fetch(AUTH + '/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: env.TWITCH_BOT_CLIENT_ID, client_secret: env.TWITCH_BOT_CLIENT_SECRET, ...fields }),
    signal: AbortSignal.timeout(2500),
  });
}

async function helix(env, path, body) {
  if (!appToken || appToken.client !== env.TWITCH_BOT_CLIENT_ID || appToken.expires < Date.now()) {
    const response = await tokenRequest(env, { grant_type: 'client_credentials' });
    if (!response.ok) throw new Error('Twitch bot authentication failed');
    const result = await response.json();
    appToken = { client: env.TWITCH_BOT_CLIENT_ID, value: result.access_token, expires: Date.now() + (result.expires_in - 60) * 1000 };
  }
  const response = await fetch(HELIX + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'client-id': env.TWITCH_BOT_CLIENT_ID, authorization: 'Bearer ' + appToken.value, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(2500),
  });
  if (response.status === 401) appToken = undefined;
  return response;
}

// Public Twitch profiles (id, login, picture) for up to 100 user ids, with the bot's app login.
// For Buy Your Friends' Twitch Island, whose viewers arrive from chat without a picture.
export async function twitchProfiles(env, ids) {
  const wanted = [...new Set(ids.filter(id => VALID_ID.test(id)))].slice(0, 100);
  if (!wanted.length || !env.TWITCH_BOT_CLIENT_ID || !env.TWITCH_BOT_CLIENT_SECRET) return [];
  const response = await helix(env, '/users?' + wanted.map(id => 'id=' + id).join('&'));
  if (!response.ok) throw new Error('Twitch users lookup failed (' + response.status + ')');
  const { data } = await response.json();
  return (Array.isArray(data) ? data : [])
    .filter(u => VALID_ID.test(String(u.id)))
    .map(u => ({ id: String(u.id), login: String(u.login || ''), avatar: /^https:\/\//.test(u.profile_image_url || '') ? u.profile_image_url : null }));
}

async function getBotId(env, DB) {
  if (VALID_ID.test(env.TWITCH_BOT_USER_ID || '')) return env.TWITCH_BOT_USER_ID;
  return (await DB.prepare('SELECT user_id FROM twitch_bot_identity WHERE singleton = 1').first())?.user_id ?? null;
}

function callback(env) {
  return new URL(ROOT + '/authorize/callback', env.SITE_URL).href;
}

async function authorize(req, env, DB, url, returned) {
  const player = await sessionPlayer(DB, req);
  const state = cookies(req)[STATE_COOKIE]?.split('.');
  const role = returned ? state?.[1] : url.searchParams.get('role') === 'bot' ? 'bot' : 'channel';
  if (role !== 'bot' && role !== 'channel') return json({ error: 'Twitch authorization expired.' }, 400);
  const ticket = url.searchParams.get('ticket');
  const pair = role === 'bot' && !returned && url.searchParams.get('pair') === '1';
  const admin = isAdmin(env, player);
  if (pair) {
    if (!admin) return redirect('/signin?next=' + encodeURIComponent(url.pathname + url.search));
    const key = crypto.randomUUID();
    await DB.prepare('DELETE FROM twitch_bot_authorizations WHERE expires_at < ?').bind(Date.now()).run();
    await DB.prepare('INSERT INTO twitch_bot_authorizations (hash, kind, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(key), 'ticket', Date.now() + 300000).run();
    return json({ url: new URL(ROOT + '/authorize?role=bot&ticket=' + key, env.SITE_URL).href });
  }
  const credential = !returned ? ticket : state?.[3] === 'device' ? state[0] : null;
  if (returned && state?.[3] === 'device' && (!url.searchParams.get('code') || state[0] !== url.searchParams.get('state'))) {
    return json({ error: 'Twitch authorization expired or was cancelled.' }, 400);
  }
  let paired = false;
  if (role === 'bot' && credential && /^[0-9a-f-]{36}$/.test(credential)) {
    const result = await DB.prepare('DELETE FROM twitch_bot_authorizations WHERE hash = ? AND kind = ? AND expires_at > ?')
      .bind(await sha256(credential), returned ? 'state' : 'ticket', Date.now()).run();
    paired = result.meta.changes === 1;
    if (!paired) return json({ error: 'The bot authorization link expired or was already used.' }, 403);
  }
  if (!player && !paired) return redirect('/signin?next=' + encodeURIComponent(url.pathname + url.search));
  const linked = role === 'channel' ? await DB.prepare("SELECT subject FROM identities WHERE player_id = ? AND provider = 'twitch'").bind(player).first() : null;
  const botId = await getBotId(env, DB);
  if (role === 'bot' && !admin && !paired) return json({ error: 'Only a Rookie Gamers admin can authorize the bot account.' }, 403);
  if (role === 'channel' && (!botId || !VALID_ID.test(linked?.subject || ''))) {
    return json({ error: botId ? 'Link Twitch on Rookie Gamers first.' : 'The Rookie Gamers bot account is awaiting authorization.' }, 409);
  }
  const expected = role === 'bot' ? botId ?? 'first' : linked.subject;
  const scope = role === 'bot' ? 'user:read:chat user:write:chat user:bot' : 'channel:bot';
  if (!returned) {
    const nonce = crypto.randomUUID();
    if (paired) await DB.prepare('INSERT INTO twitch_bot_authorizations (hash, kind, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(nonce), 'state', Date.now() + 600000).run();
    const target = new URL(AUTH + '/authorize');
    target.search = new URLSearchParams({ client_id: env.TWITCH_BOT_CLIENT_ID, redirect_uri: callback(env), response_type: 'code', scope, state: nonce, force_verify: 'true' });
    return redirect(target.href, [setCookie(req, STATE_COOKIE, [nonce, role, expected, paired ? 'device' : ''].join('.'), 600)]);
  }
  const code = url.searchParams.get('code');
  if (!code || !state || state[0] !== url.searchParams.get('state') || state[2] !== expected) {
    return json({ error: 'Twitch authorization expired or was cancelled.' }, 400);
  }
  const exchanged = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: callback(env) });
  if (!exchanged.ok) return json({ error: 'Twitch authorization failed.' }, 502);
  const { access_token } = await exchanged.json();
  const checked = await fetch(AUTH + '/validate', { headers: { authorization: 'OAuth ' + access_token }, signal: AbortSignal.timeout(2500) });
  const grant = checked.ok ? await checked.json() : null;
  if (!VALID_ID.test(grant?.user_id || '') || (expected !== 'first' && grant.user_id !== expected) ||
      !scope.split(' ').every(s => grant.scopes?.includes(s))) {
    return json({ error: 'Authorize using the Twitch account expected for this connection.' }, 403);
  }
  if (role === 'bot') {
    await DB.prepare('INSERT INTO twitch_bot_identity (singleton, user_id) VALUES (1, ?) ON CONFLICT DO NOTHING')
      .bind(grant.user_id).run();
    if ((await getBotId(env, DB)) !== grant.user_id) return json({ error: 'Another Twitch account is already configured for this bot.' }, 409);
  }
  if (role === 'channel') {
    await DB.prepare('INSERT INTO twitch_bot_channels (id) VALUES (?) ON CONFLICT DO NOTHING').bind(expected).run();
    for (const [type, version] of [['channel.chat.message', '1'], ['stream.online', '1'], ['stream.offline', '1'], ['channel.update', '2']]) {
      const condition = { broadcaster_user_id: expected };
      if (type === 'channel.chat.message') condition.user_id = botId;
      const response = await helix(env, '/eventsub/subscriptions', { type, version, condition, transport: {
        method: 'webhook', callback: new URL(ROOT + '/events', env.SITE_URL).href, secret: env.TWITCH_EVENTSUB_SECRET,
      } });
      if (!response.ok && response.status !== 409) return json({ error: 'Twitch subscription failed.', type, status: response.status }, 502);
    }
  }
  return new Response(role === 'bot' ? 'Rookie Gamers Bot authorized.' : 'Your channel is connected to Rookie Gamers Bot.', {
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', 'set-cookie': setCookie(req, STATE_COOKIE, '', 0) },
  });
}

async function eventPayload(req, secret) {
  const id = req.headers.get('twitch-eventsub-message-id');
  const at = req.headers.get('twitch-eventsub-message-timestamp');
  const signature = req.headers.get('twitch-eventsub-message-signature');
  const time = Date.parse(at || '');
  if (!id || !Number.isFinite(time) || Math.abs(Date.now() - time) > 600000 || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return null;
  const raw = new Uint8Array(await req.arrayBuffer());
  const prefix = encoder.encode(id + at);
  const bytes = new Uint8Array(prefix.length + raw.length);
  bytes.set(prefix);
  bytes.set(raw, prefix.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const hash = Uint8Array.from(signature.slice(7).match(/../g), hex => parseInt(hex, 16));
  if (!await crypto.subtle.verify('HMAC', key, hash, bytes)) return null;
  try { return { data: JSON.parse(new TextDecoder().decode(raw)), at, time }; } catch { return null; }
}

async function relay(env, DB, profile) {
  const body = JSON.stringify(profile);
  const token = await signToken(DB, env, { aud: "buyyourfriends:twitch-relay", use: "twitch-relay", bodyHash: await sha256(body) }, 45);
  const response = await fetch('https://buyyourfriends.com/api/twitch', {
    method: 'POST',
    headers: { authorization: 'RG-Twitch ' + token, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error('BYF Twitch market relay failed (' + response.status + ')');
  return response.json();
}

export async function drainTwitchQueue(env, DB) {
  if (await getBotId(env, DB)) await relay(env, DB, { type: 'drain' });
}

async function processEvent(env, DB, signed) {
  const { data, at, time } = signed;
  const { event, subscription } = data;
  const channel = event?.broadcaster_user_id;
  if (!VALID_ID.test(channel || '') || subscription?.condition?.broadcaster_user_id !== channel) return;
  const registered = await DB.prepare('SELECT live FROM twitch_bot_channels WHERE id = ?').bind(channel).first();
  if (!registered) return;
  if (subscription.type === 'channel.chat.message') {
    const botId = await getBotId(env, DB);
    const command = typeof event.message?.text === 'string' ? event.message.text.trim().toLowerCase() : '';
    if (!botId || subscription.condition.user_id !== botId ||
        event.chatter_user_id === botId ||
        (event.source_broadcaster_user_id && event.source_broadcaster_user_id !== channel) ||
        !['!addme', '!snipeme', '!pumpme'].includes(command) ||
        !VALID_ID.test(event.chatter_user_id || '') || !event.message_id) return;
    const action = command === '!snipeme' ? 'snipe' : command === '!pumpme' ? 'pump' : undefined;
    const { requestId } = await relay(env, DB, { id: event.chatter_user_id, login: event.chatter_user_login,
      name: event.chatter_user_name, at, action, broadcaster: channel, messageId: event.message_id });
    const message = !action
      ? "You're in the Buy Your Friends Twitch market. Sign in through Rookie Gamers with this Twitch account to claim your listing."
      : requestId
        ? 'BYF request ' + requestId + '. Include this code with the streamer’s configured tip or event.'
        : 'This channel has not enabled that BYF command.';
    const inserted = await DB.prepare('INSERT INTO twitch_bot_receipts (channel, message, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
      .bind(channel, event.message_id, time).run();
    if (!inserted.meta.changes) return;
    await DB.prepare('DELETE FROM twitch_bot_receipts WHERE at < ?').bind(Date.now() - 86400000).run();
    const reply = await helix(env, '/chat/messages', { broadcaster_id: channel, sender_id: botId,
      reply_parent_message_id: event.message_id, for_source_only: true,
      message });
    if (!reply.ok || !(await reply.json()).data?.[0]?.is_sent) console.warn('Twitch chat confirmation dropped', reply.status);
    return;
  }
  if (!['stream.online', 'stream.offline', 'channel.update'].includes(subscription.type)) return;
  const active = subscription.type !== 'stream.offline';
  const liveLookup = active ? await helix(env, '/streams?user_id=' + channel) : null;
  if (liveLookup && !liveLookup.ok) throw new Error('Twitch stream lookup failed');
  const live = liveLookup ? (await liveLookup.json()).data?.[0] : null;
  const game = live ? [live.game_name, live.title, ...(live.tags || [])].join(' ') : '';
  const wanted = /\[rg:([a-z0-9-]{1,32})\]/i.exec(live?.title || '')?.[1].toLowerCase();
  const listed = wanted ? await DB.prepare('SELECT slug FROM games WHERE slug = ? AND live = 1').bind(wanted).first() : null;
  const slug = listed?.slug || (/buy[\s_-]*your[\s_-]*friends/i.test(game) ? 'buyyourfriends' : null);
  const isLive = subscription.type === 'stream.online' || Boolean(live);
  await DB.prepare(`UPDATE twitch_bot_channels SET login = ?, display_name = ?, stream_title = ?, game_slug = ?, live = ?,
    updated_at = ?, last_live_at = CASE WHEN live = 1 AND ? = 0 THEN ? ELSE last_live_at END WHERE id = ? AND updated_at < ?`)
    .bind(event.broadcaster_user_login, event.broadcaster_user_name, live?.title ?? '', slug,
      isLive ? 1 : 0, time, isLive ? 1 : 0, time, channel, time).run();
  await relay(env, DB, { id: channel, login: event.broadcaster_user_login, name: event.broadcaster_user_name, at, live: isLive });
}

export async function twitchBotRoute(req, env, DB, url) {
  const path = url.pathname.slice(ROOT.length);
  if (path === '/streams' && req.method === 'GET') {
    const { results } = await DB.prepare(`SELECT id, login, display_name, stream_title, game_slug FROM twitch_bot_channels
       WHERE live = 1 AND game_slug IS NOT NULL ORDER BY updated_at DESC LIMIT 100`).all();
    return json({ streams: results }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=30' });
  }
  if (!env.TWITCH_BOT_CLIENT_ID || !env.TWITCH_BOT_CLIENT_SECRET || !env.TWITCH_EVENTSUB_SECRET) return json({ error: 'Twitch bot is not configured.' }, 503);
  if (path === '/status' && req.method === 'GET') return json({ ready: Boolean(await getBotId(env, DB)) });
  if ((path === '/authorize' || path === '/authorize/callback') && req.method === 'GET') {
    return authorize(req, env, DB, url, path.endsWith('/callback'));
  }
  if (path !== '/events' || req.method !== 'POST') return json({ error: 'Not found' }, 404);
  const signed = await eventPayload(req, env.TWITCH_EVENTSUB_SECRET);
  if (!signed) return json({ error: 'Invalid Twitch signature' }, 403);
  const type = req.headers.get('twitch-eventsub-message-type');
  if (type === 'webhook_callback_verification' && typeof signed.data.challenge === 'string') return new Response(signed.data.challenge);
  if (type === 'notification') await processEvent(env, DB, signed);
  if (type === 'revocation' && signed.data.subscription?.type === 'channel.chat.message') {
    await DB.prepare("UPDATE twitch_bot_channels SET live = 0, game_slug = NULL WHERE id = ?")
      .bind(signed.data.subscription.condition.broadcaster_user_id).run();
  }
  return new Response(null, { status: 204 });
}
