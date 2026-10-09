import { useState } from "react";
import { isLoopbackHost } from "../auth/client-config.js";
import { HandleTypeahead } from "./HandleTypeahead.jsx";
import { accountName } from "../auth/accounts.js";

// What the account's approval screen will name the app: the live site's
// address, or "localhost" for the copy running on this computer.
function appAddress() {
  if (typeof location === "undefined") return "foundry.thunderbird.cafe";
  return isLoopbackHost(location.hostname) ? "localhost (your test copy)" : location.hostname;
}

// The page's own address, to paste into another browser (without anything a
// returning sign-in left in it).
function pageLink() {
  return `${location.origin}${location.pathname}`;
}

// "Copy link", for when sign-in must be done in another browser. The clipboard
// may be blocked inside other apps, so it falls back to the old copy command,
// and then to showing the link to copy by hand.
function CopyLinkButton() {
  const [state, setState] = useState("idle"); // idle | copied | manual
  async function copy() {
    const link = pageLink();
    try {
      await navigator.clipboard.writeText(link);
      setState("copied");
      return;
    } catch {
      /* try the older way */
    }
    try {
      const area = document.createElement("textarea");
      area.value = link;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) {
        setState("copied");
        return;
      }
    } catch {
      /* show it instead */
    }
    setState("manual");
  }
  return (
    <div className="copy-link">
      <button type="button" className="btn btn-quiet btn-small" onClick={copy}>
        {state === "copied" ? "Link copied" : "Copy link"}
      </button>
      {state === "manual" && (
        <p className="field-help">
          Copy this link: <span className="mono" style={{ userSelect: "all" }}>{pageLink()}</span>
        </p>
      )}
    </div>
  );
}

// Signing in with an atproto handle, and the "signed in as" bar.

export function SignIn({ account, onSignIn, accounts = [], onSwitch }) {
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
      {account.errorKind === "storage" && <CopyLinkButton />}
      {accounts.length > 0 && onSwitch && (
        <div className="known-accounts">
          <p className="field-help">Or carry on with an account already signed in on this browser:</p>
          <div className="button-row">
            {accounts.map((a) => (
              <button key={a.did} type="button" className="btn btn-quiet btn-small" disabled={starting || account.busy} onClick={() => onSwitch(a.did)}>
                {accountName(a)}
              </button>
            ))}
          </div>
        </div>
      )}
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

// The "signed in as" bar. With more than one account signed in on this browser,
// a menu picks the one tiles are published to; "Add another account" signs in
// to one more in a small window, so the tile being made here is kept.
export function AccountBar({ account, accounts = [], adding = { state: "idle" }, onSignOut, onSwitch, onAdd, onCancelAdd }) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const waiting = adding.state === "waiting";
  const others = accounts.filter((a) => a.did !== account.did);
  const current = account.handle ? `@${account.handle}` : account.lookupError ? account.did : "…";

  // Closes the form once an account has been added (the one in use changes).
  const [shownFor, setShownFor] = useState(account.did);
  if (shownFor !== account.did) {
    setShownFor(account.did);
    setOpen(false);
    setHandle("");
  }

  function submit(e) {
    e.preventDefault();
    if (onAdd) onAdd(handle); // opens the sign-in window: must stay inside this submit
  }

  return (
    <div className="account-bar-wrap">
      <div className="account-bar">
        <span className="account-current">
          {others.length ? (
            <label>
              Signed in as{" "}
              <select
                className="account-pick"
                value={account.did}
                disabled={account.busy || waiting}
                onChange={(e) => onSwitch && onSwitch(e.target.value)}
                aria-label="Account to publish to"
              >
                {accounts.map((a) => (
                  <option key={a.did} value={a.did}>{a.did === account.did ? current : accountName(a)}</option>
                ))}
              </select>
            </label>
          ) : (
            <>Signed in as <strong>{current}</strong></>
          )}
        </span>
        <span className="account-actions">
          {onAdd && !open && (
            <button type="button" className="linklike" onClick={() => setOpen(true)} disabled={account.busy}>Add another account</button>
          )}
          <button type="button" className="linklike" onClick={onSignOut} disabled={account.busy || waiting}>Sign out</button>
        </span>
      </div>
      {others.length > 0 && <p className="account-note">New tiles are published to the account chosen here.</p>}
      {account.error && <p className="field-error account-note" role="alert">{account.error}</p>}
      {open && (
        <form className="account-add" onSubmit={submit}>
          <label className="field-label" htmlFor="add-handle">Another account's handle</label>
          <div className="signin-row">
            <HandleTypeahead
              id="add-handle"
              placeholder="another.name"
              value={handle}
              onChange={setHandle}
              onPick={setHandle}
              disabled={waiting}
            />
            <button type="submit" className="btn" disabled={waiting || !handle.trim()}>
              {waiting ? "Waiting…" : "Add"}
            </button>
          </div>
          {waiting ? (
            <p className="field-help">
              Finish signing in in the window that opened.{" "}
              <button type="button" className="linklike" onClick={onCancelAdd}>Cancel</button>
            </p>
          ) : (
            <p className="field-help">
              A small sign-in window opens; what you're making here stays as it is. The new account becomes the one
              you publish to, and you can switch back at any time.{" "}
              <button type="button" className="linklike" onClick={() => { setOpen(false); if (onCancelAdd) onCancelAdd(); }}>Close</button>
            </p>
          )}
          {adding.state === "error" && <p className="field-error" role="alert">{adding.message}</p>}
        </form>
      )}
    </div>
  );
}

/** Shown inside the small sign-in window once it has done its job. */
export function SignInWindowDone() {
  return (
    <div className="signin-window-done">
      <h1>Signed in</h1>
      <p>You can close this window and go back to the Foundry.</p>
      <button type="button" className="btn" onClick={() => window.close()}>Close this window</button>
    </div>
  );
}
