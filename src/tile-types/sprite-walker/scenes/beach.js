// Beach day: bright sky and sun, a strip of sea with drifting wave glints,
// foam at the shoreline, and speckled sand.
export const beach = {
  id: "beach",
  version: 1,
  label: "Beach day",
  groundRatio: 0.8,
  paint: function (ctx, w, h, px, t) {
    var u = Math.max(1, Math.round(px));
    var seaTop = Math.round((h * 0.54) / u) * u;
    var sandTop = Math.round((h * 0.66) / u) * u;
    var g = Math.round(h * 0.8);
    var seed = 59;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    var sky = ctx.createLinearGradient(0, 0, 0, seaTop);
    sky.addColorStop(0, "#6cbff0");
    sky.addColorStop(1, "#dcf3ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, seaTop);

    // Sun, top left, with a soft halo.
    var sx = Math.round((w * 0.15) / u) * u, sy = Math.round((h * 0.18) / u) * u, r = 7;
    var halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, u * 22);
    halo.addColorStop(0, "rgba(255,230,140,0.55)");
    halo.addColorStop(1, "rgba(255,230,140,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(sx - u * 22, sy - u * 22, u * 44, u * 44);
    ctx.fillStyle = "#ffd65a";
    for (var dy = -r; dy <= r; dy++) {
      var half = Math.floor(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(sx - half * u, sy + dy * u, (half * 2 + 1) * u, u);
    }

    // Sea, with glints drifting slowly sideways.
    var sea = ctx.createLinearGradient(0, seaTop, 0, sandTop);
    sea.addColorStop(0, "#1f7fc2");
    sea.addColorStop(1, "#55b6e4");
    ctx.fillStyle = sea;
    ctx.fillRect(0, seaTop, w, sandTop - seaTop);
    ctx.fillStyle = "rgba(220,245,255,0.7)";
    var shift = t ? (t / 120) % (u * 24) : 0;
    for (var wy = seaTop + u * 2, row = 0; wy < sandTop - u * 2; wy += u * 3, row++) {
      for (var wx = -u * 24 + ((row * 7 * u) % (u * 24)) + shift * (row % 2 ? 1 : -1); wx < w; wx += u * 24) {
        ctx.fillRect(Math.round(wx / u) * u, wy, u * 4, u);
      }
    }

    // Sand and foam.
    var sand = ctx.createLinearGradient(0, sandTop, 0, h);
    sand.addColorStop(0, "#f4dda4");
    sand.addColorStop(1, "#e2bd78");
    ctx.fillStyle = sand;
    ctx.fillRect(0, sandTop, w, h - sandTop);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    var lap = t ? Math.round(Math.sin(t / 1600) * 1.5) : 0;
    for (var fx = 0; fx < w; fx += u * 2) {
      var bump = (Math.floor(fx / (u * 2)) % 3 === 0 ? 1 : 0) + lap;
      ctx.fillRect(fx, sandTop - u + Math.max(0, bump) * u, u * 2, u);
    }
    var specks = Math.round((w * (h - sandTop)) / (u * u * 60));
    for (var i = 0; i < specks; i++) {
      ctx.fillStyle = rand() > 0.5 ? "rgba(170,120,60,0.35)" : "rgba(255,250,235,0.6)";
      ctx.fillRect(Math.floor(rand() * w / u) * u, sandTop + u * 2 + Math.floor(rand() * (h - sandTop) / u) * u, u, u);
    }
    return g;
  },
};
