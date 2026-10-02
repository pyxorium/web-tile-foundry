// Snowy night: navy sky, a pixel moon, pine silhouettes, snow on the ground
// and flakes drifting down.
export const snow = {
  id: "snow",
  version: 1,
  label: "Snowy night",
  groundRatio: 0.76,
  paint: function (ctx, w, h, px, t) {
    var u = Math.max(1, Math.round(px));
    var g = Math.round(h * 0.76);
    var seed = 43;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    var sky = ctx.createLinearGradient(0, 0, 0, g);
    sky.addColorStop(0, "#0f1a3a");
    sky.addColorStop(1, "#33507e");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, g);

    // Moon, top left: a pixel disc.
    var mr = 6;
    var mx = Math.round((w * 0.15) / u) * u, my = Math.round((h * 0.2) / u) * u;
    ctx.fillStyle = "#f3f0d8";
    for (var dy = -mr; dy <= mr; dy++) {
      var half = Math.floor(Math.sqrt(mr * mr - dy * dy));
      ctx.fillRect(mx - half * u, my + dy * u, (half * 2 + 1) * u, u);
    }
    ctx.fillStyle = "rgba(170,165,140,0.5)";
    ctx.fillRect(mx - 2 * u, my - u, 2 * u, 2 * u);
    ctx.fillRect(mx + 2 * u, my + 2 * u, u, u);

    // Pines: stepped triangles along the horizon.
    ctx.fillStyle = "#1d3a40";
    var x = Math.round(rand() * u * 10);
    while (x < w) {
      var tall = 10 + Math.floor(rand() * 9);
      for (var lvl = 0; lvl < tall; lvl++) {
        var half2 = Math.floor((tall - lvl) / 2.2);
        ctx.fillRect(x - half2 * u, g - (lvl + 1) * u, (half2 * 2 + 1) * u, u);
      }
      x += Math.round((6 + rand() * 14) * u);
    }

    // Snowy ground.
    var ground = ctx.createLinearGradient(0, g, 0, h);
    ground.addColorStop(0, "#eef4fb");
    ground.addColorStop(1, "#bccbe0");
    ctx.fillStyle = ground;
    ctx.fillRect(0, g, w, h - g);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, g, w, u);

    // Falling flakes.
    var n = Math.round((w * h) / 7000) + 10;
    for (var i = 0; i < n; i++) {
      var x0 = rand() * w, y0 = rand() * h;
      var speed = h / (7000 + rand() * 5000);
      var phase = rand() * 6.283;
      var size = rand() > 0.8 ? 2 : 1;
      var fy = (y0 + (t ? t * speed : 0)) % h;
      var fx = x0 + (t ? Math.sin(t / 1300 + phase) * 3 * u : 0);
      ctx.fillStyle = "rgba(255,255,255," + (size === 2 ? 0.95 : 0.75) + ")";
      ctx.fillRect(Math.round(fx / u) * u, Math.round(fy / u) * u, size * u, size * u);
    }
    return g;
  },
};
