// Games the portal knows about on a fresh database. Inserted once; edit them later through the
// developer API or `node scripts/rg.mjs`. The other launch games join here as their links arrive.

export const SEED_GAMES = [
  {
    slug: 'unsays', title: 'unsays', kind: 'linked', url: 'https://unsays.com/?rg=1',
    origins: ['https://unsays.com'], developer: 'ecoay',
    blurb: 'Things you can\'t unsay. Everyone gets the same letters, writes a line for the topic, then everyone votes.',
    tags: ['multiplayer', 'party', 'word'], color: '#8f6bff', devices: 'both', multiplayer: true,
    score_label: 'Points', score_mode: 'sum', score_order: 'desc',
  },
  {
    slug: 'buyyourfriends', title: 'BuyYourFriends', kind: 'linked', url: 'https://buyyoufriends.vercel.app/',
    origins: ['https://buyyoufriends.vercel.app'], developer: 'ecoay',
    blurb: '', tags: ['social'], color: '#3ddc97',
  },
  // Listed but not live until their URLs are in. Set url and origins, then publish.
  { slug: 'handofnine', title: 'Hand of Nine', kind: 'linked', live: false, developer: 'ecoay',
    blurb: 'Arrange nine cards on a 3x3 table, match twelve touching edges, and chase a Perfect Hand worth 2400.', tags: ['cards', 'puzzle'], color: '#d4a64a' },
  { slug: 'youcult', title: 'YouCult', kind: 'linked', live: false, developer: 'ecoay', blurb: '', tags: [], color: '#ff2bd6' },
  { slug: 'fishtarttycoon', title: 'FishTartTycoon', kind: 'hosted', live: false, developer: 'ecoay',
    blurb: 'Humans build an industrial civilisation because three hungry seals want fish tarts. The seals are still sitting forty feet away.',
    tags: ['tycoon', 'idle'], color: '#4fb3ff', score_label: 'Season revenue', score_mode: 'best', score_order: 'desc' },
  { slug: 'glitch-homiez', title: 'Glitch Homiez', kind: 'linked', live: false, developer: 'ecoay', blurb: '', tags: [], color: '#ff2bd6' },
];

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const RESERVED = new Set(['api', 'admin', 'dev', 'sdk', 'mcp', 'play', 'u', 'hall-of-fame', 'signin', 'auth', 'hosted', 'new', 'games', 'me', 'docs']);
