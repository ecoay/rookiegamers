// RookieGamers profile icons: the platform's own sticker art in public/icons/ (256px webp). Players'
// social media pictures are never used as platform icons. An icon is bought in the Diamond Shop with
// gems, earned by a milestone, or (later, 18+ with a wallet) minted. Owned icons live in icons_owned.

import { now, DAY, levelFor } from './db.js';
import { APEX } from './seo/site.js';

// Every player starts with their letter icon and owns nothing. price: gems in the Diamond Shop.
// earn: a milestone instead of a price. pick: one icon of the group is chosen at the milestone.
// soon: listed in code but hidden until its art is in public/icons/.
export const ICONS = [
  { id: 'logo', name: 'RookieGamers', earn: 'level2', file: 'rookie-gamers-logo', soon: true },
  { id: 'rookie', name: 'Rookie Gamer', earn: 'level5', pick: 'rookie', file: 'rookie-gamer-portrait' },
  { id: 'rookie-2', name: 'Rookie Gamer', earn: 'level5', pick: 'rookie', file: 'rookie-gamer-female-portrait' },
  { id: 'fishtart-handler-pink', name: 'FishTart Handler', price: 150 },
  { id: 'fishtart-handler-bearded', name: 'Bearded Handler', price: 150 },
  { id: 'fishtart-handler-veteran', name: 'Old Salt', price: 150 },
  { id: 'fishtart-hungry-seal', name: 'Hungry Seal', price: 150 },
  { id: 'hand-of-nine-fan', name: 'Hand of Nine Fan', price: 150 },
  { id: 'gray-wojak', name: 'Gray Guy', price: 200 },
  { id: 'crying-wojak', name: 'Crying Guy', price: 200 },
  { id: 'pink-haired-shouter', name: 'Shouter', price: 200 },
  { id: 'moon', name: 'Hooded Frog', price: 200, file: 'hooded-frog' },
  { id: 'blonde-with-phone', name: 'Posting', price: 250 },
  { id: 'youcult-leader', name: 'Cult Leader', price: 250 },
  { id: 'flame', name: 'Shiba', price: 250, file: 'sunglasses-shiba' },
  { id: 'rocket', name: 'Zeppelin', price: 300, file: 'zeppelin' },
  { id: 'hand-of-nine-intern', name: 'Hand of Nine Intern', price: 300 },
  { id: 'alien', name: 'Arcade Fish', price: 350, file: 'rookie-gamers-arcade-fish' },
  { id: 'hand-of-nine-hamster', name: 'Hand of Nine Hamster', price: 350 },
  { id: 'skull', name: 'Hooded Skull', price: 400, file: 'hooded-skull' },
  { id: 'crown', name: 'Bubble Gum King', price: 750, file: 'crowned-bubble-gum-king' },
  { id: 'gem', name: 'Abduction', price: 1500, file: 'ufo-cow' },
  { id: 'linked', name: 'Connector', earn: 'link3', file: 'connector' },
  { id: 'recruiter', name: 'Recruiter', earn: 'referral' },
  { id: 'veteran', name: 'Veteran', earn: 'level10' },
  { id: 'champion', name: 'Champion', earn: 'hall' },
];
export const ICON = Object.fromEntries(ICONS.filter(i => !i.soon).map(i => [i.id, i]));
export const SHOWN = ICONS.filter(i => !i.soon);

export const EARN = {
  level2: 'Reach level 2.',
  level5: 'Reach level 5, then pick one Rookie Gamer.',
  link3: 'Link 3 social networks.',
  referral: 'Bring a friend who plays for 10 minutes.',
  level10: 'Reach level 10.',
  hall: 'Finish a month in a game\'s Hall of Fame.',
};

// Absolute, so games on other sites can show it too.
export function iconURI(icon) {
  const i = typeof icon === 'string' ? ICON[icon] : icon;
  return i ? `${APEX}/icons/${i.file || i.id}.webp` : null;
}

// The first shop set was code-drawn. Seven of its slots now carry the new art under the same id
// (gem, crown, skull, alien, rocket, flame, moon), so owners keep them. The five dropped ones are
// refunded in full.
const RETIRED = { bolt: 100, heart: 100, star: 150, pad: 150, ghost: 200 };
export async function refundRetired(DB) {
  const ids = Object.keys(RETIRED);
  const rows = (await DB.prepare(`SELECT player_id, icon, source FROM icons_owned WHERE icon IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  for (const r of rows) {
    const del = await DB.prepare('DELETE FROM icons_owned WHERE player_id = ? AND icon = ?').bind(r.player_id, r.icon).run();
    if (r.source === 'shop' && del.meta && del.meta.changes) await DB.prepare('UPDATE players SET gems = gems + ? WHERE id = ?').bind(RETIRED[r.icon], r.player_id).run();
  }
  await DB.prepare(`UPDATE players SET icon = NULL WHERE icon IN (${ids.map(() => '?').join(',')})`).bind(...ids).run();
}

/* ---------- ownership ---------- */

export async function ownedIcons(DB, pid) {
  const rows = (await DB.prepare('SELECT icon, source FROM icons_owned WHERE player_id = ?').bind(pid).all()).results;
  return Object.fromEntries(rows.filter(r => ICON[r.icon]).map(r => [r.icon, r.source]));
}

// Players who wore a Rookie Gamer back when both were free keep the one they wore.
export async function keepWornRookie(DB) {
  await DB.prepare("INSERT OR IGNORE INTO icons_owned (player_id, icon, source, at) SELECT id, icon, 'earned', ? FROM players WHERE icon IN ('rookie', 'rookie-2')").bind(now()).run();
}

// Grants any milestone icons the player now qualifies for. Cheap enough to run on each shop visit.
export async function claimEarned(DB, p) {
  const [links, refs, hall] = await Promise.all([
    DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE player_id = ? AND provider != 'email'").bind(p.id).first(),
    DB.prepare("SELECT COUNT(*) AS n FROM gems WHERE player_id = ? AND reason = 'referral'").bind(p.id).first(),
    DB.prepare('SELECT COUNT(*) AS n FROM hall WHERE player_id = ?').bind(p.id).first(),
  ]);
  const got = { level2: levelFor(p.xp) >= 2, link3: links.n >= 3, referral: refs.n >= 1, level10: levelFor(p.xp) >= 10, hall: hall.n >= 1 };
  for (const i of SHOWN) if (i.earn && !i.pick && got[i.earn]) {
    await DB.prepare("INSERT OR IGNORE INTO icons_owned (player_id, icon, source, at) VALUES (?, ?, 'earned', ?)").bind(p.id, i.id, now()).run();
  }
}

// Spends gems on a shop icon. The balance check and the debit are one UPDATE, so two clicks at once
// can't overspend.
export async function buyIcon(DB, pid, id) {
  const i = ICON[id];
  if (!i || !i.price) return { status: 404, error: 'That icon isn\'t for sale.' };
  if ((await ownedIcons(DB, pid))[id]) return { status: 409, error: 'You already own that icon.' };
  const r = await DB.prepare('UPDATE players SET gems = gems - ? WHERE id = ? AND gems >= ?').bind(i.price, pid, i.price).run();
  if (!r.meta || !r.meta.changes) return { status: 402, error: `You need ${i.price} gems for ${i.name}.` };
  const own = await DB.prepare("INSERT OR IGNORE INTO icons_owned (player_id, icon, source, at) VALUES (?, ?, 'shop', ?)").bind(pid, id, now()).run();
  if (!own.meta || !own.meta.changes) {
    await DB.prepare('UPDATE players SET gems = gems + ? WHERE id = ?').bind(i.price, pid).run();
    return { status: 409, error: 'You already own that icon.' };
  }
  await DB.prepare('INSERT OR IGNORE INTO gems (player_id, reason, ref, amount, at) VALUES (?, ?, ?, ?, ?)').bind(pid, 'shop', id, -i.price, now()).run();
  const p = await DB.prepare('SELECT gems FROM players WHERE id = ?').bind(pid).first();
  return { status: 200, ok: true, icon: id, gems: p.gems };
}

// At level 5 a player picks one Rookie Gamer, once. The pick is theirs to wear from then on.
export async function pickIcon(DB, p, id) {
  const i = ICON[id];
  if (!i || !i.pick) return { status: 404, error: 'That icon isn\'t a pick.' };
  if (levelFor(p.xp) < 5) return { status: 403, error: 'Reach level 5 to pick your Rookie Gamer.' };
  const group = SHOWN.filter(x => x.pick === i.pick).map(x => x.id);
  const owned = await ownedIcons(DB, p.id);
  if (group.some(g => owned[g])) return { status: 409, error: 'You already picked your Rookie Gamer.' };
  await DB.prepare("INSERT OR IGNORE INTO icons_owned (player_id, icon, source, at) VALUES (?, ?, 'earned', ?)").bind(p.id, id, now()).run();
  await DB.prepare('UPDATE players SET icon = ? WHERE id = ?').bind(id, p.id).run();
  return { status: 200, ok: true, icon: id };
}

// Which pick groups a player can choose from now: level reached and nothing in the group owned yet.
export function canPick(p, owned) {
  if (!p || levelFor(p.xp) < 5) return {};
  const groups = {};
  for (const i of SHOWN) if (i.pick) groups[i.pick] = groups[i.pick] || !!owned[i.id];
  return Object.fromEntries(Object.entries(groups).filter(([, has]) => !has).map(([g]) => [g, true]));
}

export async function equipIcon(DB, pid, id) {
  if (id && !(await ownedIcons(DB, pid))[id]) return { status: 403, error: 'You don\'t own that icon yet.' };
  await DB.prepare('UPDATE players SET icon = ? WHERE id = ?').bind(id || null, pid).run();
  return { status: 200, ok: true, icon: id || null };
}

/* ---------- gems for playing ---------- */

// Every 10 minutes played (any game, signed in) earns 5 gems, up to 30 gems a day.
export const PLAY_GEMS = { every: 10 * 60 * 1000, amount: 5, perDay: 6 };

export async function playGems(DB, pid, grant) {
  const since = now() - DAY;
  const today = await DB.prepare('SELECT COALESCE(SUM(ms), 0) AS ms FROM plays WHERE player_id = ? AND last_at > ?').bind(pid, since).first();
  const day = new Date(now()).toISOString().slice(0, 10);
  const earned = Math.min(PLAY_GEMS.perDay, Math.floor(today.ms / PLAY_GEMS.every));
  for (let n = 1; n <= earned; n++) await grant(DB, pid, PLAY_GEMS.amount, 'play', `${day}:${n}`);
}
