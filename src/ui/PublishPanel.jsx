import { useEffect, useMemo, useState } from "react";
import { publishTile, deleteTile, tileViewUrl } from "../core/publish.js";
import { fetchPublicBlob } from "../core/atproto.js";
import { xrpcFor } from "../auth/auth.js";
import { DEBUG } from "./debug.js";
import { InputForm } from "./InputForm.jsx";
import { formatSize } from "../core/fileset.js";

// The Publish step: "Review and publish" draws the tile's card pictures and
// shows the card as feeds will show it, with the card's words to edit (the
// inputs in the "card" group and the confirmations; see reviewInputs in
// src/core/contract.js), where it goes and its size. Then "Publish to @handle"
// (live progress, then the result) or "Back to editing".

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

// The card as webtil.es and appmosphe.re show it before anyone opens the tile.
function ReviewCard({ tile, name, description }) {
  const banner = tile.screenshots[0] && tile.files.find((f) => f.path === tile.screenshots[0].src);
  const icon = tile.icons[0] && tile.files.find((f) => f.path === tile.icons[0].src);
  const urls = useMemo(() => {
    const make = (f) => (f ? URL.createObjectURL(new Blob([f.bytes], { type: f.contentType || "image/png" })) : null);
    return { banner: make(banner), icon: make(icon) };
  }, [banner, icon]);
  useEffect(() => () => Object.values(urls).forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="review-card" aria-label="The link preview card">
      {urls.banner && <img className="tile-card-banner" src={urls.banner} alt="" />}
      <span className="tile-card-body">
        {urls.icon && <img className="tile-card-icon" src={urls.icon} alt="" width="44" height="44" />}
        <span>
          <span className="tile-card-name">{name || "(no title yet)"}</span>
          {description && <span className="tile-card-desc">{description}</span>}
        </span>
      </span>
    </div>
  );
}

/**
 * result: the tile as it is now (null while it can't be built); shown: the
 * latest tile that could be built (kept so the review stays up while a field
 * is being fixed). getFinal(): the complete tile (card pictures included).
 * reviewKeys: the inputs shown at the review step (and not while editing).
 */
export function PublishPanel({ result, shown, getFinal, account, type, values, setValue, problems, context, reviewKeys, onBack }) {
  const [state, setState] = useState({ phase: "idle" });
  const [review, setReview] = useState(null); // { tile, values }: the card as drawn, and the values it was drawn from
  const signedIn = account.status === "signedIn" && account.did && account.pds;
  const who = account.handle ? `@${account.handle}` : "your account";
  const tile = result || shown;

  // Something other than the card's words changed since the card was drawn.
  const changed = review && Object.keys({ ...values, ...review.values }).some((k) => !reviewKeys.has(k) && values[k] !== review.values[k]);
  // Another tile type, or the tile can't be built at all any more: back to the start.
  useEffect(() => {
    if (state.phase === "review" && review && review.tile.typeId !== (tile && tile.typeId)) { setReview(null); setState({ phase: "idle" }); }
  }, [state.phase, review, tile]);

  async function startReview() {
    setState({ phase: "drawing" });
    try {
      const at = values;
      const drawn = await getFinal();
      setReview({ tile: drawn, values: at });
      setState({ phase: "review" });
    } catch (err) {
      console.error("[review]", err);
      setState({ phase: "idle", message: err.message });
    }
  }

  async function publish() {
    // Held to the account in use now, even if the creator switches accounts meanwhile.
    const to = { did: account.did, pds: account.pds, handle: account.handle };
    const progress = {};
    // The card already drawn is used when nothing has changed since; otherwise it's drawn again.
    const reuse = review && review.values === values ? review.tile : null;
    setState({ phase: "running", progress });
    try {
      if (!reuse && getFinal && !(result && result.final)) {
        progress.prepare = { state: "active" };
        setState({ phase: "running", progress: { ...progress } });
      }
      const tile = reuse || (getFinal ? await getFinal() : result);
      if (progress.prepare) progress.prepare = { state: "done" };
      const xrpc = xrpcFor(to.did);
      const out = await publishTile({
        xrpc,
        fetchBlob: (cid) => fetchPublicBlob(to.did, to.pds, cid),
        did: to.did,
        result: tile,
        onStep: (id, s, detail) => {
          progress[id] = { state: s, detail };
          setState({ phase: "running", progress: { ...progress } });
        },
      });
      setReview(null);
      setState({ phase: "done", out, name: tile.name, to });
    } catch (err) {
      console.error("[publish]", err);
      setState({ phase: "error", message: err.message, step: err.step, progress: { ...progress } });
    }
  }

  async function removeTestTile() {
    if (account.did !== state.to.did) {
      window.alert(`Switch back to ${state.to.handle ? `@${state.to.handle}` : "the account it was published to"} to delete it.`);
      return;
    }
    if (!window.confirm(`Delete the tile "${state.name}" from your account? This can't be undone.`)) return;
    try {
      await deleteTile({ xrpc: xrpcFor(state.to.did), did: state.to.did, rkey: state.out.rkey });
      setState((s) => ({ ...s, deleted: true }));
    } catch (err) {
      window.alert(`Couldn't delete it: ${err.message}`);
    }
  }

  function backToEditing() {
    setState({ phase: "idle" });
    if (onBack) onBack();
  }

  if (state.phase === "done") {
    const { out, to } = state;
    const link = tileViewUrl(out.uri, to.handle);
    const who = to.handle ? `@${to.handle}'s account` : "your account";
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

  // Before the review: one button.
  if (state.phase === "idle" || state.phase === "drawing") {
    const drawing = state.phase === "drawing";
    return (
      <div className="publish">
        <div>
          <p>
            <strong>Ready?</strong> Review your tile's link preview card, then publish “{tile ? tile.name : ""}” to {who}.
            Nothing else in your account is changed.
          </p>
          {!signedIn && <p className="publish-note">Sign in to publish.</p>}
          {drawing && <p className="publish-note" role="status">Drawing your card…</p>}
          {state.message && <p className="field-error" role="alert">{state.message}</p>}
        </div>
        <button type="button" className="btn" disabled={!signedIn || !result || drawing} onClick={startReview}>
          {drawing ? "Drawing…" : "Review and publish"}
        </button>
      </div>
    );
  }

  // The review, and publishing from it.
  const reviewProblems = problems.filter((p) => reviewKeys.has(p.key));
  const blocked = !signedIn || !result || problems.length > 0;
  const summary = type && typeof type.reviewSummary === "function" ? type.reviewSummary(values) : "";
  // An empty description box shows, in grey, the words the card will use instead.
  const placeholders = { description: tile && !String(values.description || "").trim() ? tile.description : "" };
  const size = review ? review.tile.totalBytes : tile ? tile.totalBytes : 0;
  return (
    <div className="publish publish-review">
      <div className="review-grid">
        <div className="review-card-col">
          <p className="review-label">Your link preview card</p>
          {review && <ReviewCard tile={review.tile} name={tile ? tile.name : values.name} description={tile ? tile.description : values.description} />}
          {changed && (
            <p className="publish-note">
              You've changed your tile since this card was drawn.{" "}
              <button type="button" className="linklike" onClick={startReview} disabled={running}>Draw it again</button>
            </p>
          )}
        </div>
        <div className="review-side">
          {reviewKeys.size > 0 && (
            <InputForm type={type} values={values} onChange={setValue} problems={reviewProblems} context={context} only={reviewKeys} placeholders={placeholders} />
          )}
          <dl className="review-facts">
            <dt>Publishing to</dt>
            <dd>{who}</dd>
            <dt>Size</dt>
            <dd>{formatSize(size)}{summary ? ` · ${summary}` : ""}</dd>
          </dl>
          {problems.some((p) => !reviewKeys.has(p.key)) && (
            <p className="field-error">Your tile needs attention before it can be published (see “Make your tile”).</p>
          )}
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
          <div className="button-row">
            <button type="button" className="btn" disabled={blocked || running} onClick={publish}>
              {running ? "Publishing…" : state.phase === "error" ? "Try again" : `Publish to ${who}`}
            </button>
            <button type="button" className="btn btn-quiet" disabled={running} onClick={backToEditing}>Back to editing</button>
          </div>
        </div>
      </div>
    </div>
  );
}
