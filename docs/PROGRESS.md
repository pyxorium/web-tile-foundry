# Web Tile Foundry: progress and decisions

Last updated Oct 2 2026. App code lives at `C:\thunderbird-cafe\web-tile-foundry\` (v0.3.0); delivered as web-tile-foundry.zip from the build chat.

## Decided
- Separate app, hosted at **foundry.thunderbird.cafe** (subdomain, so OAuth tokens get their own browser origin). Client ID will be `https://foundry.thunderbird.cafe/client-metadata.json`.
- **Scope:** `atproto repo:ing.dasl.masl blob:*/*` (verified against atproto.com/specs/permission). `repo:<nsid>` with no action = create, update, delete. Blob permission cannot be tied to a collection and cannot go in a permission set. Generate client-metadata.json from the same scope constant the code uses.
- **Architecture:** type-agnostic core (`src/core/`) + tile types as plugins (`src/tile-types/<id>/`) following `src/core/contract.js`. Multi-file tiles supported. `build()` is async and location-agnostic (a backend could do it later).
- **Recipe** `/foundry.json` in every tile: type, version, inputs (public, deterministic).
- **One fixed content type per file kind** (text/html, image/png, application/json, model/gltf-binary) to avoid the PDS blob-dedupe InvalidMimeType trap. On "Expected: X" errors at publish: adopt X, recompute manifest CID, retry once.
- **Manifest CID:** use `@atcute/cbor` + `@atcute/cid` (matches atile; see manifest-cid-encoding-finding.md). Still to do: golden test vs atile output for a full Foundry tile.
- **Sprite Walker:** always starts walking forward; gear (top right) offers no motion / walking forward / back and forth per visit; House Dice SoloSpriteFrame choreography; reduced-motion viewers start still. Background chosen in the Foundry (8 scenes: twilight, glitter, blockworld, dungeon, cafe, snow, beach, plain), only the chosen scene ships in the tile; card icon (256) and banner (1200x630, provisional sizes) drawn from it.
- **Novice UI:** two steps, Make your tile → Publish (plain confirmation). Title/description grouped under "For display in the link preview card", description optional. Type picker hidden while only one type. Developer views (sprite details, feed card, file table) behind `?debug`.

## Verified facts
- actor.rpg.sprite record: `spriteSheet` blob (image/png), width 144, height 192, frameWidth 48, frameHeight 48, columns 3, rows 4, frames 12, `source` → actor.rpg.generator. (Memo's `image` field name was wrong.)
- Foundry's raw CID code reproduces the live record's `bafkreidtr5ux…` address for the sample sprite.
- webtil.es link: `https://webtil.es/browser/#url=<at-uri>`. Card art from manifest `icons` / `screenshots` arrays (`{src: "/path"}`, path must be in resources).
- App runs clean on the user's Windows machine (npm test 20/20, npm run dev).

## Next
1. Preview through the real tile loader (load.tiles.thunderbird.cafe), on the user's machine.
2. Sign-in + read own sprite.
3. Manifest CID + golden test; publish a throwaway test tile; polish; blog post.
