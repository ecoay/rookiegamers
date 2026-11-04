# RookieGamers

**One portal, one SDK, everyone's players.** A web game portal where every game shares one player account, one level, one Hall of Fame, and sends its players on to the next game. AI-built games are welcome, and developers can publish straight from Claude Code, Codex or Grok.

It runs on Cloudflare: one Worker, one D1 database and one R2 bucket.

## What's here

| Part | Where | What it does |
| --- | --- | --- |
| Portal pages | `src/pages.js`, `public/site.css` | Home shelf (ranked by playtime per player, new releases first), `/play/<slug>` with the game frame, boards and play-next, profiles at `/u/<id>`, `/hall-of-fame`, `/signin`, `/dev`, `/docs` |
| SDK | `public/sdk/v1.js` | The `rg` global: game events, player, leaderboards, Hall of Fame, play next, plus safe stubs for saves, invites, store, guilds, ads and wallet. Works in the portal frame, on a game's own site (sign-in popup), and in test mode (`?rg_test=1`) |
| Portal bridge | `public/portal.js` | The page side of the frame: answers only its own game frame, mints a player token for that one game, opens sign-in in a popup so the game keeps its state |
| SDK API | `src/api.js` (`/api/v1`) | Events and playtime, scores (browser with limits, or a game's server with its key), boards, Hall of Fame, play next. Bearer tokens only, open to any origin |
| Sign-in | `src/auth.js` | Email link (Resend) now, and any OpenID Connect provider through `OIDC_*` secrets. SceneSpot becomes the main sign-in by setting those secrets. Every sign-in method is an identity row on one player, so linking SceneSpot later keeps the account |
| Player tokens | `src/tokens.js` | ES256 JWTs (15 minutes, `aud` = game slug). Public keys at `/.well-known/jwks.json` so game servers can check them |
| Developer API | `src/dev.js` (`/api/dev`) | API keys, create and edit games, upload builds to R2, publishing checks, publish, stats, server keys |
| MCP server | `src/mcp.js` (`/mcp`) | The developer API as MCP tools, plus the SDK docs and a starter game. One server for Claude Code, Codex, Grok and any other MCP client |
| CLI | `public/rg.mjs` (served at `/rg.mjs`) | `init`, `create`, `deploy`, `publish`, `games`, `stats`, `server-key`. No dependencies |
| Integrations | `integrations/`, `.claude-plugin/` | Claude Code plugin (MCP server, skill, `/rg-publish`), Codex config and `AGENTS.md`, Grok remote-MCP setup and script |
| Docs | `docs/SDK.md` | One source for `/docs`, the `get_sdk_docs` tool and the agent skills |

Games are either **hosted** (static files uploaded to R2, served from `GAMES_HOST`) or **linked** (the game runs on its own site, like unsays on unsays.com or a Vercel app, and the portal frames its URL).

## Set up

```sh
npm install
npx wrangler d1 create rookiegamers          # paste the id into wrangler.jsonc
npx wrangler r2 bucket create rookiegamers-games
npx wrangler deploy
```

Secrets (Workers & Pages, rookiegamers, Settings, Variables and Secrets):

| Secret | For |
| --- | --- |
| `RESEND_API_KEY` | Email sign-in links. Verify `rookiegamers.com` in Resend, or change `EMAIL_FROM` |
| `ADMIN_TOKEN` | The admin API: developer invites, assigning game owners, editing any game |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Sign in with SceneSpot (or any OpenID Connect provider). Optional `OIDC_NAME` (button label, default "SceneSpot") and `OIDC_ID` (default `scenespot`). Redirect URI: `https://rookiegamers.com/auth/oidc/callback` |

Variables in `wrangler.jsonc`: `SITE_URL` (also the token issuer), `EMAIL_FROM`, `OPEN_DEVELOPERS` (`"1"` lets anyone signed in become a developer; otherwise it takes an invite), and `GAMES_HOST` once `games.rookiegamers.com` routes to this Worker. Until `GAMES_HOST` is set, hosted games are served from `/hosted/<slug>/` in an opaque-origin sandbox.

Until `rookiegamers.com` points at Cloudflare, set `SITE_URL` to the workers.dev address.

### Admin

```sh
# a developer invite (send them /dev?invite=<code>)
curl -X POST https://rookiegamers.com/api/admin/invites -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"note":"for a friend"}'
# give a seeded game to its developer (they sign in once first)
curl -X POST https://rookiegamers.com/api/admin/games/handofnine/owner -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"email":"dev@example.com"}'
# set a seeded game's URL and put it live
curl -X PATCH https://rookiegamers.com/api/admin/games/handofnine -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"url":"https://...","origins":["https://..."]}'
curl -X POST https://rookiegamers.com/api/admin/games/handofnine/publish -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{}'
# the unsays server key, for its RG_SERVER_KEY secret
curl -X POST https://rookiegamers.com/api/admin/games/unsays/server-key -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{}'
```

The launch games are seeded in `src/catalog.js`. unsays and BuyYourFriends start live; Hand of Nine, YouCult and Glitch Homiez wait for their URLs.

FishTartTycoon is hosted here. Its build goes live with its own deploy, from the fish-tart-tycoon repo:

```sh
curl -X POST https://rookiegamers.com/api/admin/games/fishtarttycoon/owner -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"email":"dev@example.com"}'
python3 build.py
ROOKIEGAMERS_API_KEY=rgk_... node rg.mjs deploy dist/rookiegamers --game fishtarttycoon
```

## Develop

```sh
printf 'DEV_LOGIN=1\nADMIN_TOKEN=dev\nSITE_URL=http://localhost:8787\n' > .dev.vars
npm run dev     # http://localhost:8787. With DEV_LOGIN=1 the sign-in page shows the link instead of emailing it
npm test
```

Use `localhost`, not `127.0.0.1`, in the browser: the SDK only trusts messages from `SITE_URL`'s origin.

## Rules

- Accounts are 13 and up. Younger players play as guests.
- The crypto layer is 18+ and opt-in, per player and per game. The coin (Solana) is only a discount: items can be paid in cash, unlocked with ads, or bought for less in coins. Of a coin payment, 30% is burned, 30% goes to the treasury (the liquidity pool) and 40% to the developer. Games with coin off sell for cash and ads, and the developer is paid in cash. The store lands in phase 3; this repo has the per-game switch and the player's 18+ flag.
- No outside ad code in games. The portal serves ads for every game.
