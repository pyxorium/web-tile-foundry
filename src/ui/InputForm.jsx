import { useEffect, useRef, useState } from "react";
import { spriteFromBytes } from "../core/sprite-source.js";
import { formatSize } from "../core/fileset.js";
import { DEBUG } from "./debug.js";
import { isShown, formatDuration, TRANSITIONS, TRACK_TITLE_MAX } from "../core/contract.js";

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

function TextInput({ input, value, onChange }) {
  const id = `input-${input.key}`;
  const Tag = input.multiline ? "textarea" : "input";
  const length = (value || "").length;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{input.label}</label>
      <Tag
        id={id}
        className="text"
        value={value || ""}
        maxLength={input.maxLength}
        rows={input.multiline ? 2 : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {input.maxLength && <span className="counter">{length} / {input.maxLength}</span>}
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
      if (h && h.update) h.update(tracksRef.current);
    });
    return () => {
      disposed = true;
      if (handleRef.current && handleRef.current.dispose) handleRef.current.dispose();
      handleRef.current = null;
    };
    // Mount once per picker; later changes reach it through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker]);

  useEffect(() => {
    if (handleRef.current && handleRef.current.update) handleRef.current.update(tracks);
  }, [tracks]);

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
                      <select value={t.transition || "fade"} onChange={(e) => patch(t.id, { transition: e.target.value })}>
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

const KIND_COMPONENTS = {
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

export function InputForm({ type, values, onChange, problems, context }) {
  function field(input) {
    const Component = KIND_COMPONENTS[input.kind];
    const problem = problems.find((p) => p.key === input.key);
    return (
      <div key={input.key}>
        <Component input={input} value={values[input.key]} onChange={(v) => onChange(input.key, v)} type={type} values={values} context={context} />
        {problem && input.kind !== "sprite" && <p className="field-error">{problem.message}</p>}
      </div>
    );
  }

  // Inputs that share a group are shown together under the group's title.
  const blocks = [];
  for (const input of type.inputs.filter((i) => isShown(i, values))) {
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
