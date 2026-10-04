import * as THREE from "three";

// The cart and its rider.
//
// The cart is a few simple boxes: a body with two rows of seats (front and
// back), sitting on the rails. The rider is the sprite, a flat picture in the
// front row that always turns to face the camera (around the cart's own up),
// and shows the pose that matches where the camera is: their back when the
// camera is behind, their face when it is in front, a profile from the side.
//
// Sprite sheets are rpg.actor's standard 3 × 4 layout: row 0 facing the
// viewer, 1 facing left, 2 facing right, 3 facing away; the middle column is
// the standing pose.

const ROW = Object.freeze({ front: 0, left: 1, right: 2, back: 3 });
const RIDER_HEIGHT = 1.5; // m, how tall the sprite is drawn
const SEAT_ROWS = [0.55, -0.55]; // m along the cart: front row, back row

export function createCart() {
  const group = new THREE.Group();
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: "#f6c531", metalness: 0.25, roughness: 0.45 }),
    trim: new THREE.MeshStandardMaterial({ color: "#2a5db0", metalness: 0.3, roughness: 0.5 }),
  };
  const geometries = [];
  const box = (w, h, d, material, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    geometries.push(g);
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };
  // Body (x = across, y = up, z = forward), sitting just above the rails.
  box(1.5, 0.45, 2.5, materials.body, 0, 0.42, 0);
  box(1.56, 0.12, 2.56, materials.trim, 0, 0.2, 0); // skirt over the wheels
  box(1.5, 0.5, 0.25, materials.body, 0, 0.78, 1.2); // front nose
  for (const z of SEAT_ROWS) box(1.3, 0.26, 0.14, materials.trim, 0, 0.76, z - 0.36); // seat backs

  // Rider: a flat picture in the front row. Its own small group turns to face the camera.
  const riderPivot = new THREE.Group();
  riderPivot.position.set(0, 0.5, SEAT_ROWS[0]);
  group.add(riderPivot);
  const riderGeometry = new THREE.PlaneGeometry(RIDER_HEIGHT, RIDER_HEIGHT);
  riderGeometry.translate(0, RIDER_HEIGHT / 2, 0);
  geometries.push(riderGeometry);
  const riderMaterial = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  const rider = new THREE.Mesh(riderGeometry, riderMaterial);
  rider.visible = false;
  riderPivot.add(rider);

  let texture = null;
  let row = -1;

  const camLocal = new THREE.Vector3();
  const inverse = new THREE.Matrix4();

  return {
    group,
    materials,

    /** Uses this image (a 3 × 4 rpg.actor sheet) for the rider; null hides the rider. */
    setRider(image) {
      if (texture) texture.dispose();
      texture = null;
      row = -1;
      rider.visible = Boolean(image);
      if (!image) return;
      texture = new THREE.Texture(image);
      texture.magFilter = THREE.NearestFilter; // keep the pixel art crisp
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.repeat.set(1 / 3, 1 / 4);
      texture.needsUpdate = true;
      riderMaterial.map = texture;
      riderMaterial.needsUpdate = true;
    },

    /** Places the cart at a frame from path.js ({ p, t, up, side }), drawn `size` times its real size. */
    place(frame, size = 1) {
      const { p, t, up, side } = frame;
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...side), new THREE.Vector3(...up), new THREE.Vector3(...t));
      if (size !== 1) m.multiply(new THREE.Matrix4().makeScale(size, size, size));
      m.setPosition(p[0], p[1], p[2]);
      group.matrixAutoUpdate = false;
      group.matrix.copy(m);
      group.matrixWorldNeedsUpdate = true;
    },

    /** Turns the rider to face the camera and picks the matching pose. Call before each frame is drawn. */
    faceCamera(camera) {
      if (!texture) return;
      group.updateMatrixWorld(true);
      inverse.copy(group.matrixWorld).invert();
      camLocal.copy(camera.position).applyMatrix4(inverse); // camera in the cart's own terms
      const angle = Math.atan2(camLocal.x, camLocal.z); // 0 = camera straight ahead of the cart
      riderPivot.rotation.set(0, angle, 0);
      // Pose: which way the rider (facing forward, +z) looks from where the camera is.
      const a = Math.abs(angle);
      let next;
      if (a < Math.PI / 4) next = ROW.front;
      else if (a > (3 * Math.PI) / 4) next = ROW.back;
      else next = angle > 0 ? ROW.left : ROW.right;
      if (next !== row) {
        row = next;
        // Middle column; rows count from the top of the image.
        texture.offset.set(1 / 3, 1 - (row + 1) / 4);
      }
    },

    setColors(body, trim) {
      materials.body.color.set(body);
      materials.trim.color.set(trim);
    },

    dispose() {
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
      riderMaterial.dispose();
      if (texture) texture.dispose();
    },
  };
}

export { ROW as RIDER_ROWS };
