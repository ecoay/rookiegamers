// Icon frames: a ring drawn around a player's icon wherever it shows. Like icons, a frame is earned
// by a milestone or bought in the Diamond Shop with gems (minted later). Frames are drawn in CSS
// (public/site.css .fr-<id>), so new frame art can replace a style without touching this list.
// Also the trophy case: Hall of Fame finishes and milestones, shown on every profile.

import { now, levelFor } from './db.js';

export const FRAMES = [
  { id: 'bronze', name: 'Bronze', earn: 'level3' },
  { id: 'silver', name: 'Silver', earn: 'level10' },
  { id: 'scenespot', name: 'SceneSpot Gold', earn: 'scenespot' },
  { id: 'champion', name: 'Champion', earn: 'hall' },
  { id: 'neon', name: 'Neon', price: 200 },
  { id: 'inferno', name: 'Inferno', price: 400 },
  { id: 'rainbow', name: 'Rainbow', price: 750 },
  { id: 'diamond', name: 'Diamond', price: 1500 },
];
export const FRAME = Object.fromEntries(FRAMES.map(f => [f.id, f]));

export const FRAME_EARN = {
  level3: 'Reach level 3.',
  level10: 'Reach level 10.',
  scenespot: 'Sign in with or link SceneSpot.',
  hall: 'Finish a month in a game\'s Hall of Fame.',
};

// What a player has done, for frames and trophies. One round trip of small counts.
export async function progress(DB, p) {
  const [links, ss, refs, hall, games] = await Promise.all([
    DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE player_id = ? AND provider != 'email'").bind(p.id).first(),
    DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE player_id = ? AND provider = 'scenespot'").bind(p.id).first(),
    DB.prepare("SELECT COUNT(*) AS n FROM gems WHERE player_id = ? AND reason = 'referral'").bind(p.id).first(),
    DB.prepare('SELECT COUNT(*) AS n FROM hall WHERE player_id = ?').bind(p.id).first(),
    DB.prepare('SELECT COUNT(DISTINCT game) AS n FROM plays WHERE player_id = ?').bind(p.id).first(),
  ]);
  const lv = levelFor(p.xp);
  return { level: lv, links: links.n, scenespot: ss.n > 0, referrals: refs.n, hall: hall.n, games: games.n };
}

const reached = (g, earn) => ({ level3: g.level >= 3, level10: g.level >= 10, scenespot: g.scenespot, hall: g.hall >= 1 })[earn];

export async function ownedFrames(DB, pid) {
  const rows = (await DB.prepare('SELECT frame, source FROM frames_owned WHERE player_id = ?').bind(pid).all()).results;
  return Object.fromEntries(rows.filter(r => FRAME[r.frame]).map(r => [r.frame, r.source]));
}

export async function claimFrames(DB, p, g) {
  g = g || await progress(DB, p);
  for (const f of FRAMES) if (f.earn && reached(g, f.earn)) {
    await DB.prepare("INSERT OR IGNORE INTO frames_owned (player_id, frame, source, at) VALUES (?, ?, 'earned', ?)").bind(p.id, f.id, now()).run();
  }
}

// Same single conditional debit as icons, so two clicks can't overspend.
export async function buyFrame(DB, pid, id) {
  const f = FRAME[id];
  if (!f || !f.price) return { status: 404, error: 'That frame isn\'t for sale.' };
  if ((await ownedFrames(DB, pid))[id]) return { status: 409, error: 'You already own that frame.' };
  const r = await DB.prepare('UPDATE players SET gems = gems - ? WHERE id = ? AND gems >= ?').bind(f.price, pid, f.price).run();
  if (!r.meta || !r.meta.changes) return { status: 402, error: `You need ${f.price} gems for the ${f.name} frame.` };
  const own = await DB.prepare("INSERT OR IGNORE INTO frames_owned (player_id, frame, source, at) VALUES (?, ?, 'shop', ?)").bind(pid, id, now()).run();
  if (!own.meta || !own.meta.changes) {
    await DB.prepare('UPDATE players SET gems = gems + ? WHERE id = ?').bind(f.price, pid).run();
    return { status: 409, error: 'You already own that frame.' };
  }
  await DB.prepare('INSERT OR IGNORE INTO gems (player_id, reason, ref, amount, at) VALUES (?, ?, ?, ?, ?)').bind(pid, 'shop', 'frame:' + id, -f.price, now()).run();
  const p = await DB.prepare('SELECT gems FROM players WHERE id = ?').bind(pid).first();
  return { status: 200, ok: true, frame: id, gems: p.gems };
}

export async function equipFrame(DB, pid, id) {
  if (id && !(await ownedFrames(DB, pid))[id]) return { status: 403, error: 'You don\'t own that frame yet.' };
  await DB.prepare('UPDATE players SET frame = ? WHERE id = ?').bind(id || null, pid).run();
  return { status: 200, ok: true, frame: id || null };
}

/* ---------- trophies ---------- */

// Milestone trophies. Locked ones show greyed out on your own profile so there's something to chase.
export const MILESTONES = [
  { id: 'first-game', name: 'First Game', how: 'Play any game.', got: g => g.games >= 1 },
  { id: 'explorer', name: 'Explorer', how: 'Play 3 different games.', got: g => g.games >= 3 },
  { id: 'level5', name: 'Level 5', how: 'Reach level 5.', got: g => g.level >= 5 },
  { id: 'level10', name: 'Level 10', how: 'Reach level 10.', got: g => g.level >= 10 },
  { id: 'connected', name: 'Connected', how: 'Link 3 social networks.', got: g => g.links >= 3 },
  { id: 'scenespot', name: 'SceneSpot Member', how: 'Sign in with or link SceneSpot.', got: g => g.scenespot },
  { id: 'recruiter', name: 'Recruiter', how: 'Bring a friend who plays for 10 minutes.', got: g => g.referrals >= 1 },
];

// Hall of Fame finishes, best first, with the game's title.
export async function hallTrophies(DB, pid) {
  return (await DB.prepare(`SELECT h.game, h.month, h.rank, h.score, COALESCE(g.title, h.game) AS title
    FROM hall h LEFT JOIN games g ON g.slug = h.game WHERE h.player_id = ? ORDER BY h.rank, h.month DESC`).bind(pid).all()).results;
}
