// Café corner: a warm wall with a window, a counter with a steaming mug,
// and a wooden plank floor. A nod to thunderbird.cafe.
export const cafe = {
  id: "cafe",
  version: 1,
  label: "Café corner",
  groundRatio: 0.76,
  paint: function (ctx, w, h, px, t) {
    var u = Math.max(1, Math.round(px));
    var g = Math.round(h * 0.76);
    function snap(v) { return Math.round(v / u) * u; }

    // Wall and wainscot.
    ctx.fillStyle = "#f0dcb8";
    ctx.fillRect(0, 0, w, g);
    var wy = snap(g - h * 0.17);
    ctx.fillStyle = "#c9925e";
    ctx.fillRect(0, wy, w, g - wy);
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    for (var px2 = u * 8; px2 < w; px2 += u * 16) ctx.fillRect(px2, wy + u * 3, u, g - wy - u * 5);
    ctx.fillStyle = "#8a5a36";
    ctx.fillRect(0, wy - u * 2, w, u * 2);

    // Window, left.
    var wx = snap(w * 0.08), wt = snap(h * 0.12), ww = snap(w * 0.24), wh = snap(h * 0.36);
    ctx.fillStyle = "#7a4b2b";
    ctx.fillRect(wx, wt, ww, wh);
    var sky = ctx.createLinearGradient(0, wt, 0, wt + wh);
    sky.addColorStop(0, "#9fd4f0");
    sky.addColorStop(1, "#e3f4fb");
    ctx.fillStyle = sky;
    var f = u * 2;
    var paneW = (ww - f * 3) / 2, paneH = (wh - f * 3) / 2;
    for (var r = 0; r < 2; r++) for (var c = 0; c < 2; c++) {
      ctx.fillRect(snap(wx + f + c * (paneW + f)), snap(wt + f + r * (paneH + f)), snap(paneW), snap(paneH));
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(snap(wx + ww * 0.18), snap(wt + wh * 0.22), u * 8, u * 2);
    ctx.fillRect(snap(wx + ww * 0.22), snap(wt + wh * 0.22) - u * 2, u * 4, u * 2);

    // Counter, back right, with a mug.
    var cx = snap(w * 0.68), ct = snap(g - h * 0.24);
    ctx.fillStyle = "#8a5634";
    ctx.fillRect(cx, ct, w - cx, g - ct);
    ctx.fillStyle = "#5e3820";
    ctx.fillRect(cx - u * 2, ct - u * 2, w - cx + u * 2, u * 3);
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (var cp = cx + u * 6; cp < w; cp += u * 12) ctx.fillRect(cp, ct + u * 3, u, g - ct - u * 3);
    var mx = snap(w * 0.82), my = ct - u * 7;
    ctx.fillStyle = "#fbf6ee";
    ctx.fillRect(mx, my, u * 6, u * 5);
    ctx.fillRect(mx + u * 6, my + u, u * 2, u);
    ctx.fillRect(mx + u * 7, my + u, u, u * 3);
    ctx.fillRect(mx + u * 6, my + u * 3, u * 2, u);
    ctx.fillStyle = "#d9534f";
    ctx.fillRect(mx, my + u * 2, u * 6, u);
    // Steam, rising and swaying.
    for (var s = 0; s < 3; s++) {
      for (var k = 0; k < 4; k++) {
        var rise = t ? ((t / 60 + k * 9 + s * 5) % 36) : k * 9;
        var sway = t ? Math.round(Math.sin(t / 400 + k + s * 2) * 1.2) : (k % 2);
        var a = 0.55 * (1 - rise / 36);
        ctx.fillStyle = "rgba(255,255,255," + a + ")";
        ctx.fillRect(mx + u + s * u * 2 + sway * u, my - u * 2 - Math.round(rise / 3) * u, u, u * 2);
      }
    }

    // Plank floor.
    ctx.fillStyle = "#a8744a";
    ctx.fillRect(0, g, w, h - g);
    ctx.fillStyle = "#8a5c37";
    var pr = 0;
    for (var py = g + u * 5; py < h; py += u * 5, pr++) {
      ctx.fillRect(0, py, w, u);
      for (var sx = (pr % 2) * u * 20; sx < w; sx += u * 40) ctx.fillRect(sx, py - u * 5, u, u * 5);
    }
    ctx.fillStyle = "rgba(255,240,210,0.25)";
    ctx.fillRect(0, g, w, u);
    return g;
  },
};
