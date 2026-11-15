// Sign-in settings: the ONE place the Foundry's permission scope is written.
//
// Both ways of signing in are built from these values, so they can never
// disagree (House Dice once broke sign-in when two copies of a scope drifted):
//   - development, on your own machine: atproto's "localhost client" mode.
//     The client ID is http://localhost?redirect_uri=...&scope=..., and the
//     sign-in server builds the app's details from it; nothing is hosted.
//   - production, at foundry.thunderbird.cafe: oauth.json, which is generated
//     from productionClientMetadata() when the site is built (see vite.config.js).
//     Its address IS the app's identity, and sign-in screens show it in full
//     (https://foundry.thunderbird.cafe/oauth.json), so it is kept short.
//     Changing it later would sign everyone out.
//
// Scope, checked against https://atproto.com/specs/permission (Oct 2 2026):
//   atproto               required for every atproto sign-in
//   repo:ing.dasl.masl    create, update and delete Web Tile records only
//   repo:cafe.thunderbird.tile.post
//                         tile posts (v0.32.0): the Post step on the published
//                         screen. Sign-ins made before v0.32.0 lack it; the
//                         post box asks those to sign in again (src/core/tile-post.js, canPost)
//   blob:*/*              upload files (blob permission can't be tied to a collection)
//   repo:cafe.thunderbird.audio.track
//                         songs kept on the PDS (v0.35.0, Mixtape Burndown's
//                         importer, pyxorium.com only). DECLARED in oauth.json
//                         and the development client ID, but only ASKED FOR
//                         when the importer signs that account in again
//                         (IMPORT_SCOPE). Every ordinary sign-in passes SCOPE
//                         itself (src/auth/auth.js), so nobody else is asked
//                         anything new. A sign-in server only requires that what
//                         a sign-in asks for is declared (checked in atproto's
//                         oauth-client and oauth-provider, Nov 14:
//                         claude/mixtape-v2-plan.md R3-A8).
//
// No browser-only code here, so Node (tests, the build) can import it too.

/** What every ordinary sign-in asks for. */
export const SCOPE = "atproto repo:ing.dasl.masl repo:cafe.thunderbird.tile.post blob:*/*";
/** The importer's songs (lexicon: pyxorium/audio-tracks). */
export const TRACK_COLLECTION = "cafe.thunderbird.audio.track";
/** What the importer's "Sign in again to allow importing" asks for. */
export const IMPORT_SCOPE = `${SCOPE} repo:${TRACK_COLLECTION}`;
/** Everything the Foundry may ever ask for: oauth.json and the development client ID. */
export const DECLARED_SCOPE = IMPORT_SCOPE;
export const APP_NAME = "Web Tile Foundry";
export const PRODUCTION_ORIGIN = "https://foundry.thunderbird.cafe";
export const CLIENT_METADATA_FILE = "oauth.json";

// Same handle resolver as House Dice. Known privacy trade-off: it tells
// Bluesky which handle is signing in. A self-hosted resolver is the upgrade.
export const HANDLE_RESOLVER = "https://bsky.social";

export function productionClientMetadata() {
  return {
    client_id: `${PRODUCTION_ORIGIN}/${CLIENT_METADATA_FILE}`,
    client_name: APP_NAME,
    client_uri: `${PRODUCTION_ORIGIN}/`,
    redirect_uris: [`${PRODUCTION_ORIGIN}/`],
    scope: DECLARED_SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "web",
    dpop_bound_access_tokens: true,
  };
}

/** True when the page runs on this computer (development). */
export function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost";
}

/** The development client ID, carrying the return address and the scope. */
export function loopbackClientId(redirectUri) {
  const q = new URLSearchParams();
  q.append("redirect_uri", redirectUri);
  q.append("scope", DECLARED_SCOPE);
  return `http://localhost?${q.toString()}`;
}

/**
 * The details a sign-in server derives from a development client ID, written
 * out in full (used if the sign-in library needs them spelled out).
 */
export function loopbackClientMetadata(redirectUri) {
  return {
    client_id: loopbackClientId(redirectUri),
    redirect_uris: [redirectUri],
    scope: DECLARED_SCOPE,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: "native",
    dpop_bound_access_tokens: true,
  };
}
