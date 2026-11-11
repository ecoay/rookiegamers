---
name: rookiegamers
description: Build or update a web game on the RookieGamers SDK and publish it to rookiegamers.com. Use when the user wants to make a browser game, add RookieGamers sign-in, leaderboards or "play next" to a game, or publish, update or check stats for a game on RookieGamers.
---

# Building and publishing on RookieGamers

RookieGamers is a web game portal where every game shares one player account, leaderboards, a Hall of Fame and cross-promotion. AI-built games are welcome. The `rookiegamers` MCP server gives you the docs and the publishing tools.

## Steps

1. Call `get_sdk_docs` once and follow it. Don't guess SDK calls.
2. New game: call `scaffold_game` and write the files it returns, then build the real gameplay on top. Existing game: add `<script src="https://rookiegamers.com/sdk/v1.js"></script>` and wire in the calls below.
3. Keep these wired in:
   - `await rg.init({ game: "<slug>" })` first
   - `rg.game.loaded()` once the game is playable
   - `rg.game.gameplayStart()` / `rg.game.gameplayStop()` around real play
   - `rg.scores.submit({ score })` at the end of a run, and `rg.user.login()` only if it returns `signin: true`
   - `rg.promo.showNext()` at a natural break like game over
4. Test locally: serve the folder (for example `npx serve` or `python3 -m http.server`) and open it with `?rg_test=1`. Test mode fakes a signed-in player and keeps scores in memory. Check it on a phone-sized viewport and with touch. To test real sign-in, scores and saves without touching real players, load the SDK from the staging site instead (`https://rookiegamers-staging.ecoay.workers.dev/sdk/v1.js`) and run the game on `localhost` or `127.0.0.1`; switch the script back to `https://rookiegamers.com/sdk/v1.js` before publishing.
5. Publish:
   - `create_game` (first time only) with a slug, title, blurb and tags. Pick `scoreOrder: "asc"` for times where lower is better.
   - `upload_files` with every file in the build, `encoding: "base64"` for binary files, and a new `version` each release. Split big builds across several calls.
   - `upload_cover` with a 16:9 cover image (1280 by 720 is ideal) so the game card and link previews aren't blank.
   - If the developer has a studio, `list_studios` and set `studio` with `update_game` (or `save_studio` to make one, and `upload_studio_logo` for its logo).
   - `publish_game`. If it reports problems, fix them and upload a new version. Show the user the warnings too.
6. Give the user the live URL from `publish_game`. If it answers `pending: true`, this is the developer's first game: it's in the RookieGamers review queue and goes live once approved. Tell the user that, and that later games and updates go live right away.

## Rules

- No outside ad code (AdSense, GameDistribution and the like). The portal serves ads for every game. To earn from ads, call `rg.ads.rewarded()` when the player chooses to watch for a reward (pause in `before`, resume in `after`, reward only if `rewarded` is true) and `rg.ads.midgame()` between levels, then ask for ads with the `request_ads` tool once the game is live. Show the developer the ad terms first and only pass `agree: true` once they accept. Accepting puts the game in the ad loop at once: until it passes review for paid ads it shows only other games' clips, unpaid, and its clips run in theirs. Paid ads, and the 70% share, start once it's approved.
- Sound: follow the portal's mute button. Apply `rg.audio.muted()` at start and `rg.audio.onChange(muted => ...)` to every sound (master volume). It also covers ads and hidden tabs. Don't ship a separate mute that ignores it.
- To sell things, add products with `set_product` and use `rg.store.buy(sku)`, `rg.store.unlock(sku)` (watch ads to unlock) and `rg.store.has(sku)`. Never take payments any other way: all money goes through RookieGamers, which pays the developer.
- No sign-in of its own (Google, Firebase Auth, Supabase Auth, Auth0, Clerk...). The RookieGamers account is the only login: use `rg.user.login()` and `rg.user.token()`.
- A game built on players' social accounts (playing as their X or TikTok account) turns on `socialAccounts`, reads `rg.user.get().social`, and calls `rg.user.link('x')` for a network that isn't linked. It never asks for social logins itself.
- Give players a reason to share: call `rg.share({ score })` from a button after a good run. Friends who join through it earn the player gems.
- The game must work on phones: a viewport meta tag, touch controls, and no fixed widths bigger than the screen.
- Never put a server key (`rgs_...`) or API key (`rgk_...`) in browser code.
- Games with their own server should report scores from the server. See "Games with a server" in the docs and use `create_server_key`.
- Coins are optional and off by default. Only set `coin: true` if the user asks for it.

If a tool says it needs an API key, tell the user to make one at https://rookiegamers.com/dev and set `ROOKIEGAMERS_API_KEY` before starting Claude Code.
