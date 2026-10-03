// The gear menu: a small round button in a corner that opens a panel with
// "Slow turn" (on or off) and "Reset view". Novice-simple wording. Plain DOM,
// styled inline so a tile needs no extra stylesheet.

export function createGearMenu({ parent = document.body, corner = "top-right", slowTurn = true, onSlowTurn, onReset } = {}) {
  const [v, h] = corner.split("-");
  const wrap = document.createElement("div");
  Object.assign(wrap.style, { position: "fixed", [v]: "12px", [h]: "12px", zIndex: "5", font: "15px system-ui, sans-serif" });

  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Settings");
  button.setAttribute("aria-expanded", "false");
  button.textContent = "⚙";
  Object.assign(button.style, {
    width: "40px", height: "40px", borderRadius: "50%", border: "1px solid rgba(244,233,214,0.35)",
    background: "rgba(14,9,7,0.6)", color: "#f4e9d6", fontSize: "21px", lineHeight: "1", cursor: "pointer", padding: "0",
  });

  const panel = document.createElement("div");
  Object.assign(panel.style, {
    display: "none", position: "absolute", [v]: "48px", [h]: "0", minWidth: "170px", padding: "10px 12px",
    borderRadius: "10px", background: "rgba(14,9,7,0.88)", color: "#f4e9d6", boxShadow: "0 6px 24px rgba(0,0,0,0.5)",
  });

  const label = document.createElement("label");
  Object.assign(label.style, { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "4px 0" });
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = slowTurn;
  check.addEventListener("change", () => onSlowTurn && onSlowTurn(check.checked));
  label.append(check, document.createTextNode("Slow turn"));

  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset view";
  Object.assign(reset.style, {
    marginTop: "6px", width: "100%", padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(244,233,214,0.35)",
    background: "transparent", color: "inherit", font: "inherit", cursor: "pointer",
  });
  reset.addEventListener("click", () => {
    if (onReset) onReset();
    setOpen(false);
  });

  panel.append(label, reset);
  wrap.append(button, panel);
  parent.append(wrap);

  function setOpen(open) {
    panel.style.display = open ? "block" : "none";
    button.setAttribute("aria-expanded", String(open));
  }
  button.addEventListener("click", () => setOpen(panel.style.display === "none"));
  // A tap anywhere else closes it.
  document.addEventListener("pointerdown", (e) => {
    if (!wrap.contains(e.target)) setOpen(false);
  });

  return {
    element: wrap,
    setSlowTurn(on) {
      check.checked = Boolean(on);
    },
    close: () => setOpen(false),
  };
}
