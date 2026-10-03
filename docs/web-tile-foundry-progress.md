# Web Tile Foundry: progress and decisions

Last updated Oct 2 2026 (evening). App code lives at `C:\thunderbird-cafe\web-tile-foundry\` (**v0.8.3, live**), and on GitHub at **pyxorium/web-tile-foundry** (public, no licence). Delivered as web-tile-foundry.zip from the build chat.

## Status
- **Foundry LIVE at https://foundry.thunderbird.cafe/** (GitHub Pages, deployed by `.github/workflows/deploy.yml` on every push to main). v0.8.3 confirmed live by the user, typeahead working. Sign-in, publish, share and delete verified (on v0.8.1).
- **Blog post PUBLISHED** Oct 2 2026: https://thunderbird.cafe/blog/web-tile-foundry (`src/content/blog/web-tile-foundry.mdx`, cover `src/assets/web-tile-foundry-cover.jpg`). Web page confirmed good by the user.

## Blog post (done)
- Title "The Web Tile Foundry: Mint your own Web Tiles". `pubDate: '2026-10-02T20:00:00'`: a time was added because the Cosmic Junkyard post has the same date and same-day posts sorted in arbitrary order. Use a time whenever two posts share a day.
- Sequoia record: `at://did:plc:6vxjigxrqizmbo56gojxico3/site.standard.document/3mwwkptwny32r`; Bluesky post `.../app.bsky.feed.post/3mwwkpumuvb2n`. Cleanup patch run and verified: textContent starts "Until now, every Web Tile on this site was made by hand", no import line or tags.
- Known cosmetic glitch (atproto copy only): `clean_mdx_for_atproto.mjs` treats asterisks inside inline code as emphasis, so `blob:*/*` became `blob:/:`. Website is correct. Fix in the cleaner if it matters later.
- Structure: Part 1 for novices (steps as bold lead-ins, not ### headings, which render too large in the blog theme); Part 2 builders' lessons; Part 3 Berjon quotes; Further reading (user's links merged: DASL spec, Berjon essay, webtil.es, @dasl/tiles, Twinkl AGENTS.md).
- Unconfirmed: whether the Sequoia bookkeeping commit (`.sequoia-state.json` + the post's atUri) was pushed. If `git status` in pyxorium.github.io shows them modified, commit them before the next Sequoia run.

## App passwords: lesson from Oct 2
- All thunderbird.cafe app passwords were deleted Oct 2 after one was exposed (typed inside the Read-Host quotes). A **new app password** is needed for the next Sequoia publish, cleanup patch or screenshot script.
- Instruction that works: `$env:BSKY_APP_PASSWORD = Read-Host "App password"`, leaving the quoted label alone, then typing (or right-click pasting) the password at the `App password:` prompt. Check with `$env:BSKY_APP_PASSWORD.Length` (19). The SecureString one-liner caused trouble; in the VS Code terminal Ctrl+V at the prompt types `^V` (use right-click or Ctrl+Shift+V). Plain Windows PowerShell worked. Never show example prompt text (like `PS C:\...>`) in instructions: it gets pasted as a command.

## Changes since v0.8.1
- **v0.8.2:** success screen shows the tile's at:// address with "Copy address" directly under the share link.
- **v0.8.3:** handle **typeahead at sign-in** (`src/ui/HandleTypeahead.jsx`), suggestions from `typeahead.waow.tech` (`X-Client: foundry.thunderbird.cafe`), 150 ms debounce, 2+ characters, avatar + @handle + display name, keyboard and mouse. Suggestions only; sign-in still uses normal resolution and OAuth. Trade-off noted in the README. Tests 43/43.

## Hosting
- Repo pyxorium/web-tile-foundry; Settings > Pages > Source = GitHub Actions; custom domain foundry.thunderbird.cafe; HTTPS enforced.
- DNS is at **Wix**: CNAME `foundry` → `pyxorium.github.io`.
- Workflow: npm ci → npm test → npm run build → check dist/oauth.json → deploy.
- `@atproto/oauth-client-browser` pinned at 0.5.8. Commit package-lock.json whenever dependencies change.
- User commits from VS Code or PowerShell, ONE LINE AT A TIME. LF→CRLF warnings are harmless. Zips are copied OVER the folder (keeping node_modules and package-lock.json).

## Sign-in identity
- **client_id: `https://foundry.thunderbird.cafe/oauth.json`** (changing it would sign everyone out).
- Sign-in servers show the full client_id URL; name/logo only for trusted clients.
- Sign-in step text (user's wording): "Signing in allows **foundry.thunderbird.cafe** to publish Web Tile changes to your repo. The Foundry doesn't touch your posts, likes, follows or anything else."

## Decided
- **Scope:** `atproto repo:ing.dasl.masl blob:*/*`, set ONLY in `src/auth/client-config.js`.
- **Sign-in:** locally atproto localhost client mode (http://127.0.0.1:5173). Handle resolver bsky.social.
- **`?debug` works only on the user's computer.**
- **Architecture:** type-agnostic core (`src/core/`) + tile types as plugins (`src/tile-types/<id>/`) following `src/core/contract.js`.
- **Recipe** `/foundry.json` in every tile. One fixed content type per file kind. Own DAG-CBOR encoder (atile-style).
- **Record shape:** `{ $type: "ing.dasl.masl", cid, tile: { name, description?, icons, screenshots, resources: { "/", "/icon.png", "/banner.png", "/foundry.json" } }, createdAt }`.
- **Card art:** banner 1280×720 (16:9 box), icon 256×256 (shown at 48×48).
- **Sprite Walker:** starts walking forward; gear: no motion / walking forward / back and forth; 8 backgrounds chosen in the Foundry.
- **Tagline:** "Mint your own Web Tiles, and keep them in your own atproto repo."
- **Success screen:** View on webtil.es; Make another tile; Share it (link); tile address with Copy address; collapsed Astro snippet.
- **Any-website embed snippet: SKIPPED.**

## Verified facts
- actor.rpg.sprite record: `spriteSheet` blob, 144x192, frames 48x48, 3 columns x 4 rows.
- Raw CID and DAG-CBOR code reproduce known live addresses.
- webtil.es link: `https://webtil.es/browser/#url=<at-uri>`.
- thunderbird.cafe PDS: fibercap.us-west.host.bsky.network.
- Embed tile used in the blog: `at://did:plc:joer5rzmwgec3dkr4srfmq45/ing.dasl.masl/3mwwhkjfvfq2o` ("Thunderbirdwine Sprite").

## Next (ideas, nothing pending)
- A second tile type (the picker appears automatically).
- Fix the asterisk handling in clean_mdx_for_atproto.mjs.
- Make a new app password when next needed.
