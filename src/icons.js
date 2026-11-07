// RookieGamers profile icons. Every icon is drawn here in code: players' social media pictures are
// never used as platform icons. An icon is either bought in the Diamond Shop with gems, earned by
// reaching a milestone, or (later, 18+ with a wallet) minted. Owned icons live in icons_owned.

import { now, DAY, levelFor } from './db.js';

const G = {
  star: '<path d="M32 12l5.9 12 13.1 1.9-9.5 9.3 2.2 13.1L32 42.1l-11.7 6.2 2.2-13.1-9.5-9.3 13.1-1.9z"/>',
  bolt: '<path d="M36 10 18 36h12l-4 18 20-28H34z"/>',
  crown: '<path d="M14 44V22l10 9 8-13 8 13 10-9v22z"/><rect x="14" y="46" width="36" height="5" rx="2"/>',
  heart: '<path d="M32 50S14 39 14 26a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z"/>',
  flame: '<path d="M32 10c2 9 14 14 14 27a14 14 0 0 1-28 0c0-7 4-11 7-14 0 5 2 8 5 9-2-8 2-15 2-22z"/>',
  ghost: '<path d="M18 50V30a14 14 0 0 1 28 0v20l-5-4-4 4-5-4-5 4-4-4z"/><circle cx="27" cy="30" r="3" fill="#fff"/><circle cx="37" cy="30" r="3" fill="#fff"/>',
  rocket: '<path d="M32 10c8 6 11 15 9 26H23c-2-11 1-20 9-26z"/><path d="M23 36l-6 8h8zM41 36l6 8h-8z"/><path d="M28 40h8l-4 10z" fill="#ffd166"/><circle cx="32" cy="24" r="4" fill="#fff"/>',
  pad: '<rect x="12" y="24" width="40" height="20" rx="10"/><path d="M22 29v10M17 34h10" stroke="#000" stroke-opacity=".5" stroke-width="3.5"/><circle cx="40" cy="31" r="2.8" fill="#000" fill-opacity=".5"/><circle cx="46" cy="36" r="2.8" fill="#000" fill-opacity=".5"/>',
  skull: '<path d="M32 12c-11 0-18 7-18 17 0 6 3 10 7 12v7h22v-7c4-2 7-6 7-12 0-10-7-17-18-17z"/><circle cx="25" cy="30" r="4.5" fill="#000" opacity=".55"/><circle cx="39" cy="30" r="4.5" fill="#000" opacity=".55"/>',
  moon: '<path d="M40 12a20 20 0 1 0 12 30A16 16 0 0 1 40 12z"/>',
  alien: '<ellipse cx="32" cy="32" rx="16" ry="19"/><ellipse cx="25" cy="31" rx="5" ry="3" transform="rotate(25 25 31)" fill="#000" opacity=".6"/><ellipse cx="39" cy="31" rx="5" ry="3" transform="rotate(-25 39 31)" fill="#000" opacity=".6"/>',
  gem: '<path d="M20 16h24l8 10-20 24-20-24z"/><path d="M12 26h40M20 16l12 34M44 16 32 50" stroke="#000" stroke-opacity=".2" fill="none"/>',
  trophy: '<path d="M22 12h20v10a10 10 0 0 1-20 0z"/><path d="M22 15h-6a6 6 0 0 0 6 9M42 15h6a6 6 0 0 1-6 9" fill="none" stroke="currentColor" stroke-width="3"/><rect x="29" y="31" width="6" height="9"/><rect x="22" y="40" width="20" height="6" rx="2"/>',
  rookie: '<path d="M22 50V40l-4-4V24l6 4V16h6v10h4V16h6v12l6-4v12l-4 4v10z"/>',
  link: '<path d="M27 37l10-10M24 30l-4 4a6 6 0 0 0 9 9l4-4M40 34l4-4a6 6 0 0 0-9-9l-4 4" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
};

// bg: two gradient stops; fg: glyph color.
const look = (glyph, a, b, fg = '#fff') => ({ glyph, a, b, fg });

// price: gems in the Diamond Shop. earn: a milestone instead of a price. A free starter is always owned.
export const ICONS = [
  { id: 'rookie', name: 'Rookie', earn: 'starter', ...look('rookie', '#5b6cff', '#3a2bd1') },
  { id: 'bolt', name: 'Bolt', price: 100, ...look('bolt', '#ffb703', '#fb8500') },
  { id: 'heart', name: 'Heart', price: 100, ...look('heart', '#ff5d8f', '#c9184a') },
  { id: 'star', name: 'Star', price: 150, ...look('star', '#4cc9f0', '#4361ee') },
  { id: 'pad', name: 'Controller', price: 150, ...look('pad', '#2a9d8f', '#1d6f65') },
  { id: 'ghost', name: 'Ghost', price: 200, ...look('ghost', '#9d4edd', '#5a189a') },
  { id: 'moon', name: 'Moon', price: 200, ...look('moon', '#22223b', '#4a4e69', '#f2e9e4') },
  { id: 'flame', name: 'Flame', price: 250, ...look('flame', '#ff6b35', '#c1121f', '#ffd166') },
  { id: 'rocket', name: 'Rocket', price: 300, ...look('rocket', '#0b132b', '#3a506b', '#e0e1dd') },
  { id: 'alien', name: 'Alien', price: 350, ...look('alien', '#06d6a0', '#118ab2', '#b7ffd8') },
  { id: 'skull', name: 'Skull', price: 400, ...look('skull', '#212529', '#495057', '#f8f9fa') },
  { id: 'crown', name: 'Crown', price: 750, ...look('crown', '#7b2cbf', '#3c096c', '#ffd60a') },
  { id: 'gem', name: 'Diamond', price: 1500, ...look('gem', '#48cae4', '#0077b6', '#caf0f8') },
  { id: 'linked', name: 'Connector', earn: 'link3', ...look('link', '#00b4d8', '#023e8a') },
  { id: 'recruiter', name: 'Recruiter', earn: 'referral', ...look('heart', '#f72585', '#7209b7', '#ffd6ff') },
  { id: 'veteran', name: 'Veteran', earn: 'level10', ...look('star', '#e9c46a', '#a16207', '#fff8e1') },
  { id: 'champion', name: 'Champion', earn: 'hall', ...look('trophy', '#ffd60a', '#e85d04', '#fff') },
];
export const ICON = Object.fromEntries(ICONS.map(i => [i.id, i]));

export const EARN = {
  starter: 'Yours from the start.',
  link3: 'Link 3 social networks.',
  referral: 'Bring a friend who plays for 10 minutes.',
  level10: 'Reach level 10.',
  hall: 'Finish a month in a game\'s Hall of Fame.',
};

export function iconSVG(icon) {
  const i = typeof icon === 'string' ? ICON[icon] : icon;
  if (!i) return null;
  const gid = 'g' + i.id;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${i.a}"/><stop offset="1" stop-color="${i.b}"/></linearGradient></defs><rect width="64" height="64" rx="32" fill="url(#${gid})"/><g fill="${i.fg}" color="${i.fg}">${G[i.glyph]}</g></svg>`;
}
export const iconURI = icon => { const s = iconSVG(icon); return s ? 'data:image/svg+xml,' + encodeURIComponent(s) : null; };

/* ---------- ownership ---------- */

export async function ownedIcons(DB, pid) {
  const rows = (await DB.prepare('SELECT icon, source FROM icons_owned WHERE player_id = ?').bind(pid).all()).results;
  return Object.fromEntries([['rookie', 'earned'], ...rows.map(r => [r.icon, r.source])]);
}

// Grants any milestone icons the player now qualifies for. Cheap enough to run on each shop visit.
export async function claimEarned(DB, p) {
  const [links, refs, hall] = await Promise.all([
    DB.prepare("SELECT COUNT(*) AS n FROM identities WHERE player_id = ? AND provider != 'email'").bind(p.id).first(),
    DB.prepare("SELECT COUNT(*) AS n FROM gems WHERE player_id = ? AND reason = 'referral'").bind(p.id).first(),
    DB.prepare('SELECT COUNT(*) AS n FROM hall WHERE player_id = ?').bind(p.id).first(),
  ]);
  const got = { link3: links.n >= 3, referral: refs.n >= 1, level10: levelFor(p.xp) >= 10, hall: hall.n >= 1 };
  for (const i of ICONS) if (i.earn && got[i.earn]) {
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
