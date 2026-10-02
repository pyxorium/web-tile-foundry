import { isLoopbackHost } from "../auth/client-config.js";

// Adding ?debug to the Foundry's address shows developer views (sprite details,
// a PNG picker, the real tile loader preview, the feed card, the exact files
// that would be published, and "Delete this test tile"). The choice survives
// the trip to the account's sign-in page and back, for this browser tab only.
//
// Only on this computer (127.0.0.1): on the live site, ?debug is ignored.

const KEY = "foundry:debug";

export function debugAllowedOn(hostname) {
  return isLoopbackHost(hostname);
}

function readDebug() {
  if (typeof location === "undefined" || !debugAllowedOn(location.hostname)) return false;
  const asked = new URLSearchParams(location.search).has("debug");
  const returningFromSignIn = /[?#&](code|error|iss)=/.test(location.search + location.hash);
  try {
    if (asked) sessionStorage.setItem(KEY, "1");
    else if (!returningFromSignIn) sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return asked;
  }
}

export const DEBUG = readDebug();
