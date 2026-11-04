# Building and publishing on RookieGamers

RookieGamers is a web game portal where every game shares one player account, leaderboards, a Hall of Fame and cross-promotion. AI-built games are welcome. The `rookiegamers` MCP server gives you the docs and the publishing tools.

## Steps

1. Call the `get_sdk_docs` tool on the `rookiegamers` MCP server once and follow it. Don't guess SDK calls.
2. New game: call `scaffold_game` and write the files it returns, then build the real gameplay on top. Existing game: add `<script src="https://rookiegamers.com/sdk/v1.js"></script>` and wire in the calls below.
3. Keep these wired in:
   - `await rg.init({ game: "<slug>" })` first
   - `rg.game.loaded()` once the game is playable
   - `rg.game.gameplayStart()` / `rg.game.gameplayStop()` around real play
   - `rg.scores.submit({ score })` at the end of a run, and `rg.user.login()` only if it returns `signin: true`
   - `rg.promo.showNext()` at a natural break like game over
4. Test locally: serve the folder (for example `npx serve` or `python3 -m http.server`) and open it with `?rg_test=1`. Test mode fakes a signed-in player and keeps scores in memory. Check it on a phone-sized viewport and with touch.
5. Publish:
   - `create_game` (first time only) with a slug, title, blurb and tags. Pick `scoreOrder: "asc"` for times where lower is better.
   - `upload_files` with every file in the build, `encoding: "base64"` for binary files, and a new `version` each release. Split big builds across several calls.
   - `publish_game`. If it reports problems, fix them and upload a new version. Show the user the warnings too.
6. Give the user the live URL from `publish_game`.

## Rules

- No outside ad code (AdSense, GameDistribution and the like). The portal serves ads for every game.
- No sign-in of its own (Google, Firebase Auth, Supabase Auth, Auth0, Clerk...). The RookieGamers account is the only login: use `rg.user.login()` and `rg.user.token()`.
- Give players a reason to share: call `rg.share({ score })` from a button after a good run. Friends who join through it earn the player gems.
- The game must work on phones: a viewport meta tag, touch controls, and no fixed widths bigger than the screen.
- Never put a server key (`rgs_...`) or API key (`rgk_...`) in browser code.
- Games with their own server should report scores from the server. See "Games with a server" in the docs and use `create_server_key`.
- Coins are optional and off by default. Only set `coin: true` if the user asks for it.

If a tool says it needs an API key, tell the user to make one at https://rookiegamers.com/dev and set `ROOKIEGAMERS_API_KEY` before starting Codex.
