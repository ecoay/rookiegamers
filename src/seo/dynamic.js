// SEO/AEO output built from the live catalog in D1: the sitemap, the game lists in llms.txt and
// llms-full.txt, VideoGame structured data for every /play page, and ads.txt from env settings.

import { APEX } from './site.js';
import { ORG } from './copy.js';
import { safeJSON } from '../db.js';

// Public pages that are always in the sitemap. Live games are added from D1.
export const STATIC_PATHS = ['/', '/about', '/creators', '/ai', '/faq', '/dev', '/docs', '/hall-of-fame', '/shop', '/privacy', '/terms', '/data-deletion'];

const xmlEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const day = t => new Date(t).toISOString().slice(0, 10);

export const liveCatalog = async DB =>
  (await DB.prepare('SELECT * FROM games WHERE live = 1 ORDER BY released_at ASC, slug ASC').all()).results;

// An absolute image URL for a game's link previews and structured data, or null. Covers can be an
// https URL or, for hosted games, a path inside the live build.
export function gameImage(env, g) {
  if (!g || !g.cover) return null;
  if (/^https:\/\//.test(g.cover)) return g.cover;
  if (g.kind !== 'hosted' || !/^[A-Za-z0-9._\-/]{1,200}$/.test(g.cover) || g.cover.includes('..')) return null;
  const path = g.cover.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  return env && env.GAMES_HOST ? `https://${env.GAMES_HOST}/${g.slug}/${path}` : `${APEX}/hosted/${g.slug}/${path}`;
}

// The image to use when a game has no cover: the site's share card.
export const DEFAULT_OG_IMAGE = `${APEX}/img/og.jpg`;

export function sitemapXML(games) {
  const rows = STATIC_PATHS.map(p => `  <url><loc>${APEX}${p}</loc></url>`);
  for (const g of games) rows.push(`  <url><loc>${APEX}/play/${xmlEsc(g.slug)}</loc>${g.released_at ? `<lastmod>${day(g.released_at)}</lastmod>` : ''}</url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const blurbOf = g => oneLine(g.blurb) || `a free web game by ${oneLine(g.developer)}`;

// "- [title](url): blurb" lines for llms.txt.
export const llmsGameLines = games => games.map(g => `- [${oneLine(g.title)}](${APEX}/play/${g.slug}): ${blurbOf(g)}`).join('\n');
// "- title (url), by dev: blurb" lines for llms-full.txt.
export const llmsFullGameLines = games => games.map(g => `- ${oneLine(g.title)} (${APEX}/play/${g.slug}), by ${oneLine(g.developer)}: ${blurbOf(g)}`).join('\n');

// /play/<slug>: the VideoGame is the mainEntity of a WebPage, with the BreadcrumbList on the WebPage.
export function playJSONLD(env, g, description) {
  const page = `${APEX}/play/${g.slug}`;
  const tags = safeJSON(g.tags, []).filter(t => typeof t === 'string' && t);
  const image = gameImage(env, g);
  const videoGame = {
    '@type': 'VideoGame',
    '@id': `${page}#game`,
    name: g.title,
    url: page,
    description,
    author: { '@type': 'Person', name: g.developer },
    publisher: { '@id': `${APEX}/#org` },
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any (web browser)',
    ...(tags.length ? { genre: tags, keywords: tags.join(', ') } : {}),
    playMode: g.multiplayer ? 'MultiPlayer' : 'SinglePlayer',
    ...(image ? { image } : {}),
    ...(g.released_at ? { datePublished: day(g.released_at) } : {}),
    inLanguage: 'en',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: page },
    potentialAction: { '@type': 'PlayAction', target: page },
  };
  return [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        '@id': `${page}#page`,
        url: page,
        name: `Play ${g.title} free`,
        description,
        isPartOf: { '@id': `${APEX}/#site` },
        publisher: { '@id': `${APEX}/#org` },
        breadcrumb: { '@id': `${page}#breadcrumb` },
        mainEntity: { '@id': `${page}#game` },
        ...(image ? { primaryImageOfPage: image } : {}),
      },
      videoGame,
      {
        '@type': 'BreadcrumbList',
        '@id': `${page}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${APEX}/` },
          { '@type': 'ListItem', position: 2, name: g.title, item: page },
        ],
      },
    ],
  }];
}

// The home page's list of games, so search and answer engines see the catalog.
export function gameListJSONLD(games) {
  if (!games.length) return [];
  return [{
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': `${APEX}/#games`,
    name: 'Games on RookieGamers',
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => ({ '@type': 'ListItem', position: i + 1, url: `${APEX}/play/${g.slug}`, name: g.title })),
  }];
}

// ads.txt (IAB Tech Lab). Built from settings the owner enters in Cloudflare:
//   ADSENSE_CLIENT  ca-pub-... adds Google's line automatically.
//   ADS_TXT         any other seller lines, one per line, exactly as the ad network gives them.
// With neither set, the file lists no sellers, which tells buyers nobody is authorized to sell
// RookieGamers ad space yet (true today: the portal only runs its own sponsor and house ads).
export function adsTxt(env) {
  const lines = ['# ads.txt for rookiegamers.com', `OWNERDOMAIN=rookiegamers.com`, 'contact=support@rookiegamers.com'];
  const pub = String(env.ADSENSE_CLIENT || 'ca-pub-8081136929405133').trim().match(/^(?:ca-)?(pub-\d{6,24})$/);
  const sellers = [];
  if (pub) sellers.push(`google.com, ${pub[1]}, DIRECT, f08c47fec0942fa0`);
  for (const raw of String(env.ADS_TXT || '').split(/\r?\n|\\n/)) {
    const l = raw.replace(/[^\x20-\x7e]/g, '').trim();
    if (!l || l.startsWith('#')) continue;
    // A record is domain, account, DIRECT|RESELLER[, cert id]; variables like MANAGERDOMAIN= pass through.
    if (/^[a-z0-9.-]+\s*,\s*[^,]+\s*,\s*(DIRECT|RESELLER)\s*(,\s*[^,]+)?$/i.test(l) || /^[A-Za-z]+=\S+$/.test(l)) {
      if (!sellers.includes(l)) sellers.push(l);
    }
  }
  if (!sellers.length) lines.push('# No ad networks are authorized to sell RookieGamers ad space yet.');
  return lines.concat(sellers).join('\n') + '\n';
}
