// The little scene a sprite stands in: a dusk sky with a few pixel stars and a
// ground strip. Used both inside the tile and for the card's icon and banner,
// so they always match.
//
// IMPORTANT: this function is copied into the tile as text (paintScene.toString()),
// so it must stay fully self-contained: no imports, no outside variables.

export function paintScene(ctx, w, h, px, groundRatio) {
  var groundY = Math.round(h * groundRatio);
  var sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, "#1d1f45");
  sky.addColorStop(0.55, "#4b3f7d");
  sky.addColorStop(1, "#c98a7a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, groundY);

  // Pixel stars at fixed, repeatable spots (a tiny seeded generator).
  var seed = 7;
  function rand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
  var size = Math.max(1, Math.round(px));
  var count = Math.round((w * groundY) / 9000) + 6;
  for (var i = 0; i < count; i++) {
    var x = Math.floor(rand() * w / size) * size;
    var y = Math.floor(rand() * groundY * 0.6 / size) * size;
    ctx.fillStyle = rand() > 0.7 ? "rgba(255,240,200,0.9)" : "rgba(220,225,255,0.55)";
    ctx.fillRect(x, y, size, size);
  }

  var ground = ctx.createLinearGradient(0, groundY, 0, h);
  ground.addColorStop(0, "#3c5a43");
  ground.addColorStop(1, "#22362a");
  ctx.fillStyle = ground;
  ctx.fillRect(0, groundY, w, h - groundY);
  ctx.fillStyle = "rgba(255,236,190,0.35)";
  ctx.fillRect(0, groundY, w, size);
  return groundY;
}

/** Soft oval shadow under a sprite's feet. Same self-contained rule applies. */
export function paintShadow(ctx, cx, groundY, spriteWidth) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY, spriteWidth * 0.32, Math.max(2, spriteWidth * 0.07), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
