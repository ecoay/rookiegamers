import * as dev from './dev.js';
import { frontPage, topScores } from './play.js';
import { getGame, monthKey } from './db.js';
import { starterFiles } from './template.js';
import * as money from './money.js';
import SDK_DOCS from '../docs/SDK.md';
import { tokenPlayer, resourceMetadataURL } from './oauth.js';

// A Model Context Protocol server (Streamable HTTP, stateless JSON responses) at /mcp. Claude, ChatGPT,
// Grok, Claude Code, Codex and any other MCP client connect with OAuth (src/oauth.js) or a developer
// API key and get the same powers as the developer API: read the SDK docs, scaffold a game, upload
// it, publish it, and watch it. A request with no valid token gets a 401 that points at the OAuth
// metadata, which is how the app stores' connectors start sign-in.

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_UPLOAD_CALL = 20 * 1024 * 1024;

const INSTRUCTIONS = `RookieGamers is a web game portal. Every game shares one player account, leaderboards, a Hall of Fame and "play next" cross-promotion through the RookieGamers SDK (one script tag, global \`rg\`). AI-built games are welcome.
Typical flow: get_sdk_docs, then scaffold_game (or add the SDK to an existing game), test locally with ?rg_test=1, then create_game, upload_files and publish_game. Publishing checks the build for index.html, the SDK, a viewport tag, no outside ad code and no sign-in of its own (the RookieGamers account is the only login). A developer's first game then waits for review by RookieGamers (publish_game answers pending: true); once one is approved, later games and updates go live right after the checks. list_my_games shows each game's status: live, pending, rejected (with the reason in review.note) or draft.`;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const SLUG = str('The game\'s slug: lowercase letters, numbers and dashes, like "sky-harvest".');
const GAME_FIELDS = {
  title: str('Display name.'),
  blurb: str('One or two sentences for the game card (up to 280 characters).'),
  tags: { type: 'array', items: { type: 'string' }, description: 'Up to 8 short tags, like "puzzle" or "multiplayer".' },
  kind: { type: 'string', enum: ['hosted', 'linked'], description: '"hosted": upload static files to the portal. "linked": the game runs on its own site (give url and origins).' },
  url: str('Linked games only: the https URL the portal frames.'),
  origins: { type: 'array', items: { type: 'string' }, description: 'Linked games: every origin the game runs on, like "https://mygame.com".' },
  devices: { type: 'string', enum: ['mobile', 'desktop', 'both'] },
  multiplayer: { type: 'boolean' },
  color: str('Accent color as #rrggbb.'),
  cover: str('Cover image: an https URL, or a path inside the hosted build like "cover.png".'),
  scoreLabel: str('What the score is called on boards, like "Points" or "Seconds".'),
  scoreOrder: { type: 'string', enum: ['desc', 'asc'], description: '"desc": higher is better (default). "asc": lower is better, like a race time.' },
  scoreMode: { type: 'string', enum: ['best', 'sum'], description: '"best": keep each player\'s best (default). "sum": add up points; only the game\'s server can report.' },
  maxScore: { type: 'number', description: 'Optional cap on scores sent from the browser.' },
  coin: { type: 'boolean', description: 'Opt this game into the RookieGamers coin (Solana) as a discounted way to pay. Off by default.' },
  wallet: { type: 'string', enum: ['none', 'optional', 'required'], description: 'How the game uses crypto wallets. "none" (default for most games), "optional" (wallet unlocks extras), or "required" (an onchain game, listed in the Web3 Arcade, 18+ players only).' },
  payoutWallet: str('Solana address that receives the developer\'s 40% of coin payments.'),
};

const TOOLS = [
  { name: 'get_sdk_docs', description: 'Get the RookieGamers SDK and publishing reference (markdown). Read this before writing game code.', inputSchema: { type: 'object', properties: {} },
    run: async () => SDK_DOCS },
  { name: 'scaffold_game', description: 'Get the files of a small, complete starter game already wired to the SDK. Write them to disk, then change the gameplay.',
    inputSchema: { type: 'object', properties: { slug: SLUG, title: str('Display name.') }, required: ['slug'] },
    run: async (a, ctx) => ({ files: starterFiles({ slug: a.slug, title: a.title || a.slug, portal: ctx.site }), next: 'Write these files, open index.html?rg_test=1 to test, then create_game, upload_files and publish_game.' }) },
  { name: 'list_portal_games', description: 'List the games live on RookieGamers, with playtime stats.', inputSchema: { type: 'object', properties: {} },
    run: async (a, ctx) => (await frontPage(ctx.DB)).map(g => ({ slug: g.slug, title: g.title, developer: g.developer, tags: g.tags, url: `${ctx.site}/play/${g.slug}`, isNew: g.isNew, plays30d: g.stats.plays })) },
  { name: 'leaderboard', description: 'Show a game\'s leaderboard.',
    inputSchema: { type: 'object', properties: { slug: SLUG, board: { type: 'string', enum: ['monthly', 'alltime'] } }, required: ['slug'] },
    run: async (a, ctx) => {
      const g = await getGame(ctx.DB, a.slug);
      if (!g) throw new dev.DevError(404, `There's no game called "${a.slug}".`);
      return topScores(ctx.DB, g, a.board === 'alltime' ? 'all' : monthKey(), 20);
    } },
  { name: 'list_my_games', description: 'List your games, with whether each is live and its current version.', inputSchema: { type: 'object', properties: {} },
    run: (a, ctx) => dev.myGames(ctx.DB, ctx.pid) },
  { name: 'create_game', description: 'Create a new game listing. It stays unpublished until publish_game.',
    inputSchema: { type: 'object', properties: { slug: SLUG, ...GAME_FIELDS }, required: ['slug', 'title'] },
    run: (a, ctx) => dev.createGame(ctx.DB, ctx.pid, a) },
  { name: 'update_game', description: 'Change a game\'s listing fields.',
    inputSchema: { type: 'object', properties: { slug: SLUG, ...GAME_FIELDS }, required: ['slug'] },
    run: (a, ctx) => { const { slug, ...rest } = a; return dev.updateGame(ctx.DB, ctx.pid, slug, rest); } },
  { name: 'upload_files', description: 'Upload files into a build version of a hosted game. Call as many times as needed for the same version (up to 20 MB per call), then publish_game. Use encoding "base64" for images, audio and other binary files.',
    inputSchema: { type: 'object', required: ['slug', 'version', 'files'], properties: {
      slug: SLUG, version: str('Build version, like "1.0.0". Use a new one for each release.'),
      files: { type: 'array', items: { type: 'object', required: ['path', 'content'], properties: {
        path: str('Path inside the build, like "index.html" or "assets/hero.png".'), content: str('File contents.'),
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Default utf8.' } } } } } },
    run: async (a, ctx) => {
      const files = [].concat(a.files || []);
      if (!files.length) throw new dev.DevError(400, 'Pass at least one file.');
      const bodies = files.map(f => f.encoding === 'base64' ? Uint8Array.from(atob(String(f.content)), ch => ch.charCodeAt(0)) : new TextEncoder().encode(String(f.content)));
      const total = bodies.reduce((n, b) => n + b.byteLength, 0);
      if (total > MAX_UPLOAD_CALL) throw new dev.DevError(413, 'That\'s over 20 MB in one call. Split it across several upload_files calls.');
      const out = [];
      for (let i = 0; i < files.length; i++) out.push(await dev.putFile(ctx.DB, ctx.env, ctx.pid, a.slug, String(a.version), String(files[i].path), bodies[i], bodies[i].byteLength));
      return { uploaded: out.length, bytes: total, files: out.map(f => f.path), next: `When every file is up, call publish_game with slug "${a.slug}" and version "${a.version}".` };
    } },
  { name: 'publish_game', description: 'Run the publishing checks and make a build live at rookiegamers.com/play/<slug>. Linked games skip the build checks. A developer\'s first game goes to the review queue instead (pending: true) and goes live when RookieGamers approves it; later games and updates go live right away.',
    inputSchema: { type: 'object', properties: { slug: SLUG, version: str('Hosted games: the build to publish. Defaults to the latest upload.') }, required: ['slug'] },
    run: (a, ctx) => dev.publish(ctx.DB, ctx.env, ctx.pid, a.slug, a.version) },
  { name: 'unpublish_game', description: 'Take a game off the portal. Its boards and Hall of Fame are kept.',
    inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] }, run: (a, ctx) => dev.unpublish(ctx.DB, ctx.pid, a.slug) },
  { name: 'list_builds', description: 'List a game\'s uploaded builds.', inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] },
    run: (a, ctx) => dev.listBuilds(ctx.DB, ctx.pid, a.slug) },
  { name: 'game_stats', description: 'Plays, playtime, returning players, which games sent players over, and top scores for the last 30 days.',
    inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] }, run: (a, ctx) => dev.stats(ctx.DB, ctx.pid, a.slug) },
  { name: 'create_server_key', description: 'Make a new secret key for the game\'s own server to report trusted scores (replaces the old one, shown once). Never put it in browser code.',
    inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] }, run: async (a, ctx) => ({ key: await dev.rotateServerKey(ctx.DB, ctx.pid, a.slug), docs: `${ctx.site}/docs#games-with-a-server` }) },
  { name: 'set_product', description: 'Add or change a product in the game\'s store: a one-time item or a monthly pass. Give a cash price in cents (sold through RookieGamers\' Stripe; you keep 90% after fees and tax), a number of rewarded ads that unlocks it, or both. In the game, sell it with rg.store.buy(sku), unlock it with rg.store.unlock(sku), and check it with rg.store.has(sku).',
    inputSchema: { type: 'object', required: ['slug', 'sku', 'title'], properties: { slug: SLUG, sku: str('Product id, like "skin.gold" or "season-pass".'), title: str('Name players see.'), blurb: str('One line about it.'),
      kind: { type: 'string', enum: ['item', 'pass'], description: '"item": bought once, kept for good. "pass": renews monthly.' }, priceCents: { type: 'number', description: 'Cash price in US cents (99 to 50000). Leave out for ads-only.' },
      adUnlock: { type: 'number', description: 'Rewarded ads that unlock it (0 to 20). Needs the game in the ad loop.' }, adDays: { type: 'number', description: 'Passes only: days an ad unlock lasts (default 1).' },
      active: { type: 'boolean' } } },
    run: async (a, ctx) => { const g = await myGame(ctx, a.slug); const { slug, sku, ...rest } = a; return money.putProduct(ctx.DB, g, sku, rest); } },
  { name: 'list_products', description: 'List the products in a game\'s store.', inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] },
    run: async (a, ctx) => money.listProducts(ctx.DB, await myGame(ctx, a.slug), { all: true }) },
  { name: 'request_ads', description: 'Put a live game in the RookieGamers ad loop and ask for paid ads. As soon as the developer accepts the ad terms, rg.ads.rewarded() and rg.ads.midgame() start showing other RookieGamers games\' clips, unpaid, and the developer\'s own clips run in other games the same way. RookieGamers then reviews the game for paid ads; once approved (monetized), sponsor and network ads fill in too and the developer keeps 70% of paid ad revenue. Show the developer these terms and pass agree: true only once they accept. Also shows the current status.',
    inputSchema: { type: 'object', properties: { slug: SLUG, agree: { type: 'boolean', description: 'The developer accepts the ad terms (see the description). Ask them first.' }, formats: { type: 'array', items: { type: 'string', enum: ['rewarded', 'midgame'] } } }, required: ['slug'] },
    run: async (a, ctx) => money.requestAds(ctx.DB, await myGame(ctx, a.slug), a) },
  { name: 'game_money', description: 'Store sales, ad revenue, refunds and your share by month for one game, plus ad views and sales in the last 30 days.',
    inputSchema: { type: 'object', properties: { slug: SLUG }, required: ['slug'] }, run: async (a, ctx) => money.gameMoney(ctx.DB, (await myGame(ctx, a.slug)).slug) },
  { name: 'payout_status', description: 'Your balance (ready, clearing, paid) and whether Stripe payouts are set up.', inputSchema: { type: 'object', properties: {} },
    run: async (a, ctx) => ({ ...(await money.payoutStatus(ctx.DB, ctx.pid)), setup: `${ctx.site}/dev/payouts/connect` }) },
];

// Titles and behaviour hints for every tool. The Claude and ChatGPT directories require them: read-only
// tools run without asking, destructive ones always ask the developer first.
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = (o = {}) => ({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, ...o });
const META = {
  get_sdk_docs: ['Read the SDK docs', READ],
  scaffold_game: ['Get a starter game', READ],
  list_portal_games: ['List portal games', READ],
  leaderboard: ['Show a leaderboard', READ],
  list_my_games: ['List my games', READ],
  create_game: ['Create a game listing', WRITE()],
  update_game: ['Update a game listing', WRITE({ idempotentHint: true })],
  upload_files: ['Upload build files', WRITE({ idempotentHint: true })],
  publish_game: ['Publish a game', WRITE({ idempotentHint: true, openWorldHint: true })],
  unpublish_game: ['Unpublish a game', WRITE({ destructiveHint: true, idempotentHint: true })],
  list_builds: ['List builds', READ],
  game_stats: ['Show game stats', READ],
  create_server_key: ['Replace the server key', WRITE({ destructiveHint: true })],
  set_product: ['Set a store product', WRITE({ idempotentHint: true })],
  list_products: ['List store products', READ],
  request_ads: ['Join the ad loop', WRITE({ destructiveHint: true, idempotentHint: true })],
  game_money: ['Show game earnings', READ],
  payout_status: ['Show payout status', READ],
};
for (const t of TOOLS) {
  const [title, annotations] = META[t.name] || [];
  if (!title) throw new Error(`mcp: tool ${t.name} needs a title and annotations`);
  t.title = title;
  t.annotations = { title, ...annotations };
}

async function myGame(ctx, slug) {
  const g = await getGame(ctx.DB, String(slug || ''));
  if (!g) throw new dev.DevError(404, `There's no game called "${slug}".`);
  if (g.owner_id !== ctx.pid) throw new dev.DevError(403, 'That game belongs to another developer.');
  return g;
}

const rpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const reply = (body, status = 200, extra = {}) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

async function handle(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
  const isNote = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case 'initialize': {
      const want = msg.params?.protocolVersion;
      return rpc(msg.id, {
        protocolVersion: PROTOCOLS.includes(want) ? want : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rookiegamers', title: 'RookieGamers', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping': return rpc(msg.id, {});
    case 'tools/list':
      return rpc(msg.id, { tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });
    case 'tools/call': {
      const tool = TOOLS.find(t => t.name === msg.params?.name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${msg.params?.name}`);
      try {
        const out = await tool.run(msg.params?.arguments || {}, ctx);
        return rpc(msg.id, { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] });
      } catch (e) {
        if (e instanceof dev.DevError || e instanceof money.MoneyError) return rpc(msg.id, { isError: true, content: [{ type: 'text', text: e.message }] });
        console.error('mcp tool', tool.name, e);
        return rpc(msg.id, { isError: true, content: [{ type: 'text', text: 'Something went wrong on RookieGamers. Try again.' }] });
      }
    }
    default:
      if (isNote) return null; // notifications/initialized and friends need no answer
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function mcp(req, env, DB, site) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'access-control-expose-headers': 'www-authenticate, mcp-session-id' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // Stateless server: no server-to-client stream, no sessions to end.
  if (req.method !== 'POST') return reply(rpcError(null, -32000, 'POST JSON-RPC messages to this endpoint.'), 405, { allow: 'POST', ...cors });
  let body;
  try { body = await req.json(); } catch { return reply(rpcError(null, -32700, 'Parse error'), 400, cors); }
  const pid = await dev.keyPlayer(DB, req) || await tokenPlayer(DB, req);
  if (!pid) {
    // RFC 9728: tell the client where the OAuth metadata is, so it can sign the developer in.
    const sent = !!req.headers.get('authorization');
    const challenge = `Bearer resource_metadata="${resourceMetadataURL(site)}", scope="games"${sent ? ', error="invalid_token", error_description="The token is wrong or expired"' : ''}`;
    return reply(rpcError(Array.isArray(body) ? null : body?.id, -32001, `Sign in to RookieGamers to use this server. AI apps do this for you with OAuth; for a key instead, make one at ${site}/dev and send "Authorization: Bearer rgk_...".`), 401,
      { ...cors, 'www-authenticate': challenge, 'access-control-expose-headers': 'www-authenticate' });
  }
  const ctx = { env, DB, site, pid };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(m => handle(m, ctx)))).filter(Boolean);
    return out.length ? reply(out, 200, cors) : new Response(null, { status: 202, headers: cors });
  }
  const out = await handle(body, ctx);
  return out ? reply(out, 200, cors) : new Response(null, { status: 202, headers: cors });
}

export const TOOL_NAMES = TOOLS.map(t => t.name);
