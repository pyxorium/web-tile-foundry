// Adding ?debug to the Foundry's address shows developer views (sprite details,
// a PNG picker, the real tile loader preview, the feed card, and the exact
// files that would be published). The choice survives the trip to the
// account's sign-in page and back, for this browser tab only.

const KEY = "foundry:debug";

function readDebug() {
  if (typeof location === "undefined") return false;
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
