import { now, newId, monthKey, prevMonth, monthLabel, DAY, liveGames, gameView } from './db.js';

// Plays, leaderboards, the Hall of Fame and "play next".

const MAX_PLAY_MS = 4 * 3600 * 1000;
const BROWSER_GAP = 5000;        // a browser can submit a score once every 5 seconds per game
const MAX_SCORE = 1e12;
const XP_PER_MINUTE = 2, XP_PER_SCORE = 5, XP_PER_DAY_CAP = 300;
const NEW_RELEASE = 14 * DAY;

/* ---------- game events and playtime ---------- */

export async function gameEvent(DB, game, { type, play, ref, playerId }) {
  const t = now();
  if (type === 'loaded') {
    const id = newId('pl');
    await DB.prepare('INSERT INTO plays (id, game, player_id, ref, started_at, last_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, game.slug, playerId || null, ref && ref !== game.slug ? String(ref).slice(0, 32) : null, t, t).run();
    return { play: id };
  }
  const row = play && await DB.prepare('SELECT * FROM plays WHERE id = ? AND game = ?').bind(String(play), game.slug).first();
  if (!row) return { error: 'Unknown play.' };
  // A guest who signs in mid-play claims the play.
  if (playerId && !row.player_id) await DB.prepare('UPDATE plays SET player_id = ? WHERE id = ?').bind(playerId, row.id).run();
  if (type === 'start') {
    await DB.prepare('UPDATE plays SET last_at = ? WHERE id = ?').bind(t, row.id).run();
    return { play: row.id };
  }
  if (type === 'stop' || type === 'beat') {
    // Count time since the last start or heartbeat, never more than the play has been open.
    const add = Math.max(0, Math.min(t - row.last_at, 5 * 60 * 1000, MAX_PLAY_MS - row.ms));
    await DB.prepare('UPDATE plays SET ms = ms + ?, last_at = ? WHERE id = ?').bind(add, t, row.id).run();
    const pid = playerId || row.player_id;
    if (pid && add > 0) await addXP(DB, pid, Math.floor(add / 60000 * XP_PER_MINUTE));
    return { play: row.id, ms: row.ms + add };
  }
  return { error: 'Unknown event.' };
}

async function addXP(DB, pid, xp) {
  if (xp <= 0) return;
  // Daily cap so an idle tab can't level forever.
  const since = now() - DAY;
  const today = await DB.prepare('SELECT COALESCE(SUM(ms), 0) AS ms FROM plays WHERE player_id = ? AND started_at > ?').bind(pid, since).first();
  if (today.ms / 60000 * XP_PER_MINUTE > XP_PER_DAY_CAP) return;
  await DB.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').bind(xp, pid).run();
}

/* ---------- scores ---------- */

// trusted = reported by the game's own server with its secret key.
export async function submitScore(DB, game, playerId, rawScore, { trusted }) {
  const score = Math.round(Number(rawScore));
  if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) return { status: 400, error: 'Scores are whole numbers from 0 up.' };
  if (game.score_mode === 'sum' && !trusted) return { status: 403, error: 'This game\'s board only takes scores from its server.' };
  if (!trusted) {
    if (game.max_score != null && score > game.max_score) return { status: 400, error: 'That score is over this game\'s limit.' };
    const last = await DB.prepare('SELECT at FROM submits WHERE game = ? AND player_id = ?').bind(game.slug, playerId).first();
    if (last && now() - last.at < BROWSER_GAP) return { status: 429, error: 'Slow down a little.' };
    await DB.prepare('INSERT INTO submits (game, player_id, at) VALUES (?, ?, ?) ON CONFLICT (game, player_id) DO UPDATE SET at = excluded.at').bind(game.slug, playerId, now()).run();
  }
  const m = monthKey(), t = now();
  const better = game.score_order === 'asc' ? 'MIN' : 'MAX';
  const update = game.score_mode === 'sum' ? 'score = score + excluded.score, at = excluded.at'
    : `score = ${better}(score, excluded.score), at = CASE WHEN excluded.score ${game.score_order === 'asc' ? '<' : '>'} score THEN excluded.at ELSE at END`;
  const stmt = month => DB.prepare(`INSERT INTO scores (game, month, player_id, score, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (game, month, player_id) DO UPDATE SET ${update}`)
    .bind(game.slug, month, playerId, score, t);
  await DB.batch([stmt(m), stmt('all')]);
  await addXP(DB, playerId, XP_PER_SCORE);
  const mine = await DB.prepare('SELECT score FROM scores WHERE game = ? AND month = ? AND player_id = ?').bind(game.slug, m, playerId).first();
  return { status: 200, ok: true, best: mine.score, rank: await rankOf(DB, game, m, playerId) };
}

export async function rankOf(DB, game, month, playerId) {
  const mine = await DB.prepare('SELECT score, at FROM scores WHERE game = ? AND month = ? AND player_id = ?').bind(game.slug, month, playerId).first();
  if (!mine) return null;
  const cmp = game.score_order === 'asc' ? '<' : '>';
  const r = await DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE game = ? AND month = ? AND (score ${cmp} ? OR (score = ? AND at < ?))`)
    .bind(game.slug, month, mine.score, mine.score, mine.at).first();
  return r.n + 1;
}

export async function topScores(DB, game, month = monthKey(), limit = 10) {
  const dir = game.score_order === 'asc' ? 'ASC' : 'DESC';
  const rows = (await DB.prepare(`SELECT s.player_id, s.score, s.at, p.name, p.hue, p.title FROM scores s JOIN players p ON p.id = s.player_id
    WHERE s.game = ? AND s.month = ? ORDER BY s.score ${dir}, s.at ASC LIMIT ?`).bind(game.slug, month, Math.min(100, Math.max(1, limit | 0))).all()).results;
  return rows.map((r, i) => ({ rank: i + 1, player: { id: r.player_id, name: r.name, hue: r.hue, title: r.title }, score: r.score, at: r.at }));
}

/* ---------- Hall of Fame ---------- */

const PLACES = ['champion', 'runner-up', 'third place'];

// Seal a finished month: its top 3 per game are kept forever and earn a title.
export async function archiveMonth(DB, month) {
  if (month >= monthKey()) return;
  for (const g of await liveGames(DB)) {
    const done = await DB.prepare('SELECT 1 FROM hall WHERE game = ? AND month = ? LIMIT 1').bind(g.slug, month).first();
    if (done) continue;
    const top = await topScores(DB, g, month, 3);
    if (!top.length) continue;
    const stmts = [];
    for (const r of top) {
      const title = `${g.title} ${PLACES[r.rank - 1]} · ${monthLabel(month)}`;
      stmts.push(DB.prepare('INSERT OR IGNORE INTO hall (game, month, rank, player_id, name, score) VALUES (?, ?, ?, ?, ?, ?)').bind(g.slug, month, r.rank, r.player.id, r.player.name, r.score));
      stmts.push(DB.prepare('INSERT OR IGNORE INTO titles (player_id, title, game, month, at) VALUES (?, ?, ?, ?, ?)').bind(r.player.id, title, g.slug, month, now()));
      // The newest title is worn by default; players can pick another on their profile.
      stmts.push(DB.prepare('UPDATE players SET title = ? WHERE id = ?').bind(title, r.player.id));
    }
    await DB.batch(stmts);
  }
}

// Lazily seal last month too, in case the cron hasn't run yet.
export const sealIfDue = DB => archiveMonth(DB, prevMonth(monthKey()));

export async function fame(DB, { game, limit = 60 } = {}) {
  const q = game
    ? DB.prepare('SELECT h.*, g.title AS game_title FROM hall h JOIN games g ON g.slug = h.game WHERE h.game = ? ORDER BY h.month DESC, h.rank ASC LIMIT ?').bind(game, limit)
    : DB.prepare('SELECT h.*, g.title AS game_title FROM hall h JOIN games g ON g.slug = h.game ORDER BY h.month DESC, g.title ASC, h.rank ASC LIMIT ?').bind(limit);
  return (await q.all()).results.map(r => ({ game: r.game, gameTitle: r.game_title, month: r.month, monthLabel: monthLabel(r.month), rank: r.rank, player: { id: r.player_id, name: r.name }, score: r.score }));
}

/* ---------- play next ---------- */

// Pick another game: one the player hasn't tried, weighted toward new releases and games
// people stay in. Returns null if there's nothing else to show.
export async function playNext(DB, fromSlug, playerId, rand = Math.random) {
  const games = (await liveGames(DB)).filter(g => g.slug !== fromSlug);
  if (!games.length) return null;
  const tried = new Set(playerId ? (await DB.prepare('SELECT DISTINCT game FROM plays WHERE player_id = ?').bind(playerId).all()).results.map(r => r.game) : []);
  const stats = await engagement(DB);
  const weights = games.map(g => {
    let w = 1 + Math.min(4, (stats[g.slug]?.perPlayer || 0) / 600000); // up to +4 for 40 min per player
    if (!tried.has(g.slug)) w *= 3;
    if (now() - g.released_at < NEW_RELEASE) w *= 2;
    return w;
  });
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < games.length; i++) { r -= weights[i]; if (r <= 0) return gameView(games[i]); }
  return gameView(games[games.length - 1]);
}

// Playtime per player over the last 30 days. The front page ranks by this, not raw plays,
// so a good small game can beat a big one that people bounce off.
export async function engagement(DB) {
  const rows = (await DB.prepare(`SELECT game, COUNT(*) AS plays, COUNT(DISTINCT COALESCE(player_id, id)) AS players, SUM(ms) AS ms
    FROM plays WHERE started_at > ? GROUP BY game`).bind(now() - 30 * DAY).all()).results;
  return Object.fromEntries(rows.map(r => [r.game, { plays: r.plays, players: r.players, ms: r.ms, perPlayer: r.players ? r.ms / r.players : 0 }]));
}

export async function frontPage(DB) {
  const [games, stats] = await Promise.all([liveGames(DB), engagement(DB)]);
  const t = now();
  return games.map(g => ({ ...gameView(g), isNew: t - g.released_at < NEW_RELEASE, stats: stats[g.slug] || { plays: 0, players: 0, ms: 0, perPlayer: 0 } }))
    .sort((a, b) => (b.isNew - a.isNew) || (b.stats.perPlayer - a.stats.perPlayer) || a.title.localeCompare(b.title));
}

/* ---------- per-game stats for developers ---------- */

export async function gameStats(DB, slug, days = 30) {
  const since = now() - days * DAY;
  const [totals, refs, daily, returning] = await Promise.all([
    DB.prepare('SELECT COUNT(*) AS plays, COUNT(DISTINCT player_id) AS players, COALESCE(SUM(ms), 0) AS ms FROM plays WHERE game = ? AND started_at > ?').bind(slug, since).first(),
    DB.prepare('SELECT ref, COUNT(*) AS plays FROM plays WHERE game = ? AND started_at > ? AND ref IS NOT NULL GROUP BY ref ORDER BY plays DESC LIMIT 10').bind(slug, since).all(),
    DB.prepare(`SELECT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch') AS day, COUNT(*) AS plays, COALESCE(SUM(ms), 0) AS ms FROM plays WHERE game = ? AND started_at > ? GROUP BY day ORDER BY day`).bind(slug, since).all(),
    DB.prepare(`SELECT COUNT(*) AS n FROM (SELECT player_id FROM plays WHERE game = ? AND started_at > ? AND player_id IS NOT NULL
      GROUP BY player_id HAVING COUNT(DISTINCT strftime('%Y-%m-%d', started_at / 1000, 'unixepoch')) > 1)`).bind(slug, since).first(),
  ]);
  return { days, plays: totals.plays, signedInPlayers: totals.players, returningPlayers: returning.n, playtimeMinutes: Math.round(totals.ms / 60000), referrers: refs.results, daily: daily.results };
}
