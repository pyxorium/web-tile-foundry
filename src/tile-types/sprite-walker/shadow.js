// Soft oval shadow under a sprite's feet, used in the tile and in card art.
// Copied into the tile as text, so it must stay self-contained.
export function paintShadow(ctx, cx, groundY, spriteWidth) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, groundY, spriteWidth * 0.32, Math.max(2, spriteWidth * 0.07), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
