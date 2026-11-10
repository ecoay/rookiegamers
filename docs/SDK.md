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
- Ask for sign-in when it matters, like saving a score or claiming gems: `if (!await rg.user.get()) await rg.user.login()`.
- Never put outside ad code in a game. The portal serves ads for every game.
- The RookieGamers account is the only sign-in. Don't ship your own login or another one (Google, Firebase Auth, Supabase Auth, Auth0, Clerk, Facebook and so on). Use `rg.user.login()`, and `rg.user.token()` if your server needs to know who's playing. This holds wherever your game runs: on the portal, on your own site, or on other portals.
- Make it fit a phone screen: include `<meta name="viewport" content="width=device-width, initial-scale=1">` and handle touch as well as mouse.
- Every call returns a Promise and never throws for normal failures. Failures resolve to `{ ok: false, error }`.

## Where a game runs

- **On the portal** at `rookiegamers.com/play/<slug>`, inside a sandboxed frame. The SDK talks to the page around it with `postMessage`. Games never see a password or a portal cookie.
- **On its own site**, like `unsays.com`. The same script works there. `rg.user.login()` opens a RookieGamers sign-in popup, so both places share one account and one leaderboard. Add your site's origin to the game's `origins` list.

The SDK works out which one it's in by itself.

## Staging

Staging is a separate copy of RookieGamers at `https://rookiegamers-staging.ecoay.workers.dev`, with its own database and storage. Use it to test your game against the real API from your own computer. Nothing you do there touches real players, scores, gems or saves, and staging data can be wiped at any time.

1. Load the SDK from staging instead of rookiegamers.com: `<script src="https://rookiegamers-staging.ecoay.workers.dev/sdk/v1.js"></script>`. The SDK talks to whichever site it was loaded from.
2. Run your game on `http://localhost:<port>` or `http://127.0.0.1:<port>`. Staging accepts sign-in from any localhost port for any game, so you don't need to add localhost to your game's origins.
3. Sign in on staging with any email address. No email is sent: the sign-in link shows on the page.
4. To test inside the portal frame, open `/dev` on staging, make a developer key and create your game there. Use a linked game whose URL is your localhost address, then open `/play/<slug>` on staging. Games go live on staging straight away, with no review. Staging doesn't host files, so build and cover uploads are turned off there.

The command-line tool works against staging too: set `ROOKIEGAMERS_URL=https://rookiegamers-staging.ecoay.workers.dev` and use a key made on staging. Tokens from staging are signed by staging, so a game server that checks them should read the keys from staging's `/.well-known/jwks.json` while you test. Switch the script back to `https://rookiegamers.com/sdk/v1.js` before you ship.

Test mode (below) is still the quickest way to build with no network at all.

## Reference

### `rg.init({ game, test })`

Call first, once. `game` is your slug. `test: true` (or `?rg_test=1` in the URL) turns on **test mode**: a fake signed-in player, scores kept in memory, and a sample "play next" card, so you can build without a network or an account. Resolves to `{ ok, mode, staging }` where `mode` is `"portal"`, `"standalone"` or `"test"`, and `staging` is true when the SDK was loaded from the staging site (also on `rg.staging`; see [Staging](#staging)).

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
| `rg.scores.top({ board, limit, month, friends })` | `{ ok, rows: [{ rank, player: { id, name, title }, score }] }`. `friends: true` ranks only the player and their friends |
| `rg.scores.mine({ board })` | `{ ok, rank, score }` for the signed-in player |

`board` is `"monthly"` (default) or `"alltime"`. `month` is `"YYYY-MM"` for a past month. Scores are whole numbers. Each game sets whether higher or lower is better, and whether the board keeps each player's **best** score or adds up a **sum** of points.

Scores from the browser have limits: one submit every 5 seconds per player, and an optional maximum score set by the developer. Browser games can't be fully cheat-proof. For a game with a server, report scores from the server instead (see below).

### Cloud saves

Save a player's progress and it follows them to any device. Signed-in players save to RookieGamers; guests save in their browser, and those saves move to their account the first time they sign in.

| Call | Returns |
| --- | --- |
| `rg.data.get(key)` | The saved value, or `null` |
| `rg.data.set(key, value)` | `{ ok, cloud, version }`. `cloud` is `false` for guests |
| `rg.data.del(key)` | Same as `set(key, null)` |
| `rg.data.keys()` | Every key your game saved for this player |
| `rg.data.flush()` | Sends batched writes now |

A value is anything JSON can hold, up to 256 KB. Each game can keep up to 100 keys and 1 MB per player. Keys are 1 to 64 letters, digits, or `_ . : -`.

Save on checkpoints (a level cleared, an item bought), not every frame. Rapid `set` calls on one key are batched and only the latest value is sent, at most every 3 seconds, and anything pending is sent when the page closes.

If the player saved on another device since this one last loaded, the newer save wins: `set` resolves `{ ok: false, conflict: true, value }` with the newer value, so reload it into your game. Each game only ever sees its own saves.

```js
const save = (await rg.data.get('progress')) || { level: 1 };
// ...later, at a checkpoint
const r = await rg.data.set('progress', save);
if (r.conflict) loadProgress(r.value);
```

### Friends

Every player has one friends list across all RookieGamers games. Players send and accept requests on each other's profiles, and anyone who signs up through a player's invite link becomes their friend straight away. Your game can read the list and add friends too.

| Call | Returns |
| --- | --- |
| `rg.friends.list()` | `{ ok, friends, requests }`, or `{ ok: false, signin: true }` for guests |
| `rg.friends.add(player)` | `{ ok, state }`: `"sent"`, or `"friends"` if they had already asked |
| `rg.friends.accept(player)` | `{ ok, state: "friends" }` |
| `rg.friends.remove(player)` | `{ ok, state: "none" }`. Also declines or cancels a request |
| `rg.friends.invite()` | An invite link, same as `rg.invite.link()` |

Each friend has their public profile (`id, name, avatar, frame, level, title`), plus `plays` (whether they have played your game), `lastPlayed` and `gameLevel` (their level in your game). `requests` are players waiting for an answer. `player` is a player id or a friend object. A player can have up to 500 friends.

```js
const { friends } = await rg.friends.list();
const here = friends.filter(f => f.plays);
showFriends(here); // e.g. "3 friends play this. Challenge one?"
const board = await rg.scores.top({ friends: true });
```

### Game levels

Your game can give players its own XP and level, separate from their RookieGamers level, on the same curve (level 2 at 100 XP, level 3 at 300, level 4 at 600...). It shows on their profile and to their friends.

| Call | Returns |
| --- | --- |
| `rg.level.get()` | `{ ok, level, xp, levelXp, nextXp }` |
| `rg.level.addXp(xp)` | The same, plus `given` and `levelUp: true` when they went up a level |

`levelXp` and `nextXp` are where this level starts and the next begins, for a progress bar. Give 1 to 1,000 XP a call and up to 10,000 a day per player. A tenth of it also counts toward the player's RookieGamers level, up to 100 a day from each game.

```js
const r = await rg.level.addXp(150);
if (r.levelUp) celebrate(r.level);
```

### Hall of Fame

At the end of each month, the top 3 on every game's monthly board go into the Hall of Fame forever and earn a title shown across the portal.

`rg.fame.list()` → `{ ok, rows: [{ month, monthLabel, rank, player: { id, name }, score }] }` for your game.

### Play next

`rg.promo.showNext()` shows a "play next" card over your game with another game from the portal, picked from ones the player hasn't tried. Call it at a natural break like a round end or a game over. Resolves to `{ ok, shown, game }`. `rg.promo.next()` gives you the pick without showing anything, if you want to draw your own card; call `rg.promo.go(slug)` when the player taps it.

### Sound

The game page has a sound button, like other portals, and the player's choice is remembered. The portal can't silence another site's frame itself, so your game follows the setting:

```js
const apply = muted => { music.muted = muted; sfx.muted = muted; }; // or your engine's master volume
apply(rg.audio.muted());
rg.audio.onChange(apply);
```

| Call | Does |
| --- | --- |
| `rg.audio.muted()` | `true` while the player has muted the game, while an ad is on screen, or while the tab is hidden |
| `rg.audio.onChange(fn)` | Calls `fn(muted)` whenever that changes. Returns a function that stops listening |
| `rg.audio.set(muted)` | For your own mute button on your own site. Inside the portal, the portal's button decides |

Following `rg.audio` also covers ads: the game goes quiet when an ad opens and comes back after, with no extra code in `before` and `after`.

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

**Your first game is reviewed.** RookieGamers plays every developer's first game before it goes live. Publishing it answers `{ "live": false, "pending": true }` (HTTP 202) and the game waits in the review queue, usually a day or two. If it's approved, it goes live and so does everything after: your later games and updates go live as soon as they pass the checks. If it isn't, `GET /api/dev/games` shows `status: "rejected"` and the reason in `review.note`; fix it and publish again. Each game's `status` is `live`, `pending`, `rejected` or `draft`. While a build waits for review it can't be changed, so upload a new version if you need to fix something.

**Game studios.** Credit your games to a studio with its own name, logo, website and about text. Game pages and cards show the studio logo next to your developer name and link to the studio's page. Make one on `/dev`, through the MCP server (`save_studio`), or with the API below, then set `studio` on each game.

Ways to publish, all with the same powers:

- **AI agents:** connect Claude Code, Codex, Grok or any MCP client to `https://rookiegamers.com/mcp` with your API key. See `/dev` on the portal for one-line setup.
- **CLI:** `node rg.mjs deploy ./dist --game my-game` (download `rg.mjs` from `https://rookiegamers.com/rg.mjs`).
- **HTTP API:** below.

### Developer API

All calls take `Authorization: Bearer rgk_...` (make a key at `rookiegamers.com/dev`).

| Method and path | Does |
| --- | --- |
| `GET /api/dev/games` | Your games |
| `POST /api/dev/games` | Create a game: `{ slug, title, kind, blurb, tags, url, origins, devices, multiplayer, scoreLabel, scoreOrder, scoreMode, maxScore, cover, color, studio }` |
| `PATCH /api/dev/games/<slug>` | Change any of those fields |
| `PUT /api/dev/games/<slug>/cover` | Upload cover art (raw PNG, JPEG, WebP, GIF or AVIF body, up to 5 MB). Covers show at 16:9, so 1280 by 720 is ideal |
| `GET /api/dev/studios` | Your game studios |
| `POST /api/dev/studios` | Create or update a studio: `{ slug, name, url, bio }`. Its page is `rookiegamers.com/studio/<slug>` |
| `PUT /api/dev/studios/<slug>/logo` | Upload the studio logo (raw image body, square, up to 5 MB) |
| `DELETE /api/dev/studios/<slug>` | Delete a studio (its games go back to showing your developer name) |
| `PUT /api/dev/games/<slug>/builds/<version>/files/<path>` | Upload one file of a build (raw body) |
| `GET /api/dev/games/<slug>/builds` | Uploaded builds |
| `POST /api/dev/games/<slug>/publish` | Make a build live: `{ version }` (latest build if left out). A first game goes to review instead (202, `pending: true`) |
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
