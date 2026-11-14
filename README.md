# RookieGamers

**One portal, one SDK, everyone's players.** A web game portal where every game shares one player account, one level, one Hall of Fame, and sends its players on to the next game. AI-built games are welcome, and developers can publish straight from Claude Code, Codex or Grok.

It runs on Cloudflare: one Worker, one D1 database and one R2 bucket.

## What's here

| Part | Where | What it does |
| --- | --- | --- |
| Portal pages | `src/pages.js`, `public/site.css` | Home shelf (ranked by playtime per player, new releases first), `/play/<slug>` with the game frame, boards and play-next, profiles at `/u/<id>`, `/hall-of-fame`, `/signin`, `/dev`, `/docs` |
| SDK | `public/sdk/v1.js` | The `rg` global: game events, player, leaderboards, Hall of Fame, play next, sharing and invites, plus safe stubs for saves, invites, store, guilds, ads and wallet. Works in the portal frame, on a game's own site (sign-in popup), and in test mode (`?rg_test=1`) |
| Portal bridge | `public/portal.js` | The page side of the frame: answers only its own game frame, mints a player token for that one game, opens sign-in in a popup so the game keeps its state |
| SDK API | `src/api.js` (`/api/v1`) | Events and playtime, scores (browser with limits, or a game's server with its key), boards, Hall of Fame, play next. Bearer tokens only, open to any origin |
| Growth | `src/growth.js` | Share links (`/s/<id>`, with link previews), invite links (`/?via=<player>`), referrals and gems |
| Sign-in | `src/auth.js` | Email link (Resend); Google, YouTube, Discord, X, Twitch, GitHub, Facebook, Instagram, Threads, TikTok, Reddit, Snapchat, LinkedIn and Kick over OAuth; Steam (OpenID), Telegram (login widget) and Bluesky (atproto OAuth) in `src/social-extra.js`; and any OpenID Connect provider through `OIDC_*` secrets. SceneSpot becomes the main sign-in by setting those secrets. Every sign-in method is an identity row on one player, so linking SceneSpot later keeps the account |
| Player tokens | `src/tokens.js` | ES256 JWTs (15 minutes, `aud` = game slug). Public keys at `/.well-known/jwks.json` so game servers can check them |
| Developer API | `src/dev.js` (`/api/dev`) | API keys, create and edit games, upload builds to R2, publishing checks, publish, stats, server keys |
| MCP server | `src/mcp.js` (`/mcp`), `src/oauth.js` | The developer API as MCP tools, plus the SDK docs and a starter game. One server for Claude, ChatGPT, Grok, Claude Code, Codex and any other MCP client. AI apps sign in with OAuth (`/oauth/*`); API keys still work. Store listing steps: `integrations/STORES.md` |
| CLI | `public/rg.mjs` (served at `/rg.mjs`) | `init`, `create`, `deploy`, `publish`, `games`, `stats`, `server-key`. No dependencies |
| Integrations | `integrations/`, `.claude-plugin/` | Claude Code plugin (MCP server, skill, `/rg-publish`), Codex config and `AGENTS.md`, Grok remote-MCP setup and script |
| FaultyParty | `games/faultyparty/` | A first-party hosted game kept in this repo: Vite + React, static build, deployed with `npm run deploy` there. See its README |
| Docs | `docs/SDK.md` | One source for `/docs`, the `get_sdk_docs` tool and the agent skills |

Games are either **hosted** (static files uploaded to R2, served from `GAMES_HOST`) or **linked** (the game runs on its own site, like unsays on unsays.com or a Vercel app, and the portal frames its URL).

## Set up

```sh
npm install
npx wrangler d1 create rookiegamers          # paste the id into wrangler.jsonc
npx wrangler r2 bucket create rookiegamers-games
npx wrangler deploy
```

Staging, a separate copy for developers testing games from localhost (see "Staging" in `docs/SDK.md`):

```sh
npx wrangler d1 create rookiegamers-staging          # paste the id into env.staging in wrangler.jsonc
npx wrangler r2 bucket create rookiegamers-staging-games
npm run deploy:staging
```

It needs no secrets. Social sign-in, payments and ads stay off there, and email sign-in shows the link on the page instead of sending it.

Secrets (Workers & Pages, rookiegamers, Settings, Variables and Secrets):

| Secret | For |
| --- | --- |
| `RESEND_API_KEY` | Email sign-in links. Verify `rookiegamers.com` in Resend, or change `EMAIL_FROM` |
| `ADMIN_TOKEN` | The admin API: developer invites, assigning game owners, editing any game |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Sign in with SceneSpot (or any OpenID Connect provider). Optional `OIDC_NAME` (button label, default "SceneSpot") and `OIDC_ID` (default `scenespot`). Redirect URI: `https://rookiegamers.com/auth/oidc/callback` |
| `GOOGLE_`, `DISCORD_`, `X_`, `TWITCH_`, `GITHUB_`, `FACEBOOK_`, `THREADS_`, `TIKTOK_`, `REDDIT_`, `SNAPCHAT_`, `LINKEDIN_`, `KICK_` + `CLIENT_ID` and `CLIENT_SECRET` | Sign in with, and link, that network. Each one shows up on the sign-in page and the profile once its two secrets are set. Redirect URI: `https://<portal>/auth/<network>/callback`. X needs a confidential OAuth 2.0 client. TikTok's client id is its "client key". YouTube reuses the Google keys (add the YouTube Data API and the `youtube.readonly` scope to that app) |
| `INSTAGRAM_CONFIG_ID` | Instagram sign-in through Meta's Unified Login. It uses the Facebook app's `FACEBOOK_CLIENT_ID` and `FACEBOOK_CLIENT_SECRET`, plus the ID of a Facebook Login for Business configuration with `instagram_basic`. Redirect URI: `https://<portal>/auth/instagram/callback`. Professional (Business and Creator) accounts only, and public use needs Meta app review |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_NAME` | Telegram sign-in through the login widget. In BotFather, run `/setdomain` for the bot with the portal's domain |
| `STEAM_API_KEY` (optional) | Steam sign-in works with no keys; the key adds the Steam name and avatar. Set `STEAM_LOGIN=0` to hide it |
| (none) | Bluesky sign-in needs no keys: the portal publishes its client metadata at `/auth/bluesky/client-metadata.json`. Set `BLUESKY_LOGIN=0` to hide it |
| `STRIPE_SECRET_KEY` | The store and payouts. The portal's Stripe account is the seller; turn on Connect (Express) for developer payouts |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhooks at `https://rookiegamers.com/stripe/webhook`. Send `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`, `customer.subscription.deleted`, `charge.refunded`, and `account.updated` (from connected accounts too) |
| `ADSENSE_CLIENT` | Optional. `ca-pub-...` once AdSense approves rookiegamers.com for H5 Games Ads. Without it, ads are sponsors and "play next" house ads. Also adds Google's line to /ads.txt |
| `ADS_TXT` | Optional. Extra seller lines for /ads.txt, one per line, exactly as an ad network gives them (for example `example.com, 12345, DIRECT, abc`). With neither this nor `ADSENSE_CLIENT`, /ads.txt lists no sellers |

Variables in `wrangler.jsonc`: `SITE_URL` (also the token issuer), `EMAIL_FROM`, `STRIPE_TAX` (`"1"` turns on Stripe Tax at checkout), `ADS_TEST` (`"1"` shows Google test ads), `PROMO_CPM_CENTS` (the price of promoted clips per 1000 views), `OPEN_DEVELOPERS` (`"1"` lets anyone signed in become a developer; otherwise it takes an invite), and `GAMES_HOST` once `games.rookiegamers.com` routes to this Worker. Until `GAMES_HOST` is set, hosted games are served from `/hosted/<slug>/` in an opaque-origin sandbox.

Until `rookiegamers.com` points at Cloudflare, set `SITE_URL` to the workers.dev address.

### Admin

```sh
# a developer invite (send them /dev?invite=<code>)
curl -X POST https://rookiegamers.com/api/admin/invites -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"note":"for a friend"}'
# give a seeded game to its developer (they sign in once first)
curl -X POST https://rookiegamers.com/api/admin/games/handofnine/owner -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"email":"dev@example.com"}'
# set a seeded game's URL and put it live
curl -X PATCH https://rookiegamers.com/api/admin/games/handofnine -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"url":"https://...","origins":["https://..."]}'
# feature a game at the top of the home page ({"featured": false} to stop)
curl -X PATCH https://rookiegamers.com/api/admin/games/unsays -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"featured":true}'
curl -X POST https://rookiegamers.com/api/admin/games/handofnine/publish -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{}'
# the unsays server key, for its RG_SERVER_KEY secret
curl -X POST https://rookiegamers.com/api/admin/games/unsays/server-key -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{}'
```

### The admin page

`/admin` on the site does everything below without commands: edit any game (title, blurb, tags, URL, cover upload with a crop tool, color, studio, featured), make and edit game studios (name, logo, website, about), publish or take down games, approve or reject first games, and make developer invites. It opens for the signed-in players listed in `ADMIN_PLAYERS` (comma-separated player ids, the `p...` part of `/u/p...`), set like the other secrets: `npx wrangler secret put ADMIN_PLAYERS`. The commands below still work with `ADMIN_TOKEN`.

Game studios: developers make theirs on `/dev`, and each studio gets a page at `/studio/<slug>`. The developer API has `GET /api/dev/studios`, `POST /api/dev/studios` (`{slug, name, url, bio}` creates or updates), `PUT /api/dev/studios/<slug>/logo` (raw image body), `DELETE /api/dev/studios/<slug>`, and `studio` on `PATCH /api/dev/games/<slug>`. The same routes are under `/api/admin` for any studio.

### Game review

A developer's first game waits for review. Once one of their games is approved, their later games and updates go live as soon as they pass the automatic checks. Games that were live before the queue existed, and their developers, are already approved. Publishing a game through the admin API puts it live and approves its developer.

```sh
# first games waiting for review: hosted ones come with a previewUrl that plays the waiting build,
# linked ones with their url
curl https://rookiegamers.com/api/admin/review -H "authorization: Bearer $ADMIN_TOKEN"
# approve: the game goes live and its developer is trusted from then on
curl -X POST https://rookiegamers.com/api/admin/games/sky-harvest/review -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"status":"approved"}'
# reject, with the reason the developer sees on /dev, in the CLI and through MCP
curl -X POST https://rookiegamers.com/api/admin/games/sky-harvest/review -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"status":"rejected","note":"The game never loads past the title screen."}'
```

### Ads, stores and payouts

```sh
A="authorization: Bearer $ADMIN_TOKEN"; J='content-type: application/json'
# games in the ad loop waiting for paid-ad review, then monetize one (or "rejected" with a note the developer sees, or "paused").
# A game is in the loop (showing and getting unpaid cross-promo clips) from the moment its developer accepts the terms.
curl https://rookiegamers.com/api/admin/ads/queue -H "$A"
curl -X POST https://rookiegamers.com/api/admin/games/unsays/ads/review -H "$A" -H "$J" -d '{"status":"approved"}'
# clips waiting for review, then approve one (or "rejected" with a note)
curl https://rookiegamers.com/api/admin/clips -H "$A"
curl -X POST https://rookiegamers.com/api/admin/clips/<clip id>/review -H "$A" -H "$J" -d '{"status":"approved"}'
# a sponsor: $8 per 1000 completed views, $500 budget, optionally only some games
curl -X POST https://rookiegamers.com/api/admin/campaigns -H "$A" -H "$J" -d '{"name":"Acme","headline":"Acme gaming chairs","image":"https://...","clickUrl":"https://...","cpmCents":800,"budgetCents":50000}'
# the ad network's real payout for a month, split by each game's network views (or pass rows per game)
curl -X POST https://rookiegamers.com/api/admin/ads/network -H "$A" -H "$J" -d '{"month":"2026-11","grossCents":123456}'
# what a payout run would pay, then run it (the cron does both on the 1st)
curl -X POST https://rookiegamers.com/api/admin/payouts/run -H "$A" -H "$J" -d '{"dryRun":true}'
curl https://rookiegamers.com/api/admin/money -H "$A"
```

On the 1st (the same cron as the Hall of Fame), last month's sponsor views are priced into the ledger and every developer with at least $10 cleared is paid. Games the portal owns (no owner set) are recorded in the ledger but never paid out.

Asking for ads means accepting the ad terms: with no paid ad, a game shows other games' clips unpaid, and its own clips run elsewhere free. Developers promote clips of 30 seconds or less by paying a budget through Checkout; it becomes a sponsor campaign at `PROMO_CPM_CENTS` (default 600, so $6 per 1000 completed views), and the games that show it earn 70%.

The launch games are seeded in `src/catalog.js`. unsays and BuyYourFriends start live; Hand of Nine and Glitch Homiez wait for their URLs.

FishTartTycoon and YouCult are hosted here. Each goes live with its own deploy from its repo (`dist/rookiegamers` for FishTartTycoon, `dist-rookiegamers` for YouCult):

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
- The crypto layer is 18+ and opt-in, per player and per game. The coin (Solana) is only a discount: items can be paid in cash, unlocked with ads, or bought for less in coins. Of a coin payment, 30% is burned, 30% goes to the treasury (the liquidity pool) and 40% to the developer. Games with coin off sell for cash and ads, and the developer is paid in cash. Paying in coin isn't wired up yet; this repo has the per-game switch, coin prices and the player's 18+ flag.
- No outside ad code in games. The portal serves ads for every game, once it approves the game for ads. Games in the ad program show other games' clips, unpaid, when there's no paid ad, and their clips run elsewhere the same way.
- All money goes through the portal's Stripe account. Developers get 90% of store sales (after Stripe's fee and tax, after a 30-day hold) and 70% of ad revenue, paid monthly over $10 through Stripe Connect.
- The RookieGamers account is a game's only sign-in, wherever the game runs. Publishing blocks hosted builds that ship another sign-in (Google, Firebase Auth, Supabase Auth, Auth0, Clerk and others).
- Gems reward word of mouth. A friend who signs up through a player's invite or share link and plays for 10 minutes earns that player 100 gems and earns the friend 25 (at most 20 paid referrals a day per player). Each social network a player links earns 50 gems, once. Gems are not money and never convert to coin or cash.
