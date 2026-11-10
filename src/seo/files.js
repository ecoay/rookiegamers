// Root text files served byte-for-byte by the Worker (see worker.js). Kept as plain JS strings
// because the project's Text bundling rule in wrangler.jsonc only covers *.md.

export const ROBOTS_TXT = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /auth/
Disallow: /sdk/connect

Sitemap: https://rookiegamers.com/sitemap.xml
`;

// /sitemap.xml is built from D1 on each request: see seo/dynamic.js.

// {{GAMES}} is replaced with the live games from D1 when the file is served.
export const LLMS_TXT = `# RookieGamers

> RookieGamers is a free web game portal for indie games. Games play in the browser with nothing to install, and every game is built to share one player account, one level and one Hall of Fame. Indie developers are welcome whether they use AI or not.

RookieGamers wants to be an integrated plugin for indie game makers, reachable over MCP from AI assistants such as ChatGPT, Grok and, later, Claude. That is a goal, not a finished set of integrations. Today the public RookieGamers MCP server at https://rookiegamers.com/mcp is live. Setup material exists for Claude Code, Codex and the xAI API; those client setups, and any ChatGPT setup, have not been verified end to end.

## Learn
- [About RookieGamers](https://rookiegamers.com/about): why the portal exists and who it is for
- [For creators](https://rookiegamers.com/creators): how publishing is designed to work
- [AI and RookieGamers](https://rookiegamers.com/ai): our view on AI, what exists today, and what is planned
- [FAQ](https://rookiegamers.com/faq): short answers on playing, accounts, wallets and publishing

## Build and publish
- [Publish a game](https://rookiegamers.com/dev): MCP server address, Claude Code, Codex, xAI API and CLI setup
- [SDK docs](https://rookiegamers.com/docs): the SDK v1 reference (sign-in, scores, Hall of Fame, play-next cards)

## Play
{{GAMES}}
- [Hall of Fame](https://rookiegamers.com/hall-of-fame): each month's top 3 players in every game

## Optional
- [Full text of the pages above](https://rookiegamers.com/llms-full.txt)
`;

export const LLMS_FULL_TXT = `# RookieGamers

> RookieGamers is a free web game portal for indie games. Games play in the browser with nothing to install. Indie developers are welcome whether they use AI or not.

---

# Why RookieGamers exists
URL: https://rookiegamers.com/about

RookieGamers is a web game portal for indie games. Games are free to play in the browser, with nothing to install. Every game on the portal is built on one shared player account, one level and one Hall of Fame, and each game can point players to another one when a round ends, so a new game does not have to find its audience alone.

## What we believe
We want to remove the barriers to entry into the creative arts and let indie developers publish, whether they use AI or not. Some makers write every line by hand. Some work with an AI assistant. Some let an agent do most of the building. All of them are welcome here.

We see AI as a tool that can open game making to more people, and we would rather build for it than around it.

## Where we are going
Our aim is to be an integrated plugin for indie game makers, reachable over MCP from the AI assistants they already use, such as ChatGPT, Grok and, later, Claude. Part of that groundwork exists today: a public MCP server and setup guides for some AI coding tools. See [AI and RookieGamers](https://rookiegamers.com/ai) for what exists now and what is still planned.

## For players
Every game is free to play. Your RookieGamers account, for people 13 and up, saves your scores and earns gems for each social network you link. Wallets are optional, for players 18 and up, and are not live yet. Every game plays without one.

## For makers
Read [For creators](https://rookiegamers.com/creators) for how publishing is designed to work, then [Publish](https://rookiegamers.com/dev) for setup and [SDK docs](https://rookiegamers.com/docs) for the reference.

## Who runs it
RookieGamers is operated by Tenacié LLC.

---

# Publish your game on RookieGamers
URL: https://rookiegamers.com/creators

Every game on RookieGamers is meant to share one player base. Your players can find other games, and their players can find yours.

## What the SDK provides
Add one script tag and the SDK v1 gives your game:
- Sign-in with the RookieGamers account, the only login a game uses.
- Score submission with a monthly board and an all-time board.
- The Hall of Fame: at the end of each month, the top 3 on every game's monthly board are kept forever and earn a title shown across the portal.
- Play-next cards that suggest another portal game at a natural break.
- A test mode, so you can build without a network or an account.
The full reference is in the [SDK docs](https://rookiegamers.com/docs).

## Ways to publish
- By hand: add the SDK script and use the RookieGamers command-line tool.
- With an AI agent: connect the RookieGamers MCP server so your agent can read the docs and work on your game.
- A mix of both.
Publishing needs a developer API key from the [Publish](https://rookiegamers.com/dev) page. Setup steps are there too.

## With or without AI
You can build your game any way you like. See [AI and RookieGamers](https://rookiegamers.com/ai).

---

# AI and RookieGamers
URL: https://rookiegamers.com/ai

## Our view
We want to remove the barriers to entry into the creative arts. AI tools can help more people make games, so we are building for them. Developers who do not use AI are just as welcome, and so are their games.

## What exists today
- A public RookieGamers MCP server at https://rookiegamers.com/mcp. Developers sign in with their RookieGamers account (AI apps open the sign-in page for you) or use an API key, and get the SDK docs, a game scaffold, publishing, stats and leaderboards.
- Tools that change your games, such as creating, uploading and publishing, need a developer API key from the [Publish](https://rookiegamers.com/dev) page.
- Setup material for Claude Code (a plugin and a direct MCP setup), Codex and the xAI API, plus a command-line tool for people who prefer to work by hand. These client setups have not been verified end to end.
Exact setup steps are on the [Publish](https://rookiegamers.com/dev) page.

## What is planned
We aim to become an integrated plugin for indie game makers, reachable over MCP from AI assistants such as ChatGPT, Grok and, later, Claude. We have not verified a ChatGPT setup yet, and the client setup material above has not been verified end to end; it is a starting point, not finished app integrations.

---

# Frequently asked questions
URL: https://rookiegamers.com/faq

## Is RookieGamers free to play?
Yes. Games are free to play in the browser, with nothing to install.

## Do I need an account?
Sign up free with your RookieGamers account (13 and up) to save scores, climb the leaderboards and earn gems. One account works in every game.

## Do I need a crypto wallet?
No. Every game plays without one. Wallets are not live yet. When they arrive they will be optional, for players 18 and up, and the site says they will only unlock coin discounts and onchain games.

## Can I publish a game made with AI?
Yes. Developers who use AI are welcome.

## Can I publish a game made without AI?
Yes. Hand-made games are just as welcome.

## How do I publish?
Get a developer API key on the Publish page, add the SDK, then publish with the command-line tool or through the RookieGamers MCP server from your AI agent. The Publish page has the setup steps.

## Does RookieGamers work with ChatGPT, Grok or Claude?
The public RookieGamers MCP server is live. Setup material exists for Claude Code, Codex and the xAI API, but those client setups have not been verified end to end, and we have not verified a ChatGPT setup yet. Becoming an integrated plugin for these assistants is our goal.

## Can my game use its own login or ad code?
The SDK rules say no: the RookieGamers account is the only sign-in, and games should not include outside ad code.

---

# Publish a game
URL: https://rookiegamers.com/dev

Get a developer API key on this page, then connect the RookieGamers MCP server (https://rookiegamers.com/mcp) from Claude Code, Codex or an xAI API call, or use the command-line tool. Exact commands are on the page.

# SDK docs
URL: https://rookiegamers.com/docs

SDK v1 adds sign-in, monthly and all-time leaderboards, the Hall of Fame, gameplay events and play-next cards with one script tag. The RookieGamers account is the only sign-in, and games should not include outside ad code.

# Games
{{GAMES}}

# Hall of Fame
URL: https://rookiegamers.com/hall-of-fame

Every month, the top 3 players in every game are kept here forever. Champions wear their title in every game on RookieGamers.

RookieGamers is operated by Tenacié LLC.
`;
