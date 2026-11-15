# FaultyParty

Choose five friends. Give them a terrible situation. Find out which one makes it worse.

FaultyParty is a RookieGamers hosted game. It has no server of its own: the whole thing is a static
build the portal serves in its game frame.

- **A party is its link.** The scenario, version, seed, five X handles and who assembled it ride on
  the RookieGamers share link as the room (`bunker-1-0xkpxd-ecoay-a-b-c-d`, up to 120 characters).
  Opening the link replays the same roles, punchlines and line-up (`src/game/party.ts`).
- **The card is drawn in the browser.** `src/render.ts` builds the card SVG (`src/game/card.ts`),
  inlines the fonts and the art it uses, and draws it onto a 2400x1350 canvas.
- **Everyone is cardboard.** Cast members are YouCult's cardboard followers
  (`src/game/youcult-cutout.ts`, a port of `paintArtCutout`), seeded by X handle, with the grey
  "NPC" print. The "Still an NPC?" upgrade is a disabled teaser for now.
- **Sharing goes through the SDK.** `rg.share()` and `rg.invite.link()` make the link; "Post it on
  X" opens an X post that mentions all five.

## Develop

```sh
npm install
npm run dev          # http://localhost:5173/?rg_test=1 plays it in SDK test mode
npm test
```

## Deploy

Needs `ROOKIEGAMERS_API_KEY` for the `ecoay` developer account. The `faultyparty` listing is seeded by
the portal (`src/catalog.js`), so there's nothing to create first.

```sh
npm run deploy       # builds to dist-rookiegamers/ and uploads it with public/rg.mjs
```

## Art

`public/npc` (YouCult parts and rigs) and `public/bg` (the artist's scenario backgrounds, cut down to
1600x900 JPG) are generated. To refresh them:

```sh
python3 scripts/prepare-assets.py --youcult ../../../youcult --backgrounds path/to/bg_pngs
```
