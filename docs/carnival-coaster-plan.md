# Coaster Carnival: plan

*Written Oct 4 2026 from the planning conversation that followed `claude/carnival-coaster-type-handoff.md`. That memo is the background; this doc is the plan. Status: **approved**; stage 2 (track maths) done and pushed Oct 4 (commit `541b24c`). Stage 3 (ride lab) done and pushed Oct 4 (commit `9478b78`, 149 tests passing). Next: stage 4 (ride and controls). Later versions: see the roadmap in §12.*

**Name:** the type was renamed from "Carnival Coaster" to **Coaster Carnival** on Oct 4 2026. Older docs (and this doc's file name) keep the old name; use the new one going forward.

Items marked **To tune** are starting values to settle in the ride lab. Items marked **To confirm** need a look at existing code before building.

---

## 1. What version 1 is

A Web Tile Foundry tile type that makes a short rideable roller coaster. The creator picks a theme, sets a few sliders and gets a layout; their own sprite rides in the front row. A viewer taps the tile, the cart climbs the chain lift, runs the track and rolls back into the station, in about 25 to 40 seconds.

Type id: `coaster-carnival` (permanent once published). Title: Coaster Carnival.

---

## 2. Decisions

| Question | Decision |
|---|---|
| Name | Coaster Carnival (id `coaster-carnival`) |
| Authoring shape | Theme first (picture cards), then sliders, plus a "New layout" button |
| Themes | Three to start: daytime carnival, night lights, spooky (with scenery, see §6) |
| Sliders | Drops 1 to 3, loops 0 to 2, corkscrews 0 to 2, intensity 1 to 5 (defaults 2, 1, 1, 3). Trimmed Oct 4 from 4/3/3 because the cart runs out of energy and room beyond about 3 drops plus a loop or two and a corkscrew or two |
| Ride length | Real physics shown at **1.3× real time**, with a **40 second cap** on played time (about 52 real seconds). Chosen Oct 4 ("option 2"). Raising the cap instead ("option 1", about 50 s) stays open for later |
| Too much asked | Pieces are left out (last in riding order first) when the ride would pass the cap or the cart lacks speed or room; the result says what was left out so the panel can tell the creator |
| Track pieces | Small fixed set: climb, drop, loop, corkscrew, plus turns and straights the generator adds itself. "Tunnel" is a theme decoration, not a piece |
| Theme and layout | The theme does not affect the layout: switching themes never changes the ride |
| Versioning | The generator carries a version number from day one. Until the first publish, layouts may change while tuning (tests are re-locked on purpose); after it, version 1 is frozen |
| Camera | Behind the cart (main view), riding on the track itself so it follows the same curve. **Settled Oct 4:** 6.5 m behind, 2.6 m up, 64° view width. "Watch from outside" follows the cart like a drone. Side view (still camera, cart drawn larger) for reduced motion |
| Riders | Creator's sprite in the front row; it turns to face the camera and shows the matching pose. **Default sprite** (no rpg.actor sprite): thunderbirdwine.bsky.social's, saved at `public/coaster-carnival/default-sprite.png` (now live) |
| Track drawing | Rails and spine as tubes swept along a smooth curve, ties and supports as batched shapes |
| Sound | Made in the browser (Web Audio), no sound files. Starts on the viewer's tap; mute in the gear menu. **Tuned Oct 4**, one mix for every theme (§6) |
| Theme looks | Shared models, recolored, plus scenery drawn in code (§6) |
| Track style (idea) | **Option A, preferred:** a "Track style" choice, steel or wooden, that only changes the look and sound; every piece (loops and corkscrews included) works in both, as Son of Beast had a loop. Undecided: version 1 or a version 1.1 follow-up |
| Build codes | Not in version 1. The recipe is designed so a code can be added later |
| Layout | Full circuit back to the station (works; no fallback needed) |
| Phone touch | Taps only. Page scrolling is left alone |
| Layout number | The seed. New layouts pick from 0 to about 4.3 billion; shortening to 6 digits (for a shorter future build code) suggested, undecided. Creators won't see it in the Foundry |
| Later versions | Roadmap in §12; version 2 (boarding and discovery) detailed in §11, a big goal on the near horizon |
| Save a clip | A separate project for all tile types, after Coaster Carnival ships |

---

## 3. In and out of version 1

**In:** the track generator, three themes with scenery, the ride with the behind-the-cart camera, the reduced-motion side view, the creator's sprite (or the default) in the front row, synthesized sound with mute, the waiting view and end card, card pictures drawn at Publish, the Foundry panel with a live preview and "Test ride". The cart's other seats stay empty, ready for version 2.

**Out (later, see §12):** boarding and discovery, riding together, live discovery, bot riders, an announcer bot, build codes, a first-person camera, "Save a clip" (likely a Foundry feature for every tile type; a person posted a hand-made video of their Sprite Walker on launch day, so there's real demand; a short video may be simpler than a GIF), past builds, anything drawn from the creator's account beyond their sprite. The wooden track style may join version 1 or follow soon after (§2).

---

## 4. The creator's panel (sketch, to approve before stage 6)

1. **Theme**: picture cards (three saved pictures). Changing it asks first, then resets colors and sound to that theme's starting values.
2. **Your rider**: the creator's sprite, using Sprite Walker's sprite input. Falls back to the default sprite.
3. **Drops** 1 to 3, **Loops** 0 to 2, **Corkscrews** 0 to 2, **Intensity** 1 to 5: sliders.
4. **New layout**: button that picks a new random seed.
5. A closed group with **Start over**.

When pieces had to be left out, one plain line under the sliders says so (for example "1 corkscrew left out: the ride ran out of room").

---

## 5. The track generator (stage 2: done Oct 4)

Code: `src/tile-types/coaster-carnival/track/` (`index.js` is the entry, `generateTrack(input)`). Tests: `test/coaster-carnival-track.test.mjs` (19 tests). Drawing tool: `node lab/coaster-track-sketch.mjs` writes an SVG of four sample rides.

**Input:** drops, loops, corkscrews, intensity, seed (version filled in).
**Output:** about 1 m spaced points around the closed track, the rider's "up" at each, real speed (m/s), played time, the pieces with their times (for sound cues), what was built and left out, duration (played and real), bounds and a fingerprint. About 40 KB for a typical ride.

**How it works:**
1. *Layout:* order and size the pieces from the sliders and seed. Every piece starts and ends level. Sizes come from the expected speed, so drops, climbs and turns stay within the intensity's push, float and slope limits.
2. *Ground plan:* all turns go the same way (so the outline can't cross itself) and add up to a full circle. The turn sizes are adjusted to close the circuit as tightly as possible, then two short straights close it exactly.
3. *Ride:* even spacing, banking on turns (up to 70°), speed from height and friction, timing, felt forces.
4. *Checks:* smooth, clear of itself (3 m beside, 4.5 m above or below), inside the box, closed, never slower than 3.5 m/s, comfortable. A failed layout is replaced by the next draw from the same seed.

**Loops** are shaped point by point from the entry speed, like real teardrop loops (gentle at the bottom, tight at the top), mirrored for the way down, with a 6 m sideways shift so the way out passes beside the way in. **Corkscrews** are "heartline" rolls 1.5 m around an axis, eased in and out, sized to the speed so the sideways shove stays small.

**Starting values (To tune):** lift 22 to 36 m by intensity at 7.5 m/s; push limit 3.5 to 5 g (below 3.5 no loop is possible); framing box 300 × 200 × 50 m; station 16 m; brakes 26 m.

**Measured (played seconds):** 1 drop about 25 to 29 s; the default 2 drops, loop and corkscrew about 34 to 39 s; generation under half a second even for the largest requests.

**Determinism:** Node-tested fingerprints. As with Glass Lantern's gems, the Foundry will run the generator once and store the finished points in the tile, so tiles don't depend on a browser's floating-point details.

---

## 6. The ride (stages 3 and 4)

**Ride lab (stage 3: done, pushed Oct 4 as `9478b78`):** `lab/coaster-carnival.html` with `lab/coaster-carnival-lab.js`; ride code in `src/tile-types/coaster-carnival/ride/` (`scene.js`, `track-mesh.js`, `cart.js`, `path.js`, `themes.js`, `placement.js`, `scenery.js`, `sound.js`); tests in `test/coaster-carnival-ride.test.mjs` (7). Open with `npm run lab`, then change the address to `/lab/coaster-carnival.html`. Live sync with the phone uses the existing lab sync, tagged so the lantern lab ignores it. The panel has track sliders, theme, view, "Ride", a sprite picker for testing, sound (on/off, volume, a slider per sound layer, roar tone), behind-the-cart camera sliders and "Show settings to copy". Looks great on desktop; **phone check still to do** (stage 4).

**Scenery (built Oct 4):** all drawn in code, placed from the layout number and kept clear of the track and station, so the preview and the tile match. Every theme has a sky that fades to a lighter horizon and a distant silhouette band.
- *Daytime carnival:* rolling hills, clouds, trees of varied height, striped tents with doorways, food stands, game booths with prizes, big balloons, lamp posts, a Ferris wheel.
- *Night lights:* city skyline, stars, a moon, bulbs along the track, lit Ferris wheel, tents with lit doorways, stands, booths, lamp posts with glowing pools of light.
- *Spooky:* a softer treeline horizon (gentler ridge with scattered spires, after the first was too jagged), pale moon, low mist, bare trees of varied height, gravestones, jack-o'-lanterns, a haunted house as the landmark.
- Feedback already applied: tents were first mushroom-like pink caps (replaced by striped tents, plus stands and booths); balloons made bigger; more tree height variety.

**Sound (built and tuned Oct 4):** made in the browser, six layers each with its own lab slider that silences it fully at zero:
- *Wheel roar* (low tones plus grit; kept very quiet in the tuned mix), *track clicks* (a soft click every 3 m of track), *deep rumble*, *wind* that follows speed, *effects* (chain lift clack, a whoosh on loops, a thump at the bottom of drops, brake hiss), and the *spooky drone* (spooky only: two mistuned tones around 110 Hz, raised an octave on Oct 4 because laptop and phone speakers couldn't play the first 55 Hz version).
- The first version sounded "too whooshing, like surf" and was redesigned around roar and clicks; the corkscrew slide whistle was removed.
- **Tuned defaults, the same for every theme:** volume 0.7; mix roar 0.05, clicks 0.85, wind 0.45, rumble 1.5, effects 1, drone 0.05; roar tone pitch 0.65, brightness 0.65, rise with speed 0.25. Themes still nudge pitch slightly (night a little higher, spooky lower).

**Waiting view:** a still view of the whole track, the cart in the station, the rider in the front row, a "Tap to ride" prompt. Nothing moves or makes sound.

**The ride:** on the tap, sound starts, the camera moves behind the cart, the cart climbs the chain lift with its clack, then runs the track and rolls back into the station, at 1.3× real time.

**End card:** "Built by @handle" (the creator's own handle), "Ride again", and a soft "Make your own" pointing to the Foundry.

**Reduced motion:** no ride-along camera; the side view of the whole track with the cart moving along it.

**Riders:** seats in rows of two; the rider in the front row, a flat sprite that turns to face the camera and picks the pose to match (back, front, left, right: rows 4, 1, 2, 3 of the standard 3 × 4 sheet).

**Gear menu:** mute, reset view, switch to the side view.

**Ready for clips later:** the ride can play from the start at a fixed size without a tap.

---

## 7. Making it a tile (stage 5)

- Every Coaster Carnival tile carries a byte-identical `/coaster.js` (ride code plus three.js), bundled like Glass Lantern's `/lantern.js`; the Vite plugin is generalized to take a list of types.
- The tile page is small: the security policy, a JSON config (including the finished track points), the sprite picture, and `/coaster.js`.
- Recipe (`/foundry.json`) inputs: theme, drops, loops, corkscrews, intensity, seed, generator version, sprite reference (plus track style if the wooden option goes into version 1).
- Card pictures drawn at Publish only. Device care reused from Glass Lantern.
- No new npm packages or file types expected.

---

## 8. In the Foundry (stage 6)

- A quick 2D side drawing of the track that updates as the sliders move; generation runs in the background so sliders never stutter.
- A "Test ride" button runs the real 3D ride in the same box (only one 3D view on the page).
- Theme picture cards are saved picture files.

---

## 9. Stages

1. **Plan**: done.
2. **Track as maths**: done, pushed Oct 4 as `541b24c` (`docs/signin-storage-fix.md` was deliberately left out and stays local).
3. **Ride lab**: done, pushed Oct 4 as `9478b78` (12 files, 149 tests passing; again without `docs/signin-storage-fix.md`). Scene, cart, rider, three views, camera settled, three themes with scenery, six-layer synthesized sound tuned by ear.
4. **Ride and controls**: next. Tap to ride, the end card, the gear menu, reduced motion, Glass Lantern's phone care, and the phone check.
5. **Real tile**: shared `/coaster.js`, card pictures, real tile loader test, size and determinism tests.
6. **Into the Foundry**: the panel (sketch for approval first), preview, Test ride, saved pictures, registration.
7. **Publish**: test tiles, check on webtil.es (computer and phone) and twinkl.social, then live.

Every push goes live, so the chat says so before each one.

---

## 10. Risks and things to watch

- **Phones:** a moving 3D scene with scenery is heavier than Glass Lantern's still die; scenery is batched and glow faked, but the phone hasn't been checked yet (do it early in stage 4).
- **Queasiness:** behind-the-cart camera, smoothed roll.
- **Playback speed:** 1.3× should go unnoticed; check it feels right, and switch to a longer cap if not.
- **Generation time** in the browser: up to about half a second in Node; run it in the background in the Foundry.
- **Track footprint:** up to about 300 m across; check the waiting view frames it well in a 400 high tile.
- **Sound on phones:** small speakers drop low notes (as found with the first drone); check the tuned mix on a phone, since the rumble carries much of it.

---

## 11. Version 2: boarding and discovery (near-horizon goal, more to think through)

*Discussed Oct 4. Discoverability in Web Tiles is new ground; this is mainly a proof of concept. Version 1 ships first; version 1 leaves the cart's other seats empty for this.*

**The idea:** at the start of the ride, the station holds a lineup of about 8 sprites: the creator's own, plus mutual coaster partners, minglers and anonymous riders (and bots, labeled as bots). The viewer picks 3 or 5 to ride along (seats in rows of two); then the camera moves behind the cart and the ride begins. All front-facing in the lineup, back-facing once seated.

**How it fits Web Tiles:** a published tile cannot use the internet while being viewed (confirmed in the browser in the wish demos too), so live discovery inside a tile isn't possible today, a finding worth sharing in the Web Tiles conversation. The split:
- *In the Foundry (creator, signed in):* discover mutual coaster partners, minglers and anonymous riders; choose the lineup; bake their sprite images into the tile.
- *In the tile (viewer):* the station shows that fixed lineup; the viewer picks companions.

**Three kinds of riders, three different yeses (all opt-in, set in each person's own Coaster Carnival record):**
- *Mutual coaster partners:* both lists include each other. Coaster Carnival's own relationship, modeled on House Dice's but separate (House Dice partners are limited to that game, per its lexicon, and are not reused). Its meaning is stated from day one: coaster partners can include each other in their rides.
- *Minglers:* a flag meaning "creators can see who I am in the Foundry, find me, choose me for their lineup and invite me to partner." Social discovery, like the House Dice lounge, but a bigger yes: it includes being put in rides, and the toggle's wording must say so.
- *Anonymous riders:* a separate flag meaning "use my sprite, but keep me out of sight." Creators never see who they are, even in the Foundry; the Foundry draws a few at random to fill the lineup. A "face in the crowd" option for people happy to ride along but not to be findable (suggested by attie.ai as a way to make the anonymous group rest on consent too).
- *Founding anonymous riders:* the user's own alt accounts with sprites, setting the same anonymous-rider flag anyone can, so every lineup has riders from day one. Keep them in the anonymous pool, not among minglers (so they never look like real strangers to befriend), and say so openly in the launch blog post.
- *Bot riders:* bot accounts with their own sprites (consenting by nature), labeled as bots in the lineup, with small personalities (reactions at the lift top, drops, loops). Local characters in version 2; see §12 for later roles.
- Optional nicety: the Foundry could suggest the creator's House Dice partners as people to invite, never adding them automatically.

**Discovery mechanics (borrowed from the wish demos' discovery work, not the wish protocol itself; Coaster Carnival has no tile-to-tile wish component):**
- Opt-in record; no record means not discoverable. Ask the public atproto relay with `com.atproto.sync.listReposByCollection` for repos holding the Coaster Carnival record (as the House Dice lounge does), then read each candidate's own record with `Promise.allSettled`.
- *Strict trust rules:* accept a candidate only if the relevant flag is exactly `true`; ignore every other field. Cap the sweep (the wish demo used 25) and skip the creator's own DID.
- *Keep stranger-written text off the page:* handles at most in the Foundry, never display names or bios; nothing from strangers in the tile.
- *Check stranger-supplied images strictly before baking:* real PNG, expected size and 3 × 4 layout, under a size limit (the Foundry already checks the creator's own sprite this way).
- *Timestamp the records, and re-check flags at publish time*, not just when building the lineup.
- *Known gap:* one relay may miss people on servers indexed only by other relays (for example EuroSky); consider asking a second relay later. The user's fly.io relay is a message relay (no atproto) and doesn't help here.
- *Likely fine, to confirm:* House Dice already writes records in its own unregistered collection and finds them via `listReposByCollection`, which suggests both work; check the House Dice code before relying on it.

**Privacy and consent:**
- *No handles in the minted tile:* viewers can't tell partners, minglers and anonymous riders apart. The tile's public recipe (`/foundry.json`) must not list companions either. The creator's own "Built by @handle" credit stays. Bots are the exception: labeled.
- *Honest limit:* a sprite can still be recognized by people who know it. Tiles store files by a fingerprint of their bytes, and an unchanged sprite would share its fingerprint with the original in the owner's rpg.actor record, allowing an exact match; **re-save each companion's sprite image when baking**. Wording should promise "looks anonymous to casual viewers," not anonymity.
- *Point of no return:* once a ride is published with someone in it, unpartnering or turning a flag off later can't change that ride. Say so plainly wherever someone opts in.
- *Records are public* (partner lists and flags are readable by anyone), as in House Dice; say so in a plain line.
- *Consent receipt (open):* attie suggested recording which consent record authorized each sprite, for auditability; a public receipt naming people's records would undo the no-handles anonymity, so keep only what verifies without identifying, or skip it.

**Background on consent (Oct 4):**
- *rpg.actor:* their sprite artwork is original to their project (not from any asset pack); they've welcomed interop, said apps can call a user's sprite from their `actor.rpg.sprite` record, and invited listing on rpg.actor/experiences via the record "uses" values. Their welcome reads as clear permission for the creator's own sprite and friends who opted in. Still to ask them: baked copies (tiles copy rather than call live), and anonymous riders. A draft message was prepared in chat.
- *attie.ai's research* (`attie-consent-reuse-of-public-data-for-coaster-carniva.md` in this project): "public by design" is a contested argument in the atproto community, not a settled norm; the community is moving toward explicit, revisable, scoped preference records (Bluesky's user intents proposal, a community preferences lexicon); baked copies outlive revocation, and the closest precedent is VRChat's fight over reused avatars. Partners and minglers are on solid ground. Some specific citations in that doc (an April 2026 lexicon, GitHub issue numbers) weren't verified here.

**Open questions:**
- *Sign-in:* the Foundry's sign-in currently only allows publishing tiles; writing the Coaster Carnival record needs one more permission, a deliberate change to the sign-in setup stabilized Oct 4.
- *Who picks:* creator picks the lineup in the Foundry; viewer picks companions in the tile. Confirm when building.
- *Record names and lexicon*, under the user's own namespace.
- *rpg.actor's answer* on baked copies and anonymous riders.

**Launch blog post notes:** the three kinds of riders and the different yes each gives; why everyone looks anonymous in the tile; the finding that tiles can't go online while viewed, so discovery happens when the tile is made; the point of no return and why consent comes first; the atproto consent debate and where this design sits; the alts as founding anonymous riders, disclosed.

---

## 12. Roadmap: how each version builds on the last

Each step adds one new kind of connection: none (solo), when making (baked lineup), with a friend (invited, live), with anyone (live discovery). Each can stand alone if the next never happens.

**Version 1: Solo ride** *(in progress; stages 1 to 3 of 7 done Oct 4, roughly half the work)*
A creator sets a theme and sliders in the Foundry, gets a physically real coaster, and publishes it. Viewers tap to ride with the creator's sprite (or the default) in the front row, the behind-the-cart camera, three themes with scenery, synthesized sound and an end card. Everything later builds on this ride engine and tile.

**Alongside or soon after version 1** *(small, independent additions)*
- *Wooden track style* (Option A in §2), if it doesn't go into version 1 itself.
- *Announcer bot:* posts new rides (only for creators who opt in when publishing) with the card picture and a link to view them, so Bluesky can show them. Discoverability in its most natural form, needing nothing from version 2. Finds new rides by watching for Coaster Carnival tile records (every Foundry tile carries a public recipe). Needs a small always-on service (fly.io could host it); clearly labeled as a bot, posting only opted-in rides. A custom Bluesky feed of rides is a close cousin.
- *Save a clip:* the Foundry-wide feature for every tile type (a short video of a ride to share); the announcer could later post clips.
- *Listing on rpg.actor's experiences portal* (Coaster Carnival, and probably Sprite Walker).
- *Maybe:* shorter layout numbers, toward shareable build codes.

**Version 2: Boarding and discovery** *(near-horizon goal; §11)*
The station lineup and the cart's other seats. In the Foundry, the creator finds mutual coaster partners, minglers and anonymous riders (the user's alts first) through records in people's own repos, and bakes a lineup of about 8 into the tile, with no handles. Viewers pick 3 or 5 companions. Bots appear as labeled fill-in riders with personalities. Builds on version 1's ride, seats and sprite handling. Before starting: rpg.actor's answer and the consent wording.

**Version 3: Ride together, by invitation**
Two people on their own devices ride the same coaster at the same moment, linked by a code or link and synced through the user's fly.io relay (from the wish demos: a WebSocket message relay that pairs two connections by session number, carries tiny strictly shaped messages, keeps nothing and never touches atproto). Only a few messages are needed: seats, "start now", an occasional clock check. Needs a host page that connects to the relay (like the blog's demo pages); ordinary hosts (webtil.es, twinkl.social) won't, so the tile falls back to a solo ride. If no friend is there, ride with a bot. Must fail gracefully if the relay is down. Builds on version 2's seats and companions.

**Version 4: Live discovery**
"Who's at the station right now?" Opted-in riders show as waiting, so strangers can find each other for a live ride: atproto records say who has agreed to be found for live rides, the relay says who's present. In wish terms, a tile could wish for "someone to ride with" and the host and relay would answer it. Needs: riders proving who they are to the relay (likely via their atproto sign-in; the relay has no identity today, the "who may wish for what" question left open in the wish posts), a separate presence opt-in (being shown as online is more sensitive than being findable), and moderation basics (blocks, mutes). Possibly bots as live participants on the relay (only if it earns its keep), and a wish letting a viewer ride as themselves (a host that knows who's viewing hands the viewer's sprite into the tile). Builds on version 2's consent records and version 3's live rides.
