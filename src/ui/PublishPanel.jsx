import { useState } from "react";
import { publishTile, deleteTile, tileViewUrl } from "../core/publish.js";
import { fetchPublicBlob } from "../core/atproto.js";
import { xrpc } from "../auth/auth.js";
import { DEBUG } from "./debug.js";

// The Publish step: a plain confirmation, live progress, then the result.

// Shown first when the card pictures still have to be drawn (see getFinal).
const PREPARE_STEP = { id: "prepare", label: "Drawing your card pictures" };

const STEPS = [
  { id: "upload", label: "Uploading your tile's files" },
  { id: "create", label: "Adding the tile to your account" },
  { id: "verify", label: "Checking everything arrived safely" },
];

/** How an Astro site with the WebTile component (as on thunderbird.cafe) embeds a tile. */
export function astroSnippet(uri, height = 400) {
  return `---\nimport WebTile from "../components/WebTile.astro";\n---\n\n<WebTile uri="${uri}" height={${height}} />`;
}

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this:", text);
    }
  }
  return (
    <button type="button" className="btn btn-quiet btn-small" onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}

// getFinal(): the complete tile to publish (card pictures included); may take a moment.
export function PublishPanel({ result, getFinal, account, who }) {
  const [state, setState] = useState({ phase: "idle" });
  const signedIn = account.status === "signedIn" && account.did && account.pds;

  async function publish() {
    const progress = {};
    setState({ phase: "running", progress });
    try {
      if (getFinal && !result.final) {
        progress.prepare = { state: "active" };
        setState({ phase: "running", progress: { ...progress } });
      }
      const tile = getFinal ? await getFinal() : result;
      if (progress.prepare) progress.prepare = { state: "done" };
      const out = await publishTile({
        xrpc,
        fetchBlob: (cid) => fetchPublicBlob(account.did, account.pds, cid),
        did: account.did,
        result: tile,
        onStep: (id, s, detail) => {
          progress[id] = { state: s, detail };
          setState({ phase: "running", progress: { ...progress } });
        },
      });
      setState({ phase: "done", out, name: tile.name });
    } catch (err) {
      console.error("[publish]", err);
      setState({ phase: "error", message: err.message, step: err.step, progress: { ...progress } });
    }
  }

  async function removeTestTile() {
    if (!window.confirm(`Delete the tile "${state.name}" from your account? This can't be undone.`)) return;
    try {
      await deleteTile({ xrpc, did: account.did, rkey: state.out.rkey });
      setState((s) => ({ ...s, deleted: true }));
    } catch (err) {
      window.alert(`Couldn't delete it: ${err.message}`);
    }
  }

  if (state.phase === "done") {
    const { out } = state;
    const link = tileViewUrl(out.uri, account.handle);
    return (
      <div className="publish publish-done" role="status">
        <div className="publish-done-text">
          <p className="publish-title">{state.deleted ? "Test tile deleted." : "Your tile is published!"}</p>
          {!state.deleted && (
            <>
              <p>“{state.name}” is now in {who}. Open it on appmosphe.re to see it the way others will.</p>
              <div className="button-row">
                <a className="btn" href={link} target="_blank" rel="noopener">View on appmosphe.re</a>
                <button type="button" className="btn btn-quiet" onClick={() => setState({ phase: "idle" })}>Make another tile</button>
              </div>
              <div className="share">
                <p className="share-label">Share it</p>
                <p className="field-help">Paste this link into a Bluesky post, or send it to a friend.</p>
                <div className="share-row">
                  <span className="mono share-text">{link}</span>
                  <CopyButton text={link} label="Copy link" />
                </div>
                <p className="share-label share-label-second">Your tile's address</p>
                <p className="field-help">For twinkl.social home pages and other sites that take an at:// address.</p>
                <div className="share-row">
                  <span className="mono share-text">{out.uri}</span>
                  <CopyButton text={out.uri} label="Copy address" />
                </div>
              </div>
              <details className="embed">
                <summary>Embed on an Astro site</summary>
                <p className="field-help">
                  For Astro sites that have a WebTile component, like thunderbird.cafe. Adjust the import
                  path to wherever the component lives on your site.
                </p>
                <pre className="mono">{astroSnippet(out.uri)}</pre>
                <CopyButton text={astroSnippet(out.uri)} label="Copy code" />
              </details>
            </>
          )}
          {DEBUG && !state.deleted && (
            <div className="debug-tools">
              <span className="debug-badge">debug</span>
              <button type="button" className="btn btn-small btn-danger" onClick={removeTestTile}>Delete this test tile</button>
              <details>
                <summary>Record as published</summary>
                <pre>{JSON.stringify(out.record, null, 2)}</pre>
              </details>
            </div>
          )}
          {state.deleted && (
            <button type="button" className="btn btn-quiet" onClick={() => setState({ phase: "idle" })}>Back</button>
          )}
        </div>
      </div>
    );
  }

  const running = state.phase === "running";
  const progress = state.progress || {};
  return (
    <div className="publish">
      <div>
        <p>
          <strong>Ready to publish?</strong> This adds one Web Tile, “{result.name}”, to {who}.
          Nothing else in your account is changed.
        </p>
        {!signedIn && <p className="publish-note">Sign in to publish.</p>}
        {(running || state.phase === "error") && (
          <ol className="publish-steps">
            {(progress.prepare ? [PREPARE_STEP, ...STEPS] : STEPS).map((s) => {
              const p = progress[s.id];
              const status = p ? p.state : "waiting";
              const d = p && p.detail;
              // Big tiles (songs) also show megabytes, since files differ so much in size.
              const big = d && d.bytesTotal > 1024 * 1024;
              const mb = (x) => (x / 1024 / 1024).toFixed(1);
              const count = s.id === "upload" && d && d.total
                ? ` (${d.done} of ${d.total}${big ? `, ${mb(d.bytesDone)} of ${mb(d.bytesTotal)} MB` : ""})`
                : "";
              const failed = state.phase === "error" && state.step === s.id;
              return (
                <li key={s.id} className={`ps-${failed ? "failed" : status}`}>
                  <span className="ps-mark" aria-hidden="true">{failed ? "✕" : status === "done" ? "✓" : status === "active" ? "…" : "·"}</span>
                  {s.label}{status === "active" ? count : ""}
                </li>
              );
            })}
          </ol>
        )}
        {state.phase === "error" && (
          <p className="field-error" role="alert">
            {state.message}
            {state.step === "verify" ? " The tile may still be in your account; check appmosphe.re before trying again." : ""}
          </p>
        )}
      </div>
      <button type="button" className="btn" disabled={!signedIn || running} onClick={publish}>
        {running ? "Publishing…" : state.phase === "error" ? "Try again" : "Publish my tile"}
      </button>
    </div>
  );
}
