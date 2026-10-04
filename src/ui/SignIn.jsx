import { useState } from "react";
import { isLoopbackHost } from "../auth/client-config.js";
import { HandleTypeahead } from "./HandleTypeahead.jsx";

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
      {account.errorKind === "storage" && <CopyLinkButton />}
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
