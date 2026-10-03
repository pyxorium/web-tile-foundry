import { Sprite, SpriteMaterial, DataTexture, RGBAFormat, LinearFilter, AdditiveBlending, SRGBColorSpace } from "three";

// The lamp's soft glow: a haze that always faces the viewer, brightest in the
// middle and fading to nothing, with no hard edge.
//
// Real glass only "sees" solid (opaque) things behind it, so the glow is drawn
// as an opaque object that adds its light on top of what is already there.
// It is drawn after the far panes (renderOrder) so it glows over them, and it
// does not hide anything behind it (no depth writing).

function glowTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      // A bright core with a long soft falloff, reaching exactly 0 at the edge.
      const core = Math.exp(-r * r * 18);
      const haze = Math.pow(1 - r, 2.4) * 0.55;
      const v = Math.round(255 * Math.min(1, core + haze) * (1 - r * r));
      const i = 4 * (y * size + x);
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function makeLampGlow() {
  const material = new SpriteMaterial({
    map: glowTexture(),
    blending: AdditiveBlending,
    transparent: false, // keeps it in the opaque list, so real glass can see it
    depthWrite: false,
    fog: false,
  });
  const sprite = new Sprite(material);
  sprite.renderOrder = 2;
  return sprite;
}
