// Cloud saves: a game's own save data for a signed-in player, behind rg.data in the SDK. Each save
// is a key holding JSON, with a version that goes up on every write. A write names the version it
// was based on, so a stale tab can't overwrite newer progress from another device.

import { now } from './db.js';

export const SAVE_LIMITS = { keyRe: /^[A-Za-z0-9_.:-]{1,64}$/, valueBytes: 256 * 1024, gameBytes: 1024 * 1024, keys: 100 };

export async function listSaves(DB, game, pid) {
  const rows = (await DB.prepare('SELECT key, value, version, updated_at FROM saves WHERE game = ? AND player_id = ?').bind(game, pid).all()).results;
  return Object.fromEntries(rows.map(r => [r.key, { value: JSON.parse(r.value), version: r.version, at: r.updated_at }]));
}

// Writes one key. value null deletes it. base: the version the game last saw (0 or absent for a
// new key); a mismatch returns 409 with the newer save so the SDK can hand it back to the game.
export async function writeSave(DB, game, pid, { key, value, base }) {
  key = String(key || '');
  if (!SAVE_LIMITS.keyRe.test(key)) return { status: 400, error: 'Save keys are 1 to 64 letters, digits, or _ . : -' };
  const cur = await DB.prepare('SELECT value, version FROM saves WHERE game = ? AND player_id = ? AND key = ?').bind(game, pid, key).first();
  const have = cur ? cur.version : 0;
  if (base != null && Number(base) !== have) {
    return { status: 409, error: 'A newer save exists (another device or tab saved since).', conflict: true, current: cur ? { value: JSON.parse(cur.value), version: cur.version } : null };
  }
  if (value === null || value === undefined) {
    if (cur) await DB.prepare('DELETE FROM saves WHERE game = ? AND player_id = ? AND key = ?').bind(game, pid, key).run();
    return { status: 200, ok: true, key, version: 0 };
  }
  const text = JSON.stringify(value);
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > SAVE_LIMITS.valueBytes) return { status: 413, error: `A save can be at most ${SAVE_LIMITS.valueBytes / 1024} KB.` };
  const tot = await DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(value)), 0) AS b FROM saves WHERE game = ? AND player_id = ? AND key != ?').bind(game, pid, key).first();
  if (tot.n >= SAVE_LIMITS.keys) return { status: 413, error: `A game can keep at most ${SAVE_LIMITS.keys} save keys per player.` };
  if (tot.b + bytes > SAVE_LIMITS.gameBytes) return { status: 413, error: `A game's saves can total at most ${SAVE_LIMITS.gameBytes / 1024 / 1024} MB per player.` };
  const version = have + 1;
  // The version check repeats in the write itself, so two writes racing on the same base can't both land.
  const r = cur
    ? await DB.prepare('UPDATE saves SET value = ?, version = ?, updated_at = ? WHERE game = ? AND player_id = ? AND key = ? AND version = ?').bind(text, version, now(), game, pid, key, have).run()
    : await DB.prepare('INSERT OR IGNORE INTO saves (game, player_id, key, value, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(game, pid, key, text, version, now()).run();
  if (!r.meta || !r.meta.changes) {
    const c = await DB.prepare('SELECT value, version FROM saves WHERE game = ? AND player_id = ? AND key = ?').bind(game, pid, key).first();
    return { status: 409, error: 'A newer save exists (another device or tab saved since).', conflict: true, current: c ? { value: JSON.parse(c.value), version: c.version } : null };
  }
  return { status: 200, ok: true, key, version };
}
