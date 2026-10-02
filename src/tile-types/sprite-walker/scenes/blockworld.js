// Block world: a blocky voxel-style landscape in our own colours. Blue sky,
// square clouds drifting by, stepped hills, and grass-topped dirt blocks.
export const blockworld = {
  id: "blockworld",
  version: 1,
  label: "Block world",
  groundRatio: 0.72,
  paint: function (ctx, w, h, px, t) {
    var u = Math.max(1, Math.round(px));
    var B = u * 6;
    var g = Math.round((h * 0.72) / B) * B;

    var sky = ctx.createLinearGradient(0, 0, 0, g);
    sky.addColorStop(0, "#5aa9ec");
    sky.addColorStop(1, "#c4e7ff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, g);

    var seed = 23;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

    // Clouds made of blocks, drifting slowly to the right.
    var shapes = [[0, 1, 1, 0, 0], [1, 1, 1, 1, 1]];
    var cs = B * 1.5;
    for (var c = 0; c < 3; c++) {
      var cy = Math.round((0.08 + rand() * 0.28) * g / u) * u;
      var span = w + 5 * cs;
      var cx = ((rand() * span + (t ? t * w / 90000 : 0)) % span) - 5 * cs;
      cx = Math.round(cx / u) * u;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      for (var r = 0; r < shapes.length; r++) {
        for (var k = 0; k < shapes[r].length; k++) {
          if (shapes[r][k]) ctx.fillRect(cx + k * cs, cy + r * cs, cs, cs);
        }
      }
    }

    // Distant stepped hills.
    ctx.fillStyle = "#7fb878";
    var hgt = 2;
    for (var x = 0; x < w; x += B) {
      hgt = Math.max(1, Math.min(5, hgt + Math.floor(rand() * 3) - 1));
      ctx.fillRect(x, g - hgt * B, B, hgt * B);
    }

    // Grass layer, one block tall, with drips into the dirt.
    ctx.fillStyle = "#8b5a2b";
    ctx.fillRect(0, g, w, h - g);
    ctx.fillStyle = "#5aa832";
    ctx.fillRect(0, g, w, B);
    ctx.fillStyle = "#7cc94a";
    ctx.fillRect(0, g, w, u);
    for (var dx = 0; dx < w; dx += u * 2) {
      var drip = Math.floor(rand() * 3);
      if (drip) { ctx.fillStyle = "#5aa832"; ctx.fillRect(dx, g + B, u * 2, drip * u); }
    }
    // Speckled dirt.
    var spots = Math.round((w * (h - g)) / (B * B)) * 3;
    for (var i = 0; i < spots; i++) {
      ctx.fillStyle = rand() > 0.5 ? "#6e4520" : "#a8723e";
      var sx = Math.floor(rand() * w / u) * u;
      var sy = g + B + Math.floor(rand() * (h - g - B) / u) * u;
      ctx.fillRect(sx, sy, u * 2, u * 2);
    }
    // Faint block grid.
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (var gx = 0; gx < w; gx += B) ctx.fillRect(gx, g, u > 1 ? 1 : 1, h - g);
    for (var gy = g + B; gy < h; gy += B) ctx.fillRect(0, gy, w, 1);
    return g;
  },
};
