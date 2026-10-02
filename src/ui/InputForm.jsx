import { useEffect, useRef, useState } from "react";
import { spriteFromBytes } from "../core/sprite-source.js";
import { formatSize } from "../core/fileset.js";
import { DEBUG } from "./debug.js";

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
  const spriteKey = sprite ? sprite.cid : "none";

  useEffect(() => {
    let cancelled = false;
    const made = {};
    (async () => {
      for (const o of input.options) {
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
    // Only the sprite changes what a swatch looks like.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, input, spriteKey]);

  return (
    <fieldset className="field">
      <legend className="field-label">{input.label}</legend>
      {input.help && <p className="field-help">{input.help}</p>}
      <div className="swatches">
        {input.options.map((o) => (
          <label key={o.value} className={`swatch ${value === o.value ? "on" : ""}`}>
            <input type="radio" name={input.key} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            {urls[o.value] ? <img src={urls[o.value]} alt="" /> : <span className="swatch-blank" />}
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

const KIND_COMPONENTS = { sprite: SpriteInput, choice: ChoiceInput, text: TextInput };

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
  for (const input of type.inputs) {
    const last = blocks[blocks.length - 1];
    if (input.group && last && last.group === input.group) last.inputs.push(input);
    else blocks.push({ group: input.group || null, inputs: [input] });
  }

  return (
    <div className="form">
      {blocks.map((block) => {
        if (!block.group) return block.inputs.map(field);
        const group = (type.groups || []).find((g) => g.id === block.group);
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
