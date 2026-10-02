import { useState } from "react";
import { isLoopbackHost } from "../auth/client-config.js";
import { HandleTypeahead } from "./HandleTypeahead.jsx";

// What the account's approval screen will name the app: the live site's
// address, or "localhost" for the copy running on this computer.
function appAddress() {
  if (typeof location === "undefined") return "foundry.thunderbird.cafe";
  return isLoopbackHost(location.hostname) ? "localhost (your test copy)" : location.hostname;
}

// Signing in with an atproto handle, and the "signed in as" bar.

export function SignIn({ account, onSignIn }) {
  const [handle, setHandle] = useState("");
  const starting = account.status === "starting";

  function submit(e) {
    e.preventDefault();
    onSignIn(handle);
  }

  return (
    <div className="signin">
      <form className="signin-form" onSubmit={submit}>
        <label className="field-label" htmlFor="handle">Your atproto handle</label>
        <div className="signin-row">
          <HandleTypeahead
            id="handle"
            placeholder="yourname.bsky.social"
            value={handle}
            onChange={setHandle}
            onPick={setHandle}
            disabled={starting || account.busy}
          />
          <button type="submit" className="btn" disabled={starting || account.busy || !handle.trim()}>
            {account.busy ? "Opening sign-in…" : "Sign in"}
          </button>
        </div>
      </form>
      {account.error && <p className="field-error" role="alert">{account.error}</p>}
      <div className="heads-up">
        <p>
          Signing in allows <strong>{appAddress()}</strong> to publish Web Tile changes to your repo.
          The Foundry doesn't touch your posts, likes, follows or anything else.
        </p>
      </div>
      <p className="fineprint">
        No atproto account yet? One way to get one is <a href="https://bsky.app/" target="_blank" rel="noopener">Bluesky</a>.
        Your character sprite comes from <a href="https://rpg.actor/" target="_blank" rel="noopener">rpg.actor</a>.
      </p>
    </div>
  );
}

export function AccountBar({ account, onSignOut }) {
  return (
    <div className="account-bar">
      <span>
        Signed in as <strong>{account.handle ? `@${account.handle}` : "…"}</strong>
      </span>
      <button type="button" className="linklike" onClick={onSignOut}>Sign out</button>
    </div>
  );
}
