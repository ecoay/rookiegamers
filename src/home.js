// The home page: a left rail, a top bar with search, the "Play something weird" hero, category
// chips, the Trending Now row with the play-type filter, and the Web3 Arcade strip. The two
// pieces of art (public/img/hero.webp and web3-strip.webp) are the only images; everything else
// is HTML and CSS. Filtering and search run in the browser over the games on the page.

import { canonical, ldJSON } from './seo/site.js';
import { FOOTER_LINKS, HOME_JSONLD } from './seo/copy.js';
import { gameListJSONLD } from './seo/dynamic.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const data = v => JSON.stringify(v).replace(/</g, '\\u003c');

// Line icons, 24px grid, drawn with currentColor.
const P = {
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.6 1 2.6 2 3 0-3-.5-5.5.5-8z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><circle cx="17" cy="9" r="2.6"/><path d="M16.5 14c2.5.2 4 1.8 4.5 4.5"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16 5 3.8-1 2.2 15.5-3.8 1z"/>',
  diamond: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21 8 9l4-6 4 6z"/>',
  wand: '<path d="m4 20 11-11"/><path d="m13 7 2-2 2 2-2 2zM18 3v3M16.5 4.5h3M20 9v2M19 10h2M9 3v2M8 4h2"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  sparkles: '<path d="M10 3.5 11.8 8l4.7 1.8-4.7 1.8L10 16.2 8.2 11.6 3.5 9.8 8.2 8z"/><path d="m18 13 .9 2.1L21 16l-2.1.9L18 19l-.9-2.1L15 16l2.1-.9z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c.8-4 4-6 8-6s7.2 2 8 6"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3M16 13.5h2"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5h14v-5"/>',
  pad: '<path d="M7 8h10a4 4 0 0 1 4 4.5l-.4 3a2.6 2.6 0 0 1-4.6 1.3L14.5 15h-5L8 16.8a2.6 2.6 0 0 1-4.6-1.3l-.4-3A4 4 0 0 1 7 8z"/><path d="M8 10.5v3M6.5 12h3"/><circle cx="15.5" cy="11.2" r=".6" fill="currentColor"/><circle cx="17" cy="12.8" r=".6" fill="currentColor"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.5 9 5 9-5"/><path d="m3 16.5 9 5 9-5" opacity=".6"/>',
  cards: '<rect x="3.5" y="6" width="10" height="14" rx="1.5" transform="rotate(-8 8.5 13)"/><path d="m12 5.5 6.8 1.2a1.5 1.5 0 0 1 1.2 1.7L18 19.6"/>',
  cube: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  paw: '<circle cx="6.5" cy="10" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="17.5" cy="10" r="1.8"/><path d="M8 17c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5c0 1.6-1.4 2.5-4 2.5s-4-.9-4-2.5z"/>',
  scissors: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5 20 18M8 15.5 20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  sword: '<path d="M14.5 3H21v6.5L10 20.5 3.5 14z"/><path d="m6 17-3 4M7.5 13l3.5 3.5"/>',
  sim: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  party: '<path d="m4 20 4.5-12L16 15.5z"/><path d="M14 4.5c.5 1.5 0 2.5-1 3M19 9.5c-1.5-.5-2.5 0-3 1M17 3l.5 1.5M20.5 6.5 19 7"/>',
};
const icon = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

// Categories map to game tags. A chip only filters; games carry whatever tags their developer set.
const CATEGORIES = [
  ['all', 'All Games', null], ['action', 'Action', 'pad'], ['adventure', 'Adventure', 'layers'], ['card', 'Card', 'cards'], ['strategy', 'Strategy', 'cube'],
  ['rpg', 'RPG', 'star'], ['creature', 'Creature Collection', 'paw'], ['multiplayer', 'Multiplayer', 'users'], ['simulation', 'Simulation', 'scissors'], ['party', 'Party', 'cube'],
];
const ALIASES = { card: ['card', 'cards', 'card battler', 'deckbuilder'], creature: ['creature', 'creatures', 'creature collection', 'pets'], simulation: ['simulation', 'sim', 'tycoon', 'idle'], action: ['action', 'arcade', 'platformer', 'racing'] };

const WALLET = {
  none: ['No wallet', 'pad'],
  optional: ['Wallet optional', 'wallet'],
  required: ['Wallet required', 'link'],
};

const compact = n => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K' : String(n));
const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#8f6bff');

function cover(g) {
  const img = g.cover && /^https:\/\//.test(g.cover) ? g.cover : null;
  const c = hex(g.color);
  // No cover yet: the title, poster-style, on the game's color.
  return `<div class="cover" style="--c:${c}">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="poster">${esc(g.title)}</span>`}</div>`;
}

function gameCard(g) {
  const [label, ic] = WALLET[g.wallet] || WALLET.none;
  const tags = (g.tags || []).slice(0, 3);
  const plays = g.stats?.plays || 0;
  const hay = [g.title, g.developer, g.blurb, ...(g.tags || [])].join(' ').toLowerCase();
  return `<article class="gc" data-tags="${esc((g.tags || []).join('|').toLowerCase())}" data-wallet="${esc(g.wallet)}" data-q="${esc(hay)}" data-new="${g.isNew ? 1 : 0}" data-featured="${g.featured ? 1 : 0}">
<a class="hit" href="/play/${esc(g.slug)}" aria-label="Play ${esc(g.title)}"></a>${cover(g)}${g.featured ? `<span class="feat">${icon('star')}Featured</span>` : ''}<span class="badge">${icon(ic)}${label}</span>
<div class="gb"><h3>${esc(g.title)}</h3><p>${esc(g.blurb || 'A RookieGamers original.')}</p>
${tags.length ? `<div class="tags">${tags.map(t => `<span>${esc(t.replace(/\b\w/g, m => m.toUpperCase()))}</span>`).join('')}</div>` : '<div class="tags"></div>'}
<div class="foot">${plays ? `<span class="stat" title="Plays in the last 30 days">${icon('play')}${compact(plays)} plays</span>` : g.isNew ? '<span class="stat new">New</span>' : '<span></span>'}<a class="pn" href="/play/${esc(g.slug)}">${icon('play')}Play Now</a></div></div></article>`;
}

export function homePage({ me, games, site }) {
  const web3 = games.filter(g => g.wallet === 'required' || g.wallet === 'optional');
  const allTags = [...new Set(games.flatMap(g => g.tags || []).map(t => t.toLowerCase()))];
  const known = new Set(CATEGORIES.flatMap(([k]) => ALIASES[k] || [k]));
  const extra = allTags.filter(t => !known.has(t)).slice(0, 12);
  const rail = [
    ['/', 'Discover', 'compass', true], ['/?sort=new', 'New Games', 'flame'], ['/?cat=multiplayer', 'Multiplayer', 'users'],
    [me ? `/u/${me.id}` : '/signin?next=/', 'My Library', 'library'], ['/shop', 'Diamond Shop', 'diamond'], ['/dev', 'Creator Studio', 'wand'],
  ];
  const t = 'RookieGamers · Play something weird';
  const desc = 'Indie games. Instant play. Free web games from indie developers, with one account across every game.';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title><meta name="description" content="${esc(desc)}"><meta name="google-adsense-account" content="ca-pub-8081136929405133"><meta name="google-site-verification" content="OSHWSdXxLLrQTk12-QAup0nc3IHfnccGLamcxk2hDng">
<meta property="og:site_name" content="RookieGamers"><meta property="og:title" content="${t}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:locale" content="en_US">
<meta property="og:url" content="${esc(canonical('/'))}"><link rel="canonical" href="${esc(canonical('/'))}"><meta property="og:image" content="${esc(canonical('/img/og.jpg'))}"><meta property="og:image:alt" content="RookieGamers: play something weird"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(canonical('/img/og.jpg'))}"><meta name="twitter:title" content="${t}"><meta name="twitter:description" content="${esc(desc)}"><meta name="theme-color" content="#0f0d16">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="preload" as="image" href="/img/hero.webp" imagesrcset="/img/hero-sm.webp 1086w, /img/hero.webp 2172w" imagesizes="(max-width: 900px) 100vw, calc(100vw - 120px)">
<link rel="stylesheet" href="/home.css">${[...HOME_JSONLD, ...gameListJSONLD(games)].map(block => `<script type="application/ld+json">${ldJSON(block)}</script>`).join('')}</head><body class="rg-home">
<aside class="rail" aria-label="Sections">
${rail.map(([h, l, ic, on]) => `<a href="${esc(h)}"${on ? ' class="on" aria-current="page"' : ''}>${icon(ic)}<span>${l}</span></a>`).join('')}
<a class="w3" href="#web3">${icon('link')}<span>WEB3<br>ARCADE</span></a>
</aside>
<div class="main">
<header class="bar">
<label class="search">${icon('search')}<input id="q" type="search" placeholder="Search games, creators, tags..." aria-label="Search games, creators, tags" autocomplete="off"><kbd>⌘K</kbd></label>
<div class="acts">
<a class="b ai" href="/dev#ai">${icon('sparkles')}<span>Customize with AI</span></a>
${me ? `<a class="b me" href="/u/${esc(me.id)}#inventory"><span class="av${me.frame ? ` fr-${esc(me.frame)}` : ''}"><img src="${esc(me.avatar)}" alt=""></span><span>${esc(me.name)}</span></a>` : `<a class="b out" href="/signin?next=/">${icon('user')}<span>Sign In</span></a>`}
<button class="b lime" type="button" id="walletBtn">${icon('wallet')}<span>Connect Wallet</span></button>
</div></header>

<section class="hero" aria-label="RookieGamers: play something weird. Indie games, instant play.">
<img src="/img/hero.webp" srcset="/img/hero-sm.webp 1086w, /img/hero.webp 2172w" sizes="(max-width: 900px) 100vw, calc(100vw - 120px)" alt="RookieGamers. Play something weird. Indie games. Instant play." width="2172" height="724">
<div class="cta"><a class="b lime big" href="#trending">${icon('play')}<span>Explore Games</span>${icon('chev', 'sm')}</a><a class="b out big" href="/dev">${icon('upload')}<span>Submit a Game</span></a></div>
</section>

<p class="tagline">Free indie web games, made with AI or without it. <a href="/about">Why we exist</a></p>

<nav class="chips" aria-label="Categories">
${(games.some(g => g.featured) ? [CATEGORIES[0], ['featured', 'Featured', 'sparkles'], ...CATEGORIES.slice(1)] : CATEGORIES).map(([k, l, ic], i) => `<button type="button" data-cat="${k}"${i === 0 ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"'}>${ic ? icon(ic) : ''}${l}</button>`).join('')}
<span class="more"><button type="button" id="moreBtn" aria-expanded="false">${icon('plus')}More${icon('down', 'sm')}</button>
<span class="morelist" id="moreList" hidden>${extra.length ? extra.map(t => `<button type="button" data-cat="${esc(t)}" aria-pressed="false">${esc(t.replace(/\b\w/g, m => m.toUpperCase()))}</button>`).join('') : '<em>More categories as games arrive</em>'}</span></span>
</nav>

<section class="trend" id="trending">
<div class="th"><h2><span class="fire" aria-hidden="true">🔥</span>Trending Now</h2><p>The games everyone's playing at Rookie Gamers.</p>
<div class="pt" role="group" aria-label="Play type"><span>Play Type:</span>
<button type="button" data-pt="none" aria-pressed="false">${icon('pad')}No Crypto</button><button type="button" data-pt="optional" aria-pressed="false">${icon('swap')}Hybrid</button><button type="button" data-pt="required" aria-pressed="false">${icon('link')}Web3</button></div>
<a class="all" href="#trending" id="seeAll">See All Trending${icon('chev', 'sm')}</a></div>
<div class="grid" id="grid">${games.map(gameCard).join('')}</div>
<p class="empty" id="empty" hidden>No games match that yet. <a href="/dev">Make one?</a></p>
</section>

<section class="w3a" id="web3" aria-label="Web3 Arcade: onchain-enabled indie games at Rookie Gamers">
<div class="strip"><img src="/img/web3-strip.webp" alt="Web3 Arcade. Onchain-enabled indie games at Rookie Gamers." width="2160" height="169" loading="lazy">
<div class="w3in"><div class="thumbs">${web3.length ? web3.slice(0, 8).map(g => `<a class="th3" href="/play/${esc(g.slug)}" style="--c:${hex(g.color)}">${g.cover && /^https:\/\//.test(g.cover) ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : `<i>${esc(g.title)}</i>`}<span>${esc(g.title)}</span></a>`).join('') : '<p class="soon">Onchain games are on their way. Wallets stay optional, and are for players 18+.</p>'}</div>
<a class="b lime" href="#trending" data-goto="web3">${icon('link')}<span>Explore Web3</span>${icon('chev', 'sm')}</a></div></div>
</section>

<footer class="ft"><span>RookieGamers</span>${FOOTER_LINKS.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}<span>Accounts are for players 13 and up. Wallets are optional and for players 18 and up.</span></footer>
</div>

<dialog class="dlg" id="walletDlg"><h3>Wallets are coming</h3><p>Every game on RookieGamers plays without a wallet. Connecting one will be optional, for players 18 and up, and only unlocks coin discounts and onchain games.</p><button class="b lime" type="button" id="walletOk">Got it</button></dialog>
<script>window.RG_HOME=${data({ aliases: ALIASES })}</script><script src="/home.js" defer></script>
</body></html>`;
}
