import {
  Mesh, PlaneGeometry, ShaderMaterial, Color, Vector2, Scene, OrthographicCamera,
  WebGLRenderTarget, HalfFloatType, UnsignedByteType, LinearFilter,
} from "three";

// The backgrounds, all drawn in code (no images):
//
//   plain     Plain glow: a soft gradient with a warm halo (what the lab first showed)
//   parlour   Parlour: dark wood panelling, a carved rail, panelled wainscot (Tiffany)
//   damask    Velvet damask: plum wallpaper with a damask flourish (Victorian)
//   workshop  Workshop: sooty brick, gear and pipe silhouettes, a cool side light (Steampunk)
//
// The background never moves, so it is PAINTED ONCE into a picture (a render
// target) whenever its settings or the canvas size change, and each frame only
// shows that picture: almost free per frame. It is painted at reduced size
// ("softness"), which also makes it look softly out of focus behind the lantern.
//
// The picture is shown by an ordinary opaque mesh drawn first, so real glass
// (which only sees opaque things) shows it through the panes. The tabletop
// also reads it, to fade its far edge into the wall.

export const BACKGROUNDS = Object.freeze([
  Object.freeze({ id: "plain", label: "Plain glow", style: 0 }),
  Object.freeze({ id: "parlour", label: "Parlour", style: 1 }),
  Object.freeze({ id: "damask", label: "Velvet damask", style: 2 }),
  Object.freeze({ id: "workshop", label: "Workshop", style: 3 }),
]);

const PAINTER = /* glsl */ `
uniform int uStyle;
uniform vec3 uMain, uDark, uAccent, uLamp;
uniform float uHalo, uVignette, uScale, uContrast, uBrightness, uAspect;
varying vec2 vUv;

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 17.3; a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Wood grain running along y (stretch noise across x).
float wood(vec2 q) {
  float warp = fbm(q * vec2(3.0, 0.4)) * 2.0;
  float grain = fbm(vec2(q.x * 26.0 + warp * 3.0, q.y * 1.2));
  float rings = 0.5 + 0.5 * sin((q.x * 9.0 + warp * 2.5) * 6.2832);
  return mix(grain, rings, 0.35);
}

vec3 plainGlow(vec2 uv) {
  return mix(uDark, uMain, smoothstep(0.0, 1.0, uv.y));
}

vec3 parlour(vec2 uv, vec2 p) {
  float railY = 0.34;
  vec3 col;
  if (uv.y > railY + 0.035) {
    // Vertical boards.
    float x = p.x * 3.0 * uScale + 0.5;
    float bi = floor(x), bx = fract(x);
    float h = hash1(bi);
    float w = wood(vec2(bx * 0.9 + h * 5.0, uv.y * 1.4 + h * 3.0));
    col = mix(uDark, uMain * 1.25, clamp(0.45 + (w - 0.5) * 1.1 * uContrast + (h - 0.5) * 0.3, 0.0, 1.3));
    float seam = smoothstep(0.0, 0.025, bx) * smoothstep(1.0, 0.975, bx);
    col *= mix(0.35, 1.0, seam);
  } else if (uv.y > railY - 0.02) {
    // The carved rail: a rounded moulding that catches the light.
    float t = (uv.y - (railY - 0.02)) / 0.055;
    float roll = sin(t * 3.1416);
    col = mix(uDark * 0.8, mix(uMain, uAccent, 0.45), 0.25 + 0.75 * roll);
    col += uAccent * 0.35 * pow(roll, 8.0);
    col *= 0.75 + 0.25 * wood(vec2(p.x * 0.3, t * 0.05)) ;
  } else {
    // Panelled wainscot: raised panels in frames, grain running across.
    float px = p.x * 1.7 * uScale + 0.5;
    float pi = floor(px);
    vec2 q = vec2(fract(px), uv.y / (railY - 0.02));
    vec2 e = min(q, 1.0 - q) * vec2(1.0, 0.75);
    float edge = min(e.x, e.y);
    float frame = smoothstep(0.07, 0.08, edge);
    float bevel = smoothstep(0.08, 0.12, edge);
    float w = wood(vec2(q.y * 0.8 + hash1(pi) * 4.0, q.x * 2.0));
    vec3 panel = mix(uDark, uMain * 1.15, clamp(0.4 + (w - 0.5) * uContrast, 0.0, 1.2));
    col = mix(uDark * 0.7, panel, frame);
    col = mix(col * 0.75, col, bevel);
    col += uAccent * 0.08 * (1.0 - bevel) * frame;
  }
  return col;
}

// One damask motif in a cell (c in [-0.5, 0.5], mirrored left-right). Returns a distance: < 0 inside.
float damaskMotif(vec2 c) {
  c.x = abs(c.x);
  float d = abs(c.x) * 1.7 + abs(c.y) - 0.3;                      // central lozenge
  d = max(d, -(abs(c.x) * 1.7 + abs(c.y) - 0.15));                // cut out its middle
  d = min(d, abs(c.x) * 1.7 + abs(c.y) - 0.07);                   // and a jewel in the middle
  vec2 l = rot(0.65) * (c - vec2(0.2, 0.08));
  d = min(d, length(l * vec2(1.0, 2.5)) - 0.1);                   // upper leaves
  vec2 l2 = rot(-0.75) * (c - vec2(0.16, -0.18));
  d = min(d, length(l2 * vec2(1.0, 2.3)) - 0.085);                // lower leaves
  d = min(d, abs(length(c - vec2(0.31, 0.27)) - 0.075) - 0.016); // curls
  d = min(d, length((c - vec2(0.0, 0.37)) * vec2(2.4, 1.0)) - 0.07); // crown
  d = min(d, length((c - vec2(0.0, -0.38)) * vec2(2.0, 1.0)) - 0.05); // foot
  return d;
}

vec3 damask(vec2 uv, vec2 p) {
  vec2 q = p * 2.6 * uScale;
  float colIndex = floor(q.x + 0.5);
  q.y += mod(colIndex, 2.0) * 0.5;                                // half-drop repeat
  vec2 c = fract(q + 0.5) - 0.5;
  float d = damaskMotif(c);
  float m = 1.0 - smoothstep(-0.004, 0.006, d);
  float sheen = 0.7 + 0.45 * fbm(p * 1.8 + 3.0);                  // velvet catches light unevenly
  float fabric = noise(p * 160.0) * 0.05;
  vec3 base = uMain * sheen;
  vec3 motif = mix(uMain * 1.7, uAccent * 0.8, 0.3) * (0.85 + 0.3 * fbm(p * 5.0));
  // (The gilt picture rail that ran across the top was removed at the user's request.)
  return mix(base, motif, m * clamp(0.6 * uContrast, 0.0, 1.0)) + fabric * uMain;
}

// A gear: distance from its outline (< 0 inside).
float gear(vec2 v, float r, float teeth, float turn) {
  float a = atan(v.y, v.x) + turn;
  float len = length(v);
  float outline = r + r * 0.13 * smoothstep(-0.25, 0.25, cos(a * teeth));
  float d = len - outline;
  d = max(d, -(len - r * 0.22));                                   // axle hole
  float spokeGap = abs(sin(a * 2.5)) - 0.55;                       // five openings between spokes
  float ringCut = max(len - r * 0.72, r * 0.36 - len);
  d = max(d, -max(ringCut, -spokeGap * r));
  return d;
}

vec3 workshop(vec2 uv, vec2 p) {
  // Brick wall.
  vec2 q = p * 6.0 * uScale;
  vec2 b = vec2(q.x * 0.5, q.y);
  float row = floor(b.y);
  b.x += mod(row, 2.0) * 0.5;
  vec2 id = floor(b);
  vec2 f = fract(b);
  float mortar = smoothstep(0.0, 0.06, f.y) * smoothstep(1.0, 0.94, f.y) * smoothstep(0.0, 0.03, f.x) * smoothstep(1.0, 0.97, f.x);
  float h = hash2(id);
  vec3 brick = mix(uMain * 0.9, uMain * 1.6 + vec3(0.03, 0.008, 0.0), h * uContrast) * (0.75 + 0.5 * fbm(q * 2.5));
  vec3 col = mix(uDark * 0.5, brick, mortar);
  col *= mix(1.0, 0.4, smoothstep(0.35, 1.0, uv.y) * (0.6 + 0.4 * fbm(p * 2.5)));  // soot rising

  // Pipes: two across, one down; rounded shading and joints.
  float halfW = uAspect * 0.5;
  for (int i = 0; i < 3; i++) {
    float r = i == 2 ? 0.035 : 0.045;
    float dist = i == 0 ? p.y - 0.36 : i == 1 ? p.y + 0.33 : p.x - (halfW - 0.18);
    float along = i == 2 ? p.y : p.x;
    if (abs(dist) < r) {
      float shade = sqrt(1.0 - (dist / r) * (dist / r));
      vec3 pipe = uAccent * (0.15 + 0.55 * shade) + vec3(0.5) * pow(shade, 30.0) * 0.25;
      float joint = 1.0 - smoothstep(0.0, 0.012, abs(fract(along * 1.4) - 0.5) - 0.03);
      pipe *= 1.0 + 0.35 * joint;
      col = pipe;
    }
  }

  // Gear silhouettes, dark against the wall with a faint brass rim.
  vec2 g1 = vec2(-halfW + 0.12, 0.3);
  vec2 g2 = vec2(halfW - 0.22, -0.08);
  vec2 g3 = g2 + vec2(-0.17, 0.27);
  float d = min(gear(p - g1, 0.3, 14.0, 0.0), min(gear(p - g2, 0.22, 11.0, 0.3), gear(p - g3, 0.11, 7.0, 0.1)));
  float inside = 1.0 - smoothstep(-0.002, 0.004, d);
  col = mix(col, uDark * 0.4 + uAccent * 0.06, inside);
  col += uAccent * 0.3 * (1.0 - smoothstep(0.0, 0.01, abs(d))) * smoothstep(-0.2, 0.4, p.x + p.y);

  // A cooler light from the right (the "cooler rim" in the plan).
  col += vec3(0.25, 0.35, 0.5) * 0.06 * smoothstep(0.3, 1.0, uv.x);
  return col;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uAspect, 1.0);
  vec3 col;
  if (uStyle == 1) col = parlour(uv, p);
  else if (uStyle == 2) col = damask(uv, p);
  else if (uStyle == 3) col = workshop(uv, p);
  else col = plainGlow(uv);

  // The lamp lights the wall behind it, and adds a soft halo.
  float r = length(p);
  if (uStyle != 0) col *= 1.0 + uHalo * 1.6 * exp(-r * r * 4.0);
  col += uLamp * uHalo * 0.35 * exp(-r * r * 9.0);
  col *= 1.0 - uVignette * smoothstep(0.25, 0.85, length((uv - 0.5) * 1.6));
  gl_FragColor = vec4(max(col * uBrightness, 0.0), 1.0);
}
`;

const DISPLAY = /* glsl */ `
uniform sampler2D uPicture;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(uPicture, vUv).rgb, 1.0);
  #include <colorspace_fragment>
}
`;

const FULLSCREEN = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }
`;

export function makeBackground(renderer) {
  const uniforms = {
    uStyle: { value: 0 },
    uMain: { value: new Color("#3a2618") },
    uDark: { value: new Color("#0e0907") },
    uAccent: { value: new Color("#b58a3c") },
    uLamp: { value: new Color("#ffb46b") },
    uHalo: { value: 0.55 },
    uVignette: { value: 0.6 },
    uScale: { value: 1 },
    uContrast: { value: 1 },
    uBrightness: { value: 1 },
    uAspect: { value: 1 },
  };

  // The painter: draws the background once into `target`.
  const halfFloat = renderer.extensions.has("EXT_color_buffer_half_float") || renderer.extensions.has("EXT_color_buffer_float");
  const target = new WebGLRenderTarget(1, 1, { type: halfFloat ? HalfFloatType : UnsignedByteType, depthBuffer: false });
  target.texture.minFilter = target.texture.magFilter = LinearFilter;
  const painterScene = new Scene();
  const painterCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const painter = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({ uniforms, vertexShader: FULLSCREEN, fragmentShader: PAINTER, depthTest: false, depthWrite: false }));
  painter.frustumCulled = false;
  painterScene.add(painter);

  // What the main scene draws each frame: just the painted picture.
  const material = new ShaderMaterial({
    uniforms: { uPicture: { value: target.texture } },
    vertexShader: FULLSCREEN,
    fragmentShader: DISPLAY,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  let dirty = true;
  let softness = 0.5;

  return {
    mesh,
    uniforms,
    texture: target.texture,
    /** Call after changing uniforms, softness or size; the next paint() redraws. */
    invalidate() {
      dirty = true;
    },
    setSoftness(s) {
      if (s !== softness) {
        softness = s;
        dirty = true;
      }
    },
    /** Repaints the picture if anything changed. Call before rendering the main scene. */
    paint(width, height) {
      const scale = 1 - 0.75 * Math.min(1, Math.max(0, softness)); // softer = painted smaller
      const w = Math.max(1, Math.round(width * scale));
      const h = Math.max(1, Math.round(height * scale));
      if (target.width !== w || target.height !== h) {
        target.setSize(w, h);
        dirty = true;
      }
      if (!dirty) return;
      uniforms.uAspect.value = width / height;
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(painterScene, painterCamera);
      renderer.setRenderTarget(previous);
      dirty = false;
    },
    dispose() {
      target.dispose();
      painter.geometry.dispose();
      painter.material.dispose();
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
