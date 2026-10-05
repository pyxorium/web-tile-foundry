// Everything the viewer touches, laid over the ride (plain DOM, styled
// inline, so a tile needs no extra stylesheet). See the controls sketch in
// the plan (§13): what shows depends on the ride's state.
//
//   waiting    "Tap to ride"; theme and view chips (top left); the gear (top right)
//   boarding   with a track switch: two big buttons at the sides ("← Frolic",
//              "Detour →", following the track) and the hint "Tap left or right
//              to choose your way"; in the view from above, two plain buttons at
//              the bottom instead. They pulse after a while (the scene's job
//              on the sign; here, the buttons)
//   riding     nothing but a dimmed gear
//   settling   nothing but a dimmed gear
//   done       "Ride again" (green) at the bottom, where "Tap to ride" was, and
//              a slim strip along the bottom edge: "Built by @handle · Make
//              your own"; the chips again. Nothing covers the coaster
//
// The gear menu holds Sound, View (Behind, Outside, Above) and Theme (Day,
// Night, Spooky). Every control is a real button, so keyboards and screen
// readers can use them; the tap-anywhere-on-a-half behavior is the mount's.

const INK = "#ffffff";
const GLASS = "rgba(14, 12, 20, 0.62)";
const EDGE = "1px solid rgba(255, 255, 255, 0.32)";
const GO = "#178a4c"; // "Ride again": green for go (white text stays easy to read on it)
const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

export const VIEWS = Object.freeze([
  Object.freeze({ id: "behind", label: "Behind" }),
  Object.freeze({ id: "outside", label: "Outside" }),
  Object.freeze({ id: "above", label: "Above" }),
]);
const THEME_LABELS = Object.freeze({ day: "Day", night: "Night", spooky: "Spooky" });
const THEME_ICONS = Object.freeze({ day: "☀", night: "☾", spooky: "✦" });

function el(tag, style = {}, attrs = {}) {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  return node;
}

function button(text, style = {}, label = text) {
  const b = el("button", { font: `600 14px ${FONT}`, color: INK, background: GLASS, border: EDGE, cursor: "pointer", padding: "0 12px", ...style }, { type: "button", "aria-label": label, text });
  b.addEventListener("pointerdown", (e) => e.stopPropagation()); // a button is not a tap on the ride
  b.addEventListener("click", (e) => e.stopPropagation());
  return b;
}

/**
 * box: the positioned element the ride fills. options:
 *   handle (creator's handle, for the credit), makeUrl (link to the Foundry),
 *   themes (ids), theme, view, sound (on or off),
 *   onRide(), onChoose(side "left" | "right"), onTheme(id), onView(id), onSound(on)
 */
export function createControls(box, options) {
  const { handle = null, makeUrl = null, themes = ["day", "night", "spooky"], onRide, onChoose, onTheme, onView, onSound } = options;
  let theme = options.theme;
  let view = options.view;
  let sound = options.sound !== false;
  let state = "waiting";
  let ridden = 0;
  let routes = 1;
  let pulse = null;

  const layer = el("div", { position: "absolute", inset: "0", pointerEvents: "none", font: `14px ${FONT}`, color: INK, userSelect: "none" });
  box.append(layer);
  const live = (node) => {
    node.style.pointerEvents = "auto";
    layer.append(node);
    return node;
  };
  // Shows or hides a control, keeping its own display (flex, for example).
  const show = (node, on) => {
    if (node.dataset.display === undefined) node.dataset.display = node.style.display === "none" ? "" : node.style.display;
    node.style.display = on ? node.dataset.display : "none";
  };

  // ---------- theme and view chips (top left) ----------
  const chips = live(el("div", { position: "absolute", top: "10px", left: "10px", display: "flex", gap: "6px" }));
  const chipStyle = { height: "32px", borderRadius: "16px", font: `600 13px ${FONT}` };
  const themeChip = button("", chipStyle);
  const viewChip = button("", chipStyle);
  chips.append(themeChip, viewChip);
  const nextOf = (list, id) => list[(list.indexOf(id) + 1) % list.length];
  themeChip.addEventListener("click", () => onTheme(nextOf(themes, theme)));
  viewChip.addEventListener("click", () => onView(nextOf(VIEWS.map((v) => v.id), view)));

  // ---------- the gear and its menu (top right) ----------
  const gearWrap = live(el("div", { position: "absolute", top: "10px", right: "10px" }));
  const gear = button("⚙", { width: "40px", height: "40px", borderRadius: "50%", padding: "0", fontSize: "20px", lineHeight: "1" }, "Settings");
  gear.setAttribute("aria-expanded", "false");
  const menu = el("div", { display: "none", position: "absolute", top: "48px", right: "0", width: "200px", padding: "10px 12px", borderRadius: "10px", background: "rgba(14, 12, 20, 0.92)", boxShadow: "0 6px 24px rgba(0,0,0,0.5)" });
  gearWrap.append(gear, menu);
  const soundRow = el("label", { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 0 8px", cursor: "pointer" });
  const soundBox = el("input", {}, { type: "checkbox" });
  soundRow.append(el("span", {}, { text: "Sound" }), soundBox);
  soundBox.addEventListener("change", () => onSound(soundBox.checked));
  const segment = (title, items, pick) => {
    const wrap = el("div", { marginBottom: "6px" });
    wrap.append(el("div", { fontSize: "12px", opacity: "0.7", margin: "2px 0 4px" }, { text: title }));
    const row = el("div", { display: "flex", gap: "4px" }, { role: "group", "aria-label": title });
    const buttons = items.map(([id, label]) => {
      const b = button(label, { flex: "1", height: "30px", padding: "0", borderRadius: "7px", font: `600 12px ${FONT}` });
      b.addEventListener("click", () => pick(id));
      row.append(b);
      return [id, b];
    });
    wrap.append(row);
    menu.append(wrap);
    return (current) => {
      for (const [id, b] of buttons) {
        const on = id === current;
        b.style.background = on ? "#f4ecdc" : "rgba(255,255,255,0.12)";
        b.style.color = on ? "#211a12" : INK;
        b.setAttribute("aria-pressed", String(on));
      }
    };
  };
  menu.append(soundRow);
  const markView = segment("View", VIEWS.map((v) => [v.id, v.label]), (id) => onView(id));
  const markTheme = segment("Theme", themes.map((id) => [id, THEME_LABELS[id] || id]), (id) => onTheme(id));
  const setMenu = (open) => {
    menu.style.display = open ? "block" : "none";
    gear.setAttribute("aria-expanded", String(open));
  };
  gear.addEventListener("click", () => setMenu(menu.style.display === "none"));
  const closeMenu = (e) => {
    if (!gearWrap.contains(e.target)) setMenu(false);
  };
  document.addEventListener("pointerdown", closeMenu);

  // ---------- "Tap to ride" and the hint (bottom) ----------
  const prompt = live(
    el("div", { position: "absolute", left: "50%", bottom: "14px", transform: "translateX(-50%)", whiteSpace: "nowrap", maxWidth: "calc(100% - 20px)", overflow: "hidden", textOverflow: "ellipsis", font: `700 16px ${FONT}`, background: "rgba(12, 14, 22, 0.66)", borderRadius: "999px", padding: "9px 20px", pointerEvents: "none" }, { "aria-live": "polite" })
  );
  prompt.style.pointerEvents = "none";
  const rideButton = live(button("Ride", { position: "absolute", width: "1px", height: "1px", padding: "0", overflow: "hidden", clip: "rect(0 0 0 0)", border: "0" }, "Ride the coaster"));
  rideButton.addEventListener("click", () => onRide());

  // ---------- choosing: big buttons at the sides, or plain ones at the bottom (view from above) ----------
  const sideStyle = (left) => ({
    position: "absolute", top: "22%", bottom: "20%", [left ? "left" : "right"]: "10px", width: "min(26%, 150px)", borderRadius: "14px",
    background: "rgba(12, 14, 22, 0.42)", border: "2px solid rgba(255,255,255,0.6)", font: `800 clamp(15px, 4.5vw, 22px) ${FONT}`,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", transition: "opacity 0.35s, transform 0.35s",
  });
  const leftBig = live(button("", sideStyle(true)));
  const rightBig = live(button("", sideStyle(false)));
  const bottomRow = live(el("div", { position: "absolute", left: "50%", bottom: "14px", transform: "translateX(-50%)", display: "flex", gap: "10px", width: "max-content" }));
  const leftSmall = button("", { height: "40px", borderRadius: "20px", font: `800 15px ${FONT}`, padding: "0 18px" });
  const rightSmall = button("", { height: "40px", borderRadius: "20px", font: `800 15px ${FONT}`, padding: "0 18px" });
  bottomRow.append(leftSmall, rightSmall);
  leftBig.addEventListener("click", () => onChoose("left"));
  rightBig.addEventListener("click", () => onChoose("right"));
  leftSmall.addEventListener("click", () => onChoose("left"));
  rightSmall.addEventListener("click", () => onChoose("right"));
  let names = { left: "Frolic", right: "Detour" };
  function labelChoices() {
    leftBig.innerHTML = "";
    rightBig.innerHTML = "";
    leftBig.append(el("span", {}, { text: `← ${names.left}` }), el("small", { font: `500 11px ${FONT}`, opacity: "0.85" }, { text: "tap this side" }));
    rightBig.append(el("span", {}, { text: `${names.right} →` }), el("small", { font: `500 11px ${FONT}`, opacity: "0.85" }, { text: "tap this side" }));
    leftSmall.textContent = `← ${names.left}`;
    rightSmall.textContent = `${names.right} →`;
    for (const [b, side] of [[leftBig, "left"], [rightBig, "right"], [leftSmall, "left"], [rightSmall, "right"]]) b.setAttribute("aria-label", `${names[side]}, ${side}`);
  }
  labelChoices();

  // ---------- the end: "Ride again" and the credit strip ----------
  const again = live(button("Ride again", { position: "absolute", left: "50%", bottom: "34px", transform: "translateX(-50%)", height: "42px", padding: "0 30px", background: GO, border: "0", borderRadius: "999px", font: `800 16px ${FONT}`, boxShadow: "0 3px 12px rgba(0,0,0,0.35)", whiteSpace: "nowrap" }));
  again.addEventListener("click", () => onRide());
  const strip = live(el("div", { position: "absolute", left: "0", right: "0", bottom: "0", height: "24px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", font: `12px ${FONT}`, background: "rgba(12, 14, 22, 0.55)", whiteSpace: "nowrap", overflow: "hidden" }));
  if (handle) strip.append(el("span", {}, { text: `Built by @${handle}` }));
  if (makeUrl) {
    if (handle) strip.append(el("span", { opacity: "0.6" }, { text: "·" }));
    const make = el("a", { color: INK, opacity: "0.9" }, { href: makeUrl, target: "_blank", rel: "noopener", text: "Make your own" });
    make.addEventListener("click", (e) => e.stopPropagation());
    make.addEventListener("pointerdown", (e) => e.stopPropagation());
    strip.append(make);
  }

  function render() {
    const choosing = state === "boarding" && routes > 1 && !options.chosen;
    show(chips, state === "waiting" || state === "done");
    themeChip.textContent = `${THEME_ICONS[theme] || ""} ${THEME_LABELS[theme] || theme}`;
    themeChip.setAttribute("aria-label", `Theme: ${THEME_LABELS[theme] || theme}. Change theme`);
    const v = VIEWS.find((x) => x.id === view) || VIEWS[0];
    viewChip.textContent = `View: ${v.label}`;
    viewChip.setAttribute("aria-label", `View: ${v.label}. Change view`);
    gear.style.opacity = state === "riding" || state === "settling" || state === "boarding" ? "0.5" : "1";
    soundBox.checked = sound;
    markView(view);
    markTheme(theme);
    show(prompt, state === "waiting" || choosing);
    prompt.textContent = choosing ? (view === "above" ? "Choose your way" : "Tap left or right to choose your way") : "Tap to ride";
    prompt.style.bottom = choosing && view === "above" ? "62px" : "14px";
    prompt.style.font = choosing ? `600 13px ${FONT}` : `700 16px ${FONT}`;
    show(rideButton, state === "waiting");
    show(leftBig, choosing && view !== "above");
    show(rightBig, choosing && view !== "above");
    show(bottomRow, choosing && view === "above");
    show(again, state === "done");
    show(strip, state === "done" && (handle || makeUrl));
    if (choosing && !pulse) {
      const started = performance.now();
      pulse = setInterval(() => {
        const t = (performance.now() - started) / 1000;
        const k = t > 5 ? 1 + 0.06 * Math.sin((t - 5) * 4) : 1;
        for (const b of [leftBig, rightBig, leftSmall, rightSmall]) b.style.transform = `scale(${k.toFixed(3)})`;
      }, 50);
    } else if (!choosing && pulse) {
      clearInterval(pulse);
      pulse = null;
      for (const b of [leftBig, rightBig, leftSmall, rightSmall]) b.style.transform = "";
    }
  }
  render();

  return {
    /** The ride's state, and with a switch: names by side, whether a choice is made, ways ridden of how many. */
    setState(next, extra = {}) {
      state = next;
      if (extra.names) {
        names = extra.names;
        labelChoices();
      }
      options.chosen = Boolean(extra.chosen);
      if (Number.isFinite(extra.ridden)) ridden = extra.ridden;
      if (Number.isFinite(extra.routes)) routes = extra.routes;
      if (state !== "waiting" && state !== "done") setMenu(false);
      render();
    },
    setTheme(id) {
      theme = id;
      render();
    },
    setView(id) {
      view = id;
      render();
    },
    setSound(on) {
      sound = on;
      render();
    },
    /** Moves keyboard focus to the main action (after "Ride again", for example). */
    focusMain() {
      (state === "done" ? again : rideButton).focus({ preventScroll: true });
    },
    dispose() {
      if (pulse) clearInterval(pulse);
      document.removeEventListener("pointerdown", closeMenu);
      layer.remove();
    },
  };
}
