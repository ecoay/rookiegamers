// Friends: one list across every RookieGamers game. A player sends a request, the other accepts.
// Joining through someone's invite link makes you friends straight away. Games read the list
// through the SDK (rg.friends), getting each friend's public profile and whether they play the game.

import { now, getPlayer, publicPlayer } from './db.js';

export const MAX_FRIENDS = 500;
const pair = (x, y) => (x < y ? [x, y] : [y, x]);

async function row(DB, me, them) {
  const [a, b] = pair(me, them);
  return DB.prepare('SELECT a, b, status, requested_by FROM friends WHERE a = ? AND b = ?').bind(a, b).first();
}

// How `them` relates to `me`: 'none', 'friends', 'sent' (I asked) or 'received' (they asked).
export async function friendState(DB, me, them) {
  if (!me || !them || me === them) return 'none';
  const r = await row(DB, me, them);
  if (!r) return 'none';
  if (r.status === 'accepted') return 'friends';
  return r.requested_by === me ? 'sent' : 'received';
}

const count = async (DB, pid) => (await DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE (a = ? OR b = ?) AND status = 'accepted'").bind(pid, pid).first()).n;

// add: send a request, or accept theirs if they already asked. accept / remove (also declines or cancels).
export async function friendAction(DB, me, them, action) {
  if (!them || them === me || !await getPlayer(DB, them)) return { status: 404, error: 'No player here.' };
  const [a, b] = pair(me, them);
  const cur = await row(DB, me, them);
  if (action === 'remove') {
    await DB.prepare('DELETE FROM friends WHERE a = ? AND b = ?').bind(a, b).run();
    return { status: 200, ok: true, state: 'none' };
  }
  if (action !== 'add' && action !== 'accept') return { status: 400, error: 'Unknown action.' };
  if (cur && cur.status === 'accepted') return { status: 200, ok: true, state: 'friends' };
  if (cur && cur.requested_by !== me) {
    if (await count(DB, me) >= MAX_FRIENDS) return { status: 409, error: `You can have up to ${MAX_FRIENDS} friends.` };
    await DB.prepare("UPDATE friends SET status = 'accepted', at = ? WHERE a = ? AND b = ?").bind(now(), a, b).run();
    return { status: 200, ok: true, state: 'friends' };
  }
  if (action === 'accept') return { status: 404, error: 'No friend request from that player.' };
  if (cur) return { status: 200, ok: true, state: 'sent' };
  const pending = (await DB.prepare("SELECT COUNT(*) AS n FROM friends WHERE requested_by = ? AND status = 'pending'").bind(me).first()).n;
  if (pending >= 100) return { status: 429, error: 'Too many requests waiting. Wait for some answers first.' };
  await DB.prepare("INSERT OR IGNORE INTO friends (a, b, status, requested_by, at) VALUES (?, ?, 'pending', ?, ?)").bind(a, b, me, now()).run();
  return { status: 200, ok: true, state: 'sent' };
}

// Invited friends: the inviter and the new player become friends without a request.
export async function befriend(DB, x, y) {
  if (!x || !y || x === y) return;
  const [a, b] = pair(x, y);
  await DB.prepare("INSERT INTO friends (a, b, status, requested_by, at) VALUES (?, ?, 'accepted', ?, ?) ON CONFLICT (a, b) DO UPDATE SET status = 'accepted'").bind(a, b, x, now()).run();
}

// Friends with their public profiles. With a game, also whether and when each played it.
export async function listFriends(DB, pid, game = null) {
  const rows = (await DB.prepare(`SELECT p.*, f.at AS since,
      ${game ? '(SELECT MAX(last_at) FROM plays WHERE player_id = p.id AND game = ?)' : 'NULL'} AS last_played,
      ${game ? '(SELECT xp FROM game_xp WHERE player_id = p.id AND game = ?)' : 'NULL'} AS game_xp
    FROM friends f JOIN players p ON p.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
    WHERE (f.a = ? OR f.b = ?) AND f.status = 'accepted' ORDER BY p.seen_at DESC LIMIT ?`)
    .bind(...(game ? [game, game] : []), pid, pid, pid, MAX_FRIENDS).all()).results;
  return rows.map(p => ({ ...publicPlayer(p), since: p.since, ...(game ? { plays: !!p.last_played, lastPlayed: p.last_played || null, gameLevel: gameLevel(p.game_xp || 0).level } : {}) }));
}

// Requests waiting on this player.
export async function incomingRequests(DB, pid) {
  const rows = (await DB.prepare(`SELECT p.* FROM friends f JOIN players p ON p.id = f.requested_by
    WHERE (f.a = ? OR f.b = ?) AND f.status = 'pending' AND f.requested_by != ? ORDER BY f.at DESC LIMIT 100`).bind(pid, pid, pid).all()).results;
  return rows.map(publicPlayer);
}

/* ---------- per-game levels ---------- */

// Each game can give its own XP and level, separate from the RookieGamers level, on the same curve.
// A tenth of a game's XP also counts toward the RookieGamers level, up to 100 a day per game.
export const GAME_XP = { perCall: 1000, perDay: 10000, rgShare: 0.1, rgPerDay: 100 };
const levelOf = xp => Math.floor((1 + Math.sqrt(1 + (8 * Math.max(0, xp)) / 100)) / 2);
const dayOf = t => new Date(t).toISOString().slice(0, 10);

export function gameLevel(xp) {
  const level = levelOf(xp || 0);
  return { level, xp: xp || 0, levelXp: 50 * level * (level - 1), nextXp: 50 * (level + 1) * level };
}

export async function getGameXp(DB, game, pid) {
  const r = await DB.prepare('SELECT xp FROM game_xp WHERE game = ? AND player_id = ?').bind(game, pid).first();
  return gameLevel(r ? r.xp : 0);
}

export async function addGameXp(DB, game, pid, amount) {
  amount = Math.floor(Number(amount));
  if (!Number.isFinite(amount) || amount < 1 || amount > GAME_XP.perCall) return { status: 400, error: `Give 1 to ${GAME_XP.perCall} XP at a time.` };
  const t = now(), day = dayOf(t);
  const cur = await DB.prepare('SELECT xp, day, day_xp, day_rg FROM game_xp WHERE game = ? AND player_id = ?').bind(game, pid).first();
  const sameDay = cur && cur.day === day;
  const dayXp = sameDay ? cur.day_xp : 0, dayRg = sameDay ? cur.day_rg : 0;
  const give = Math.min(amount, GAME_XP.perDay - dayXp);
  if (give <= 0) return { status: 429, error: 'This game has given its daily XP for this player. More tomorrow.', ...(await getGameXp(DB, game, pid)) };
  const before = cur ? cur.xp : 0;
  const rg = Math.min(Math.floor(give * GAME_XP.rgShare), GAME_XP.rgPerDay - dayRg);
  await DB.prepare(`INSERT INTO game_xp (game, player_id, xp, day, day_xp, day_rg, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (game, player_id) DO UPDATE SET xp = ?, day = ?, day_xp = ?, day_rg = ?, updated_at = ?`)
    .bind(game, pid, before + give, day, dayXp + give, dayRg + rg, t, before + give, day, dayXp + give, dayRg + rg, t).run();
  if (rg > 0) await DB.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').bind(rg, pid).run();
  const after = gameLevel(before + give);
  return { status: 200, ok: true, ...after, given: give, rgXp: rg, levelUp: after.level > levelOf(before) };
}
