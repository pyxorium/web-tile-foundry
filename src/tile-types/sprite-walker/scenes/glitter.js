// Glitter profile: a 2000s personal web page. Dark tiled pattern, slowly
// twinkling sparkles, a striped "profile box" floor and an "online now!" badge.
export const glitter = {
  id: "glitter",
  version: 1,
  label: "Glitter profile",
  groundRatio: 0.76,
  paint: function (ctx, w, h, px, t) {
    var g = Math.round(h * 0.76);
    var u = Math.max(1, Math.round(px));
    ctx.fillStyle = "#1b0629";
    ctx.fillRect(0, 0, w, h);

    // Tiled background of tiny pink diamonds.
    var cell = u * 10;
    ctx.fillStyle = "rgba(255,79,184,0.28)";
    for (var y = 0, row = 0; y < g; y += cell, row++) {
      for (var x = (row % 2) * cell / 2; x < w; x += cell) {
        ctx.fillRect(x, y - u, u, u * 3);
        ctx.fillRect(x - u, y, u * 3, u);
      }
    }

    // Sparkles: four-pointed pixel stars that slowly pulse.
    var seed = 11;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var colors = ["182,255,59", "255,255,255", "255,140,214"];
    var n = Math.round((w * g) / 16000) + 5;
    for (var i = 0; i < n; i++) {
      var sx = Math.floor(rand() * w / u) * u;
      var sy = Math.floor(rand() * (g - 6 * u) / u) * u + 3 * u;
      var phase = rand() * 6.283;
      var c = colors[Math.floor(rand() * colors.length)];
      var big = rand() > 0.6 ? 2 : 1;
      var a = t ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 900 + phase)) : 0.9;
      ctx.fillStyle = "rgba(" + c + "," + a + ")";
      ctx.fillRect(sx, sy, u, u);
      ctx.fillRect(sx - u * big, sy, u * big, u);
      ctx.fillRect(sx + u, sy, u * big, u);
      ctx.fillRect(sx, sy - u * big, u, u * big);
      ctx.fillRect(sx, sy + u, u, u * big);
    }

    // Floor: a striped "profile box" with a dashed lime border.
    var floor = ctx.createLinearGradient(0, g, 0, h);
    floor.addColorStop(0, "#ff4fb8");
    floor.addColorStop(1, "#8e1d6e");
    ctx.fillStyle = floor;
    ctx.fillRect(0, g, w, h - g);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (var fy = g + 3 * u; fy < h; fy += 4 * u) ctx.fillRect(0, fy, w, u);
    ctx.fillStyle = "#b6ff3b";
    for (var dx = 0; dx < w; dx += 3 * u) ctx.fillRect(dx, g, u * 2, u);

    // The badge, top left (the gear sits top right).
    var fs = Math.max(10, u * 5);
    ctx.font = "bold " + fs + "px Verdana, Tahoma, sans-serif";
    ctx.textBaseline = "top";
    var label = "♥ online now!";
    var bx = Math.round(fs * 0.8), by = Math.round(fs * 0.8);
    var tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(255,79,184,0.85)";
    ctx.fillRect(bx - u * 2, by - u * 2, tw + u * 4, fs + u * 4);
    ctx.fillStyle = "#b6ff3b";
    ctx.fillText(label, bx, by);
    return g;
  },
};
