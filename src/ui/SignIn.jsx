import { useState } from "react";

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
          <input
            id="handle"
            className="text"
            placeholder="yourname.bsky.social"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck="false"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={starting || account.busy}
          />
          <button type="submit" className="btn" disabled={starting || account.busy || !handle.trim()}>
            {account.busy ? "Opening sign-in…" : "Sign in"}
          </button>
        </div>
      </form>
      {account.error && <p className="field-error" role="alert">{account.error}</p>}
      <p className="fineprint">
        Signing in lets the Foundry add, change or remove Web Tiles in your account, and upload
        their files. It can't touch your posts, likes, follows or anything else.
      </p>
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
