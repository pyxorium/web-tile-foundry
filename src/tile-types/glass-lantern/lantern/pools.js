// Pools of coloured light on the tabletop.
//
// The lamp sits at the lantern's centre. Light leaving through a pane that
// faces downward lands on the table as a soft pool in that pane's colour.
// This works out, for the current rotation, where each downward pane's light
// lands, how big the pool is and how strong. It is an imitation (no real light
// simulation), but the pools follow the lantern as it turns.
//
// Plain maths, no three.js: tested in Node, and cheap to run every frame.

/**
 * @param {object} o
 * @param {number[][]} o.normals   outward unit normal per face (lantern's own coordinates)
 * @param {number[][]} o.centres   centre per face
 * @param {number[]}   o.areas     area per face
 * @param {number[][]} o.colours   linear RGB per face, 0..1
 * @param {number[]}   o.rotation  3x3 rotation, column-major (as three.js Matrix3.elements)
 * @param {number}     o.tableY    height of the table (negative: below the lamp)
 * @param {number}     [o.max]     most pools to return (strongest first)
 * @returns {{ x: number, z: number, radius: number, strength: number, colour: number[] }[]}
 */
export function lightPools({ normals, centres, areas, colours, rotation: m, tableY, max = 8 }) {
  const turn = (v) => [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
  const pools = [];
  for (let i = 0; i < normals.length; i++) {
    const n = turn(normals[i]);
    if (n[1] > -0.12) continue; // only panes facing downward light the table
    const c = turn(centres[i]);
    if (c[1] >= -1e-6) continue;
    const t = tableY / c[1]; // the ray from the lamp through the pane's centre, extended to the table
    const x = c[0] * t;
    const z = c[2] * t;
    // Pools spread with distance and with the size of the pane.
    const radius = Math.sqrt(areas[i]) * t * 0.55;
    // Strongest straight down, fading for panes that face sideways or throw far.
    const strength = -n[1] / (t * t);
    pools.push({ x, z, radius, strength, colour: colours[i] });
  }
  pools.sort((a, b) => b.strength - a.strength);
  return pools.slice(0, max);
}
