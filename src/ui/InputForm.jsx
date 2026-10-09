import { useEffect, useRef, useState } from "react";
import { spriteFromBytes } from "../core/sprite-source.js";
import { formatSize } from "../core/fileset.js";
import { DEBUG } from "./debug.js";
import { cropRect, clampCrop } from "../core/pictures.js";
import { isShown, formatDuration, TRANSITIONS, TRACK_TITLE_MAX, pageShows, pageFullness, pageLayout, pagesBytes } from "../core/contract.js";

// Form controls for a tile type's inputs, one per input kind
// (see INPUT_KINDS in src/core/contract.js).

const SAMPLE_URL = `${import.meta.env?.BASE_URL ?? "/"}sample-sprite.png`;

function SpriteSheetThumb({ sprite }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([sprite.bytes], { type: "image/png" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [sprite]);
  const { columns, rows, frameWidth, frameHeight } = sprite.geometry;
  return (
    <div className="sprite-summary">
      {url && <img className="pixel sheet-thumb" src={url} alt="Your sprite sheet" width={sprite.width * 0.75} height={sprite.height * 0.75} />}
      {DEBUG ? (
        <dl>
          <dt>Sheet</dt>
          <dd>{sprite.width} × {sprite.height} px, {formatSize(sprite.bytes.length)}</dd>
          <dt>Frames</dt>
          <dd>{columns} × {rows} of {frameWidth} × {frameHeight} px</dd>
          <dt>From</dt>
          <dd>{sprite.origin.kind === "local-file" ? sprite.origin.name : sprite.origin.uri}</dd>
          <dt>Address</dt>
          <dd className="mono" title={sprite.cid}>{sprite.cid.slice(0, 14)}…{sprite.cid.slice(-6)}</dd>
        </dl>
      ) : (
        <p className="sprite-ok">
          <strong>Sprite ready</strong>
          <span>{sprite.origin.kind === "local-file" ? sprite.origin.name : "From your rpg.actor account"}</span>
        </p>
      )}
    </div>
  );
}

// The sprite. Normally it is read from the signed-in account automatically
// (see useOwnSprite); the PNG picker and sample are developer tools (?debug).
function SpriteInput({ input, value, onChange, context = {} }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const own = context.ownSprite || { state: "idle" };

  async function load(bytesPromise, origin) {
    setBusy(true);
    setError(null);
    try {
      onChange(await spriteFromBytes(await bytesPromise, origin));
    } catch (e) {
      onChange(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function onFile(e) {
    const file = e.target.files && e.target.files[0];
    if (file) load(file.arrayBuffer(), { kind: "local-file", name: file.name });
    e.target.value = "";
  }

  function useSample() {
    load(
      fetch(SAMPLE_URL).then((r) => {
        if (!r.ok) throw new Error("The sample sprite could not be loaded.");
        return r.arrayBuffer();
      }),
      { kind: "local-file", name: "sample-sprite.png (sample)" }
    );
  }

  return (
    <div className="field">
      <span className="field-label">{input.label}</span>
      {own.state === "loading" && <p className="field-help">Fetching your sprite from your account…</p>}
      {own.state === "ready" && own.options && own.options.length > 1 && (
        <label className="sprite-from">
          <span className="field-help">Sprite from</span>
          <select className="text" value={own.chosen || ""} onChange={(e) => own.choose(e.target.value)}>
            {own.options.map((o) => (
              <option key={o.did} value={o.did}>{o.handle ? `@${o.handle}` : o.did}</option>
            ))}
          </select>
        </label>
      )}
      {own.state === "none" && (
        <div className="notice" role="status">
          <p>
            <strong>No sprite yet.</strong> Your account doesn't have an rpg.actor character sprite.
            Make one at <a href="https://rpg.actor/" target="_blank" rel="noopener">rpg.actor</a>, then come back.
          </p>
          <button type="button" className="btn btn-quiet btn-small" onClick={own.retry}>I've made one, check again</button>
        </div>
      )}
      {own.state === "error" && (
        <div className="notice" role="alert">
          <p>{own.message}</p>
          <button type="button" className="btn btn-quiet btn-small" onClick={own.retry}>Try again</button>
        </div>
      )}
      {DEBUG && (
        <>
          <p className="field-help">Debug: use a PNG from this computer, or the sample.</p>
          <div className="button-row">
            <button type="button" className="btn btn-quiet btn-small" onClick={() => fileRef.current.click()} disabled={busy}>
              Choose PNG…
            </button>
            <button type="button" className="btn btn-quiet btn-small" onClick={useSample} disabled={busy}>
              Use the sample sprite
            </button>
            <input ref={fileRef} type="file" accept="image/png" hidden onChange={onFile} />
          </div>
        </>
      )}
      {busy && <p className="field-help">Reading…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {value && <SpriteSheetThumb sprite={value} />}
    </div>
  );
}

// A "choice" shown as pictures (display: "swatches"), drawn by the tile type's
// optionPreview. Redrawn whenever the sprite changes, so each swatch shows the
// user's own sprite in that option.
function SwatchChoice({ input, value, onChange, type, values }) {
  const [urls, setUrls] = useState({});
  const sprite = values.sprite;
  // What the pictures depend on: the type says (optionPreviewKey), or else the sprite.
  const spriteKey = type.optionPreviewKey ? type.optionPreviewKey(input.key, values) : sprite ? sprite.cid : "none";

  useEffect(() => {
    let cancelled = false;
    const made = {};
    (async () => {
      for (const o of input.options) {
        if (o.image) continue; // a picture made ahead of time: nothing to draw
        try {
          const bytes = await type.optionPreview(input.key, o.value, values);
          if (cancelled || !bytes) continue;
          made[o.value] = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          setUrls({ ...made });
        } catch (e) {
          console.warn(`Could not draw the "${o.label}" swatch:`, e);
        }
      }
    })();
    return () => {
      cancelled = true;
      Object.values(made).forEach((u) => URL.revokeObjectURL(u));
    };
    // Only spriteKey changes what a swatch looks like.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, input, spriteKey]);

  return (
    <fieldset className="field">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      <div className={`swatches ${input.smooth ? "swatches-smooth" : ""}`}>
        {input.options.map((o) => (
          <label key={o.value} className={`swatch ${value === o.value ? "on" : ""}`}>
            <input type="radio" name={input.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.image || urls[o.value] ? <img src={o.image || urls[o.value]} alt="" /> : <span className="swatch-blank" />}
            <span className="swatch-label">{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ChoiceInput(props) {
  if (props.input.display === "swatches") return <SwatchChoice {...props} />;
  const { input, value, onChange } = props;
  return (
    <fieldset className="field">
      <legend className="field-label">{input.label}</legend>
      <div className="segmented">
        {input.options.map((o) => (
          <label key={o.value} className={value === o.value ? "on" : ""}>
            <input type="radio" name={input.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {o.label}
            {o.color && <span className="color-square" style={{ background: o.color }} aria-hidden="true" />}
          </label>
        ))}
      </div>
      {input.help && <p className="field-help">{input.help}</p>}
    </fieldset>
  );
}

// placeholder: shown in light grey while the box is empty (at the review, the
// words the card will use if it's left empty).
function TextInput({ input, value, onChange, placeholder = "" }) {
  const id = `input-${input.key}`;
  const Tag = input.multiline ? "textarea" : "input";
  const length = (value || "").length;
  const empty = !String(value || "").trim();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{input.label}</label>
      <Tag
        id={id}
        className="text"
        value={value || ""}
        maxLength={input.maxLength}
        rows={input.multiline ? (placeholder ? 3 : 2) : undefined}
        placeholder={placeholder || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {input.maxLength && <span className="counter">{length} / {input.maxLength}</span>}
      {placeholder && empty && <p className="field-help field-help-after">Leave it empty to use the words shown in grey.</p>}
    </div>
  );
}

// Several colors, ticked on and off.
function PaletteInput({ input, value, onChange }) {
  const picked = Array.isArray(value) ? value.map((c) => c.toLowerCase()) : [];
  function flip(color) {
    const c = color.toLowerCase();
    const next = picked.includes(c) ? picked.filter((x) => x !== c) : [...picked, c];
    // Keep them in the order offered, so the spread is predictable.
    onChange(input.colors.map((o) => o.value.toLowerCase()).filter((x) => next.includes(x)));
  }
  return (
    <fieldset className="field">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      <div className="color-dots">
        {input.colors.map((o) => {
          const on = picked.includes(o.value.toLowerCase());
          return (
            <label key={o.value} className={`color-choice ${on ? "on" : ""}`} title={o.label} style={{ "--c": o.value }}>
              <input type="checkbox" checked={on} onChange={() => flip(o.value)} aria-label={o.label} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// One color: the brush for painting in the preview.
function BrushInput({ input, value, onChange }) {
  const current = (value || "").toLowerCase();
  return (
    <fieldset className="field">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      <div className="color-dots">
        {input.colors.map((o) => {
          const on = current === o.value.toLowerCase();
          return (
            <label key={o.value} className={`color-choice brush ${on ? "on" : ""}`} title={o.label} style={{ "--c": o.value }}>
              <input type="radio" name={input.key} checked={on} onChange={() => onChange(o.value.toLowerCase())} aria-label={o.label} />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RangeInput({ input, value, onChange }) {
  const id = `input-${input.key}`;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {input.label} <span className="range-value">{value}</span>
      </label>
      <div className="range-row">
        <span className="range-end">{input.min}</span>
        <input id={id} type="range" min={input.min} max={input.max} step={input.step || 1} value={value ?? input.min} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="range-end">{input.max}</span>
      </div>
      {input.help && <p className="field-help">{input.help}</p>}
    </div>
  );
}

function SeedInput({ input, value, onChange }) {
  const max = input.max ?? 999999999;
  // What is typed in the box (it may be empty or unfinished for a moment).
  const [typed, setTyped] = useState(value == null ? "" : String(value));
  useEffect(() => setTyped(value == null ? "" : String(value)), [value]);
  function pick() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    onChange(a[0] % (max + 1));
  }
  // With `editable`, the number itself shows beside the button and can be typed in.
  if (input.editable) {
    const id = `input-${input.key}`;
    return (
      <div className="field">
        {input.label && <label className="field-label" htmlFor={id}>{input.label}</label>}
        <div className="button-row">
          <input
            id={id}
            className="text seed-number"
            type="number"
            inputMode="numeric"
            min="0"
            max={max}
            step="1"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              const n = Math.floor(Number(e.target.value));
              if (e.target.value !== "" && Number.isFinite(n) && n >= 0 && n <= max) onChange(n);
            }}
            onBlur={() => setTyped(value == null ? "" : String(value))}
          />
          <button type="button" className="btn btn-quiet btn-small" onClick={pick}>{input.button || "New"}</button>
        </div>
        {input.help && <p className="field-help">{input.help}</p>}
      </div>
    );
  }
  return (
    <div className="field">
      {input.label && <span className="field-label">{input.label}</span>}
      <button type="button" className="btn btn-quiet btn-small" onClick={pick}>{input.button || "New"}</button>
      {input.help && <p className="field-help">{input.help}</p>}
    </div>
  );
}

function ToggleInput({ input, value, onChange }) {
  return (
    <div className="field">
      <label className="toggle">
        <input type="checkbox" role="switch" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true" />
        <span>{input.label}</span>
      </label>
      {input.help && <p className="field-help">{input.help}</p>}
    </div>
  );
}

// A button that does something to other values (the type's applyChange does the work).
function ActionInput({ input, onChange, values }) {
  const disabled = typeof input.disabledIf === "function" && Boolean(input.disabledIf(values));
  return (
    <div className="field field-action">
      <button type="button" className="btn btn-quiet btn-small" disabled={disabled} onClick={() => onChange(true)}>
        {input.button}
      </button>
    </div>
  );
}

// A list of songs, in playing order, grouped by side (see "tracks" in
// src/core/contract.js). The type adds songs through its own picker (shown
// above the list) and converts them; here they can be renamed, reordered,
// moved to another side, removed, and given a change into the next song.
const TRANSITION_LABELS = { straight: "Straight on", pause: "Short pause", fade: "Fade and pause" };

function TrackPicker({ picker, tracks, setTracks, context }) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const boxRef = useRef(null);
  const handleRef = useRef(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const setRef = useRef(setTracks);
  setRef.current = setTracks;

  useEffect(() => {
    let disposed = false;
    Promise.resolve(
      picker.mount(boxRef.current, {
        getTracks: () => tracksRef.current,
        // Several songs convert at once and report back in quick succession, so
        // each change builds on the latest list, not the one last drawn.
        setTracks: (next) => {
          const resolved = typeof next === "function" ? next(tracksRef.current) : next;
          tracksRef.current = resolved;
          setRef.current(resolved);
        },
        context,
      })
    ).then((h) => {
      if (disposed) { if (h && h.dispose) h.dispose(); return; }
      handleRef.current = h;
      if (h && h.update) h.update(tracksRef.current, contextRef.current);
    });
    return () => {
      disposed = true;
      if (handleRef.current && handleRef.current.dispose) handleRef.current.dispose();
      handleRef.current = null;
    };
    // Mount once per picker; later changes reach it through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  // The account can arrive after the picker mounts (its details are looked up
  // after sign-in), so the picker also hears about context changes.
  useEffect(() => {
    if (handleRef.current && handleRef.current.update) handleRef.current.update(tracks, context);
  }, [tracks, context]);

  return <div ref={boxRef} className="track-picker" />;
}

function TrackStatus({ t }) {
  if (t.status === "converting") {
    const pct = Number.isFinite(t.progress) ? Math.round(t.progress) : null;
    return (
      <span className="track-status converting">
        Converting{pct != null ? ` ${pct}%` : "…"}
        {pct != null && <span className="track-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>}
      </span>
    );
  }
  if (t.status === "error") return <span className="track-status error">Couldn't convert</span>;
  return <span className="track-status">{formatDuration(t.seconds)}</span>;
}

function TracksInput({ input, value, onChange, context }) {
  const tracks = Array.isArray(value) ? value : [];
  const sides = input.sides || ["A"];
  const max = input.maxSecondsPerSide;

  const update = (next) => onChange(next);
  const patch = (id, change) => update(tracks.map((t) => (t.id === id ? { ...t, ...change } : t)));
  const remove = (id) => update(tracks.filter((t) => t.id !== id));

  // Move a song up or down among the songs on its side.
  function move(id, dir) {
    const t = tracks.find((x) => x.id === id);
    const same = tracks.filter((x) => x.side === t.side);
    const k = same.indexOf(t);
    const other = same[k + dir];
    if (!other) return;
    const next = tracks.slice();
    const a = next.indexOf(t), b = next.indexOf(other);
    next[a] = other;
    next[b] = t;
    update(next);
  }
  // Move a song to the end of another side.
  function toSide(id, side) {
    const t = tracks.find((x) => x.id === id);
    update([...tracks.filter((x) => x.id !== id), { ...t, side }]);
  }

  return (
    <fieldset className="field tracks">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      {input.picker && <TrackPicker picker={input.picker} tracks={tracks} setTracks={update} context={context} />}
      {sides.map((side) => {
        const list = tracks.filter((t) => t.side === side);
        const total = list.reduce((n, t) => n + (Number(t.seconds) || 0), 0);
        const over = max && total > max;
        return (
          <section key={side} className="track-side" aria-label={sides.length > 1 ? `Side ${side}` : "Songs"}>
            <div className="track-side-head">
              <span className="track-side-name">{sides.length > 1 ? `Side ${side}` : "Songs"}</span>
              <span className={`track-side-time ${over ? "over" : ""}`}>
                {formatDuration(total)}{max ? ` of ${formatDuration(max)}` : ""}
              </span>
            </div>
            {max ? (
              <span className="track-side-meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (total / max) * 100)}%` }} className={over ? "over" : ""} />
              </span>
            ) : null}
            {list.length === 0 && <p className="field-help track-empty">No songs on this side yet.</p>}
            <ol className="track-list">
              {list.map((t, k) => (
                <li key={t.id} className={`track-row ${t.status === "error" ? "is-error" : ""}`}>
                  <div className="track-main">
                    <span className="track-num">{k + 1}</span>
                    <input
                      className="text track-title"
                      value={t.title || ""}
                      maxLength={TRACK_TITLE_MAX}
                      aria-label={`Title of song ${k + 1}`}
                      onChange={(e) => patch(t.id, { title: e.target.value })}
                    />
                    <TrackStatus t={t} />
                  </div>
                  {(t.artist || t.status === "error") && (
                    <p className="track-sub">
                      {t.artist}
                      {t.status === "error" && <span className="field-error"> {t.error}</span>}
                    </p>
                  )}
                  <div className="track-tools">
                    <button type="button" className="btn btn-quiet btn-small" disabled={k === 0} onClick={() => move(t.id, -1)} aria-label={`Move "${t.title}" up`}>↑</button>
                    <button type="button" className="btn btn-quiet btn-small" disabled={k === list.length - 1} onClick={() => move(t.id, 1)} aria-label={`Move "${t.title}" down`}>↓</button>
                    {sides.filter((x) => x !== side).map((x) => (
                      <button key={x} type="button" className="btn btn-quiet btn-small" onClick={() => toSide(t.id, x)}>To side {x}</button>
                    ))}
                    <button type="button" className="btn btn-quiet btn-small" onClick={() => remove(t.id)} aria-label={`Remove "${t.title}"`}>Remove</button>
                  </div>
                  {input.transitions && k < list.length - 1 && (
                    <label className="track-transition">
                      <span>Then</span>
                      <select value={t.transition || "fade"} onChange={(e) => patch(t.id, { transition: e.target.value, transitionChosen: true })}>
                        {TRANSITIONS.map((x) => <option key={x} value={x}>{TRANSITION_LABELS[x]}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
            </ol>
          </section>
        );
      })}
    </fieldset>
  );
}

// Choosing what stays in when a picture fills its space: the frame's shape over
// the picture; drag (or the arrow keys) to move it, the slider to zoom.
const CROP_BOX = 240;
function CropEditor({ picture, frame, zoomMax = 2, onChange, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([picture.bytes], { type: picture.contentType }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture.bytes, picture.contentType]);
  const scale = Math.min(CROP_BOX / frame.w, CROP_BOX / frame.h);
  const boxW = Math.round(frame.w * scale), boxH = Math.round(frame.h * scale);
  const crop = { x: 0.5, y: 0.5, zoom: 1, ...(picture.crop || {}) };
  const rect = cropRect(picture.width, picture.height, boxW, boxH, crop.x, crop.y, crop.zoom);
  // Many small moves arrive while dragging; send at most one change per frame.
  const pending = useRef(null);
  const latest = useRef(crop);
  latest.current = crop;
  function commit(next) {
    const clamped = clampCrop(picture.width, picture.height, boxW, boxH, next);
    latest.current = clamped;
    if (pending.current) { pending.current.value = clamped; return; }
    pending.current = { value: clamped };
    requestAnimationFrame(() => { const v = pending.current.value; pending.current = null; onChange(v); });
  }
  const drag = useRef(null);
  function down(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, start: latest.current, w: rect.w, h: rect.h };
  }
  function move(e) {
    const d = drag.current;
    if (!d) return;
    commit({ ...d.start, x: d.start.x - (e.clientX - d.x) / d.w, y: d.start.y - (e.clientY - d.y) / d.h });
  }
  function up() { drag.current = null; }
  function key(e) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!by) return;
    e.preventDefault();
    const c = latest.current;
    commit({ ...c, x: c.x + by[0], y: c.y + by[1] });
  }
  return (
    <div className="crop">
      <div
        className="crop-box"
        style={{ width: boxW, height: boxH }}
        tabIndex={0}
        role="application"
        aria-label={`${label}: drag the picture, or use the arrow keys, to choose what stays in`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        {url && <img src={url} alt="" draggable={false} style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />}
      </div>
      <label className="crop-zoom">
        <span>Zoom</span>
        <input
          type="range"
          min="1"
          max={zoomMax}
          step="0.05"
          value={crop.zoom}
          onChange={(e) => commit({ ...latest.current, zoom: Number(e.target.value) })}
        />
      </label>
      <p className="field-help crop-help">Drag to choose what stays in{frame.bleed ? "; the picture covers the whole page" : ""}.</p>
    </div>
  );
}

// A little book's pages (see "pages" in src/core/contract.js): a strip of page
// buttons, and the open page's layout, picture, heading and words. Pictures are
// made small in the browser before they're kept (src/core/pictures.js).
function PictureThumb({ picture }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([picture.bytes], { type: picture.contentType }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [picture.bytes, picture.contentType]);
  return url ? <img className="page-thumb" src={url} alt="" /> : <span className="page-thumb" />;
}

// A page switch's own tools (see pageToggles' panel in src/core/contract.js),
// mounted as plain DOM under the switch while it is on. Mounted once per page;
// later changes reach it through update().
function TogglePanel({ panel, getPage, patchPage, page, values, context }) {
  const boxRef = useRef(null);
  const handleRef = useRef(null);
  const latest = useRef({ page, values, context });
  latest.current = { page, values, context };
  useEffect(() => {
    let disposed = false;
    Promise.resolve(panel.mount(boxRef.current, { getPage, patchPage, values: latest.current.values, context: latest.current.context })).then((h) => {
      if (disposed) { if (h && h.dispose) h.dispose(); return; }
      handleRef.current = h;
      const l = latest.current;
      if (h && h.update) h.update(l.page, l.values, l.context);
    });
    return () => {
      disposed = true;
      if (handleRef.current && handleRef.current.dispose) handleRef.current.dispose();
      handleRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);
  useEffect(() => {
    if (handleRef.current && handleRef.current.update) handleRef.current.update(page, values, context);
  }, [page, values, context]);
  return <div ref={boxRef} className="page-toggle-panel" />;
}

function PagesInput({ input, value, onChange, values, type, context }) {
  const pages = Array.isArray(value) ? value : [];
  const [openId, setOpenId] = useState(input.pages[0].id);
  const [busy, setBusy] = useState({}); // page id -> true while its picture is being made small
  const [pictureError, setPictureError] = useState({});
  const fileRef = useRef(null);
  // Pictures finish after other edits, so changes build on the latest pages.
  const latest = useRef(pages);
  latest.current = pages;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const spec = input.pages.find((p) => p.id === openId) || input.pages[0];
  const index = input.pages.indexOf(spec);
  const page = pages[index] || { id: spec.id };
  const shows = pageShows(input, spec, page);
  const layout = pageLayout(input, spec, page);
  const labelFor = (field, fallback) => (layout && layout.labels && layout.labels[field]) || fallback;
  const alwaysFill = Boolean(layout && layout.fill === "always");

  function open(id) {
    setOpenId(id);
    if (input.onSelect) input.onSelect(id);
  }
  function patch(id, change) {
    const next = latest.current.map((p) => (p.id === id ? { ...p, ...change } : p));
    latest.current = next;
    onChange(next);
  }
  async function choose(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const id = spec.id;
    setPictureError((x) => ({ ...x, [id]: null }));
    setBusy((x) => ({ ...x, [id]: true }));
    try {
      const { shrinkPicture } = await import("../core/pictures.js");
      const made = await shrinkPicture(file);
      const old = latest.current.find((p) => p.id === id);
      // A new picture keeps the description and Fit / Fill; its crop starts centred.
      const before = (old && old.picture) || {};
      patch(id, { picture: { ...made, alt: before.alt || "", ...(before.fill ? { fill: true } : {}) } });
    } catch (err) {
      setPictureError((x) => ({ ...x, [id]: err.message || String(err) }));
    } finally {
      setBusy((x) => ({ ...x, [id]: false }));
    }
  }

  const pictureBytes = pagesBytes(input, pages);
  const limit = type && type.maxBytes;
  const has = (p) => p && (p.picture || (p.heading || "").trim() || (p.words || "").trim() || (p.subtitle || "").trim() || (input.pageToggles || []).some((t) => p[t.key]) || (Array.isArray(p.marks) && p.marks.length > 0) || (p.piece && p.piece.uri));
  const fullness = input.wordLimit ? pageFullness(input, spec, page, values) : null;
  const words = page.words || "";

  return (
    <fieldset className="field pages">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      <div className="page-strip" role="tablist" aria-label="Pages">
        {input.pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === spec.id}
            className={`page-tab ${p.id === spec.id ? "on" : ""} ${has(pages[i]) ? "filled" : ""}`}
            onClick={() => open(p.id)}
            title={p.label}
          >
            {p.short || p.label}
          </button>
        ))}
      </div>

      <div className="page-editor" role="tabpanel" aria-label={spec.label}>
        <p className="page-editor-title">{spec.label}</p>
        {spec.layouts && (
          <div className="segmented page-layouts">
            {input.layouts.map((l) => (
              <label key={l.value} className={page.layout === l.value ? "on" : ""}>
                <input type="radio" name={`${input.key}-${spec.id}-layout`} checked={page.layout === l.value} onChange={() => patch(spec.id, { layout: l.value })} />
                {l.label}
              </label>
            ))}
          </div>
        )}
        {spec.note && <p className="field-help">{spec.note}</p>}
        {(input.pageToggles || []).filter((t) => !(t.hide && t.hide(page))).map((t) => {
          const why = t.unavailable ? t.unavailable(values, context || {}) : null;
          return (
            <div key={t.key} className="page-toggle">
              <label className="toggle">
                <input type="checkbox" role="switch" disabled={Boolean(why)} checked={Boolean(page[t.key]) && !why} onChange={(e) => patch(spec.id, { [t.key]: e.target.checked })} />
                <span className="toggle-track" aria-hidden="true" />
                <span>{t.label}</span>
              </label>
              {(why || t.help) && <p className="field-help">{why || t.help}</p>}
              {t.panel && page[t.key] && !why && (
                <TogglePanel
                  key={`${spec.id}-${t.key}`}
                  panel={t.panel}
                  page={page}
                  values={values}
                  context={context}
                  getPage={() => latest.current.find((p) => p.id === spec.id)}
                  patchPage={(change) => {
                    const now = latest.current.find((p) => p.id === spec.id);
                    if (!now) return;
                    const c = typeof change === "function" ? change(now) : change;
                    if (c) patch(now.id, c);
                  }}
                />
              )}
            </div>
          );
        })}

        {shows.includes("piece") && input.piece && (
          <div className="field page-piece">
            <span className="field-label">{labelFor("piece", "Piece")}</span>
            <TogglePanel
              key={`${spec.id}-${page.layout || ""}-piece`}
              panel={input.piece.panel}
              page={page}
              values={values}
              context={context}
              getPage={() => latest.current.find((p) => p.id === spec.id)}
              patchPage={(change) => {
                const now = latest.current.find((p) => p.id === spec.id);
                if (!now) return;
                const c = typeof change === "function" ? change(now) : change;
                if (c) patch(now.id, c);
              }}
            />
          </div>
        )}
        {shows.includes("picture") && (
          <div className="page-picture">
            {page.picture ? <PictureThumb picture={page.picture} /> : <span className="page-thumb page-thumb-empty">No picture</span>}
            <div className="page-picture-tools">
              <button type="button" className="btn btn-quiet btn-small" disabled={busy[spec.id]} onClick={() => fileRef.current && fileRef.current.click()}>
                {busy[spec.id] ? "Making it small…" : page.picture ? "Change picture" : "Choose picture"}
              </button>
              {page.picture && (
                <button type="button" className="btn btn-quiet btn-small" onClick={() => patch(spec.id, { picture: null })}>Remove</button>
              )}
              {page.picture && <span className="page-picture-size">{formatSize(page.picture.bytes.length)}</span>}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,.heic,.heif" hidden onChange={choose} />
            </div>
            {pictureError[spec.id] && <p className="field-error">{pictureError[spec.id]}</p>}
            {page.picture && input.pictureFrame && !alwaysFill && (
              <div className="segmented page-fill">
                {[[false, "Fit"], [true, "Fill"]].map(([fill, text]) => (
                  <label key={text} className={Boolean(page.picture.fill) === fill ? "on" : ""}>
                    <input type="radio" name={`${input.key}-${spec.id}-fill`} checked={Boolean(page.picture.fill) === fill} onChange={() => patch(spec.id, { picture: { ...page.picture, fill } })} />
                    {text}
                  </label>
                ))}
              </div>
            )}
            {page.picture && (page.picture.fill || alwaysFill) && input.pictureFrame && input.pictureFrame(spec, page, values) && (
              <CropEditor
                picture={page.picture}
                frame={input.pictureFrame(spec, page, values)}
                zoomMax={input.zoomMax || 2}
                label={spec.label}
                onChange={(crop) => {
                  const now = latest.current.find((p) => p.id === spec.id);
                  if (now && now.picture) patch(spec.id, { picture: { ...now.picture, crop } });
                }}
              />
            )}
            {page.picture && (
              <input
                className="text page-alt"
                value={page.picture.alt || ""}
                maxLength={200}
                placeholder="Describe the picture (optional, for screen readers)"
                aria-label="Describe the picture"
                onChange={(e) => patch(spec.id, { picture: { ...page.picture, alt: e.target.value } })}
              />
            )}
          </div>
        )}

        {shows.includes("subtitle") && (
          <div className="field page-text">
            <label className="field-label" htmlFor={`${input.key}-subtitle`}>{labelFor("subtitle", "Short line (optional)")}</label>
            <input id={`${input.key}-subtitle`} className="text" value={page.subtitle || ""} maxLength={input.subtitleMax} onChange={(e) => patch(spec.id, { subtitle: e.target.value })} />
          </div>
        )}
        {shows.includes("heading") && (
          <div className="field page-text">
            <label className="field-label" htmlFor={`${input.key}-heading`}>{labelFor("heading", "Heading (optional)")}</label>
            <input id={`${input.key}-heading`} className="text" value={page.heading || ""} maxLength={input.headingMax} onChange={(e) => patch(spec.id, { heading: e.target.value })} />
          </div>
        )}
        {shows.includes("words") && (
          <div className="field page-text">
            <label className="field-label" htmlFor={`${input.key}-words`}>{labelFor("words", "Words")}</label>
            <textarea id={`${input.key}-words`} className="text" rows={6} value={words} onChange={(e) => patch(spec.id, { words: e.target.value })} />
            {fullness != null && (
              <span className={`counter ${fullness > 100 ? "over" : ""}`}>
                {fullness > 100 ? `Too many words (${fullness}%)` : `${fullness}% of the page`}
              </span>
            )}
          </div>
        )}
        <div className="page-nav">
          <button type="button" className="btn btn-quiet btn-small" disabled={index === 0} onClick={() => open(input.pages[index - 1].id)}>← {index > 0 ? input.pages[index - 1].label : ""}</button>
          <button type="button" className="btn btn-quiet btn-small" disabled={index === input.pages.length - 1} onClick={() => open(input.pages[index + 1].id)}>{index < input.pages.length - 1 ? input.pages[index + 1].label : ""} →</button>
        </div>
      </div>
      <p className="page-size">
        {input.sizeLabel || "Pictures"}: {formatSize(pictureBytes)}{limit ? ` of ${formatSize(limit)}` : ""}
        {limit ? (
          <span className="track-side-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (pictureBytes / limit) * 100)}%` }} className={pictureBytes > limit ? "over" : ""} />
          </span>
        ) : null}
      </p>
    </fieldset>
  );
}

const KIND_COMPONENTS = {
  pages: PagesInput,
  tracks: TracksInput,
  action: ActionInput,
  sprite: SpriteInput,
  choice: ChoiceInput,
  text: TextInput,
  palette: PaletteInput,
  brush: BrushInput,
  range: RangeInput,
  seed: SeedInput,
  toggle: ToggleInput,
};

// only / skip: Sets of input keys to show or leave out (the review step shows
// the card's words and the confirmations; "Make your tile" shows the rest).
export function InputForm({ type, values, onChange, problems, context, only = null, skip = null, placeholders = null }) {
  function field(input) {
    const Component = KIND_COMPONENTS[input.kind];
    const extra = placeholders && placeholders[input.key] ? { placeholder: placeholders[input.key] } : {};
    const problem = problems.find((p) => p.key === input.key);
    // A book's pages can have several problems at once (one per page): show them all.
    const shown = input.kind === "pages" ? problems.filter((p) => p.key === input.key) : problem ? [problem] : [];
    return (
      <div key={input.key}>
        <Component input={input} value={values[input.key]} onChange={(v) => onChange(input.key, v)} type={type} values={values} context={context} {...extra} />
        {input.kind !== "sprite" && shown.map((p, i) => <p key={i} className="field-error">{p.message}</p>)}
      </div>
    );
  }

  // Inputs that share a group are shown together under the group's title.
  const blocks = [];
  const wanted = (i) => (only ? only.has(i.key) : !(skip && skip.has(i.key)));
  for (const input of type.inputs.filter((i) => isShown(i, values) && wanted(i))) {
    const last = blocks[blocks.length - 1];
    if (input.group && last && last.group === input.group) last.inputs.push(input);
    else blocks.push({ group: input.group || null, inputs: [input] });
  }

  return (
    <div className="form">
      {blocks.map((block) => {
        if (!block.group) return block.inputs.map(field);
        const group = (type.groups || []).find((g) => g.id === block.group);
        if (group.collapsed) {
          return (
            <details key={block.group} className="input-group input-group-more">
              <summary className="input-group-title">{group.title}</summary>
              {block.inputs.map(field)}
            </details>
          );
        }
        return (
          <section key={block.group} className="input-group" aria-label={group.title}>
            <p className="input-group-title">{group.title}</p>
            {block.inputs.map(field)}
          </section>
        );
      })}
    </div>
  );
}
