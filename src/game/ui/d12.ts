/**
 * A twelve-sided die, as geometry.
 *
 * The Duality Dice are d12s, and the tray drew them as a pentagon with five
 * facets around it — a badge, not a die. This is the solid itself: the regular
 * dodecahedron, twelve pentagons numbered the way a real d12 is, opposite faces
 * summing to thirteen. A die here can be turned to any angle, tumbled from a
 * seed, and flattened into polygons a view can draw, each face lit in the three
 * flat bands the board is lit in.
 *
 * Arithmetic only, no DOM: `Die.tsx` draws what this returns, and a test reads
 * the numbers without a browser.
 */

export type Vec = readonly [number, number, number];

/**
 * A turn of the die, row-major.
 *
 * Row 0 is where the die's own axes land on screen x, row 1 on screen y, row 2
 * on the axis out of the screen — so `apply(turn, n)[2] > 0` is a face pointing
 * at whoever is watching.
 */
export type Turn = readonly [number, number, number, number, number, number, number, number, number];

/** One of the twelve pentagons: what it says, which way it faces, and where its corners are. */
export interface Face {
  /** The number printed on it. */
  value: number;
  /** Out of the die, at right angles to the face. */
  normal: Vec;
  /** The middle of the pentagon. */
  centre: Vec;
  /** The way the number reads upright, in the face's own plane. */
  up: Vec;
  /** Five, counter-clockwise seen from outside, starting at the corner `up` points to. */
  corners: readonly Vec[];
}

const PHI = (1 + Math.sqrt(5)) / 2;
const ROOT3 = Math.sqrt(3);

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const minus = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec): Vec => times(a, 1 / Math.hypot(a[0], a[1], a[2]));

/**
 * The solid, worked out once.
 *
 * The twenty corners are the cube's eight and three rectangles of the golden
 * ratio, scaled so the die sits inside a sphere of radius one; the twelve face
 * normals are the same three rectangles turned the other way. Which corners
 * belong to a face is then simply which five of them lean furthest that way.
 */
function build(): Face[] {
  const corners: Vec[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(times([x, y, z], 1 / ROOT3));
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      corners.push(times([0, a / PHI, b * PHI], 1 / ROOT3), times([a / PHI, b * PHI, 0], 1 / ROOT3), times([a * PHI, 0, b / PHI], 1 / ROOT3));
    }
  }
  const normals: Vec[] = [];
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) normals.push(unit([0, a * PHI, b]), unit([b, 0, a * PHI]), unit([a * PHI, b, 0]));
  }

  // A real d12 has one and twelve, two and eleven, three and ten on opposite
  // sides: number a face, and its opposite takes what is left of thirteen.
  const printed = new Map<number, number>();
  let next = 1;
  normals.forEach((normal, i) => {
    if (printed.has(i)) return;
    printed.set(i, next);
    printed.set(normals.findIndex((other) => dot(other, normal) < -0.999), 13 - next);
    next++;
  });

  return normals.map((normal, i) => {
    const furthest = Math.max(...corners.map((corner) => dot(corner, normal)));
    const on = corners.filter((corner) => dot(corner, normal) > furthest - 1e-6);
    const centre = times(on.reduce((sum, corner) => [sum[0] + corner[0], sum[1] + corner[1], sum[2] + corner[2]] as Vec, [0, 0, 0] as Vec), 1 / on.length);
    const up = unit(minus(on[0]!, centre));
    // Round the face the way a right hand turns about its normal, so a view that
    // draws the corners in order draws the outside of the die.
    const across = cross(normal, up);
    const round = (corner: Vec): number => Math.atan2(dot(minus(corner, centre), across), dot(minus(corner, centre), up));
    return { value: printed.get(i)!, normal, centre, up, corners: [...on].sort((p, q) => round(p) - round(q)) };
  });
}

/** The twelve faces, in the order the solid was built. */
export const FACES: readonly Face[] = build();

/** The face that says this number. */
export const faceOf = (value: number): Face => FACES.find((face) => face.value === value) ?? FACES[0]!;

/** Where a point of the die ends up once it has been turned. */
export function apply(turn: Turn, point: Vec): Vec {
  return [
    turn[0] * point[0] + turn[1] * point[1] + turn[2] * point[2],
    turn[3] * point[0] + turn[4] * point[1] + turn[5] * point[2],
    turn[6] * point[0] + turn[7] * point[1] + turn[8] * point[2],
  ];
}

/** One turn after another: `after` is made first, then `before` on top of it. */
function then(before: Turn, after: Turn): Turn {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      out.push(before[row * 3]! * after[column]! + before[row * 3 + 1]! * after[3 + column]! + before[row * 3 + 2]! * after[6 + column]!);
    }
  }
  return out as unknown as Turn;
}

/** A turn of so many radians about an axis. */
function about(axis: Vec, angle: number): Turn {
  const [x, y, z] = unit(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}

/**
 * How far a landed die leans back and to the side, in radians.
 *
 * The face it rolled points at whoever is watching — a die read off a table
 * from above it — so this is the hint of a lean and no more: enough that the
 * pentagons around the rim catch the light at different angles and the die
 * reads as a solid, not enough to turn the number away from the player.
 */
const LEAN_BACK = 0.12;
const LEAN_SIDE = 0.07;

/** The die at rest, showing this number, leaning as if it were looked down on. */
export function landing(value: number): Turn {
  const face = faceOf(value);
  const across = cross(face.up, face.normal);
  const flat: Turn = [
    across[0], across[1], across[2],
    face.up[0], face.up[1], face.up[2],
    face.normal[0], face.normal[1], face.normal[2],
  ];
  return then(then(about([0, 1, 0], LEAN_SIDE), about([1, 0, 0], LEAN_BACK)), flat);
}

/** Turns a thrown die makes on the way down, and the slower roll under them. */
const SPINS = 2.6;
const WOBBLES = 1.35;

/** A hash small enough to read, so the same throw tumbles the same way twice. */
function hashed(seed: number, step: number): number {
  let x = (Math.imul(seed + 1, 2654435761) ^ Math.imul(step + 1, 40503)) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296;
}

/** An axis this throw turns about, away from any pole so a die never spins flat. */
function axisFrom(seed: number, step: number): Vec {
  const axis: Vec = [hashed(seed, step * 3) - 0.5, hashed(seed, step * 3 + 1) - 0.5, hashed(seed, step * 3 + 2) - 0.5];
  return Math.hypot(axis[0], axis[1], axis[2]) < 0.15 ? unit([0.3, 1, 0.2]) : unit(axis);
}

/**
 * A die part way through a throw, where `t` runs 0 to 1 and 1 has landed.
 *
 * The turning slows into the face rather than stopping dead, and every angle is
 * measured back from where the die comes to rest — so however long the throw
 * takes, it ends on the number the rules already rolled.
 */
export function tumble(value: number, seed: number, t: number): Turn {
  const rest = landing(value);
  const gone = Math.max(0, Math.min(1, t));
  if (gone >= 1) return rest;
  const left = (1 - gone) ** 3;
  return then(then(rest, about(axisFrom(seed, 0), left * SPINS * Math.PI * 2)), about(axisFrom(seed, 1), left * WOBBLES * Math.PI * 2));
}

/** A face of a turned die, ready to draw. */
export interface DrawnFace {
  value: number;
  /** The pentagon, as an SVG points list. */
  points: string;
  /** Which of the three bands of light it falls in: 0 lit, 2 in shadow. */
  band: 0 | 1 | 2;
  /** An SVG transform putting the number on the face, squashed the way the face is. */
  label: string;
}

/** A turned die, flattened. */
export interface Drawn {
  /** Only the faces pointing at whoever is watching. */
  faces: DrawnFace[];
  /** The die's outline, as an SVG points list. */
  rim: string;
  /** The number most nearly facing the front. */
  front: number;
}

/** The box a die is drawn in, and how much of it the die fills. */
const BOX = 100;
const RADIUS = 44;
/** Where the light comes from: over the watcher's left shoulder, as on the board. */
const LIGHT = unit([-0.45, 0.62, 0.65]);

/** Everything about a turned die a view needs: its faces, its outline and what it is showing. */
export function draw(turn: Turn): Drawn {
  const flat = (point: Vec): [number, number] => {
    const [x, y] = apply(turn, point);
    return [BOX / 2 + RADIUS * x, BOX / 2 - RADIUS * y];
  };
  const points = (corners: readonly Vec[]): string => corners.map((corner) => flat(corner).map((n) => n.toFixed(2)).join(',')).join(' ');

  const faces: DrawnFace[] = [];
  let front = FACES[0]!.value;
  let nearest = -Infinity;
  for (const face of FACES) {
    const normal = apply(turn, face.normal);
    if (normal[2] > nearest) {
      nearest = normal[2];
      front = face.value;
    }
    if (normal[2] <= 0.002) continue;
    const light = dot(normal, LIGHT);
    const across = apply(turn, cross(face.up, face.normal));
    const up = apply(turn, face.up);
    const centre = apply(turn, face.centre);
    // The number is drawn flat in hundredths of the die's own width and then put
    // on the face, which is an exact squash: a flat face seen at an angle stays
    // straight-edged, so the same matrix that carries the pentagon carries the text.
    const k = RADIUS / 100;
    const label = `matrix(${(k * across[0]).toFixed(4)},${(-k * across[1]).toFixed(4)},${(-k * up[0]).toFixed(4)},${(k * up[1]).toFixed(4)},${(BOX / 2 + RADIUS * centre[0]).toFixed(2)},${(BOX / 2 - RADIUS * centre[1]).toFixed(2)})`;
    faces.push({ value: face.value, points: points(face.corners), band: light > 0.78 ? 0 : light > 0.42 ? 1 : 2, label });
  }
  return { faces, rim: points(silhouette(turn)), front };
}

/**
 * The die's outline: the corners nothing else is in front of.
 *
 * A dodecahedron is convex, so its outline is the convex hull of every corner —
 * found here by walking the lower and upper chains of the sorted corners.
 */
function silhouette(turn: Turn): Vec[] {
  const on = [...FACES.flatMap((face) => face.corners)];
  const seen = new Set<string>();
  const unique = on.filter((corner) => {
    const key = corner.map((n) => n.toFixed(4)).join();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const screen = unique.map((corner) => ({ corner, at: apply(turn, corner) }));
  screen.sort((a, b) => a.at[0] - b.at[0] || a.at[1] - b.at[1]);
  const turns = (o: Vec, a: Vec, b: Vec): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const chain = (order: typeof screen): typeof screen => {
    const out: typeof screen = [];
    for (const point of order) {
      while (out.length > 1 && turns(out[out.length - 2]!.at, out[out.length - 1]!.at, point.at) <= 0) out.pop();
      out.push(point);
    }
    return out;
  };
  const lower = chain(screen);
  const upper = chain([...screen].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((point) => point.corner);
}
