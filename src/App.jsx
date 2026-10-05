import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./tile-types/index.js";
import { listTileTypes, getTileType } from "./core/registry.js";
import { checkInputs } from "./core/contract.js";
import { buildTile } from "./core/build.js";
import { FOUNDRY_VERSION } from "./core/version.js";
import { InputForm } from "./ui/InputForm.jsx";
import { LiveTile, CardPreview } from "./ui/Previews.jsx";
import { TypePreview } from "./ui/TypePreview.jsx";
import { FileList } from "./ui/FileList.jsx";
import { RealLoaderPreview } from "./ui/RealLoaderPreview.jsx";
import { SignIn, AccountBar } from "./ui/SignIn.jsx";
import { PublishPanel } from "./ui/PublishPanel.jsx";
import { useTileBuild, useFileUrls } from "./ui/useTileBuild.js";
import { useAccount, useOwnSprite } from "./ui/useAccount.js";
import { DEBUG } from "./ui/debug.js";

// The Foundry, kept as simple as possible for first-time users:
//   sign in -> (pick a tile type, only once there is more than one)
//   -> make your tile -> publish
//
// Adding ?debug to the address also shows the developer views: a PNG picker,
// a preview through the real tile loader, the feed card, and the exact files
// (types, sizes, addresses) that would be published. In debug, the tile can be
// made without signing in.

function Step({ n, title, children, muted }) {
  return (
    <section className={`step ${muted ? "step-muted" : ""}`} aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`}>
        <span className="step-n" aria-hidden="true">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const { account, signIn, signOut, retryLookup } = useAccount();
  const ownSprite = useOwnSprite(account, retryLookup);
  const signedIn = account.status === "signedIn";

  const types = listTileTypes();
  const showTypePicker = types.length > 1;
  const [typeId, setTypeId] = useState(types.length === 1 ? types[0].id : null);
  const type = typeId ? getTileType(typeId) : null;
  const [values, setValues] = useState(() => (type ? type.defaults({}) : {}));
  const [nameEdited, setNameEdited] = useState(false);
  const [live, setLive] = useState(false);

  function pickType(id) {
    setTypeId(id);
    // Start from the type's defaults, but keep the sprite already read from
    // the account: it arrives once, so it would not come back on its own.
    const start = getTileType(id).defaults({ handle: account.handle });
    if (ownSprite.state === "ready" && "sprite" in start) start.sprite = ownSprite.sprite;
    setValues(start);
    setNameEdited(false);
  }
  // The latest values, for changes that arrive from outside React's render
  // (the live preview painting a facet, for example).
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const setValue = useCallback(
    (key, v) => {
      if (key === "name") setNameEdited(true);
      const current = valuesRef.current;
      // Some types change other inputs along with this one, and may ask first.
      const change = type && type.applyChange ? type.applyChange(key, v, current) : null;
      if (change && change.confirm && !window.confirm(change.confirm)) return;
      const next = change ? change.values : { ...current, [key]: v };
      valuesRef.current = next;
      setValues(next);
    },
    [type]
  );

  // Once the account's sprite arrives, use it.
  useEffect(() => {
    if (ownSprite.state === "ready") setValues((prev) => ({ ...prev, sprite: ownSprite.sprite }));
  }, [ownSprite.state, ownSprite.sprite]);

  // Once the handle is known, name the tile after it (unless the user already typed a name).
  useEffect(() => {
    if (type && account.handle && !nameEdited) {
      setValues((prev) => ({ ...prev, name: type.defaults({ handle: account.handle }).name }));
    }
  }, [type, account.handle, nameEdited]);

  // Types that credit the maker (their starting values have a `handle`, as
  // Coaster Carnival's "Built by @handle" does) get the signed-in handle.
  useEffect(() => {
    if (type && account.handle && "handle" in type.defaults({})) {
      setValues((prev) => (prev.handle === account.handle ? prev : { ...prev, handle: account.handle }));
    }
  }, [type, account.handle]);

  // Signing out forgets the account's sprite.
  useEffect(() => {
    if (account.status === "signedOut") {
      setValues((prev) => (prev.sprite && prev.sprite.origin.kind === "record" ? { ...prev, sprite: null } : prev));
    }
  }, [account.status]);

  const problems = useMemo(() => (type ? checkInputs(type, values) : []), [type, values]);
  const ready = !!type && problems.length === 0;
  // While making the tile, types may skip costly card pictures; the debug views
  // show the exact files, so they get the complete tile.
  const { result, error, building } = useTileBuild(type, values, ready, type && type.buildDelayMs ? type.buildDelayMs : 250, DEBUG);
  // The complete tile, for publishing (built again only if parts were skipped).
  const finalResult = useCallback(async () => (result && result.final ? result : buildTile(type, valuesRef.current, { final: true })), [result, type]);
  const urls = useFileUrls(result);

  const canMake = signedIn || DEBUG;
  const who = account.handle ? `@${account.handle}'s account` : "your account";

  let n = 0;
  return (
    <div className="page">
      <header className="masthead">
        <div>
          <p className="kicker">thunderbird.cafe</p>
          <h1>Web Tile Foundry</h1>
          <p className="lede">Mint your own Web Tiles, and keep them in your own atproto repo.</p>
        </div>
        <p className="stage-note">
          <strong>Preview version</strong> · v{FOUNDRY_VERSION}
          {DEBUG && <> · <span className="debug-badge">debug</span></>}
        </p>
      </header>

      {signedIn && <AccountBar account={account} onSignOut={signOut} />}

      {!signedIn && (
        <Step n={++n} title="Sign in">
          <SignIn account={account} onSignIn={signIn} />
        </Step>
      )}

      {canMake && showTypePicker && (
        <Step n={++n} title="Pick a tile type">
          <div className="type-grid">
            {types.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`type-card ${t.id === typeId ? "on" : ""}`}
                aria-pressed={t.id === typeId}
                onClick={() => pickType(t.id)}
              >
                <span className="type-title">{t.title}</span>
                <span className="type-summary">{t.summary}</span>
              </button>
            ))}
          </div>
        </Step>
      )}

      {canMake && type ? (
        <Step n={++n} title="Make your tile">
          <div className="make">
            <InputForm type={type} values={values} onChange={setValue} problems={problems} context={{ ownSprite }} />
            <div className="make-preview">
              {type.preview ? (
                <>
                  <TypePreview type={type} values={values} setValue={setValue} />
                  <p className="caption">{type.preview.caption ? type.preview.caption(values) : "Live preview."}</p>
                  {error ? (
                    <p className="field-error" role="alert">{error.message}</p>
                  ) : (
                    <p className="preview-status">Publish when your tile is ready.</p>
                  )}
                </>
              ) : result ? (
                <>
                  <LiveTile html={result.html} title={result.name} />
                  <p className="caption">Live preview. Try the gear in the corner.</p>
                </>
              ) : (
                <div className="preview-empty">
                  {error ? (
                    <p className="field-error" role="alert">{error.message}</p>
                  ) : building || ownSprite.state === "loading" ? (
                    <p>Getting your tile ready…</p>
                  ) : (
                    <p>Your tile will appear here once it has a sprite.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </Step>
      ) : (
        <Step n={++n} title="Make your tile" muted>
          <p className="step-help">Available once you're signed in.</p>
        </Step>
      )}

      <Step n={++n} title="Publish" muted={!result}>
        {result ? (
          <PublishPanel result={result} getFinal={finalResult} account={account} who={who} />
        ) : (
          <p className="step-help">Available once your tile is ready.</p>
        )}
      </Step>

      {DEBUG && result && (
        <>
          <Step n="·" title="Real tile loader (debug)">
            <p className="step-help">
              Runs this tile through your actual tile server, the same way webtil.es and the blog do.
            </p>
            <RealLoaderPreview result={result} />
          </Step>
          <Step n="·" title="Feed card (debug)">
            <p className="step-help">How webtil.es shows the tile in a feed, before anyone clicks it.</p>
            <CardPreview result={result} urls={urls} live={live} onToggleLive={() => setLive((v) => !v)} />
          </Step>
          <Step n="·" title="Files that would be published (debug)">
            <FileList result={result} urls={urls} />
          </Step>
        </>
      )}

      <footer className="foot">
        Sprites from <a href="https://rpg.actor/" target="_blank" rel="noopener">rpg.actor</a>. Tiles view on{" "}
        <a href="https://appmosphe.re/tiles" target="_blank" rel="noopener">appmosphe.re</a>. Foundry by{" "}
        <a href="https://thunderbird.cafe/" target="_blank" rel="noopener">thunderbird.cafe</a>.
      </footer>
    </div>
  );
}
