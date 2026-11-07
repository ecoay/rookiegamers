// Copy, meta and JSON-LD for the four new public pages and for the existing routes listed in
// pages/COPY.md. Kept as data so pages.js/home.js just wire it into the shared layout().

import { LEGAL_PAGES } from './legal.js';

export const ORG = {
  '@type': 'Organization',
  '@id': 'https://rookiegamers.com/#org',
  name: 'RookieGamers',
  url: 'https://rookiegamers.com/',
  parentOrganization: { '@type': 'Organization', name: 'Tenacié LLC' },
};

// Footer link row added to every page (COPY.md). Hall of Fame/SDK docs/Publish already existed;
// About/For creators/AI/FAQ are new.
export const FOOTER_LINKS = [
  ['/about', 'About'],
  ['/creators', 'For creators'],
  ['/ai', 'AI'],
  ['/faq', 'FAQ'],
  ['/dev', 'Publish'],
  ['/docs', 'SDK docs'],
  ['/hall-of-fame', 'Hall of Fame'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
];

/* ---------- new pages ---------- */

export const ABOUT_PAGE = {
  title: 'About RookieGamers · Free indie web games',
  description: 'Why RookieGamers exists: a free browser game portal where indie developers can publish, whether they use AI or not.',
  h1: 'Why RookieGamers exists',
  body: `RookieGamers is a web game portal for indie games. Games are free to play in the browser, with nothing to install. Every game on the portal is built on one shared player account, one level and one Hall of Fame, and each game can point players to another one when a round ends, so a new game does not have to find its audience alone.

## What we believe
We want to remove the barriers to entry into the creative arts and let indie developers publish, whether they use AI or not. Some makers write every line by hand. Some work with an AI assistant. Some let an agent do most of the building. All of them are welcome here.

We see AI as a tool that can open game making to more people, and we would rather build for it than around it.

## Where we are going
Our aim is to be an integrated plugin for indie game makers, reachable over MCP from the AI assistants they already use, such as ChatGPT, Grok and, later, Claude. Part of that groundwork exists today: a public MCP server and setup guides for some AI coding tools. See [AI and RookieGamers](/ai) for what exists now and what is still planned.

## For players
Every game is free to play. Your RookieGamers account, for people 13 and up, saves your scores and earns gems for each social network you link. Wallets are optional, for players 18 and up, and are not live yet. Every game plays without one.

## For makers
Read [For creators](/creators) for how publishing is designed to work, then [Publish](/dev) for setup and [SDK docs](/docs) for the reference.

## Who runs it
RookieGamers is operated by Tenacié LLC.`,
  jsonld: [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'AboutPage',
        '@id': 'https://rookiegamers.com/about#page',
        url: 'https://rookiegamers.com/about',
        name: 'About RookieGamers',
        description: 'Why RookieGamers exists: a free browser game portal where indie developers can publish, whether they use AI or not.',
        isPartOf: { '@id': 'https://rookiegamers.com/#site' },
        publisher: { '@id': 'https://rookiegamers.com/#org' },
        breadcrumb: { '@id': 'https://rookiegamers.com/about#breadcrumb' },
        about: { '@id': 'https://rookiegamers.com/#org' },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://rookiegamers.com/about#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
          { '@type': 'ListItem', position: 2, name: 'About', item: 'https://rookiegamers.com/about' },
        ],
      },
    ],
  }],
};

export const CREATORS_PAGE = {
  title: 'Publish your indie web game · RookieGamers for creators',
  description: 'How publishing on RookieGamers is designed to work: one SDK for sign-in, scores, the Hall of Fame and play-next cards, with or without AI.',
  h1: 'Publish your game on RookieGamers',
  body: `Every game on RookieGamers is meant to share one player base. Your players can find other games, and their players can find yours.

## What the SDK provides
Add one script tag and the SDK v1 gives your game:
- Sign-in with the RookieGamers account, the only login a game uses.
- Score submission with a monthly board and an all-time board.
- The Hall of Fame: at the end of each month, the top 3 on every game's monthly board are kept forever and earn a title shown across the portal.
- Play-next cards that suggest another portal game at a natural break.
- A test mode, so you can build without a network or an account.
The full reference is in the [SDK docs](/docs).

## Ways to publish
- By hand: add the SDK script and use the RookieGamers command-line tool.
- With an AI agent: connect the RookieGamers MCP server so your agent can read the docs and work on your game.
- A mix of both.
Publishing needs a developer API key from the [Publish](/dev) page. Setup steps are there too.

## With or without AI
You can build your game any way you like. See [AI and RookieGamers](/ai).`,
  jsonld: [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        '@id': 'https://rookiegamers.com/creators#page',
        url: 'https://rookiegamers.com/creators',
        name: 'Publish your indie web game',
        description: 'How publishing on RookieGamers is designed to work: one SDK for sign-in, scores, the Hall of Fame and play-next cards, with or without AI.',
        isPartOf: { '@id': 'https://rookiegamers.com/#site' },
        publisher: { '@id': 'https://rookiegamers.com/#org' },
        breadcrumb: { '@id': 'https://rookiegamers.com/creators#breadcrumb' },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://rookiegamers.com/creators#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
          { '@type': 'ListItem', position: 2, name: 'For creators', item: 'https://rookiegamers.com/creators' },
        ],
      },
    ],
  }],
};

export const AI_PAGE = {
  title: 'AI and RookieGamers · MCP for indie game makers',
  description: 'RookieGamers welcomes indie developers who use AI and those who do not. What our MCP server offers today, and where we plan to go.',
  h1: 'AI and RookieGamers',
  body: `## Our view
We want to remove the barriers to entry into the creative arts. AI tools can help more people make games, so we are building for them. Developers who do not use AI are just as welcome, and so are their games.

## What exists today
- A public RookieGamers MCP server at https://rookiegamers.com/mcp. Anyone can use its read-only tools, such as SDK docs, a game scaffold, the portal game list and leaderboards.
- Tools that change your games, such as creating, uploading and publishing, need a developer API key from the [Publish](/dev) page.
- Setup material for Claude Code (a plugin and a direct MCP setup), Codex and the xAI API, plus a command-line tool for people who prefer to work by hand. These client setups have not been verified end to end.
Exact setup steps are on the [Publish](/dev) page.

## What is planned
We aim to become an integrated plugin for indie game makers, reachable over MCP from AI assistants such as ChatGPT, Grok and, later, Claude. We have not verified a ChatGPT setup yet, and the client setup material above has not been verified end to end; it is a starting point, not finished app integrations.`,
  jsonld: [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        '@id': 'https://rookiegamers.com/ai#page',
        url: 'https://rookiegamers.com/ai',
        name: 'AI and RookieGamers',
        description: 'RookieGamers welcomes indie developers who use AI and those who do not. What our MCP server offers today, and where we plan to go.',
        isPartOf: { '@id': 'https://rookiegamers.com/#site' },
        publisher: { '@id': 'https://rookiegamers.com/#org' },
        breadcrumb: { '@id': 'https://rookiegamers.com/ai#breadcrumb' },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': 'https://rookiegamers.com/ai#breadcrumb',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
          { '@type': 'ListItem', position: 2, name: 'AI and RookieGamers', item: 'https://rookiegamers.com/ai' },
        ],
      },
    ],
  }],
};

export const FAQ_QA = [
  ['Is RookieGamers free to play?', 'Yes. Games are free to play in the browser, with nothing to install.'],
  ['Do I need an account?', 'Sign up free with your RookieGamers account (13 and up) to save scores, climb the leaderboards and earn gems. One account works in every game.'],
  ['Do I need a crypto wallet?', 'No. Every game plays without one. Wallets are not live yet. When they arrive they will be optional, for players 18 and up, and the site says they will only unlock coin discounts and onchain games.'],
  ['Can I publish a game made with AI?', 'Yes. Developers who use AI are welcome.'],
  ['Can I publish a game made without AI?', 'Yes. Hand-made games are just as welcome.'],
  ['How do I publish?', 'Get a developer API key on the Publish page, add the SDK, then publish with the command-line tool or through the RookieGamers MCP server from your AI agent. The Publish page has the setup steps.'],
  ['Does RookieGamers work with ChatGPT, Grok or Claude?', 'The public RookieGamers MCP server is live. Setup material exists for Claude Code, Codex and the xAI API, but those client setups have not been verified end to end, and we have not verified a ChatGPT setup yet. Becoming an integrated plugin for these assistants is our goal.'],
  ['Can my game use its own login or ad code?', 'The SDK rules say no: the RookieGamers account is the only sign-in, and games should not include outside ad code.'],
];

export const FAQ_PAGE = {
  title: 'RookieGamers FAQ · Playing, accounts and publishing',
  description: 'Short answers about playing free on RookieGamers, accounts, wallets, publishing a game and using AI.',
  h1: 'Frequently asked questions',
  body: FAQ_QA.map(([q, a]) => `## ${q}\n${a}`).join('\n\n'),
  jsonld: [
    {
      '@context': 'https://schema.org',
      '@graph': [
        ORG,
        {
          '@type': 'WebPage',
          '@id': 'https://rookiegamers.com/faq#page',
          url: 'https://rookiegamers.com/faq',
          name: 'RookieGamers FAQ',
          description: 'Short answers about playing free on RookieGamers, accounts, wallets, publishing a game and using AI.',
          isPartOf: { '@id': 'https://rookiegamers.com/#site' },
          publisher: { '@id': 'https://rookiegamers.com/#org' },
          breadcrumb: { '@id': 'https://rookiegamers.com/faq#breadcrumb' },
        },
        {
          '@type': 'BreadcrumbList',
          '@id': 'https://rookiegamers.com/faq#breadcrumb',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
            { '@type': 'ListItem', position: 2, name: 'FAQ', item: 'https://rookiegamers.com/faq' },
          ],
        },
      ],
    },
    // Optional second block: machine readability only. Google shows FAQ rich results for only some
    // government/health sites, so this is not expected to earn a rich result (COPY.md).
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      '@id': 'https://rookiegamers.com/faq#faq',
      url: 'https://rookiegamers.com/faq',
      mainEntity: FAQ_QA.map(([q, a]) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
};

export const NEW_PAGES = {
  ...LEGAL_PAGES,
  '/about': ABOUT_PAGE,
  '/creators': CREATORS_PAGE,
  '/ai': AI_PAGE,
  '/faq': FAQ_PAGE,
};

/* ---------- existing pages: meta + JSON-LD only ---------- */

export const HOME_JSONLD = [{
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': 'https://rookiegamers.com/#site',
      url: 'https://rookiegamers.com/',
      name: 'RookieGamers',
      description: 'Indie games. Instant play. Free web games from indie developers, with one account across every game.',
      publisher: { '@id': 'https://rookiegamers.com/#org' },
    },
    ORG,
  ],
}];

export const DEV_JSONLD = [{
  '@context': 'https://schema.org',
  '@graph': [
    ORG,
    {
      '@type': 'WebPage',
      '@id': 'https://rookiegamers.com/dev#page',
      url: 'https://rookiegamers.com/dev',
      name: 'Publish',
      description: 'Publish your web game on RookieGamers with the MCP server, Claude Code, Codex, the xAI API or the command-line tool.',
      isPartOf: { '@id': 'https://rookiegamers.com/#site' },
      publisher: { '@id': 'https://rookiegamers.com/#org' },
      breadcrumb: { '@id': 'https://rookiegamers.com/dev#breadcrumb' },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': 'https://rookiegamers.com/dev#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
        { '@type': 'ListItem', position: 2, name: 'Publish', item: 'https://rookiegamers.com/dev' },
      ],
    },
  ],
}];

export const DOCS_JSONLD = [{
  '@context': 'https://schema.org',
  '@graph': [
    ORG,
    {
      '@type': 'WebPage',
      '@id': 'https://rookiegamers.com/docs#page',
      url: 'https://rookiegamers.com/docs',
      name: 'SDK docs',
      description: 'RookieGamers SDK v1 reference: sign-in, monthly and all-time scores, the Hall of Fame, gameplay events and play-next cards.',
      isPartOf: { '@id': 'https://rookiegamers.com/#site' },
      publisher: { '@id': 'https://rookiegamers.com/#org' },
      breadcrumb: { '@id': 'https://rookiegamers.com/docs#breadcrumb' },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': 'https://rookiegamers.com/docs#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
        { '@type': 'ListItem', position: 2, name: 'SDK docs', item: 'https://rookiegamers.com/docs' },
      ],
    },
  ],
}];

export const HALL_OF_FAME_JSONLD = [{
  '@context': 'https://schema.org',
  '@graph': [
    ORG,
    {
      '@type': 'WebPage',
      '@id': 'https://rookiegamers.com/hall-of-fame#page',
      url: 'https://rookiegamers.com/hall-of-fame',
      name: 'Hall of Fame',
      description: 'Each month the top 3 players in every RookieGamers game are kept in the Hall of Fame forever and wear their title across the portal.',
      isPartOf: { '@id': 'https://rookiegamers.com/#site' },
      publisher: { '@id': 'https://rookiegamers.com/#org' },
      breadcrumb: { '@id': 'https://rookiegamers.com/hall-of-fame#breadcrumb' },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': 'https://rookiegamers.com/hall-of-fame#breadcrumb',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
        { '@type': 'ListItem', position: 2, name: 'Hall of Fame', item: 'https://rookiegamers.com/hall-of-fame' },
      ],
    },
  ],
}];

// /play/<slug>: COPY.md put the VideoGame at the top of the @graph with the BreadcrumbList
// attached directly to it. The build brief instead requires the VideoGame to be the mainEntity of
// a WebPage, with the BreadcrumbList on that WebPage. Applied here; see NOTES.md.
function playPageJSONLD({ path, name, description, playMode }) {
  const page = `https://rookiegamers.com${path}`;
  const videoGame = {
    '@type': 'VideoGame',
    '@id': `${page}#game`,
    name,
    url: page,
    description,
    author: { '@type': 'Person', name: 'ecoay' },
    publisher: { '@id': 'https://rookiegamers.com/#org' },
    gamePlatform: 'Web browser',
    ...(playMode ? { playMode } : {}),
    isAccessibleForFree: true,
  };
  return [{
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        '@id': `${page}#page`,
        url: page,
        name,
        description,
        isPartOf: { '@id': 'https://rookiegamers.com/#site' },
        publisher: { '@id': 'https://rookiegamers.com/#org' },
        breadcrumb: { '@id': `${page}#breadcrumb` },
        mainEntity: { '@id': `${page}#game` },
      },
      videoGame,
      {
        '@type': 'BreadcrumbList',
        '@id': `${page}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://rookiegamers.com/' },
          { '@type': 'ListItem', position: 2, name, item: page },
        ],
      },
    ],
  }];
}

// Meta description + JSON-LD for the two /play/<slug> routes COPY.md specifies. Other games are
// untouched (out of scope for this change).
export const PLAY_PAGES = {
  unsays: {
    description: "Things you can't unsay. Everyone gets the same letters, writes a line for the topic, then everyone votes.",
    jsonld: playPageJSONLD({
      path: '/play/unsays', name: 'unsays',
      description: "Things you can't unsay. Everyone gets the same letters, writes a line for the topic, then everyone votes.",
      playMode: 'MultiPlayer',
    }),
  },
  buyyourfriends: {
    description: 'BuyYourFriends, a RookieGamers original by ecoay. Free to play in your browser.',
    jsonld: playPageJSONLD({
      path: '/play/buyyourfriends', name: 'BuyYourFriends',
      description: 'BuyYourFriends, a RookieGamers original by ecoay. Free to play in your browser.',
    }),
  },
};
