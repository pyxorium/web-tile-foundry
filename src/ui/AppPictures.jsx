import { useEffect, useRef, useState } from "react";
import { APP_PICTURE_SOURCES, accountPictures, pictureBlobUrl } from "../core/app-pictures.js";
import { myAccounts, nameOf } from "../core/my-accounts.js";

// "Choose picture" for a page (Zine Scene stage 5, part 1): a small menu,
// From my computer… / From Grain / From PinkSea, and for the apps a grid of
// thumbnails from all your accounts (src/core/app-pictures.js). The picture
// you pick is downloaded from your own account, checked, and then made small
// exactly like a picture from your computer (the page editor in InputForm.jsx
// does that part).

const lists = new Map(); // "app|accounts key" -> Promise<{ groups, failed }>

/** Your pictures from one app, from all your accounts: { groups: [{ key, title, items }], failed }. */
function picturesOf(app, accounts) {
  const key = `${app}|${accounts.key}`;
  if (!lists.has(key)) {
    const p = (async () => {
      const results = await Promise.all(accounts.list.map((a) => accountPictures(app, a).then((groups) => ({ a, groups }), (error) => ({ a, error }))));
      // Name the account only when pictures come from more than one.
      const many = results.filter((r) => r.groups && r.groups.length).length > 1;
      const groups = [];
      const failed = [];
      for (const r of results) {
        if (r.error) { failed.push(nameOf(r.a)); continue; }
        for (const g of r.groups) groups.push({ ...g, key: `${r.a.did}|${g.key}`, name: g.title, title: many ? `${g.title} · ${nameOf(r.a)}` : g.title });
      }
      if (!groups.length && failed.length === results.length && failed.length) throw new Error(`couldn't read ${failed.join(", ")}`);
      return { groups, failed };
    })();
    p.catch(() => lists.delete(key));
    lists.set(key, p);
  }
  return lists.get(key);
}

function forgetPictures(app) {
  for (const k of [...lists.keys()]) if (k.startsWith(`${app}|`)) lists.delete(k);
}

/** Where each app stands for this account list: "checking" | "none" | "ready" | "error" | "out" | "waiting". */
function useAppStatus(apps, context, active, round) {
  const accounts = myAccounts(context);
  const [status, setStatus] = useState({});
  useEffect(() => {
    if (!active) return undefined;
    if (accounts.state !== "ok") return undefined;
    let alive = true;
    for (const app of apps) {
      setStatus((s) => (s[app] && s[app].key === accounts.key && s[app].state !== "error" ? s : { ...s, [app]: { key: accounts.key, state: "checking" } }));
      picturesOf(app, accounts).then(
        (r) => alive && setStatus((s) => ({ ...s, [app]: { key: accounts.key, state: r.groups.length ? "ready" : "none" } })),
        () => alive && setStatus((s) => ({ ...s, [app]: { key: accounts.key, state: "error" } }))
      );
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, accounts.key, accounts.state, apps.join(","), round]);
  return (app) => {
    if (accounts.state === "out") return "out";
    if (accounts.state !== "ok") return "waiting";
    const s = status[app];
    return s && s.key === accounts.key ? s.state : "checking";
  };
}

function reasonFor(app, state) {
  const src = APP_PICTURE_SOURCES[app];
  if (state === "out") return `Sign in to use your ${src.app} ${src.noun}s`;
  if (state === "waiting") return "Looking up your account…";
  if (state === "checking") return "Checking…";
  if (state === "none") return src.empty;
  if (state === "error") return `Couldn't reach ${src.app}; try again`;
  return null;
}

/**
 * The "Choose picture" button and its menu.
 *   apps: ["grain", "pinksea"]; onComputer(): open the file chooser (called from the click);
 *   onApp(app): show that app's grid.
 */
export function PictureMenu({ apps, context, label, disabled, onComputer, onApp }) {
  const [open, setOpen] = useState(false);
  const [warm, setWarm] = useState(false);
  const [round, setRound] = useState(0);
  const boxRef = useRef(null);
  const itemsRef = useRef([]);
  const statusOf = useAppStatus(apps, context, warm || open, round);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    // Focus the first item once the menu is drawn.
    const t = setTimeout(() => itemsRef.current[0] && itemsRef.current[0].focus(), 0);
    return () => { document.removeEventListener("pointerdown", away); clearTimeout(t); };
  }, [open]);

  const choices = [{ id: "computer", label: "From my computer…" }, ...apps.map((a) => ({ id: a, label: APP_PICTURE_SOURCES[a].menuLabel }))];

  function pick(c) {
    if (c.id === "computer") {
      setOpen(false);
      onComputer(); // straight from the click, so the browser lets the file chooser open
      return;
    }
    const state = statusOf(c.id);
    if (state === "error") { forgetPictures(c.id); setRound((n) => n + 1); return; }
    if (state !== "ready") return;
    setOpen(false);
    onApp(c.id);
  }

  function onKey(e) {
    const items = itemsRef.current.filter(Boolean);
    const at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); boxRef.current && boxRef.current.querySelector(".picture-menu-button").focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(at + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(at - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0].focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <span className="picture-menu" ref={boxRef} onPointerEnter={() => setWarm(true)} onFocus={() => setWarm(true)}>
      <button
        type="button"
        className="btn btn-quiet btn-small picture-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {label}<span className="picture-menu-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className="picture-menu-list" role="menu" aria-label="Choose a picture" onKeyDown={onKey}>
          {choices.map((c, i) => {
            const state = c.id === "computer" ? "ready" : statusOf(c.id);
            const why = c.id === "computer" ? null : reasonFor(c.id, state);
            const off = state !== "ready" && state !== "error";
            return (
              <li key={c.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  ref={(e) => { itemsRef.current[i] = e; }}
                  aria-disabled={off}
                  className={`picture-menu-item ${off ? "off" : ""}`}
                  onClick={() => pick(c)}
                >
                  <span>{c.label}</span>
                  {why && <span className="picture-menu-why">{why}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
}

function Thumb({ item, used, onPick, ticked = null }) {
  const [failed, setFailed] = useState(false);
  const src = APP_PICTURE_SOURCES[item.app];
  const name = item.alt || `Untitled ${src.noun}`;
  const picking = ticked !== null;
  return (
    <button
      type="button"
      className={`app-thumb ${item.sensitive ? "sensitive" : ""} ${picking ? "picking" : ""} ${ticked ? "ticked" : ""}`}
      onClick={() => onPick(item)}
      title={name}
      {...(picking ? { role: "checkbox", "aria-checked": ticked } : {})}
      aria-label={`${name}${item.sensitive ? " (marked sensitive)" : ""}${used ? ` (already on ${used})` : ""}`}
    >
      {picking && <span className="app-thumb-tick" aria-hidden="true">{ticked ? "✓" : ""}</span>}
      {failed ? <span className="app-thumb-fail">Couldn't load</span> : <img src={pictureBlobUrl(item)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />}
      {item.sensitive && <span className="app-thumb-flag">Marked sensitive</span>}
      {used && <span className="app-thumb-used">On {used}</span>}
    </button>
  );
}

/**
 * The thumbnails from one app. usedOn(uri) -> "page 3" when another page
 * already has that picture. onChoose(item) is called once a sensitive picture
 * has been confirmed.
 */
export function AppPictureGrid({ app, context, usedOn, onChoose, onClose, gallery = null }) {
  const src = APP_PICTURE_SOURCES[app];
  const accounts = myAccounts(context);
  const [state, setState] = useState({ status: "loading" });
  const [asking, setAsking] = useState(null); // a sensitive item waiting for "Use it"
  const [round, setRound] = useState(0);
  // "Use this whole gallery" (stage 5, part 3): { key, picked: Set of uris, replacing: bool }
  const [picking, setPicking] = useState(null);

  useEffect(() => {
    if (accounts.state !== "ok") return undefined;
    let alive = true;
    setState({ status: "loading" });
    picturesOf(app, accounts).then(
      (r) => alive && setState({ status: "ok", ...r }),
      (err) => alive && setState({ status: "error", message: err.message || String(err) })
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, accounts.key, accounts.state, round]);

  function pick(item) {
    if (item.sensitive) { setAsking(item); return; }
    onChoose(item);
  }

  // Picking from a whole gallery: every photo starts ticked, except ones marked sensitive.
  function startPicking(g) {
    setAsking(null);
    setPicking({ key: g.key, picked: new Set(g.items.filter((i) => !i.sensitive).map((i) => i.uri)), replacing: false });
  }
  function setTicked(item, on) {
    setPicking((p) => {
      if (!p) return p;
      const picked = new Set(p.picked);
      if (on) picked.add(item.uri); else picked.delete(item.uri);
      return { ...p, picked };
    });
  }
  function toggle(item) {
    if (!picking) return;
    const on = !picking.picked.has(item.uri);
    if (on && item.sensitive) { setAsking({ ...item, tick: true }); return; }
    setTicked(item, on);
  }
  const pickGroup = picking && state.status === "ok" ? state.groups.find((g) => g.key === picking.key) : null;
  const pickedItems = pickGroup ? pickGroup.items.filter((i) => picking.picked.has(i.uri)) : [];
  function fill(mode) {
    const items = pickedItems;
    const title = pickGroup ? pickGroup.name || pickGroup.title : "";
    setPicking(null);
    gallery.onFill(items, { mode, title });
  }
  const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;

  const count = state.status === "ok" ? state.groups.reduce((n, g) => n + g.items.length, 0) : 0;
  return (
    <div className="app-pictures" role="region" aria-label={`Your ${src.app} ${src.noun}s`}>
      <div className="app-pictures-head">
        <span className="app-pictures-title">Your {src.app} {src.noun}s{count ? ` (${count})` : ""}</span>
        <button type="button" className="btn btn-quiet btn-small" onClick={() => { forgetPictures(app); setAsking(null); setRound((n) => n + 1); }}>Refresh</button>
        <button type="button" className="btn btn-quiet btn-small" onClick={onClose}>Close</button>
      </div>
      {state.status === "loading" && <p className="field-help">Reading your {src.app} {src.noun}s…</p>}
      {state.status === "error" && <p className="field-error">Couldn't read your {src.app} {src.noun}s ({state.message}). Try Refresh.</p>}
      {state.status === "ok" && !state.groups.length && <p className="field-help">{src.empty}.</p>}
      {asking && (
        <div className="app-pictures-ask" role="alertdialog" aria-label="Marked sensitive">
          <p>
            This {src.noun} is marked sensitive on {src.app}. Zines don't hide pictures, so it will show openly to everyone who reads your zine.
          </p>
          <div className="app-pictures-ask-buttons">
            <button type="button" className="btn btn-small" onClick={() => { const it = asking; setAsking(null); if (it.tick) setTicked(it, true); else onChoose(it); }}>Use it</button>
            <button type="button" className="btn btn-quiet btn-small" onClick={() => setAsking(null)}>Cancel</button>
          </div>
        </div>
      )}
      {state.status === "ok" && state.groups.map((g) => {
        const here = picking && picking.key === g.key;
        if (picking && !here) return null; // while picking, only that gallery shows
        return (
          <div key={g.key} className={`app-pictures-group ${here ? "picking" : ""}`}>
            <div className="app-pictures-group-head">
              <p className="app-pictures-group-title">{g.title}{g.gallery ? <span className="app-pictures-count"> · {plural(g.items.length, src.noun)}</span> : null}</p>
              {gallery && g.gallery && !picking && (
                <button type="button" className="link-button" onClick={() => startPicking(g)}>Use this whole gallery</button>
              )}
            </div>
            {here && <p className="field-help">Untick any {src.noun}s you don't want, then fill your pages.</p>}
            <div className="app-pictures-grid">
              {g.items.map((item) => (
                <Thumb
                  key={`${g.key}|${item.uri}`}
                  item={item}
                  used={usedOn(item.uri)}
                  onPick={here ? toggle : pick}
                  ticked={here ? picking.picked.has(item.uri) : null}
                />
              ))}
            </div>
            {here && (() => {
              const n = pickedItems.length;
              const empty = gallery.emptyCount;
              const fillN = Math.min(n, empty);
              const over = n - fillN;
              const total = gallery.pageCount;
              const replaceOver = Math.max(0, n - total);
              return (
                <div className="gallery-bar">
                  <p className="gallery-count" aria-live="polite">{n} picked · {plural(empty, "empty page")}</p>
                  {picking.replacing ? (
                    <div className="app-pictures-ask" role="alertdialog" aria-label="Replace all pages">
                      <p>This replaces all {total} pages, including their words, sounds, tiles and stickers.{replaceOver ? ` ${plural(replaceOver, src.noun)} won't fit and will be left out.` : ""}</p>
                      <div className="app-pictures-ask-buttons">
                        <button type="button" className="btn btn-small" disabled={!n} onClick={() => fill("replace")}>Replace all pages</button>
                        <button type="button" className="btn btn-quiet btn-small" onClick={() => setPicking((p) => ({ ...p, replacing: false }))}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="gallery-actions">
                      <button type="button" className="btn btn-small" disabled={!fillN} onClick={() => fill("fill")}>
                        {fillN ? `Fill ${plural(fillN, "page")}${over ? ` (${plural(over, src.noun)} left over)` : ""}` : empty ? `Pick ${src.noun}s to fill your pages` : "No empty pages"}
                      </button>
                      <button type="button" className="btn btn-quiet btn-small" onClick={() => setPicking(null)}>Cancel</button>
                      <button type="button" className="link-button" disabled={!n} onClick={() => setPicking((p) => ({ ...p, replacing: true }))}>Replace all pages instead</button>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
      {state.status === "ok" && state.failed && state.failed.length > 0 && (
        <p className="field-help">Couldn't read {state.failed.join(", ")} just now; Refresh to try again.</p>
      )}
    </div>
  );
}
