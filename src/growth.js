import { befriend } from './friends.js';
import { now, newId, DAY, getPlayer, cleanText } from './db.js';

// Word of mouth: share links, referrals and gems.
//
// Every signed-in player has an invite link (/?via=<id>) and can share any game (/s/<share id>).
// A visitor who arrives through either is remembered for 30 days. If they make an account, they
// count as that player's referral. Once the friend has played for 10 minutes in any game, the
// player who brought them earns gems and so does the friend. Linking a social account to your
// RookieGamers account also earns gems, once per network.
//
// Gems are a reward currency inside RookieGamers. They are not money and never turn into coin or
// cash.

// SceneSpot is the featured sign-in and pays double the usual link reward.
export const GEMS = { link: 50, scenespot: 100, referrer: 100, friend: 25 };
export const linkGems = provider => provider === 'scenespot' ? GEMS.scenespot : GEMS.link;
export const REFERRAL_PLAY_MS = 10 * 60 * 1000;
const REFERRALS_PER_DAY = 20;        // gems for at most 20 friends a day, so farming accounts doesn't pay
const SHARES_PER_HOUR = 60;
export const VIA_COOKIE = 'rg_via', SHARE_COOKIE = 'rg_share', VIA_DAYS = 30;

/* ---------- gems ---------- */

// Pays a reward once. Returns true if it was new.
export async function grantGems(DB, pid, amount, reason, ref = '') {
  const r = await DB.prepare('INSERT OR IGNORE INTO gems (player_id, reason, ref, amount, at) VALUES (?, ?, ?, ?, ?)').bind(pid, reason, String(ref), amount, now()).run();
  if (!r.meta || !r.meta.changes) return false;
  await DB.prepare('UPDATE players SET gems = gems + ? WHERE id = ?').bind(amount, pid).run();
  return true;
}

export async function gemHistory(DB, pid, limit = 20) {
  return (await DB.prepare('SELECT reason, ref, amount, at FROM gems WHERE player_id = ? ORDER BY at DESC LIMIT ?').bind(pid, limit).all()).results;
}

/* ---------- referrals ---------- */

const PID_RE = /^p[a-f0-9]{20}$/;
export const validVia = v => (typeof v === 'string' && PID_RE.test(v) ? v : null);

// Called when a brand-new account is created. via is the inviting player from the cookie.
export async function recordReferral(DB, pid, via, shareId) {
  via = validVia(via);
  if (!via || via === pid || !await getPlayer(DB, via)) return false;
  const r = await DB.prepare('UPDATE players SET referred_by = ? WHERE id = ? AND referred_by IS NULL').bind(via, pid).run();
  if (r.meta && r.meta.changes) await befriend(DB, via, pid);
  if (shareId && /^s[a-f0-9]{12}$/.test(shareId)) await DB.prepare('UPDATE shares SET signups = signups + 1 WHERE id = ? AND player_id = ?').bind(shareId, via).run();
  return !!(r.meta && r.meta.changes);
}

// After playtime is counted: pay the referral once the friend has really played.
export async function settleReferral(DB, pid) {
  const p = await DB.prepare('SELECT referred_by, ref_paid FROM players WHERE id = ?').bind(pid).first();
  if (!p || !p.referred_by || p.ref_paid) return null;
  const played = await DB.prepare('SELECT COALESCE(SUM(ms), 0) AS ms FROM plays WHERE player_id = ?').bind(pid).first();
  if (played.ms < REFERRAL_PLAY_MS) return null;
  const claim = await DB.prepare('UPDATE players SET ref_paid = 1 WHERE id = ? AND ref_paid = 0').bind(pid).run();
  if (!claim.meta || !claim.meta.changes) return null;
  await grantGems(DB, pid, GEMS.friend, 'welcome', p.referred_by);
  const today = await DB.prepare(`SELECT COUNT(*) AS n FROM gems WHERE player_id = ? AND reason = 'referral' AND at > ?`).bind(p.referred_by, now() - DAY).first();
  if (today.n >= REFERRALS_PER_DAY) return { friend: GEMS.friend, referrer: 0 };
  await grantGems(DB, p.referred_by, GEMS.referrer, 'referral', pid);
  return { friend: GEMS.friend, referrer: GEMS.referrer };
}

export async function referralStats(DB, pid) {
  const r = await DB.prepare('SELECT COUNT(*) AS joined, COALESCE(SUM(ref_paid), 0) AS played FROM players WHERE referred_by = ?').bind(pid).first();
  return { joined: r.joined, played: r.played };
}

/* ---------- shares ---------- */

export function shareText(g, { score, text } = {}) {
  const own = cleanText(text, 200);
  if (own) return own;
  if (Number.isFinite(score) && score > 0) return `I scored ${Number(score).toLocaleString('en-US')} in ${g.title}. Can you beat it?`;
  return `Come play ${g.title} with me on RookieGamers.`;
}

// A share link for a game. Signed-in players get a /s/ link that credits them; guests get the
// plain game link (with the room, for multiplayer invites).
export async function createShare(DB, site, g, pid, { score, room, text } = {}) {
  score = Number.isFinite(Number(score)) && Number(score) > 0 ? Math.floor(Number(score)) : null;
  room = typeof room === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(room) ? room : null;
  const message = shareText(g, { score, text });
  if (!pid) return { url: `${site}/play/${g.slug}${room ? '?room=' + room : ''}`, text: message, credited: false };
  const recent = await DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE player_id = ? AND created_at > ?').bind(pid, now() - 3600 * 1000).first();
  if (recent.n >= SHARES_PER_HOUR) return { status: 429, error: 'That\'s a lot of shares. Try again in a bit.' };
  const id = newId('s', 12);
  await DB.prepare('INSERT INTO shares (id, player_id, game, score, room, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, pid, g.slug, score, room, cleanText(text, 200) || null, now()).run();
  return { id, url: `${site}/s/${id}`, text: message, credited: true };
}

export const getShare = (DB, id) => (/^s[a-f0-9]{12}$/.test(id) ? DB.prepare('SELECT * FROM shares WHERE id = ?').bind(id).first() : null);

// Link-preview fetchers (Discord, iMessage, X, Slack...) aren't visitors.
export const isBot = ua => /bot|crawl|spider|preview|facebookexternalhit|slack|discord|whatsapp|telegram|embedly|vkshare|skype|redditbot|twitterbot|linkedin|pinterest|bingpreview|headless/i.test(ua || '');

export async function countShareClick(DB, share) {
  await DB.prepare('UPDATE shares SET clicks = clicks + 1 WHERE id = ?').bind(share.id).run();
}

export async function shareStats(DB, slug, since) {
  return DB.prepare('SELECT COUNT(*) AS shares, COALESCE(SUM(clicks), 0) AS clicks, COALESCE(SUM(signups), 0) AS signups FROM shares WHERE game = ? AND created_at > ?').bind(slug, since).first();
}
