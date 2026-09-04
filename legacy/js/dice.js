// ============ DUALITY DICE ENGINE ============
// Two physical d12s (Hope = gold, Fear = violet) simulated with cannon-es.
// Player clicks & drags to fling them across the live tactical map; dice
// collide with terrain blocks and character tokens.

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { BASE_H, LEVEL_H } from './grid.js';

const DIE_R = 0.42;

// ---- Build d12 geometry + cannon convex shape + face value table ----
function buildD12() {
  const geo = new THREE.DodecahedronGeometry(DIE_R);
  const pos = geo.attributes.position;

  // Dedupe vertices
  const verts = [];           // THREE.Vector3[]
  const vIndex = new Map();   // key -> index
  const triVerts = [];        // per-corner vertex index
  const vkey = v => `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const k = vkey(v);
    if (!vIndex.has(k)) { vIndex.set(k, verts.length); verts.push(v); }
    triVerts.push(vIndex.get(k));
  }

  // Group triangles into 12 pentagonal faces by normal
  const groups = new Map(); // normalKey -> { normal, vertSet }
  for (let i = 0; i < triVerts.length; i += 3) {
    const a = verts[triVerts[i]], b = verts[triVerts[i + 1]], c = verts[triVerts[i + 2]];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const k = `${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}`;
    if (!groups.has(k)) groups.set(k, { normal: n.clone(), vertSet: new Set() });
    const g = groups.get(k);
    g.vertSet.add(triVerts[i]); g.vertSet.add(triVerts[i + 1]); g.vertSet.add(triVerts[i + 2]);
  }

  // Order each face's vertices around its centroid (CCW from outside)
  const faces = [];
  for (const { normal, vertSet } of groups.values()) {
    const ids = [...vertSet];
    const centroid = ids.reduce((acc, i) => acc.add(verts[i]), new THREE.Vector3()).divideScalar(ids.length);
    const tangent = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.9) tangent.set(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const v = new THREE.Vector3().crossVectors(normal, u).normalize();
    ids.sort((a, b) => {
      const pa = verts[a].clone().sub(centroid), pb = verts[b].clone().sub(centroid);
      return Math.atan2(pa.dot(v), pa.dot(u)) - Math.atan2(pb.dot(v), pb.dot(u));
    });
    // Ensure outward winding
    const e1 = verts[ids[1]].clone().sub(verts[ids[0]]);
    const e2 = verts[ids[2]].clone().sub(verts[ids[0]]);
    if (e1.cross(e2).dot(normal) < 0) ids.reverse();
    faces.push({ ids, normal, centroid });
  }

  // Assign values: opposite faces sum to 13
  let nextVal = 1;
  for (const f of faces) {
    if (f.value) continue;
    f.value = nextVal;
    const opp = faces.find(o => o !== f && !o.value && o.normal.dot(f.normal) < -0.99);
    if (opp) opp.value = 13 - nextVal;
    nextVal++;
  }

  const shape = new CANNON.ConvexPolyhedron({
    vertices: verts.map(v => new CANNON.Vec3(v.x, v.y, v.z)),
    faces: faces.map(f => f.ids),
  });

  return { geo, faces, shape };
}

function numberSprite(value, color) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.font = 'bold 52px Georgia';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(value), 48, 44);
  if (value === 6 || value === 9) { ctx.fillRect(34, 74, 28, 5); } // disambiguation bar
  const tex = new THREE.CanvasTexture(cv);
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true });
}

export class DiceManager {
  constructor(sceneMgr, grid, ui) {
    this.sm = sceneMgr;
    this.grid = grid;
    this.ui = ui;
    this.d12 = buildD12();

    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -22, 0) });
    this.world.allowSleep = true;
    this.diceMat = new CANNON.Material('dice');
    this.groundMat = new CANNON.Material('ground');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMat, this.groundMat, {
      friction: 0.25, restitution: 0.45,
    }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.diceMat, this.diceMat, {
      friction: 0.1, restitution: 0.55,
    }));

    this.dice = [];          // [{mesh, body}]
    this.staticBodies = [];
    this.active = false;
    this.holding = false;
    this.samples = [];       // pointer velocity samples
    this.overlay = document.getElementById('dice-overlay');
    this.resultEl = document.getElementById('dice-result');
    this.instructionEl = document.getElementById('dice-instruction');

    this.sm.frameHooks.push(dt => this.step(dt));
  }

  makeDie(color, numColor) {
    const mesh = new THREE.Mesh(
      this.d12.geo.clone(),
      new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.35, metalness: 0.15 })
    );
    mesh.castShadow = true;
    // Number plates on each face
    for (const f of this.d12.faces) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), numberSprite(f.value, numColor));
      plate.position.copy(f.centroid).addScaledVector(f.normal, 0.012);
      plate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), f.normal);
      mesh.add(plate);
    }
    const body = new CANNON.Body({
      mass: 0.35,
      shape: this.d12.shape,
      material: this.diceMat,
      angularDamping: 0.12,
      linearDamping: 0.05,
      allowSleep: true,
      sleepSpeedLimit: 0.35,
      sleepTimeLimit: 0.35,
    });
    return { mesh, body };
  }

  // Mirror map terrain + tokens into the physics world.
  rebuildStatic() {
    for (const b of this.staticBodies) this.world.removeBody(b);
    this.staticBodies = [];
    const add = body => { this.world.addBody(body); this.staticBodies.push(body); };

    // Floor
    const floor = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMat });
    floor.addShape(new CANNON.Plane());
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    add(floor);

    const map = this.grid.map;
    if (!map) return;

    // Walls around map (+1 margin)
    const hw = map.w / 2 + 1, hh = map.h / 2 + 1;
    const wallDefs = [
      [hw, 0, 0, 0.2, 4, hh * 2], [-hw, 0, 0, 0.2, 4, hh * 2],
      [0, 0, hh, hw * 2, 4, 0.2], [0, 0, -hh, hw * 2, 4, 0.2],
    ];
    for (const [x, y, z, sx, sy, sz] of wallDefs) {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMat });
      b.addShape(new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)));
      b.position.set(x, 2, z);
      add(b);
    }

    // Terrain blocks
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = this.grid.tile(x, y);
      const h = BASE_H + t.h * LEVEL_H;
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMat });
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.5, h / 2, 0.5)));
      const p = this.grid.tileWorld(x, y);
      b.position.set(p.x, h / 2, p.z);
      add(b);
    }

    // Tokens as cylinders — dice carom off the minis
    const addToken = g => {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMat });
      b.addShape(new CANNON.Cylinder(0.3, 0.36, 0.9, 8));
      b.position.set(g.position.x, g.position.y + 0.45, g.position.z);
      add(b);
    };
    this.grid.heroTokens.forEach(addToken);
    this.grid.enemyTokens.forEach(addToken);

    // Nodes as boxes
    for (const n of this.grid.map.nodes) {
      const b = new CANNON.Body({ type: CANNON.Body.STATIC, material: this.groundMat });
      const tall = n.type !== 'chest';
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.35, tall ? 0.75 : 0.25, 0.25)));
      const p = this.grid.tileWorld(n.x, n.y);
      b.position.set(p.x, this.grid.tileTopY(n.x, n.y) + (tall ? 0.75 : 0.25), p.z);
      add(b);
    }
  }

  // Roll 2d12. Resolves { hope, fear }.
  roll() {
    return new Promise(resolve => {
      this.active = true;
      this.resolve = resolve;
      this.rebuildStatic();
      this.sm.controls.enabled = false;
      this.overlay.classList.remove('hidden');
      this.resultEl.classList.add('hidden');
      this.instructionEl.classList.remove('hidden');

      const hope = this.makeDie('#f6c453', '#3a2c08');
      const fear = this.makeDie('#6f42c8', '#efe6ff');
      this.dice = [hope, fear];
      for (const d of this.dice) {
        d.body.type = CANNON.Body.KINEMATIC;
        this.world.addBody(d.body);
        this.sm.scene.add(d.mesh);
        d.body.quaternion.setFromEuler(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      }
      this.holdAt(new THREE.Vector3(0, 4.5, 4));
      this.thrown = false;
      this.settleTimer = 0;
      this.maxTimer = 0;
    });
  }

  holdAt(pt) {
    const offs = [new THREE.Vector3(-0.55, 0, 0), new THREE.Vector3(0.55, 0, 0)];
    this.dice.forEach((d, i) => {
      const p = pt.clone().add(offs[i]);
      d.body.position.set(p.x, Math.max(p.y, 2.5), p.z);
      d.body.velocity.setZero();
      d.body.angularVelocity.set(2, 3, 1.5);
    });
  }

  // ---- pointer handlers (wired by main.js while active) ----
  onPointerDown(ev) {
    if (!this.active || this.thrown) return;
    this.holding = true;
    this.samples = [];
    this.trackSample(ev);
  }
  onPointerMove(ev) {
    if (!this.active || !this.holding || this.thrown) return;
    const pt = this.sm.pickPlane(ev, 3.2);
    if (pt) this.holdAt(pt);
    this.trackSample(ev);
  }
  onPointerUp(ev) {
    if (!this.active || !this.holding || this.thrown) return;
    this.holding = false;
    this.trackSample(ev);
    this.fling();
  }
  trackSample(ev) {
    const pt = this.sm.pickPlane(ev, 3.2);
    if (!pt) return;
    this.samples.push({ t: performance.now(), x: pt.x, z: pt.z });
    if (this.samples.length > 8) this.samples.shift();
  }

  fling() {
    this.thrown = true;
    this.instructionEl.classList.add('hidden');
    // Velocity from recent pointer samples
    let vx = 0, vz = 0;
    if (this.samples.length >= 2) {
      const a = this.samples[0], b = this.samples[this.samples.length - 1];
      const dt = Math.max((b.t - a.t) / 1000, 0.016);
      vx = (b.x - a.x) / dt; vz = (b.z - a.z) / dt;
    }
    const speed = Math.hypot(vx, vz);
    if (speed < 2) { // minimal throw: toss toward map center
      const d = this.dice[0].body.position;
      vx = -d.x * 0.8 + (Math.random() - 0.5) * 3;
      vz = -d.z * 0.8 + (Math.random() - 0.5) * 3;
    }
    const cap = 16;
    const s = Math.hypot(vx, vz);
    if (s > cap) { vx = vx / s * cap; vz = vz / s * cap; }

    for (const d of this.dice) {
      d.body.type = CANNON.Body.DYNAMIC;
      d.body.wakeUp();
      d.body.velocity.set(vx * (0.9 + Math.random() * 0.2), -2, vz * (0.9 + Math.random() * 0.2));
      d.body.angularVelocity.set(
        (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22
      );
    }
  }

  step(dt) {
    if (!this.active && this.dice.length === 0) return;
    this.world.step(1 / 60, dt, 4);
    for (const d of this.dice) {
      d.mesh.position.copy(d.body.position);
      d.mesh.quaternion.copy(d.body.quaternion);
    }
    if (!this.active || !this.thrown) return;

    this.maxTimer += dt;
    const still = this.dice.every(d =>
      d.body.velocity.length() < 0.18 && d.body.angularVelocity.length() < 0.25);
    this.settleTimer = still ? this.settleTimer + dt : 0;

    if (this.settleTimer > 0.45 || this.maxTimer > 7) {
      this.finish();
    }
  }

  topValue(die) {
    const up = new THREE.Vector3(0, 1, 0);
    let best = -2, val = 1;
    for (const f of this.d12.faces) {
      const n = f.normal.clone().applyQuaternion(die.mesh.quaternion);
      const d = n.dot(up);
      if (d > best) { best = d; val = f.value; }
    }
    return val;
  }

  finish() {
    this.active = false;
    const hope = this.topValue(this.dice[0]);
    const fear = this.topValue(this.dice[1]);
    const resolve = this.resolve;
    // Linger so player reads the dice, then fade out
    setTimeout(async () => {
      await this.sm.tween(0.4, p => {
        for (const d of this.dice) d.mesh.scale.setScalar(1 - p);
      });
      for (const d of this.dice) {
        this.sm.scene.remove(d.mesh);
        this.world.removeBody(d.body);
      }
      this.dice = [];
      this.overlay.classList.add('hidden');
      this.sm.controls.enabled = true;
    }, 1400);
    resolve({ hope, fear });
  }

  showResult(html, cls) {
    this.resultEl.innerHTML = html;
    this.resultEl.className = cls; // also removes 'hidden'
  }
}
