// Twilight lawn: dusk sky, pixel stars, a grass strip. The original scene.
export const twilight = {
  id: "twilight",
  version: 1,
  label: "Twilight lawn",
  groundRatio: 0.74,
  paint: function (ctx, w, h, px, t) {
    var groundY = Math.round(h * 0.74);
    var u = Math.max(1, Math.round(px));
    var sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, "#1d1f45");
    sky.addColorStop(0.55, "#4b3f7d");
    sky.addColorStop(1, "#c98a7a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, groundY);

    var seed = 7;
    function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    var count = Math.round((w * groundY) / 9000) + 6;
    for (var i = 0; i < count; i++) {
      var x = Math.floor(rand() * w / u) * u;
      var y = Math.floor(rand() * groundY * 0.6 / u) * u;
      var warm = rand() > 0.7;
      var phase = rand() * 6.283;
      var a = t ? 0.55 + 0.4 * Math.sin(t / 1400 + phase) : 0.75;
      ctx.fillStyle = warm ? "rgba(255,240,200," + a + ")" : "rgba(220,225,255," + a * 0.75 + ")";
      ctx.fillRect(x, y, u, u);
    }

    var ground = ctx.createLinearGradient(0, groundY, 0, h);
    ground.addColorStop(0, "#3c5a43");
    ground.addColorStop(1, "#22362a");
    ctx.fillStyle = ground;
    ctx.fillRect(0, groundY, w, h - groundY);
    ctx.fillStyle = "rgba(255,236,190,0.35)";
    ctx.fillRect(0, groundY, w, u);
    return groundY;
  },
};
