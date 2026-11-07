# RookieGamers SDK v1

RookieGamers is a web game portal where every game shares one player account, one level, one Hall of Fame, and sends its players on to other games. AI-built games are welcome. Games are judged on whether they're fun, not on how they were made.

Add one script tag and you get sign-in, leaderboards, the Hall of Fame and cross-promotion.

```html
<script src="https://rookiegamers.com/sdk/v1.js"></script>
<script>
  (async () => {
    await rg.init({ game: "my-game" });     // your game's slug
    const me = await rg.user.get();         // null for guests
    rg.game.loaded();                        // call once assets are ready

    // when a round starts and ends:
    rg.game.gameplayStart();
    rg.game.gameplayStop();
    await rg.scores.submit({ score: 212 });
    rg.promo.showNext();                     // "play next" card at a natural break
  })();
</script>
```

## Rules of thumb

- Call `rg.game.loaded()` once, when the game can be played. Publishing checks look for it.
- Wrap real play in `gameplayStart()` / `gameplayStop()`. The portal uses this to count playtime and XP.
- Guests can always play. Only ask for sign-in when it matters, like saving a score: `if (!await rg.user.get()) await rg.user.login()`.
- Never put outside ad code in a game. The portal serves ads for every game.
- The RookieGamers account is the only sign-in. Don't ship your own login or another one (Google, Firebase Auth, Supabase Auth, Auth0, Clerk, Facebook and so on). Use `rg.user.login()`, and `rg.user.token()` if your server needs to know who's playing. This holds wherever your game runs: on the portal, on your own site, or on other portals.
- Make it fit a phone screen: include `<meta name="viewport" content="width=device-width, initial-scale=1">` and handle touch as well as mouse.
- Every call returns a Promise and never throws for normal failures. Failures resolve to `{ ok: false, error }`.

## Where a game runs

- **On the portal** at `rookiegamers.com/play/<slug>`, inside a sandboxed frame. The SDK talks to the page around it with `postMessage`. Games never see a password or a portal cookie.
- **On its own site**, like `unsays.com`. The same script works there. `rg.user.login()` opens a RookieGamers sign-in popup, so both places share one account and one leaderboard. Add your site's origin to the game's `origins` list.

The SDK works out which one it's in by itself.

## Reference

### `rg.init({ game, test })`

Call first, once. `game` is your slug. `test: true` (or `?rg_test=1` in the URL) turns on **test mode**: a fake signed-in player, scores kept in memory, and a sample "play next" card, so you can build without a network or an account. Resolves to `{ ok, mode }` where `mode` is `"portal"`, `"standalone"` or `"test"`.

### Game events

| Call | When |
| --- | --- |
| `rg.game.loaded()` | Once, when the game can be played |
| `rg.game.gameplayStart()` | A round, level or match begins |
| `rg.game.gameplayStop()` | It ends, pauses, or a menu opens |

### Player

| Call | Returns |
| --- | --- |
| `rg.user.get()` | `{ id, name, avatar, level, xp, title, guild, adult }` or `null` for guests |
| `rg.user.login()` | Opens sign-in. Resolves to the player, or `null` if they closed it |
| `rg.user.token()` | A signed player token (JWT, 15 minutes) for your game's server, or `null` |
| `rg.user.onChange(fn)` | Calls `fn(player)` whenever the player signs in or out |

`avatar` is an image URL. `title` is a Hall of Fame title the player wears in every game, like "unsays champion · Oct 2026". Show it next to their name if you can.

### Leaderboards

Every game has a monthly board and an all-time board.

| Call | Returns |
| --- | --- |
| `rg.scores.submit({ score })` | `{ ok, best, rank }`, or `{ ok: false, signin: true }` for guests |
| `rg.scores.top({ board, limit, month })` | `{ ok, rows: [{ rank, player: { id, name, title }, score }] }` |
| `rg.scores.mine({ board })` | `{ ok, rank, score }` for the signed-in player |

`board` is `"monthly"` (default) or `"alltime"`. `month` is `"YYYY-MM"` for a past month. Scores are whole numbers. Each game sets whether higher or lower is better, and whether the board keeps each player's **best** score or adds up a **sum** of points.

Scores from the browser have limits: one submit every 5 seconds per player, and an optional maximum score set by the developer. Browser games can't be fully cheat-proof. For a game with a server, report scores from the server instead (see below).

### Hall of Fame

At the end of each month, the top 3 on every game's monthly board go into the Hall of Fame forever and earn a title shown across the portal.

`rg.fame.list()` → `{ ok, rows: [{ month, monthLabel, rank, player: { id, name }, score }] }` for your game.

### Play next

`rg.promo.showNext()` shows a "play next" card over your game with another game from the portal, picked from ones the player hasn't tried. Call it at a natural break like a round end or a game over. Resolves to `{ ok, shown, game }`. `rg.promo.next()` gives you the pick without showing anything, if you want to draw your own card; call `rg.promo.go(slug)` when the player taps it.

### Sharing and invites

| Call | What it does |
| --- | --- |
| `rg.share({ score, text, room })` | Opens a share sheet with a link to your game: X, WhatsApp, Facebook, Reddit, Telegram, email, copy, and the phone's own share menu. Resolves to `{ ok, url, credited, shared }` |
| `rg.invite.link({ room })` | Just the link, for your own invite button. Resolves to `{ ok, url, credited }` |
| `rg.invite.room()` | The room from an invite link the player opened, or `null`. Use it to drop them into their friend's match |

Everything is optional. `score` makes the message and the link preview a challenge ("Sam got 12,400 in Rock Dodge. Can you beat it?"). `text` replaces the message. `room` rides along on the link for multiplayer invites. Call `rg.share()` from a button the player pressed, so the browser allows the share menu.

When the player is signed in, the link credits them. A friend who signs up through it and plays for 10 minutes earns the sharer 100 gems and earns the friend 25. Players also earn 50 gems for each social account they link. Gems are a reward currency on RookieGamers, not money. Your game's stats show its share links, the visits they brought and the sign-ups.

### Ads

The portal serves every ad. Your game only says when there's a good moment. Join the ad loop on a live game (from `/dev`, `POST /api/dev/games/<slug>/ads`, or the `request_ads` tool) by accepting the ad terms. Your game is in the loop right away: ads start showing, filled with clips of other RookieGamers games, unpaid, while your clips run in theirs. Meanwhile RookieGamers reviews the game for paid ads. Once it's approved (monetized), sponsor and network ads fill in too, and you keep 70% of ad revenue. Before a game joins the loop, these calls resolve right away with `{ shown: false }`, so you can wire them in from day one.

| Call | Does |
| --- | --- |
| `rg.ads.available()` | `{ rewarded, midgame }`: which formats this game can show now |
| `rg.ads.rewarded({ before, after })` | A rewarded ad the player chose to watch. Resolves to `{ shown, rewarded, receipt }`. Give the reward only when `rewarded` is true |
| `rg.ads.midgame({ before, after })` | A short ad at a natural break, like between levels. At most one every 3 minutes per player. Resolves to `{ shown }` |

`before` and `after` are called just before the ad covers the game and just after it's gone: mute and pause there. Rewarded ads last about 15 seconds and the player can close them early (no reward). `receipt` is a signed token (ES256, the same keys as player tokens, with `use: "receipt"`, `kind: "ad"` and `aud` your slug), so a game server can check a reward was really earned.

Ads come from sponsors RookieGamers sells, promoted clips from other developers, an ad network on portal pages, and, when none of those has an ad, clips of other RookieGamers games. Never add ad code of your own.

#### The ad terms and game clips

Joining the ad loop means accepting the ad terms (`{ "agree": true }`):

- Your game is in the loop as soon as you accept. Until it passes review for paid ads, it shows only other games' clips, unpaid, and your clips run in theirs.
- Once approved for paid ads, you keep 70% of what paid ads in your game earn.
- When there's no paid ad, your game shows clips of other RookieGamers games. Neither side is paid for these.
- Your own approved clips run in other games the same way, for free. Games that have shown more clips than theirs got are shown more, so the swap stays fair.
- Games in the loop also get a clip banner on their page: the free rotation, and once monetized, promoted clips first.

Once you're in the loop, upload gameplay clips: MP4, 30 to 60 seconds, up to 25 MB, up to 5 per game. RookieGamers reviews each one. Rewarded ads use clips of 30 seconds or less and play to the end. Midgame ads can use any clip and can be skipped after 5 seconds.

A clip of 30 seconds or less can be **promoted**: pay a budget ($20 to $5,000) through RookieGamers' checkout and it runs as a paid ad in other games, ahead of the free rotation, until the budget is spent. The games that show it earn their 70% like any other paid ad.

### Store

Each game has its own store: items players keep and monthly passes. You set the products and prices (from `/dev`, `PUT /api/dev/games/<slug>/products/<sku>`, or the `set_product` tool). Each product can be:

- **bought for cash** through RookieGamers' checkout. You keep 90% after Stripe's fee and any sales tax;
- **unlocked by watching ads**, a number of rewarded ads you choose (passes unlocked this way last `adDays` days);
- **bought for less in RookieGamers coin**, if the game has coin on (coming soon).

| Call | Does |
| --- | --- |
| `rg.store.items()` | `{ items, owned }`. Each item has `sku`, `title`, `kind` (`"item"` or `"pass"`), `priceCents`, `adUnlock`, `adProgress`, `coinPriceCents` and `owned` |
| `rg.store.owned()` | `[{ sku, source, expiresAt }]` for the signed-in player, `[]` for guests |
| `rg.store.has(sku)` | `true` if the player owns it now |
| `rg.store.buy(sku)` | Signs the player in if needed and opens checkout in a new window. Resolves to `{ bought, sku }` once paid, or `bought: false` if they closed it |
| `rg.store.unlock(sku)` | Plays one rewarded ad toward the item. Resolves to `{ rewarded, progress, needed, unlocked }` |

The portal keeps track of what each player owns, on every device. A game's server can ask too:

```http
GET https://rookiegamers.com/api/v1/store/<slug>/entitlements?player=<player id>
Authorization: Bearer rgs_...your server key...
```

### Coming later

These exist so you can wire them in now. Until they launch they resolve harmlessly.

| Module | Calls | Until launch |
| --- | --- | --- |
| Cloud saves | `rg.data.get(key)`, `rg.data.set(key, value)` | Uses `localStorage` |
| Guilds | `rg.guild.mine()`, `rg.guild.board()` | `null` and `[]` |
| Wallet (18+, opt-in) | `rg.wallet.get()` | `null`. Never needed to play |

## Games with a server

If your game has a server (multiplayer, or anything that decides scores), let the server report them so nobody can post a fake score from the browser console.

1. In the browser, get a token and send it to your server: `const t = await rg.user.token()`.
2. On the server, check it against the portal's public keys at `https://rookiegamers.com/.well-known/jwks.json` (ES256). Check `iss` is `https://rookiegamers.com`, `aud` is your slug, and `exp` hasn't passed. `sub` is the player id.
3. Report the score with your game's server key (make one with `rg keys server <slug>` or the `create_server_key` tool):

```http
POST https://rookiegamers.com/api/v1/scores
Authorization: Bearer rgs_...your server key...
Content-Type: application/json

{ "game": "my-game", "player": "<sub from the token>", "score": 212 }
```

Server-reported scores skip the browser limits. A `sum` board only takes server scores.

## Publishing

There are two kinds of game:

- **Hosted:** upload a folder of static files (an `index.html` at the root plus everything it loads). The portal serves it and frames it on `/play/<slug>`.
- **Linked:** the game runs on your own site. Give its URL and origins. This is how games with their own servers work.

Publishing runs quick checks first: an `index.html` exists, it loads the SDK, it has a viewport tag, it carries no outside ad code, and it has no sign-in of its own. Problems block publishing; warnings don't.

Ways to publish, all with the same powers:

- **AI agents:** connect Claude Code, Codex, Grok or any MCP client to `https://rookiegamers.com/mcp` with your API key. See `/dev` on the portal for one-line setup.
- **CLI:** `node rg.mjs deploy ./dist --game my-game` (download `rg.mjs` from `https://rookiegamers.com/rg.mjs`).
- **HTTP API:** below.

### Developer API

All calls take `Authorization: Bearer rgk_...` (make a key at `rookiegamers.com/dev`).

| Method and path | Does |
| --- | --- |
| `GET /api/dev/games` | Your games |
| `POST /api/dev/games` | Create a game: `{ slug, title, kind, blurb, tags, url, origins, devices, multiplayer, scoreLabel, scoreOrder, scoreMode, maxScore }` |
| `PATCH /api/dev/games/<slug>` | Change any of those fields |
| `PUT /api/dev/games/<slug>/builds/<version>/files/<path>` | Upload one file of a build (raw body) |
| `GET /api/dev/games/<slug>/builds` | Uploaded builds |
| `POST /api/dev/games/<slug>/publish` | Make a build live: `{ version }` (latest build if left out) |
| `POST /api/dev/games/<slug>/unpublish` | Take the game down |
| `POST /api/dev/games/<slug>/server-key` | Make a new server key (shown once) |
| `GET /api/dev/games/<slug>/stats` | Plays, playtime, returning players, which games sent players, top scores |
| `PUT /api/dev/games/<slug>/products/<sku>` | Add or change a product: `{ title, blurb, kind, priceCents, adUnlock, adDays, active }` |
| `GET /api/dev/games/<slug>/products` | The game's products |
| `DELETE /api/dev/games/<slug>/products/<sku>` | Remove a product (switched off instead if anyone owns it) |
| `POST /api/dev/games/<slug>/ads` | Join the ad loop and ask for paid ads, accepting the ad terms: `{ agree: true, formats: ["rewarded", "midgame"] }`. `GET` shows the status (`inLoop`, `monetized`) and any review note |
| `PUT /api/dev/games/<slug>/clips?title=<name>` | Upload a clip (raw MP4 body, 30 to 60 seconds) |
| `GET /api/dev/games/<slug>/clips` | Your clips, their review status, promotions, and the cross-promo counts for the last 30 days |
| `DELETE /api/dev/games/<slug>/clips/<id>` | Remove a clip (ends its promotion) |
| `POST /api/dev/games/<slug>/promote` | Promote an approved clip of 30 seconds or less: `{ clip, budgetCents }`. Returns a checkout `url` |
| `GET /api/dev/games/<slug>/money` | Store sales, ad revenue, refunds and your share by month |
| `GET /api/dev/payouts` | Your balance (ready, clearing, paid) and payout history |
| `POST /api/dev/payouts/connect` | A link to set up (or finish) your Stripe account for payouts |

## Getting paid

All money goes through RookieGamers, and RookieGamers pays you:

- **Store:** 90% of each sale after Stripe's fee and any sales tax. It clears 30 days after the sale, so refunds can come out first. A refund takes the same share back.
- **Ads:** 70% of what the ads in your game earned, credited each month once the month's numbers are in.
- **Payouts:** on the 1st of each month, by Stripe transfer, once you have at least $10 cleared. Connect your Stripe account from `/dev` first. Stripe handles your ID and tax forms.

## Coins (optional)

The RookieGamers coin runs on Solana. It's a discount, nothing else: there's no gambling and no prizes paid in coins. Each developer chooses per game:

- **Coin off (the default):** the store sells for cash or ads. The portal collects the money and pays the developer their cash share (see Getting paid). No crypto anywhere.
- **Coin on:** players can also pay a lower price in coins. Of every coin payment, 30% is burned, 30% goes to the treasury (the coin's liquidity pool), and 40% goes to the developer's Solana wallet.

Turn it on with `{ "coin": true, "payoutWallet": "<Solana address>" }` when you create or update the game.

## Accounts and age

Accounts are for players 13 and up. Younger visitors play as guests with no sign-in. Anything involving the crypto layer is 18+ and opt-in: a player never needs a wallet to play, and `rg.user.get().adult` tells you if they've confirmed they're 18+.
