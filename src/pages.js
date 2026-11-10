import { getGame, getPlayer, publicPlayer, avatarFor, gameView, monthKey, monthLabel, levelFor, safeJSON } from './db.js';
import { sessionPlayer, providers, safeNext, setCookie } from './auth.js';
import { getShare, isBot, countShareClick, validVia, referralStats, gemHistory, GEMS, linkGems, VIA_COOKIE, SHARE_COOKIE, VIA_DAYS, REFERRAL_PLAY_MS } from './growth.js';
import { frontPage, topScores, fame, sealIfDue } from './play.js';
import { isDeveloper, myGames, listKeys, siteURL } from './dev.js';
import { mintFor } from './api.js';
import { devMoneySection } from './money-api.js';
import SDK_DOCS from '../docs/SDK.md';
import { homePage } from './home.js';
import { canonical, ldJSON } from './seo/site.js';
import { SHOWN, EARN, iconURI, ownedIcons, claimEarned, canPick, PLAY_GEMS } from './icons.js';
import { FRAMES, FRAME_EARN, ownedFrames, claimFrames, progress, MILESTONES, hallTrophies } from './frames.js';
import { friendState, listFriends, incomingRequests, gameLevel } from './friends.js';
import { FOOTER_LINKS, NEW_PAGES, DEV_JSONLD, DOCS_JSONLD, HALL_OF_FAME_JSONLD, PLAY_PAGES } from './seo/copy.js';
import { gameImage, playJSONLD, DEFAULT_OG_IMAGE } from './seo/dynamic.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
// Inline JSON safely inside <script>.
const data = v => JSON.stringify(v).replace(/</g, '\\u003c');

const GEM = '<svg class="gem" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1h8l4 5-8 9-8-9z" fill="currentColor"/><path d="M0 6h16M4 1l4 14M12 1 8 15" stroke="rgba(0,0,0,.25)" fill="none"/></svg>';
// A player's icon inside the frame they wear. Every avatar on the site goes through this.
const avatar = (pub, alt = '') => `<span class="av${pub.frame ? ` fr-${esc(pub.frame)}` : ''}"><img src="${esc(pub.avatar)}" alt="${esc(alt)}"></span>`;
const RANK = r => r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`;
const MEDAL = r => r === 1 ? 'gold' : r === 2 ? 'silver' : r === 3 ? 'bronze' : 'plain';
const CUP = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20v10a10 10 0 0 1-20 0z" fill="currentColor"/><path d="M14 9H7v4a7 7 0 0 0 7 7M34 9h7v4a7 7 0 0 1-7 7" fill="none" stroke="currentColor" stroke-width="3"/><path d="M21 26h6v8h-6z" fill="currentColor"/><path d="M14 36h20v6H14z" fill="currentColor"/><path d="M18 9v7" stroke="rgba(255,255,255,.45)" stroke-width="2.5" stroke-linecap="round"/></svg>';
const gemCount = n => `<span class="gems" title="Gems">${GEM}${Number(n || 0).toLocaleString('en-US')}</span>`;

function layout({ title, titleFull, desc, me, active, body, url, scripts = '', og = {}, canonicalPath, jsonld, robots }) {
  const t = titleFull || (title ? `${title} · RookieGamers` : 'RookieGamers · free web games, one account');
  const ogTitle = og.title || t, ogDesc = og.desc || desc || 'Play free web games from indie developers, with one account, one level and one Hall of Fame across every game.';
  const nav = [['/', 'Games'], ['/hall-of-fame', 'Hall of Fame'], ['/shop', 'Diamond Shop'], ['/dev', 'Publish'], ['/docs', 'SDK']];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title><meta name="description" content="${esc(desc || 'Play free web games from indie developers, with one account, one level and one Hall of Fame across every game.')}"><meta name="google-adsense-account" content="ca-pub-8081136929405133"><meta name="google-site-verification" content="OSHWSdXxLLrQTk12-QAup0nc3IHfnccGLamcxk2hDng">
${robots ? `<meta name="robots" content="${esc(robots)}">` : ''}
<meta property="og:site_name" content="RookieGamers"><meta property="og:title" content="${esc(ogTitle)}"><meta property="og:description" content="${esc(ogDesc)}"><meta property="og:type" content="${esc(og.type || 'website')}"><meta property="og:locale" content="en_US">
${canonicalPath ? `<meta property="og:url" content="${esc(canonical(canonicalPath))}">` : url ? `<meta property="og:url" content="${esc(url)}">` : ''}${canonicalPath ? `<link rel="canonical" href="${esc(canonical(canonicalPath))}">` : ''}<meta property="og:image" content="${esc(og.image || DEFAULT_OG_IMAGE)}"><meta property="og:image:alt" content="${esc(og.alt || ogTitle)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(og.image || DEFAULT_OG_IMAGE)}"><meta name="twitter:image:alt" content="${esc(og.alt || ogTitle)}"><meta name="theme-color" content="#0f0d16">
<meta name="twitter:title" content="${esc(ogTitle)}"><meta name="twitter:description" content="${esc(ogDesc)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/site.css">${(jsonld || []).map(block => `<script type="application/ld+json">${ldJSON(block)}</script>`).join('')}</head><body>
<header class="top"><div class="wrap"><a class="logo" href="/"><b>RG</b>RookieGamers</a>
<nav class="main">${nav.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
${me ? `<a class="me" href="/u/${esc(me.id)}#inventory" title="Your profile and inventory">${avatar(me)}${esc(me.name)} <span class="muted">Lv ${me.level}</span>${gemCount(me.gems)}</a>` : `<a class="btn small" href="/signin?next=${encodeURIComponent(active || '/')}" id="signinLink">Sign in</a>`}
</div></header><main><div class="wrap">${body}</div></main>
<footer class="foot"><div class="wrap"><span>RookieGamers</span>${FOOTER_LINKS.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}<span>Accounts are for players 13 and up.</span></div></footer>
${scripts}</body></html>`;
}

async function viewer(DB, req) {
  const pid = await sessionPlayer(DB, req);
  const p = pid && await getPlayer(DB, pid);
  return p ? { ...publicPlayer(p), gems: p.gems } : null;
}

const initial = s => esc((s || '?').trim().charAt(0).toUpperCase());
function art(g) {
  const color = /^#[0-9a-f]{6}$/i.test(g.color || '') ? g.color : '#8f6bff';
  const cover = g.cover ? (/^https:\/\//.test(g.cover) ? g.cover : null) : null;
  return `<div class="art" style="background:${cover ? `url('${esc(cover)}') center/cover,` : ''}linear-gradient(135deg,${color},#191626)">${cover ? '' : initial(g.title)}</div>`;
}
function card(g) {
  const mins = Math.round((g.stats?.perPlayer || 0) / 60000);
  return `<a class="card" href="/play/${esc(g.slug)}">${g.isNew ? '<span class="pill">New</span>' : ''}${g.multiplayer ? '<span class="pill alt">Multiplayer</span>' : ''}
${art(g)}<div class="body"><h3>${esc(g.title)}</h3><p>${esc(g.blurb)}</p><div class="meta">by ${esc(g.developer)}${mins ? ` · ${mins} min per player` : ''}</div></div></a>`;
}

function boardList(rows, label) {
  if (!rows.length) return `<p class="muted">No ${esc(label.toLowerCase())} yet this month. Be the first.</p>`;
  return `<ol class="board">${rows.map(r => `<li class="top${r.rank}"><span class="n">${r.rank}</span><span class="who"><a href="/u/${esc(r.player.id)}">${esc(r.player.name)}</a>${r.player.title ? `<small>${esc(r.player.title)}</small>` : ''}</span><span class="s">${r.score.toLocaleString('en-US')}</span></li>`).join('')}</ol>`;
}

/* ---------- pages ---------- */

async function home(DB, req, env) {
  const [me, games] = await Promise.all([viewer(DB, req), frontPage(DB)]);
  return html(homePage({ me, games, site: siteURL(env) }));
}

function frameFor(env, g, url) {
  if (g.kind === 'linked') return { src: g.url, origins: safeJSON(g.origins, []), sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock allow-modals' };
  if (!g.version) return null;
  // Hosted builds come from a separate games host so they can't touch portal cookies or storage.
  if (env.GAMES_HOST) {
    const origin = `https://${env.GAMES_HOST}`;
    return { src: `${origin}/${g.slug}/`, origins: [origin], sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock' };
  }
  // No games host yet (local or workers.dev): serve from here, sandboxed to an opaque origin.
  return { src: `${url.origin}/hosted/${g.slug}/`, origins: ['null'], sandbox: 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-pointer-lock' };
}


// The share sheet on /play pages. portal.js fills in the link and opens it, for the Share button
// and for rg.share() calls from the game.
function shareDialog(me) {
  return `<dialog class="signin share" id="shareDlg"><h3 style="margin-top:0">Share this game</h3><p class="muted" id="shareText"></p>
<div class="nets" id="shareNets"></div>
<div class="copy"><input id="shareUrl" readonly aria-label="Share link"><button class="btn small" id="shareCopy" type="button">Copy</button></div>
<p class="muted small">${me ? `Friends who sign up through your link and play for ${REFERRAL_PLAY_MS / 60000} minutes earn you ${GEMS.referrer} gems, and they get ${GEMS.friend}.` : 'Sign in first and your link earns you gems when friends join.'}</p>
<div style="display:flex;justify-content:flex-end"><button class="btn ghost small" id="shareClose" type="button">Done</button></div></dialog>`;
}

// The meta description for /play/<slug>: hand-written copy if there is some, otherwise the blurb,
// otherwise a plain sentence so the page never goes out without one.
function playDescription(g) {
  const seo = PLAY_PAGES[g.slug];
  if (seo && seo.description) return seo.description;
  const blurb = String(g.blurb || '').replace(/\s+/g, ' ').trim();
  const base = blurb || `${g.title} is a free web game by ${g.developer}.`;
  return /free/i.test(base) ? base : `${base} Play free in your browser on RookieGamers.`;
}

async function play(DB, req, env, url, slug) {
  const g = await getGame(DB, slug);
  const me = await viewer(DB, req);
  if (!g || !g.live) return notFound(me, 'That game isn\'t here (yet).');
  const frame = frameFor(env, g, url);
  if (!frame) return notFound(me, 'This game is still being uploaded.');
  const ref = /^[a-z0-9-]{1,32}$/.test(url.searchParams.get('ref') || '') ? url.searchParams.get('ref') : null;
  const src = new URL(frame.src);
  if (ref) src.searchParams.set('rg_ref', ref);
  // A multiplayer invite: the game reads the room with rg.invite.room().
  const room = /^[A-Za-z0-9_-]{1,40}$/.test(url.searchParams.get('room') || '') ? url.searchParams.get('room') : null;
  if (room) src.searchParams.set('rg_room', room);
  const [monthly, alltime, hall, others] = await Promise.all([topScores(DB, g, monthKey(), 10), topScores(DB, g, 'all', 10), fame(DB, { game: g.slug, limit: 9 }), frontPage(DB)]);
  const more = others.filter(o => o.slug !== g.slug).slice(0, 4);
  const v = gameView(g);
  const body = `<div class="play"><div><div class="stage"><iframe id="game" src="${esc(src.href)}" title="${esc(g.title)}" sandbox="${frame.sandbox}" allow="autoplay; fullscreen; gamepad; clipboard-write; screen-wake-lock" allowfullscreen></iframe></div>
<div class="stagebar"><div><h1>${esc(g.title)}</h1><span class="muted">by ${esc(g.developer)}</span></div><div class="acts"><button class="btn ghost small" id="soundBtn" type="button" aria-pressed="false" title="Mute or unmute the game">Sound on</button><button class="btn small" id="shareBtn" type="button">Share</button><button class="btn ghost small" id="fs" type="button">Full screen</button></div></div>
<p class="muted">${esc(g.blurb)}</p></div>
<aside class="side"><div class="panel"><h3><span>${esc(g.score_label)}</span><span class="tabs"><button type="button" data-b="m" aria-pressed="true">${esc(monthLabel(monthKey()))}</button><button type="button" data-b="a" aria-pressed="false">All time</button></span></h3>
<div id="bm">${boardList(monthly, g.score_label)}</div><div id="ba" hidden>${boardList(alltime, g.score_label)}</div></div>
<div class="panel"><h3>Hall of Fame</h3>${hall.length ? `<ol class="board">${hall.map(h => `<li class="top${h.rank}"><span class="n">${h.rank}</span><span class="who"><a href="/u/${esc(h.player.id)}">${esc(h.player.name)}</a><small>${esc(h.monthLabel)}</small></span><span class="s">${h.score.toLocaleString('en-US')}</span></li>`).join('')}</ol>` : '<p class="muted">At the end of each month the top 3 are kept here forever and earn a title shown across RookieGamers.</p>'}</div>
<div class="panel banner" id="rgBanner" hidden></div>
${more.length ? `<div class="panel"><h3>Play next</h3><div class="shelf" style="grid-template-columns:repeat(2,minmax(0,1fr))">${more.map(card).join('')}</div></div>` : ''}</aside></div>
<dialog class="signin" id="signinDlg"><h3 style="margin-top:0">Sign in to save your scores</h3><p class="muted">One RookieGamers account works in every game.</p>
<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="dlgGo" type="button">Sign in</button><button class="btn ghost" id="dlgNo" type="button">Keep playing as a guest</button></div></dialog>
${shareDialog(me)}`;
  const boot = { game: v.slug, title: v.title, origins: frame.origins, ref, signedIn: !!me };
  const desc = playDescription(g);
  return html(layout({ title: `Play ${g.title} free online`, desc, me, active: '/play/' + g.slug, body, url: siteURL(env) + '/play/' + g.slug,
    canonicalPath: '/play/' + g.slug, jsonld: playJSONLD(env, g, desc),
    og: { title: `Play ${g.title} free on RookieGamers`, image: gameImage(env, g), alt: `${g.title} on RookieGamers` },
    scripts: `<script>window.RG_PLAY=${data(boot)}</script><script src="/portal.js"></script>` }));
}

// /s/<id>: a shared link. Link previews read the tags; people are sent on to the game, and
// remembered as the sharer's referral for 30 days.
async function sharePage(DB, req, env, id) {
  const sh = await getShare(DB, id);
  const g = sh && await getGame(DB, sh.game);
  const me = await viewer(DB, req);
  if (!sh || !g || !g.live) return notFound(me, 'That link has expired.');
  const who = await getPlayer(DB, sh.player_id);
  const name = who ? who.name : 'A friend';
  const title = sh.score ? `${name} got ${sh.score.toLocaleString('en-US')} in ${g.title}. Can you beat it?` : `${name} invited you to play ${g.title}`;
  const to = `/play/${g.slug}${sh.room ? '?room=' + encodeURIComponent(sh.room) : ''}`;
  const ua = req.headers.get('user-agent') || '';
  const cookies = [];
  if (!isBot(ua) && (!me || me.id !== sh.player_id)) {
    await countShareClick(DB, sh);
    if (!me) cookies.push(setCookie(req, VIA_COOKIE, sh.player_id, VIA_DAYS * 86400), setCookie(req, SHARE_COOKIE, sh.id, VIA_DAYS * 86400));
  }
  const body = `<section class="hero"><h1>${esc(title)}</h1><p class="lede">${esc(sh.text || g.blurb)}</p><a class="btn" href="${esc(to)}">Play ${esc(g.title)}</a></section>`;
  const res = html(layout({ title, desc: g.blurb, me, body, url: siteURL(env) + '/s/' + sh.id, og: { title, desc: sh.text || g.blurb, image: gameImage(env, g) }, robots: 'noindex,follow',
    scripts: `<script>location.replace(${data(to)})</script>` }));
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}

async function hallOfFame(DB, req, env) {
  await sealIfDue(DB);
  const [me, rows] = await Promise.all([viewer(DB, req), fame(DB, { limit: 600 })]);
  const months = {};
  for (const r of rows) ((months[r.month] ||= {})[r.game] ||= { title: r.gameTitle, rows: [] }).rows.push(r);
  const body = `<h1>Hall of Fame</h1><p class="lede">Every month, the top 3 players in every game are kept here forever. Champions wear their title in every game on RookieGamers.</p>
${Object.keys(months).length ? Object.entries(months).map(([m, games]) => `<section class="fame-month"><h2>${esc(monthLabel(m))}</h2><div class="fame-grid">${Object.entries(games).map(([slug, g]) => `<div class="panel"><h3><a href="/play/${esc(slug)}">${esc(g.title)}</a></h3>${boardList(g.rows, 'champions')}</div>`).join('')}</div></section>`).join('')
    : `<div class="empty">The first champions are crowned on ${esc(monthLabel(monthKey()))}'s last day. Go set a score.</div>`}`;
  return html(layout({ title: 'Hall of Fame', desc: 'Every month the top 3 players in every RookieGamers game are kept in the Hall of Fame forever, and wear a champion title across the portal.', me, active: '/hall-of-fame', body, url: siteURL(env) + '/hall-of-fame', canonicalPath: '/hall-of-fame', jsonld: HALL_OF_FAME_JSONLD }));
}

const NET_NAMES = { scenespot: 'SceneSpot', google: 'Google', discord: 'Discord', x: 'X', twitch: 'Twitch', github: 'GitHub' };
const REASONS = { link: r => `Linked ${NET_NAMES[r.ref] || r.ref}`, referral: () => 'A friend you invited played', welcome: () => 'Joined through a friend' };

// Gems, the invite link, referrals and linked networks, on your own profile.
async function myGrowth(DB, env, p) {
  const prov = providers(env).social;
  const [refs, history, linked] = await Promise.all([referralStats(DB, p.id), gemHistory(DB, p.id, 10),
    DB.prepare('SELECT provider FROM identities WHERE player_id = ?').bind(p.id).all()]);
  const have = new Set(linked.results.map(r => r.provider));
  const invite = `${siteURL(env)}/?via=${p.id}`;
  return `<h2>Gems ${gemCount(p.gems)}</h2>
<p class="lede">Earn gems by bringing friends and linking your accounts. Gems unlock rewards across RookieGamers.</p>
<div class="fame-grid"><div class="panel"><h3>Invite friends</h3><p class="muted">When a friend signs up through your link and plays for ${REFERRAL_PLAY_MS / 60000} minutes, you get ${GEMS.referrer} gems and they get ${GEMS.friend}.</p>
<div class="copy"><input id="inviteUrl" readonly value="${esc(invite)}" aria-label="Your invite link"><button class="btn small" id="inviteCopy" type="button">Copy</button><button class="btn ghost small" id="inviteShare" type="button" hidden>Share</button></div>
<p class="muted small">${refs.joined} joined · ${refs.played} played and paid out</p></div>
<div class="panel"><h3>Linked accounts</h3>${prov.length ? `<ul class="links">${prov.map(x => `<li${x.id === 'scenespot' ? ' class="featured"' : ''}><span>${esc(x.name)}${x.id === 'scenespot' ? ' <span class="x2">2× gems</span>' : ''}</span>${have.has(x.id) ? '<span class="ok">Linked</span>' : `<a class="btn small${x.id === 'scenespot' ? ' gold' : ''}" href="/auth/${esc(x.route)}?next=/u/${esc(p.id)}">Link, +${linkGems(x.id)} ${GEM}</a>`}</li>`).join('')}</ul>` : '<p class="muted">Linking social accounts opens soon.</p>'}</div>
${history.length ? `<div class="panel"><h3>Recent gems</h3><ul class="links">${history.map(h => `<li><span>${esc((REASONS[h.reason] || (() => h.reason))(h))}<br><span class="muted small">${new Date(h.at).toISOString().slice(0, 10)}</span></span><span class="gems">+${h.amount}</span></li>`).join('')}</ul></div>` : ''}</div>`;
}

// The trophy case: Hall of Fame finishes, then milestones. Your own profile also shows the locked ones.
function trophyCase(hall, g, mine) {
  const got = MILESTONES.filter(m => m.got(g)), locked = mine ? MILESTONES.filter(m => !m.got(g)) : [];
  if (!hall.length && !got.length && !locked.length) return '<p class="muted">No trophies yet.</p>';
  return `<div class="trophies">${hall.map(h => `<div class="trophy ${MEDAL(h.rank)}">${CUP}<b>${RANK(h.rank)} · ${esc(h.title)}</b><span class="muted small">Hall of Fame, ${esc(monthLabel(h.month))}</span></div>`).join('')}
${got.map(m => `<div class="trophy earned">${CUP}<b>${esc(m.name)}</b><span class="muted small">${esc(m.how)}</span></div>`).join('')}
${locked.map(m => `<div class="trophy locked">${CUP}<b>${esc(m.name)}</b><span class="muted small">${esc(m.how)}</span></div>`).join('')}</div>`;
}

// Your inventory on your own profile: the icons and frames you own (wear one with a tap) and your trophies.
async function inventoryHTML(DB, p, pub, trophies) {
  const [icons, frames] = await Promise.all([ownedIcons(DB, p.id), ownedFrames(DB, p.id)]);
  const pickable = canPick(p, icons);
  const letter = avatarFor({ ...p, icon: null });
  const iconCards = [
    `<div class="icon-card${!p.icon ? ' owned' : ''}"><img src="${esc(letter)}" alt="" width="96" height="96"><b>Your letter</b>${!p.icon ? '<span class="tag">Wearing</span>' : '<button class="btn small" data-equip="">Wear</button>'}</div>`,
    ...SHOWN.filter(i => icons[i.id] || (i.pick && pickable[i.pick])).map(i => `<div class="icon-card${icons[i.id] ? ' owned' : ''}"><img src="${esc(iconURI(i))}" alt="" width="96" height="96" loading="lazy"><b>${esc(i.name)}</b>${
      !icons[i.id] ? `<button class="btn small" data-pick="${esc(i.id)}">Pick this one</button>` : p.icon === i.id ? '<span class="tag">Wearing</span>' : `<button class="btn small" data-equip="${esc(i.id)}">Wear</button>`}</div>`),
  ];
  const sample = f => `<span class="av big fr-${esc(f)}"><img src="${esc(pub.avatar)}" alt=""></span>`;
  const frameCards = [
    `<div class="icon-card${!p.frame ? ' owned' : ''}"><span class="av big"><img src="${esc(pub.avatar)}" alt=""></span><b>No frame</b>${!p.frame ? '<span class="tag">Wearing</span>' : '<button class="btn small" data-frame="">Wear</button>'}</div>`,
    ...FRAMES.map(f => `<div class="icon-card${frames[f.id] ? ' owned' : ' locked'}">${sample(f.id)}<b>${esc(f.name)}</b>${
      frames[f.id] ? (p.frame === f.id ? '<span class="tag">Wearing</span>' : `<button class="btn small" data-frame="${esc(f.id)}">Wear</button>`)
      : f.price ? `<a class="btn ghost small" href="/shop#frames">${GEM}${f.price.toLocaleString('en-US')}</a>` : `<span class="muted small">${esc(FRAME_EARN[f.earn])}</span>`}</div>`),
  ];
  const nIcons = Object.keys(icons).length, nFrames = Object.keys(frames).length;
  return `<section id="inventory" class="inv"><h2>Inventory</h2>
<div class="tabs" role="tablist"><button type="button" role="tab" data-tab="icons" aria-selected="true">Icons <span>${nIcons + 1}</span></button><button type="button" role="tab" data-tab="frames" aria-selected="false">Frames <span>${nFrames}</span></button><button type="button" role="tab" data-tab="trophies" aria-selected="false">Trophies</button></div>
<div class="pane" data-pane="icons"><div class="icon-grid">${iconCards.join('')}</div><p class="muted">Earn more icons by playing, or spend gems in the <a href="/shop">Diamond Shop</a>.</p></div>
<div class="pane" data-pane="frames" hidden><div class="icon-grid">${frameCards.join('')}</div><p class="muted">A frame goes around your icon everywhere it shows.</p></div>
<div class="pane" data-pane="trophies" hidden>${trophies}</div>
<div id="invMsg"></div></section>`;
}

const INVENTORY_JS = `
const tabs=document.querySelectorAll('.inv [data-tab]');tabs.forEach(t=>t.onclick=()=>{tabs.forEach(x=>x.setAttribute('aria-selected',x===t));document.querySelectorAll('.inv [data-pane]').forEach(p=>p.hidden=p.dataset.pane!==t.dataset.tab);try{localStorage.setItem('rg_inv',t.dataset.tab)}catch(e){}});
try{const s=localStorage.getItem('rg_inv');const t=s&&document.querySelector('.inv [data-tab="'+s+'"]');if(t)t.click()}catch(e){}
document.addEventListener('click',async e=>{const b=e.target.closest('.inv [data-equip],.inv [data-frame],.inv [data-pick]');if(!b)return;
if(b.dataset.pick!==undefined&&!confirm('Pick this Rookie Gamer? You only get to pick one.'))return;b.disabled=true;
const body=b.dataset.frame!==undefined?{frame:b.dataset.frame}:{icon:b.dataset.equip!==undefined?b.dataset.equip:b.dataset.pick};
const r=await fetch(b.dataset.pick!==undefined?'/api/shop/pick':'/api/shop/equip',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
if(r.ok){location.reload();return}b.disabled=false;const j=await r.json().catch(()=>({}));const m=document.getElementById('invMsg');m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=j.error||'That didn\\'t work.'});`;

// Friends on your own profile: requests waiting on you, then your friends list.
function friendsHTML(friends, requests) {
  const who = f => `<a class="who" href="/u/${esc(f.id)}">${avatar(f)}<span>${esc(f.name)}<small class="muted">Lv ${f.level}</small></span></a>`;
  return `<section id="friends" class="friends"><h2>Friends <span class="muted">${friends.length}</span></h2>
${requests.length ? `<div class="panel"><h3>Friend requests</h3><ul class="flist">${requests.map(f => `<li>${who(f)}<span><button class="btn small" data-friend="${esc(f.id)}" data-act="accept">Accept</button> <button class="btn ghost small" data-friend="${esc(f.id)}" data-act="remove">Decline</button></span></li>`).join('')}</ul></div>` : ''}
${friends.length ? `<ul class="flist">${friends.map(f => `<li>${who(f)}<button class="btn ghost small" data-friend="${esc(f.id)}" data-act="remove" data-confirm="Remove ${esc(f.name)} from your friends?">Remove</button></li>`).join('')}</ul>` : '<p class="muted">No friends yet. Send your invite link below: anyone who joins through it becomes your friend straight away. You can also add players from their profile.</p>'}
<div id="friendMsg"></div></section>`;
}

// The button on someone else's profile.
function friendButton(id, state) {
  if (state === 'friends') return `<button class="btn ghost small" data-friend="${esc(id)}" data-act="remove" data-confirm="Remove this friend?">Friends ✓</button>`;
  if (state === 'sent') return `<button class="btn ghost small" data-friend="${esc(id)}" data-act="remove">Requested · Cancel</button>`;
  if (state === 'received') return `<button class="btn small" data-friend="${esc(id)}" data-act="accept">Accept friend request</button>`;
  return `<button class="btn small" data-friend="${esc(id)}" data-act="add">Add friend</button>`;
}

const FRIENDS_JS = `document.addEventListener('click',async e=>{const b=e.target.closest('[data-friend]');if(!b)return;if(b.dataset.confirm&&!confirm(b.dataset.confirm))return;b.disabled=true;
const r=await fetch('/api/friends',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({player:b.dataset.friend,action:b.dataset.act})});
if(r.ok){location.reload();return}b.disabled=false;const j=await r.json().catch(()=>({}));const m=document.getElementById('friendMsg');if(m){m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=j.error||'That didn\\'t work.'}});`;

async function profilePage(DB, req, env, id) {
  const me = await viewer(DB, req);
  const p = await getPlayer(DB, id);
  if (!p) return notFound(me, 'No player here.');
  const pub = publicPlayer(p);
  const lv = pub.level, floor = 50 * lv * (lv - 1), next = 50 * (lv + 1) * lv;
  const [games, titles] = await Promise.all([
    DB.prepare(`SELECT g.slug, g.title, g.score_label, g.score_order, SUM(pl.ms) AS ms, MAX(pl.started_at) AS last,
      (SELECT score FROM scores s WHERE s.game = g.slug AND s.month = 'all' AND s.player_id = ?) AS best,
      (SELECT xp FROM game_xp x WHERE x.game = g.slug AND x.player_id = ?) AS gxp
      FROM plays pl JOIN games g ON g.slug = pl.game WHERE pl.player_id = ? GROUP BY g.slug ORDER BY last DESC`).bind(id, id, id).all(),
    DB.prepare('SELECT title FROM titles WHERE player_id = ? ORDER BY at DESC').bind(id).all(),
  ]);
  const mine = me && me.id === id;
  const growth = mine ? await myGrowth(DB, env, p) : '';
  const g = await progress(DB, p);
  if (mine) { await claimEarned(DB, p); await claimFrames(DB, p, g); }
  const hall = await hallTrophies(DB, id);
  const trophies = trophyCase(hall, g, mine);
  const inventory = mine ? await inventoryHTML(DB, p, pub, trophies) : '';
  const friends = mine ? friendsHTML(await listFriends(DB, id), await incomingRequests(DB, id)) : '';
  const fbtn = me && !mine ? friendButton(id, await friendState(DB, me.id, id)) : '';
  const anyLevel = games.results.some(r => r.gxp);
  const body = `<div class="prof">${mine ? `<a href="#inventory" title="Change your icon and frame">${avatar(pub)}</a>` : avatar(pub)}<div><h1 style="margin:0">${esc(pub.name)}</h1>${pub.title ? `<div style="color:var(--violet);font-weight:600">${esc(pub.title)}</div>` : ''}
<div class="muted">Level ${lv} · ${pub.xp.toLocaleString('en-US')} XP</div><div class="xp" style="margin-top:6px"><i style="width:${Math.min(100, Math.round((pub.xp - floor) / Math.max(1, next - floor) * 100))}%"></i></div>${fbtn ? `<div style="margin-top:10px">${fbtn}</div><div id="friendMsg"></div>` : ''}</div></div>
${inventory}
${friends}
${mine ? `<h2>Your profile</h2><form class="form" id="profForm"><input name="name" maxlength="18" value="${esc(pub.name)}" aria-label="Display name">
${titles.results.length ? `<select name="title" style="padding:10px;border-radius:12px;background:var(--panel2);color:var(--text);border:1px solid var(--line)"><option value="">No title</option>${titles.results.map(t => `<option${t.title === pub.title ? ' selected' : ''}>${esc(t.title)}</option>`).join('')}</select>` : ''}
<div style="display:flex;gap:8px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" id="signOut">Sign out</button></div><div id="profMsg"></div></form>${growth}
<details class="danger" style="margin-top:28px"><summary class="muted">Delete my account</summary><p class="muted">This removes your profile, linked sign-ins, scores, gems and play history for good. See <a href="/data-deletion">data deletion</a>.</p>
<form class="form" id="delForm"><input name="confirm" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autocomplete="off"><button class="btn ghost" type="submit">Delete my account</button><div id="delMsg"></div></form></details>` : ''}
<h2>Games played</h2>${games.results.length ? `<table class="t"><tr><th>Game</th>${anyLevel ? '<th>Level</th>' : ''}<th>Best</th><th>Played</th></tr>${games.results.map(r => `<tr><td><a href="/play/${esc(r.slug)}">${esc(r.title)}</a></td>${anyLevel ? `<td>${r.gxp ? gameLevel(r.gxp).level : '<span class="muted">-</span>'}</td>` : ''}<td>${r.best == null ? '<span class="muted">-</span>' : `${r.best.toLocaleString('en-US')} <span class="muted">${esc(r.score_label.toLowerCase())}</span>`}</td><td>${Math.max(1, Math.round(r.ms / 60000))} min</td></tr>`).join('')}</table>` : '<p class="muted">No games yet.</p>'}
${mine ? '' : `<h2>Trophies</h2>${trophies}`}
${titles.results.length ? `<h2>Titles</h2><ul>${titles.results.map(t => `<li>${esc(t.title)}</li>`).join('')}</ul>` : ''}`;
  const script = mine ? `<script>${INVENTORY_JS}${FRIENDS_JS}
document.getElementById('profForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/me',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:f.get('name'),title:f.has('title')?f.get('title'):undefined})});document.getElementById('profMsg').innerHTML=r.ok?'<div class="note ok">Saved.</div>':'<div class="note err">Couldn\\'t save.</div>';if(r.ok)setTimeout(()=>location.reload(),500)};
document.getElementById('delForm').onsubmit=async e=>{e.preventDefault();const c=new FormData(e.target).get('confirm');const r=await fetch('/api/me/delete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirm:c})});const j=await r.json().catch(()=>({}));if(r.ok){location.href='/data-deletion?done=1';return}document.getElementById('delMsg').innerHTML='<div class="note err"></div>';document.getElementById('delMsg').firstChild.textContent=j.error||'Could not delete.'};
document.getElementById('signOut').onclick=async()=>{await fetch('/api/auth/signout',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});location.href='/'};
const ic=document.getElementById('inviteCopy');if(ic)ic.onclick=async()=>{const i=document.getElementById('inviteUrl');i.select();try{await navigator.clipboard.writeText(i.value)}catch(e){document.execCommand('copy')}ic.textContent='Copied'};
const is=document.getElementById('inviteShare');if(is&&navigator.share)is.hidden=false;if(is)is.onclick=()=>navigator.share({title:'RookieGamers',text:'Play free games with me on RookieGamers.',url:document.getElementById('inviteUrl').value}).catch(()=>{});
</script>` : fbtn ? `<script>${FRIENDS_JS}</script>` : '';
  return html(layout({ title: pub.name, desc: `${pub.name} on RookieGamers: level ${pub.level}${pub.title ? `, ${pub.title}` : ''}. Trophies, Hall of Fame finishes and games played.`, me, body, scripts: script, url: siteURL(env) + '/u/' + pub.id, canonicalPath: '/u/' + pub.id, og: { type: 'profile' } }));
}

function signinPage(env, me, url) {
  const p = providers(env);
  const next = safeNext(url.searchParams.get('next'));
  const popup = url.searchParams.get('popup') === '1';
  const msg = url.searchParams.has('expired') ? '<div class="note err">That link expired or was already used. Send a new one.</div>'
    : url.searchParams.has('age') ? '<div class="note err">Tick "I\'m 13 or older" first, then pick how to sign in.</div>'
    : url.searchParams.has('failed') ? '<div class="note err">Sign-in didn\'t go through. Try again.</div>' : '';
  const after = popup ? '/auth/done' : next;
  const featured = p.social.find(x => x.id === 'scenespot'), others = p.social.filter(x => x !== featured);
  const body = `<h1>Sign in</h1><p class="lede">One account for every game on RookieGamers: your level, scores, titles and gems follow you everywhere.</p>${msg}
${me ? `<div class="note ok">You're signed in as ${esc(me.name)}. <a href="${esc(next)}">Continue</a></div>` : ''}
<p class="muted">By signing in you agree to the <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.</p>
<div class="form"><label class="check"><input type="checkbox" id="age"> I'm 13 or older.</label>
${featured ? `<div class="scenespot"><span class="x2">Double gems</span><a class="btn gold social" data-net="${esc(featured.id)}" href="/auth/${esc(featured.route)}?next=${encodeURIComponent(after)}">Continue with ${esc(featured.name)}</a><p class="small">Sign in with ${esc(featured.name)} and get <b>${GEMS.scenespot} gems</b>, double any other network.</p></div>${others.length || p.email ? '<div class="muted" style="text-align:center">or</div>' : ''}` : ''}
${others.length ? `<div class="socials">${others.map(x => `<a class="btn ghost social" data-net="${esc(x.id)}" href="/auth/${esc(x.route)}?next=${encodeURIComponent(after)}">Continue with ${esc(x.name)}</a>`).join('')}</div>${p.email ? '<div class="muted" style="text-align:center">or</div>' : ''}` : ''}
${p.email ? `<form class="form" id="emailForm"><input type="email" name="email" required placeholder="you@example.com" autocomplete="email" aria-label="Email">
<button class="btn" type="submit">Email me a sign-in link</button><div id="emailMsg"></div></form>` : (p.social.length ? '' : '<div class="note">Sign-in isn\'t switched on yet.</div>')}
<p class="muted small">Every social account you sign in with or link earns you ${GEMS.link} gems, once${featured ? ` (${GEMS.scenespot} for ${esc(featured.name)})` : ''}.</p></div>`;
  const script = `<script>
const age=document.getElementById('age');
document.querySelectorAll('a.social').forEach(a=>a.onclick=e=>{if(age.checked){a.href+=(a.href.includes('?')?'&':'?')+'age=1'}});
const f=document.getElementById('emailForm');if(f)f.onsubmit=async e=>{e.preventDefault();const d=new FormData(f);const b=f.querySelector('button');b.disabled=true;
const r=await fetch('/api/auth/email',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:d.get('email'),age:age.checked,next:${data(after)}})});const j=await r.json().catch(()=>({}));b.disabled=false;
document.getElementById('emailMsg').innerHTML=r.ok?'<div class="note ok">Check your inbox for a sign-in link. '+(j.devLink?'<a href="'+j.devLink+'" id="devLink">Dev sign-in link</a>':'')+'</div>':'<div class="note err"></div>';if(!r.ok)document.querySelector('#emailMsg .err').textContent=j.error||'Something went wrong.'};
</script>`;
  return html(layout({ title: 'Sign in', me, body, scripts: script, robots: 'noindex,follow' }));
}

// After a sign-in that started in a popup, tell the page that opened it, then close.
function authDone() {
  return html(`<!doctype html><meta charset="utf-8"><title>Signed in</title><body style="background:#0f0d16;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh">
<p>You're signed in. You can close this window.</p><script>try{if(window.opener)window.opener.postMessage({rg:1,type:'signed-in'},location.origin)}catch(e){}setTimeout(()=>window.close(),300)</script>`);
}

// The sign-in popup a game on its own site opens. It hands a token only to an origin that game lists.
async function connect(DB, req, env, url) {
  const me = await viewer(DB, req);
  const g = await getGame(DB, String(url.searchParams.get('game') || ''));
  const origin = String(url.searchParams.get('origin') || '');
  const back = url.searchParams.get('return');
  const origins = g ? safeJSON(g.origins, []) : [];
  const devOrigin = env.DEV_LOGIN === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!g || !(origins.includes(origin) || devOrigin)) return html(layout({ me, title: 'Sign in', body: '<h1>Can\'t sign in here</h1><p class="lede">This game isn\'t set up for RookieGamers sign-in from that site.</p>' }), 400);
  if (!me) return Response.redirect(`${url.origin}/signin?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  if (url.searchParams.get('ok') !== '1') {
    const body = `<h1>Play ${esc(g.title)} as ${esc(me.name)}?</h1><p class="lede">${esc(g.title)} will see your RookieGamers name, level and title, and can save your scores. It never sees your email or password.</p>
<div style="display:flex;gap:8px"><a class="btn" href="${esc(url.pathname + url.search)}&ok=1">Continue</a><button class="btn ghost" type="button" onclick="window.close()">Cancel</button></div>`;
    return html(layout({ me, title: 'Sign in', body }));
  }
  const auth = await mintFor(DB, env, me.id, g.slug);
  const payload = { ...auth, game: g.slug };
  if (back) {
    let b; try { b = new URL(back); } catch { b = null; }
    if (b && b.origin === origin) {
      const frag = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
      return Response.redirect(`${b.origin}${b.pathname}${b.search}#rg_connect=${frag}`, 302);
    }
  }
  return html(`<!doctype html><meta charset="utf-8"><title>Signed in</title><body style="background:#0f0d16;color:#fff;font:16px system-ui;display:grid;place-items:center;height:100vh"><p>Signed in. Back to ${esc(g.title)}...</p>
<script>window.opener&&window.opener.postMessage({rg:1,type:'connect',data:${data(payload)}},${data(origin)});setTimeout(()=>window.close(),300)</script>`);
}

async function devPage(DB, req, env, url) {
  const me = await viewer(DB, req);
  const site = siteURL(env);
  const invite = url.searchParams.get('invite') || '';
  const agents = `<h2>Publish from your AI</h2><p class="lede">Your agent reads the SDK docs, writes the game, tests it, and publishes it, all through one MCP server: <code>${esc(site)}/mcp</code>. Set <code>ROOKIEGAMERS_API_KEY</code> to a key from this page first.</p>
<div class="agents"><div class="panel"><h3>Claude Code</h3><pre><code>/plugin marketplace add ecoay/rookiegamers
/plugin install rookiegamers@rookiegamers</code></pre><p class="muted">Or just the MCP server:</p><pre><code>claude mcp add --transport http rookiegamers ${esc(site)}/mcp \\
  --header "Authorization: Bearer $ROOKIEGAMERS_API_KEY"</code></pre></div>
<div class="panel"><h3>Codex</h3><p class="muted">In <code>~/.codex/config.toml</code>:</p><pre><code>[mcp_servers.rookiegamers]
url = "${esc(site)}/mcp"
bearer_token_env_var = "ROOKIEGAMERS_API_KEY"</code></pre></div>
<div class="panel"><h3>xAI API (Grok)</h3><p class="muted">Add a remote MCP tool to an xAI API call:</p><pre><code>{ "type": "mcp",
  "server_url": "${esc(site)}/mcp",
  "server_label": "rookiegamers",
  "authorization": "Bearer rgk_..." }</code></pre></div>
<div class="panel"><h3>CLI</h3><pre><code>curl -O ${esc(site)}/rg.mjs
node rg.mjs init my-game
node rg.mjs deploy ./my-game --game my-game</code></pre></div></div>`;
  if (!me) return html(layout({ title: 'Publish', desc: 'Publish your web game on RookieGamers: get a developer key, add the SDK, and ship with the MCP server, Claude Code, Codex, the xAI API or the command-line tool.', me, active: '/dev', body: `<h1>Publish your game on RookieGamers</h1><p class="lede">Every game on RookieGamers shares one player base. Your players find other games, and their players find yours. AI-built games are welcome.</p><a class="btn" href="/signin?next=${encodeURIComponent('/dev' + (invite ? '?invite=' + invite : ''))}">Sign in to start</a>${agents}`, canonicalPath: '/dev', jsonld: DEV_JSONLD }));
  const isDev = await isDeveloper(DB, me.id);
  if (!isDev) {
    const open = env.OPEN_DEVELOPERS === '1';
    const body = `<h1>Become a developer</h1><p class="lede">${open ? 'Publishing is open. One click and you can make API keys and publish games.' : 'Publishing is invite-only while we start. Paste your invite code, or open the invite link you were sent.'}</p>
<form class="form" id="joinForm">${open ? '' : `<input name="invite" value="${esc(invite)}" placeholder="inv_..." aria-label="Invite code" required>`}<button class="btn" type="submit">Become a developer</button><div id="joinMsg"></div></form>${agents}`;
    return html(layout({ title: 'Publish', desc: 'Publish your web game on RookieGamers: get a developer key, add the SDK, and ship with the MCP server, Claude Code, Codex, the xAI API or the command-line tool.', me, active: '/dev', body, canonicalPath: '/dev', jsonld: DEV_JSONLD, scripts: `<script>document.getElementById('joinForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/dev/join',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invite:f.get('invite')})});const j=await r.json();if(r.ok)location.href='/dev';else{const m=document.getElementById('joinMsg');m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=j.error}}</script>` }));
  }
  const [games, keys] = await Promise.all([myGames(DB, me.id), listKeys(DB, me.id)]);
  const cash = await devMoneySection(DB, env, me.id, games);
  const body = `<h1>Developer</h1><p class="lede">Make an API key, connect your AI or the CLI, and publish. Games go live as soon as they pass the checks.</p>
<h2>Your games</h2>${games.length ? `<table class="t"><tr><th>Game</th><th>Kind</th><th>Status</th><th>Version</th></tr>${games.map(g => `<tr><td>${g.live ? `<a href="/play/${esc(g.slug)}">${esc(g.title)}</a>` : esc(g.title)}</td><td>${esc(g.kind)}</td><td>${g.live ? 'Live' : 'Not published'}</td><td>${esc(g.version || '-')}</td></tr>`).join('')}</table>` : '<p class="muted">No games yet. Create one with your agent, the CLI, or the API.</p>'}
<h2>API keys</h2><form class="form" id="keyForm" style="flex-direction:row;max-width:520px"><input name="label" placeholder="Key name, like laptop or claude" aria-label="Key name"><button class="btn" type="submit">Make key</button></form><div id="keyMsg" style="margin:10px 0"></div>
${keys.length ? `<table class="t"><tr><th>Name</th><th>Key</th><th>Last used</th><th></th></tr>${keys.map(k => `<tr><td>${esc(k.label)}</td><td><code>${esc(k.prefix)}...</code></td><td>${k.used_at ? new Date(k.used_at).toISOString().slice(0, 10) : 'never'}</td><td><button class="btn ghost small" data-del="${esc(k.prefix)}" type="button">Delete</button></td></tr>`).join('')}</table>` : ''}
${cash.body}
${agents}<h2>Docs</h2><p><a href="/docs">The SDK and developer API reference</a>.</p>`;
  const script = cash.script + `<script>
document.getElementById('keyForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const r=await fetch('/api/dev/keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({label:f.get('label')})});const j=await r.json();const m=document.getElementById('keyMsg');
m.innerHTML=r.ok?'<div class="note ok">Your new key (shown once, keep it secret): <code id="newKey"></code></div>':'<div class="note err"></div>';if(r.ok)document.getElementById('newKey').textContent=j.key;else m.firstChild.textContent=j.error};
document.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await fetch('/api/dev/keys',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({prefix:b.dataset.del})});location.reload()});
</script>`;
  return html(layout({ title: 'Developer', desc: 'Publish your web game on RookieGamers: get a developer key, add the SDK, and ship with the MCP server, Claude Code, Codex, the xAI API or the command-line tool.', me, active: '/dev', body, canonicalPath: '/dev', jsonld: DEV_JSONLD, scripts: script }));
}

// Just enough Markdown for docs/SDK.md: headings, paragraphs, lists, tables, code.
export function markdown(md) {
  const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const out = [], lines = md.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('```')) { const code = []; while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]); out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { const n = h[1].length; out.push(`<h${n} id="${slug(h[2])}">${inline(h[2])}</h${n}>`); continue; }
    if (l.startsWith('|')) {
      const rows = []; while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]); i--;
      const cells = r => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
      out.push(`<table><tr>${cells(rows[0]).map(c => `<th>${inline(c)}</th>`).join('')}</tr>${rows.slice(2).map(r => `<tr>${cells(r).map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</table>`);
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d/.test(l), items = [];
      while (i < lines.length && /^(- |\d+\. )/.test(lines[i])) items.push(lines[i++].replace(/^(- |\d+\. )/, '')); i--;
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map(t => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (l.trim()) { const para = [l]; while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|\||- |\d+\. )/.test(lines[i + 1])) para.push(lines[++i]); out.push(`<p>${inline(para.join(' '))}</p>`); }
  }
  return out.join('\n');
}

async function docs(DB, req, env) {
  const me = await viewer(DB, req);
  const md = SDK_DOCS.replaceAll('https://rookiegamers.com', siteURL(env));
  return html(layout({ title: 'SDK docs', desc: 'RookieGamers SDK v1 reference: one script tag adds sign-in, leaderboards, the Hall of Fame, cloud saves and play-next cards to a web game.', me, active: '/docs', body: `<article class="doc">${markdown(md)}</article>`, url: siteURL(env) + '/docs', canonicalPath: '/docs', jsonld: DOCS_JSONLD }));
}

// The Diamond Shop: spend gems on platform icons. Icons are bought here or earned; social media
// pictures are never used as platform icons.
async function shopPage(DB, req, env) {
  const me = await viewer(DB, req);
  let owned = {}, equipped = null, pickable = {}, frames = {}, frameOn = null;
  if (me) {
    const p = await getPlayer(DB, me.id);
    await claimEarned(DB, p);
    await claimFrames(DB, p);
    frames = await ownedFrames(DB, me.id);
    frameOn = p.frame || null;
    owned = await ownedIcons(DB, me.id);
    equipped = p.icon || null;
    pickable = canPick(p, owned);
  }
  const card = i => {
    const has = !!owned[i.id], on = equipped === i.id;
    const action = !me ? (i.earn ? `<span class="muted small">${esc(EARN[i.earn])}</span>` : `<a class="btn small" href="/signin?next=%2Fshop">${GEM}${i.price.toLocaleString('en-US')}</a>`)
      : has ? (on ? '<span class="tag">Wearing</span>' : `<button class="btn small" data-equip="${esc(i.id)}">Wear</button>`)
      : i.pick && pickable[i.pick] ? `<button class="btn small" data-pick="${esc(i.id)}">Pick this one</button>`
      : i.price ? `<button class="btn small" data-buy="${esc(i.id)}"${me.gems < i.price ? ' disabled' : ''}>${GEM}${i.price.toLocaleString('en-US')}</button>`
      : `<span class="muted small">${esc(EARN[i.earn])}</span>`;
    return `<div class="icon-card${has ? ' owned' : ''}"><img src="${esc(iconURI(i))}" alt="" width="112" height="112" loading="lazy"><b>${esc(i.name)}</b>${i.earn ? '<span class="muted small">Earned</span>' : ''}${action}</div>`;
  };
  const shop = SHOWN.filter(i => i.price), earned = SHOWN.filter(i => i.earn);
  const preview = me ? me.avatar : iconURI('rookie');
  const frameCard = f => {
    const has = !!frames[f.id];
    const action = has ? (frameOn === f.id ? '<span class="tag">Wearing</span>' : `<button class="btn small" data-wear-frame="${esc(f.id)}">Wear</button>`)
      : f.earn ? `<span class="muted small">${esc(FRAME_EARN[f.earn])}</span>`
      : !me ? `<a class="btn small" href="/signin?next=%2Fshop">${GEM}${f.price.toLocaleString('en-US')}</a>`
      : `<button class="btn small" data-buy-frame="${esc(f.id)}"${me.gems < f.price ? ' disabled' : ''}>${GEM}${f.price.toLocaleString('en-US')}</button>`;
    return `<div class="icon-card${has ? ' owned' : ''}"><span class="av big fr-${esc(f.id)}"><img src="${esc(preview)}" alt=""></span><b>${esc(f.name)}</b>${f.earn ? '<span class="muted small">Earned</span>' : ''}${action}</div>`;
  };
  const body = `<style>.icon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin:12px 0 28px}.icon-card{display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 10px;border:1px solid var(--line);border-radius:16px;background:var(--panel);text-align:center}.icon-card.owned{border-color:var(--violet)}.icon-card img{object-fit:contain;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35))}.icon-card .tag{font-size:13px;font-weight:600;color:var(--violet)}.icon-card button[disabled]{opacity:.45;cursor:not-allowed}.icon-card .gem{width:14px;height:14px;vertical-align:-2px;margin-right:4px}</style>
<h1>Diamond Shop</h1><p class="lede">Spend the gems you earn on icons that show next to your name across RookieGamers.${me ? ` You have ${gemCount(me.gems)}.` : ''}</p>
<p class="muted">Earn gems by playing any game (${PLAY_GEMS.amount} gems for every ${PLAY_GEMS.every / 60000} minutes, up to ${PLAY_GEMS.amount * PLAY_GEMS.perDay} a day), linking a social network (${GEMS.link} each, ${GEMS.scenespot} for SceneSpot) and inviting friends (${GEMS.referrer}). Gems have no cash value.</p>
<div id="shopMsg"></div>
<h2>Icons for gems</h2><div class="icon-grid">${shop.map(card).join('')}</div>
<h2>Earned icons</h2><p class="muted">Everyone starts with their letter. These can't be bought: hit the milestone and they're yours. At level 5 you pick one Rookie Gamer, and that pick is for keeps.</p><div class="icon-grid">${earned.map(card).join('')}</div>
<h2 id="frames">Frames</h2><p class="muted">A frame goes around your icon everywhere it shows. Wear one from here or from your <a href="${me ? `/u/${esc(me.id)}#inventory` : '/signin?next=%2Fshop'}">inventory</a>.</p><div class="icon-grid">${FRAMES.map(frameCard).join('')}</div>
<h2>Minted icons</h2><p class="muted">Minted icons arrive with wallets, for players 18 and up. They're not live yet.</p>
${me && equipped ? '<p><button class="btn ghost small" data-equip="">Go back to my letter icon</button></p>' : ''}`;
  const script = me ? `<script>
const msg=t=>{const m=document.getElementById('shopMsg');m.innerHTML='<div class="note err"></div>';m.firstChild.textContent=t};
const post=(u,b)=>fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(async r=>({ok:r.ok,j:await r.json().catch(()=>({}))}));
document.addEventListener('click',async e=>{const f=e.target.closest('[data-buy-frame],[data-wear-frame]');if(f){f.disabled=true;const id=f.dataset.buyFrame||f.dataset.wearFrame;
if(f.dataset.buyFrame){const r=await post('/api/shop/buy',{frame:id});if(!r.ok){f.disabled=false;return msg(r.j.error||'That didn\\'t work.')}}
await post('/api/shop/equip',{frame:id});location.reload();return}
const b=e.target.closest('[data-buy],[data-equip],[data-pick]');if(!b)return;
if(b.dataset.pick!==undefined&&!confirm('Pick this Rookie Gamer? You only get to pick one.'))return;b.disabled=true;
const r=b.dataset.buy!==undefined?await post('/api/shop/buy',{icon:b.dataset.buy}):b.dataset.pick!==undefined?await post('/api/shop/pick',{icon:b.dataset.pick}):await post('/api/shop/equip',{icon:b.dataset.equip});
if(!r.ok){b.disabled=false;return msg(r.j.error||'That didn\'t work.')}
if(b.dataset.buy!==undefined)await post('/api/shop/equip',{icon:b.dataset.buy});location.reload()});
</script>` : '';
  return html(layout({ title: 'Diamond Shop', desc: 'Spend the gems you earn playing RookieGamers games on profile icons.', me, active: '/shop', body, scripts: script, url: siteURL(env) + '/shop', canonicalPath: '/shop' }));
}

function notFound(me, msg = 'Nothing here.') {
  return html(layout({ me, title: 'Not found', robots: 'noindex', body: `<h1>${esc(msg)}</h1><p class="lede"><a href="/">Find a game to play</a>.</p>` }), 404);
}

// /about, /creators, /ai, /faq: ordinary static pages, copy and JSON-LD from seo/copy.js.
async function staticPage(DB, req, env, path) {
  const page = NEW_PAGES[path];
  const me = await viewer(DB, req);
  const q = new URL(req.url).searchParams;
  const code = (q.get('code') || '').replace(/[^a-z0-9]/g, '').slice(0, 24);
  const note = path !== '/data-deletion' ? '' : q.has('done') ? '<div class="note ok">Your RookieGamers account and its data were deleted.</div>'
    : code ? `<div class="note ok">Deletion request <code>${esc(code)}</code> is complete: we removed the Facebook link and the profile details it shared.</div>` : '';
  const body = `<article class="doc"><h1>${esc(page.h1)}</h1>${note}${markdown(page.body)}</article>`;
  return html(layout({ titleFull: page.title, desc: page.description, me, active: path, body,
    url: siteURL(env) + path, canonicalPath: path, jsonld: page.jsonld }));
}

export async function page(path, url, env, DB, req) {
  const res = await route(path, url, env, DB, req);
  // An invite link (?via=<player>) is remembered for 30 days, for visitors who aren't signed in.
  const via = validVia(url.searchParams.get('via'));
  if (res && via && !isBot(req.headers.get('user-agent')) && !await sessionPlayer(DB, req)) res.headers.append('set-cookie', setCookie(req, VIA_COOKIE, via, VIA_DAYS * 86400));
  return res;
}

async function route(path, url, env, DB, req) {
  let m;
  if (path === '/') return home(DB, req, env);
  if ((m = path.match(/^\/s\/(s[a-f0-9]{12})$/))) return sharePage(DB, req, env, m[1]);
  if ((m = path.match(/^\/play\/([a-z0-9-]{1,32})\/?$/))) return play(DB, req, env, url, m[1]);
  if (path === '/hall-of-fame') return hallOfFame(DB, req, env);
  if (path === '/shop') return shopPage(DB, req, env);
  if ((m = path.match(/^\/u\/(p[a-f0-9]{20})$/))) return profilePage(DB, req, env, m[1]);
  if (path === '/signin') return signinPage(env, await viewer(DB, req), url);
  if (path === '/auth/done') return authDone();
  if (path === '/sdk/connect') return connect(DB, req, env, url);
  if (path === '/dev') return devPage(DB, req, env, url);
  if (path === '/docs') return docs(DB, req, env);
  if (NEW_PAGES[path]) return staticPage(DB, req, env, path);
  return null;
}

export const notFoundPage = async (DB, req) => notFound(DB ? await viewer(DB, req) : null);
export const SDK_MARKDOWN = SDK_DOCS;
export { levelFor };
