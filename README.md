# Web Tile Foundry

Mint your own Web Tiles, and keep them in your own atproto repo.
Lives at `thunderbird-cafe\web-tile-foundry\`; served from
https://foundry.thunderbird.cafe/ (repository: pyxorium/web-tile-foundry).

**Current stage: publishing (first real tests).** Three steps:
**Sign in** with an atproto handle (with suggestions as you type, from the
community typeahead service House Dice also uses, typeahead.waow.tech); **Make your tile** (your rpg.actor sprite
is read from your account automatically; pick a background, and a title and
optional description for the link preview card, with a live preview); and
**Publish**: a plain confirmation, then the files are uploaded, one new
Web Tile record is created, and everything is read back and checked. The
success screen links to the tile's page on lexicographer.space (the open tile viewer,
which links on to appmosphe.re), offers a copyable share link
(for a Bluesky post) and the tile's copyable at:// address (for twinkl.social
home pages and other sites), and, tucked away, a copyable snippet for Astro sites
that have a WebTile component (like thunderbird.cafe). Since v0.32.0 the
success screen also has a **post box** ("Post it to Tile posts"): a few words
(at most 300 characters), and under More an alt text and a language, then
**Post to Raku** writes one `cafe.thunderbird.tile.post` record (lexicon:
pyxorium/tile-posts) to the account the tile was published to, pointing at the
tile's exact version, and reads it back; Raku's Tile posts then shows the tile
running inside the post. One post per published tile, only on that screen.
In `?debug`, a "Delete this test tile" button removes the tile just published
(only that one), and "Delete this test post" the post just made. The tile-type picker appears automatically once there is more than
one tile type.

On this computer only, add `?debug` to the address (`http://127.0.0.1:5173/?debug`;
the live site ignores it) to also see
the developer views: sprite details, a PNG picker and sample sprite (so a tile
can be made without signing in), a preview through the **real tile loader**
(`load.tiles.thunderbird.cafe`, with the tile's files held in memory, nothing
published), the feed card, and the exact files that would be published, with
their types, sizes, addresses and downloads.

## Run it

Needs Node 20 or newer.

```
npm install
npm run dev      # the Foundry at http://127.0.0.1:5173 (not "localhost": sign-in needs 127.0.0.1)
npm test         # tests (no browser or network needed)
npm run build    # static site in dist/, including oauth.json (the sign-in file)
```

Sign-in uses `@atproto/oauth-client-browser`. On this computer it runs in
atproto's localhost client mode: no hosted files, sign-ins last about a day,
and the consent screen won't show the app's name. At
`foundry.thunderbird.cafe` it uses the `oauth.json` that
`npm run build` writes from `src/auth/client-config.js`, the one place the
permission scope (`atproto repo:ing.dasl.masl repo:cafe.thunderbird.tile.post blob:*/*`)
is set: Web Tile records, tile posts and file uploads, nothing else. The app's
identity is the address `https://foundry.thunderbird.cafe/oauth.json`, which
sign-in screens show in full; changing it would sign everyone out.
Sign-ins made before v0.32.0 keep the permission they were given (without
tile posts); the post box sees that (from what the account's server granted)
and offers "Sign in again" in a small window, keeping the published screen
and the words typed.

The package versions in `package.json` (Vite 7, React 19) could not be
checked against the npm registry when this was written. If `npm install`
complains about a version, install the current ones with
`npm install vite@latest @vitejs/plugin-react@latest`.

## Hosting

The site is published to GitHub Pages by `.github/workflows/deploy.yml` on
every push to `main`: it installs exactly what `package-lock.json` lists,
runs the tests, builds, checks that `oauth.json` was generated, and
deploys `dist/`. The custom domain `foundry.thunderbird.cafe` is set in the
repository's Settings > Pages, with a DNS CNAME record `foundry` pointing to
`pyxorium.github.io`. Commit `package-lock.json` whenever dependencies change.

## How it is organised

```
src/core/          type-agnostic: the tile-type contract, file types, the
                   security policy, file addresses (CIDs), the recipe, the build step
src/tile-types/    one folder per kind of tile; registered in index.js
  sprite-walker/   the first type: your rpg.actor sprite, walking
src/auth/          sign-in: settings (the one scope) and the browser sign-in client
src/ui/            React screens (sign-in, form, previews, file list)
test/              core tests (node --test) and the sample sprite
public/            the sample sprite used by "Use the sample sprite", and
                   og-image.jpg, the link-preview picture, and the thunderbird.cafe
                   "T" icons (favicon.ico, favicon-32x32.png, icon-192.png,
                   apple-touch-icon.png); tags in index.html
```

**Adding a tile type** means adding a folder next to `sprite-walker/` that
exports an object following `src/core/contract.js`, and registering it in
`src/tile-types/index.js`. The core does not change.

## Rules built in (lessons from earlier tiles)

- **One fixed content type per kind of file** (`src/core/fileset.js`):
  `text/html`, `image/png`, `application/json`, `model/gltf-binary` and the
  others listed there (pictures including GIF and AVIF, sounds, video, CSS, SVG,
  web fonts, text). A PDS
  stores each file once and the first upload's type sticks, so the same bytes
  must never be uploaded under two types. When a zine copies a tile someone
  already published, fonts and sounds declared under another common name for
  the same kind of file (`audio/x-flac`, `audio/x-wav` and so on) are accepted
  too, and uploaded under the type the account already holds them as.
- **Zine fonts are open fonts, cut down and packed only when chosen**
  (`public/zine-fonts/`, made by `scripts/make-zine-fonts.py` from the Google
  Fonts downloads kept in an uncommitted `font-sources/` folder): each goes
  into a zine with its OFL licence.
- **Every tile carries the standard security policy** as a meta tag
  (`src/core/policy.js`); the build refuses a page without it.
- **Every tile carries a recipe** at `/foundry.json`: tile type, version and the
  inputs used. It is public, and deterministic (same inputs, same bytes).
- **Addresses are computed locally** (`src/core/cid.js`). The test suite checks
  this against the address in a live `actor.rpg.sprite` record.
- **The manifest address** (`src/core/dagcbor.js`) follows atile: `{ "$link" }`
  becomes a real CID link. Checked against the published alice-palette tile,
  both the atile-style address and the old Python-style one in its record.
- **Publishing** (`src/core/publish.js`) always creates a new record, checks
  every uploaded file's address, uses the server's reported file types,
  recovers once from "InvalidMimeType ... Expected: X", and reads everything
  back to verify it.

## Sprite Walker

- Backgrounds, chosen in the Foundry and fixed for the tile: Twilight lawn,
  Glitter profile, Block world, Dungeon floor, Café corner, Snowy night,
  Beach day, Plain colour. Only the chosen scene's code goes into the tile.
  Scenes animate gently (twinkles, clouds, torches, steam, snow, waves) and
  hold still for reduced-motion viewers. To add one, copy a file in
  `src/tile-types/sprite-walker/scenes/` and list it in `scenes/index.js`;
  a test checks every scene draws correctly on its own.
- Motions: no motion, walking forward, back and forth. Every tile starts
  walking forward; viewers can change it with the gear (top right) for that
  visit. Viewers whose system asks for reduced motion start with no motion.
- Choreography follows House Dice's `SoloSpriteFrame` exactly: walk frames
  `[0,1,2,1]` at 190 ms, sidesteps `[0,1,2,1,0]` gliding over 760 ms, with the
  same 500 / 300 / 900 / 1000 ms beats.
**Save as .tile (v0.39.0 in `?debug`; v0.40.0: every type, for signed-in makers):** on the Publish step, under Review
and publish and again under the review's buttons, "Save as .tile" downloads the finished tile (card pictures drawn) as
one file, a CARball as the tiles spec describes it: a CAR whose header is the manifest Publish would write (each `src`
the file's plain address instead of a blob reference) plus `version: 1` and empty `roots`, every file inside as a block
under the same raw sha-256 address it would have once published. Nothing is sent anywhere; the file doesn't go to the
account (`src/core/tile-file.js`, `TILE_FILE_TYPES`). Every type: each Foundry tile is self-contained (its policy lets it
reach nothing outside itself), so a tape's songs and a zine's tiles are in the file. Making a tile still needs sign-in
(signed out only with `?debug`). On the review screen the card already drawn is reused. Raku opens these files (the
button beside its address box), and so does Robin's `CARTileLoader`. Plan: `claude/tile-files-plan.md`.

- The sprite sheet is inlined in the page, so the tile works anywhere with no
  network access.
- Card art is drawn from the idle pose in the chosen background: banner
  1280×720 (the tile loader shows it in a 16:9 box) and icon 256×256 (shown at
  48×48). Checked against @dasl/tile-loader 2.0.0's renderCard.

## Not yet done

- An embed snippet for any website (not just Astro). Open questions: which
  tile server other people's sites should use (load.tiles.thunderbird.cafe, or
  a public one), and loading the tile loader from a public CDN.
