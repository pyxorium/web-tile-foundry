// Plain colour: calm and quiet, for busy pages. A soft warm grey with a hint
// of floor so the sprite still has somewhere to stand.
export const plain = {
  id: "plain",
  version: 1,
  label: "Plain colour",
  groundRatio: 0.78,
  paint: function (ctx, w, h, px, t) {
    var g = Math.round(h * 0.78);
    ctx.fillStyle = "#e8e3d9";
    ctx.fillRect(0, 0, w, h);
    var floor = ctx.createLinearGradient(0, g, 0, h);
    floor.addColorStop(0, "rgba(120,105,85,0.10)");
    floor.addColorStop(1, "rgba(120,105,85,0.02)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, g, w, h - g);
    return g;
  },
};
