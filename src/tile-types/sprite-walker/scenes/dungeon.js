// Dungeon floor: a stone brick wall with two flickering torches, and a
// flagstone floor. The scene closest to rpg.actor's RPG roots.
export const dungeon = {
  id: "dungeon",
  version: 1,
  label: "Dungeon floor",
  groundRatio: 0.72,
  paint: function (ctx, w, h, px, t) {
    var u = Math.max(1, Math.round(px));
    var g = Math.round(h * 0.72);
    var seed = 31;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    // Wall: offset rows of bricks; the background shows through as mortar.
    ctx.fillStyle = "#1f1b27";
    ctx.fillRect(0, 0, w, g);
    var bh = u * 6, bw = u * 12;
    var shades = ["#3a3446", "#36303f", "#403a4d", "#332d3c"];
    for (var y = 0, row = 0; y < g; y += bh, row++) {
      for (var x = -((row % 2) * bw) / 2; x < w; x += bw) {
        ctx.fillStyle = shades[Math.floor(rand() * shades.length)];
        ctx.fillRect(Math.round(x) + u, y + u, bw - u, Math.min(bh - u, g - y - u));
      }
    }
    // A darker band where the wall meets the floor.
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, g - u * 3, w, u * 3);

    // Floor: flagstones.
    ctx.fillStyle = "#4a4458";
    ctx.fillRect(0, g, w, h - g);
    ctx.fillStyle = "#2c2735";
    var sh = u * 7;
    for (var fy = g + sh, frow = 0; fy < h; fy += sh, frow++) ctx.fillRect(0, fy, w, u);
    for (var ry = g, rrow = 0; ry < h; ry += sh, rrow++) {
      for (var fx = (rrow % 2) * u * 9; fx < w; fx += u * 18) ctx.fillRect(fx, ry, u, sh);
    }
    ctx.fillStyle = "rgba(255,210,150,0.12)";
    ctx.fillRect(0, g, w, u);

    // Torches with a warm, flickering glow.
    var spots = [0.16, 0.84];
    for (var i = 0; i < spots.length; i++) {
      var tx = Math.round((w * spots[i]) / u) * u;
      var ty = Math.round((h * 0.3) / u) * u;
      var f = t ? 0.5 + 0.25 * Math.sin(t / 110 + i * 2) + 0.15 * Math.sin(t / 47 + i) : 0.6;
      var glow = ctx.createRadialGradient(tx, ty, 0, tx, ty, u * 34);
      glow.addColorStop(0, "rgba(255,170,70," + (0.32 + 0.12 * f) + ")");
      glow.addColorStop(1, "rgba(255,170,70,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(tx - u * 34, ty - u * 34, u * 68, u * 68);
      // Bracket.
      ctx.fillStyle = "#5c5566";
      ctx.fillRect(tx - u * 2, ty + u * 2, u * 4, u * 2);
      ctx.fillRect(tx - u, ty + u * 4, u * 2, u * 5);
      // Flame: three heights cycling.
      var frame = t ? Math.floor(t / 140 + i) % 3 : 1;
      var fh = [5, 7, 6][frame];
      ctx.fillStyle = "#ff7a1a";
      ctx.fillRect(tx - u * 2, ty + u * 2 - u * fh, u * 4, u * fh);
      ctx.fillStyle = "#ffd25a";
      ctx.fillRect(tx - u, ty + u * 2 - u * (fh - 2), u * 2, u * (fh - 2));
    }
    return g;
  },
};
