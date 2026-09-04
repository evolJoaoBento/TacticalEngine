// ============ GRID / WORLD BUILDER ============
// Continuous low-poly terrain heightfield (ground), crisp boxes for tall
// structures (walls, curtains, balconies), tokens, nodes, decos, and a
// drifting fog wall. Owns the entity registry for text<->grid flashing.
//
// Logic stays tile-based (heights, props, pathfinding); only the LOOK and
// token motion are freeform.

import * as THREE from 'three';
import { buildModel, setSpiritEyes } from './models.js';

export const TILE = 1;          // tile world size
export const BASE_H = 0.25;     // base ground thickness
export const LEVEL_H = 0.35;    // extra height per terrain level
const STRUCT_MIN = 3;           // tiles at h >= this render as crisp boxes

const flat = (color, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });

// Deterministic hash noise in [0,1) — keeps terrain stable across rebuilds.
const hash = (x, y) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export class GridWorld {
  constructor(sceneMgr) {
    this.sm = sceneMgr;
    this.root = new THREE.Group();
    this.sm.scene.add(this.root);

    this.groundGroup = new THREE.Group();   // heightfield + skirt + prop decals
    this.structGroup = new THREE.Group();   // tall tiles as boxes
    this.tokenGroup = new THREE.Group();
    this.nodeGroup = new THREE.Group();
    this.decoGroup = new THREE.Group();
    this.fogGroup = new THREE.Group();      // drifting fog wall sprites
    this.markerGroup = new THREE.Group();   // editor overlays: triggers, spawns
    this.hiliteGroup = new THREE.Group();   // reachable highlights
    this.root.add(this.groundGroup, this.structGroup, this.tokenGroup, this.nodeGroup,
      this.decoGroup, this.fogGroup, this.markerGroup, this.hiliteGroup);

    this.map = null;
    this.terrainMesh = null;
    this.registry = new Map();   // id -> { mesh, mats }
    this.heroTokens = new Map();
    this.enemyTokens = new Map();
    this.hoverers = [];
    this.fogSprites = [];
    this.animT = 0;

    this.sm.frameHooks.push(dt => {
      this.animT += dt;
      for (const h of this.hoverers) {
        h.mesh.position.y = h.baseY + Math.sin(this.animT * 1.6 + h.phase) * 0.08 + 0.08;
      }
      for (const f of this.fogSprites) {
        f.sprite.position.x = f.baseX + Math.sin(this.animT * f.speed + f.phase) * 0.6;
        f.sprite.position.z = f.baseZ + Math.cos(this.animT * f.speed * 0.7 + f.phase) * 0.5;
        f.sprite.material.rotation += dt * f.spin;
        f.sprite.material.opacity = f.baseOpacity + Math.sin(this.animT * 0.5 + f.phase) * 0.08;
      }
    });
  }

  // ---------- coordinates / heights ----------
  tileWorld(x, y) {
    return new THREE.Vector3(x - this.map.w / 2 + 0.5, 0, y - this.map.h / 2 + 0.5);
  }
  tile(x, y) {
    if (!this.map || x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return null;
    return this.map.tiles[y * this.map.w + x];
  }
  worldToTile(pt) {
    const x = Math.floor(pt.x + this.map.w / 2);
    const y = Math.floor(pt.z + this.map.h / 2);
    return (this.tile(x, y)) ? { x, y } : null;
  }

  // Corner height of the heightfield at corner-grid coords (0..w, 0..h).
  cornerH(cx, cy) {
    let sum = 0, n = 0;
    for (const dy of [-1, 0]) for (const dx of [-1, 0]) {
      const t = this.tile(cx + dx, cy + dy);
      if (t) { sum += Math.min(t.h, STRUCT_MIN - 1); n++; }
    }
    const h = n ? sum / n : 0;
    return BASE_H + h * LEVEL_H + (hash(cx, cy) - 0.5) * 0.09;
  }

  // Visual surface height at a tile center — where tokens/props stand.
  tileTopY(x, y) {
    const t = this.tile(x, y);
    if (!t) return 0;
    if (t.h >= STRUCT_MIN) return BASE_H + t.h * LEVEL_H;
    return (this.cornerH(x, y) + this.cornerH(x + 1, y) + this.cornerH(x, y + 1) + this.cornerH(x + 1, y + 1)) / 4;
  }

  // Surface height at an arbitrary world point (bilinear over the tile's corners).
  surfaceAt(wx, wz) {
    const fx = wx + this.map.w / 2, fz = wz + this.map.h / 2;
    const x = Math.floor(fx), y = Math.floor(fz);
    const t = this.tile(x, y);
    if (!t) return 0;
    if (t.h >= STRUCT_MIN) return BASE_H + t.h * LEVEL_H;
    const u = fx - x, v = fz - y;
    const a = this.cornerH(x, y), b = this.cornerH(x + 1, y);
    const c = this.cornerH(x, y + 1), d = this.cornerH(x + 1, y + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }

  // ---------- build ----------
  build(map) {
    this.map = map;
    this.clearGroup(this.groundGroup);
    this.clearGroup(this.structGroup);
    this.clearGroup(this.nodeGroup);
    this.clearGroup(this.tokenGroup);
    this.clearGroup(this.decoGroup);
    this.clearGroup(this.fogGroup);
    this.clearGroup(this.markerGroup);
    this.registry.clear();
    this.heroTokens.clear();
    this.enemyTokens.clear();
    this.hoverers = [];
    this.fogSprites = [];

    this.rebuildGround();
    for (const n of map.nodes) this.buildNode(n);
    for (const d of (map.decos || [])) this.buildDeco(d);
    if (map.fog) this.buildFogWall(map.fog.band || 2);

    // Dense scene fog when the map carries its own fog wall
    this.sm.scene.fog.near = map.fog ? 13 : 28;
    this.sm.scene.fog.far = map.fog ? 34 : 60;
  }

  clearGroup(g) {
    while (g.children.length) {
      const c = g.children[g.children.length - 1];
      g.remove(c);
      c.traverse?.(o => { o.geometry?.dispose(); if (o.material?.dispose) o.material.dispose(); });
    }
  }

  // Editor compatibility: per-tile edits rebuild the ground (fast enough).
  buildTile() { this.rebuildGround(); }

  rebuildGround() {
    this.clearGroup(this.groundGroup);
    this.clearGroup(this.structGroup);
    const map = this.map;

    // --- Heightfield: 2 triangles per ground tile, vertex colors, flat shaded ---
    const pos = [], col = [];
    const c0 = new THREE.Color();
    const pushTri = (a, b, c, color) => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
    };
    const V = (cx, cy) => new THREE.Vector3(cx - map.w / 2, this.cornerH(cx, cy), cy - map.h / 2);

    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = this.tile(x, y);
      if (t.h >= STRUCT_MIN) continue;
      const v00 = V(x, y), v10 = V(x + 1, y), v01 = V(x, y + 1), v11 = V(x + 1, y + 1);
      c0.set(t.color).multiplyScalar(0.94 + hash(x * 3 + 1, y * 7 + 2) * 0.12);
      // Alternate the diagonal for a more natural facet pattern
      if ((x + y) % 2 === 0) {
        pushTri(v00, v01, v11, c0); pushTri(v00, v11, v10, c0);
      } else {
        pushTri(v00, v01, v10, c0); pushTri(v10, v01, v11, c0);
      }
    }

    // --- Perimeter skirt down to the void floor ---
    const skirt = new THREE.Color('#23202b');
    const edge = (ax, ay, bx, by) => { // corner coords, outer edge a->b
      const a = V(ax, ay), b = V(bx, by);
      const a0 = a.clone().setY(-0.05), b0 = b.clone().setY(-0.05);
      pushTri(a, b, b0, skirt); pushTri(a, b0, a0, skirt);
    };
    for (let x = 0; x < map.w; x++) {
      if (this.tile(x, 0).h < STRUCT_MIN) edge(x + 1, 0, x, 0);
      if (this.tile(x, map.h - 1).h < STRUCT_MIN) edge(x, map.h, x + 1, map.h);
    }
    for (let y = 0; y < map.h; y++) {
      if (this.tile(0, y).h < STRUCT_MIN) edge(0, y, 0, y + 1);
      if (this.tile(map.w - 1, y).h < STRUCT_MIN) edge(map.w, y + 1, map.w, y);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    this.terrainMesh = new THREE.Mesh(geo,
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
    this.terrainMesh.receiveShadow = true;
    this.terrainMesh.castShadow = true;
    this.terrainMesh.userData = { kind: 'terrain' };
    this.groundGroup.add(this.terrainMesh);

    // --- Structures: tall tiles stay crisp boxes (walls, curtains, balconies) ---
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = this.tile(x, y);
      if (t.h < STRUCT_MIN) continue;
      const h = BASE_H + t.h * LEVEL_H;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(TILE, h, TILE), flat(t.color));
      const p = this.tileWorld(x, y);
      mesh.position.set(p.x, h / 2, p.z);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData = { kind: 'tile', x, y };
      this.structGroup.add(mesh);
    }

    // --- Tile property decals ---
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = this.tile(x, y);
      if (!t.prop || t.h >= STRUCT_MIN) continue;
      const p = this.tileWorld(x, y);
      const topY = this.tileTopY(x, y);
      if (t.prop === 'difficult') {
        const deco = new THREE.Mesh(
          new THREE.CircleGeometry(0.32, 5),
          new THREE.MeshBasicMaterial({ color: '#2c3b33', transparent: true, opacity: 0.55, depthWrite: false })
        );
        deco.rotation.x = -Math.PI / 2;
        deco.rotation.z = hash(x, y) * 3;
        deco.position.set(p.x, topY + 0.03, p.z);
        this.groundGroup.add(deco);
      } else if (t.prop === 'cover') {
        const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.26, 0), flat('#6e7480'));
        rock.position.set(p.x + 0.22, topY + 0.14, p.z - 0.18);
        rock.rotation.set(hash(x, y) * 2, hash(y, x) * 3, 0);
        rock.castShadow = true;
        this.groundGroup.add(rock);
      }
    }
  }

  // Raycast helper: which tile did the pointer land on (terrain or structure)?
  pickCell(ev) {
    const objs = this.terrainMesh ? [this.terrainMesh, ...this.structGroup.children] : [];
    const hit = this.sm.pick(ev, objs);
    if (!hit) return null;
    if (hit.object.userData?.kind === 'tile') {
      return { x: hit.object.userData.x, y: hit.object.userData.y };
    }
    return this.worldToTile(hit.point);
  }

  // ---------- fog wall ----------
  fogTexture() {
    if (this._fogTex) return this._fogTex;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(190,195,215,0.85)');
    g.addColorStop(0.55, 'rgba(170,175,200,0.35)');
    g.addColorStop(1, 'rgba(160,165,190,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    this._fogTex = new THREE.CanvasTexture(cv);
    return this._fogTex;
  }

  buildFogWall(band) {
    const map = this.map;
    const tex = this.fogTexture();
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const inBand = x < band || y < band || x >= map.w - band || y >= map.h - band;
      if (!inBand) continue;
      // Outermost ring is denser than the inner edge of the band
      const onRim = x === 0 || y === 0 || x === map.w - 1 || y === map.h - 1;
      if (!onRim && hash(x * 5, y * 9) < 0.55) continue; // sparse inner wisps
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        opacity: (onRim ? 0.26 : 0.14) + hash(x, y) * 0.1,
        rotation: hash(x, y + 1) * 6.28,
      });
      const s = new THREE.Sprite(mat);
      const p = this.tileWorld(x, y);
      const baseX = p.x + (hash(x * 2, y) - 0.5) * 1.2;
      const baseZ = p.z + (hash(x, y * 2) - 0.5) * 1.2;
      s.position.set(baseX, 0.45 + hash(x + 7, y + 3) * 0.8, baseZ);
      const sc = 1.7 + hash(x * 3, y * 5) * 1.6;
      s.scale.set(sc, sc * 0.65, 1);
      this.fogGroup.add(s);
      this.fogSprites.push({
        sprite: s, baseX, baseZ,
        phase: hash(x, y * 4) * 6.28,
        speed: 0.18 + hash(y, x) * 0.25,
        spin: (hash(x * 9, y) - 0.5) * 0.12,
        baseOpacity: mat.opacity,
      });
    }
  }

  // ---------- registry / flash ----------
  register(id, group) {
    const mats = [];
    group.traverse(o => {
      if (o.material && o.material.emissive) mats.push({ mat: o.material, base: o.material.emissive.getHex() });
    });
    this.registry.set(id, { mesh: group, mats });
  }

  flash(id) {
    const e = this.registry.get(id);
    if (!e) return;
    this.sm.tween(0.9, p => {
      const k = Math.abs(Math.sin(p * Math.PI * 3)) * 0.9;
      for (const { mat } of e.mats) mat.emissive.setRGB(k * 0.4, k * 0.65, k);
    }).then(() => {
      for (const { mat, base } of e.mats) mat.emissive.setHex(base);
    });
  }

  // ---------- tokens ----------
  buildHeroToken(hero) {
    let g = buildModel(hero.model);
    if (!g) {
      g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 6), flat(hero.color));
      body.position.y = 0.36;
      g.add(body);
    }
    if (hero.spirit) setSpiritEyes(g, hero.spirit);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData = { kind: 'hero', id: hero.id };
    this.placeToken(g, hero.x, hero.y);
    this.tokenGroup.add(g);
    this.heroTokens.set(hero.id, g);
    this.register(hero.id, g);
    return g;
  }

  refreshSpiritEyes(hero) {
    const g = this.heroTokens.get(hero.id);
    if (g) setSpiritEyes(g, hero.spirit || 0);
  }

  buildEnemyToken(e) {
    let g = buildModel(e.model);
    if (!g) {
      g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.26, 0.5, 5), flat('#7d4452'));
      body.position.y = 0.34;
      g.add(body);
    }
    const hover = g.userData.hover;
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.userData = { kind: 'enemy', id: e.id };
    this.placeToken(g, e.x, e.y);
    this.tokenGroup.add(g);
    this.enemyTokens.set(e.id, g);
    this.register(e.id, g);
    if (hover) this.hoverers.push({ mesh: g, baseY: g.position.y, phase: Math.random() * 6 });
    return g;
  }

  placeToken(g, x, y) {
    const p = this.tileWorld(x, y);
    g.position.set(p.x, this.tileTopY(x, y), p.z);
  }

  removeToken(id) {
    const g = this.heroTokens.get(id) || this.enemyTokens.get(id);
    if (!g) return;
    this.tokenGroup.remove(g);
    this.heroTokens.delete(id); this.enemyTokens.delete(id);
    this.registry.delete(id);
  }

  // Freeflow glide along waypoints (cell coords; pre-smoothed by the caller).
  // Constant speed, smooth facing, gentle stride bob, terrain-following height.
  async hopAlong(id, cells) {
    const g = this.heroTokens.get(id) || this.enemyTokens.get(id);
    if (!g || cells.length < 2) return;

    const pts = cells.map(c => {
      const p = this.tileWorld(c.x, c.y);
      p.y = 0; // height sampled live so the token hugs slopes between waypoints
      return p;
    });
    const seg = [0];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      seg.push(total);
    }
    if (total < 0.01) return;
    const dur = Math.max(total / 4.6, 0.14);
    let yaw = g.rotation.y;

    await this.sm.tween(dur, p => {
      const d = p * total;
      let i = 1;
      while (i < seg.length - 1 && seg[i] < d) i++;
      const t = (d - seg[i - 1]) / Math.max(seg[i] - seg[i - 1], 1e-6);
      const x = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t;
      const z = pts[i - 1].z + (pts[i].z - pts[i - 1].z) * t;
      const y = this.surfaceAt(x, z) + Math.abs(Math.sin(d * Math.PI * 2.2)) * 0.07;
      g.position.set(x, y, z);
      // Smoothly face direction of travel
      const target = Math.atan2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      let dy = target - yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      yaw += dy * 0.18;
      g.rotation.y = yaw;
      g.rotation.z = Math.sin(d * Math.PI * 2.2) * 0.05; // slight stride sway
    });
    g.rotation.z = 0;
    const end = cells[cells.length - 1];
    this.placeToken(g, end.x, end.y);
    g.rotation.y = yaw;
  }

  async bumpAttack(id, tx, ty) {
    const g = this.heroTokens.get(id) || this.enemyTokens.get(id);
    if (!g) return;
    const from = g.position.clone();
    const to = this.tileWorld(tx, ty); to.y = from.y;
    g.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    await this.sm.tween(0.22, p => {
      const k = Math.sin(p * Math.PI) * 0.4;
      g.position.lerpVectors(from, to, k);
    });
    g.position.copy(from);
  }

  async deathAnim(id) {
    const g = this.heroTokens.get(id) || this.enemyTokens.get(id);
    if (!g) return;
    await this.sm.tween(0.5, p => {
      g.rotation.z = p * Math.PI / 2;
      g.scale.setScalar(1 - p * 0.4);
      g.position.y = Math.max(0.05, g.position.y - p * 0.02);
    });
  }

  // ---------- decos ----------
  buildDeco(d) {
    const g = buildModel(d.type);
    if (!g) return null;
    const p = this.tileWorld(d.x, d.y);
    g.position.set(p.x, this.tileTopY(d.x, d.y), p.z);
    if (d.rot) g.rotation.y = d.rot;
    g.traverse(o => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
    g.userData.deco = d;
    this.decoGroup.add(g);
    if (g.userData.hover) this.hoverers.push({ mesh: g, baseY: g.position.y, phase: Math.random() * 6 });
    if (d.id) this.register(d.id, g);
    return g;
  }

  rebuildDecos() {
    this.clearGroup(this.decoGroup);
    this.hoverers = this.hoverers.filter(h => h.mesh.parent);
    for (const d of (this.map.decos || [])) this.buildDeco(d);
  }

  // ---------- nodes ----------
  buildNode(n) {
    if (n.model) {
      const g = buildModel(n.model);
      if (g) {
        g.traverse(o => { if (o.isMesh && o.name !== 'beam') { o.castShadow = true; o.receiveShadow = true; } });
        g.userData = { kind: 'node', id: n.id };
        g.children.forEach(c => { c.userData = { ...c.userData, kind: 'node', id: n.id }; });
        const p = this.tileWorld(n.x, n.y);
        g.position.set(p.x, this.tileTopY(n.x, n.y), p.z);
        if (n.rot) g.rotation.y = n.rot;
        this.nodeGroup.add(g);
        this.register(n.id, g);
        if (n.model === 'spotlight' && n.lit) this.setPillarLit(n, true);
        return g;
      }
    }
    const g = new THREE.Group();
    if (n.type === 'chest') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.3, 0.38), flat('#8a6238'));
      body.position.y = 0.15;
      const lid = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.38), flat('#a07845'));
      lid.position.set(0, 0.3 + 0.07, 0);
      lid.name = 'lid';
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.46, 0.1), flat('#4d4a55'));
      band.position.y = 0.23;
      g.add(body, lid, band);
      if (n.open) { lid.position.z = -0.16; lid.rotation.x = -1.9; }
    } else if (n.type === 'door') {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.5, 0.18), flat('#4d4a55'));
      frame.position.y = 0.75;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.1), flat('#7a5a36'));
      panel.position.y = 0.7;
      panel.name = 'panel';
      g.add(frame, panel);
      if (n.open) { panel.rotation.y = 1.4; panel.position.x = 0.3; }
    } else if (n.type === 'pillar') {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 6), flat('#8d8f9c'));
      col.position.y = 0.75;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.14, 0.6), flat('#75788a'));
      cap.position.y = 1.55;
      g.add(col, cap);
    }
    g.traverse(o => { o.castShadow = o.receiveShadow = true; });
    g.userData = { kind: 'node', id: n.id };
    g.children.forEach(c => c.userData = { kind: 'node', id: n.id });
    const p = this.tileWorld(n.x, n.y);
    g.position.set(p.x, this.tileTopY(n.x, n.y), p.z);
    this.nodeGroup.add(g);
    this.register(n.id, g);
    return g;
  }

  rebuildNodes() {
    this.clearGroup(this.nodeGroup);
    for (const n of this.map.nodes) {
      this.registry.delete(n.id);
      this.buildNode(n);
    }
  }

  setPillarLit(n, lit) {
    n.lit = lit;
    const e = this.registry.get(n.id);
    if (!e) return;
    const beam = e.mesh.getObjectByName('beam');
    const lens = e.mesh.getObjectByName('lens');
    if (beam) beam.visible = lit;
    if (lens) {
      lens.material = lens.material.clone();
      lens.material.color.set(lit ? '#fff3c0' : '#3a3326');
      lens.material.emissive.set(lit ? '#ffe9a0' : '#000000');
      lens.material.emissiveIntensity = lit ? 1.8 : 0;
    }
  }

  async animateNodeOpen(n) {
    const e = this.registry.get(n.id);
    if (!e) return;
    if (n.type === 'chest') {
      const lid = e.mesh.getObjectByName('lid');
      if (lid) await this.sm.tween(0.4, p => { lid.rotation.x = -1.9 * p; lid.position.z = -0.16 * p; });
    } else if (n.type === 'door') {
      const panel = e.mesh.getObjectByName('panel');
      if (panel) await this.sm.tween(0.5, p => { panel.rotation.y = 1.4 * p; panel.position.x = 0.3 * p; });
    }
  }

  async animateNodeDestroy(n) {
    const e = this.registry.get(n.id);
    if (!e) return;
    await this.sm.tween(0.5, p => {
      e.mesh.rotation.z = p * 1.2;
      e.mesh.scale.setScalar(1 - p * 0.85);
    });
    this.nodeGroup.remove(e.mesh);
    this.registry.delete(n.id);
  }

  // ---------- editor markers ----------
  rebuildMarkers(showEditorMarkers) {
    this.clearGroup(this.markerGroup);
    if (!showEditorMarkers || !this.map) return;
    for (const trig of this.map.triggers) {
      for (const [x, y] of trig.cells) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.9),
          new THREE.MeshBasicMaterial({ color: '#ff8c42', transparent: true, opacity: 0.3, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        const p = this.tileWorld(x, y);
        m.position.set(p.x, this.tileTopY(x, y) + 0.04, p.z);
        this.markerGroup.add(m);
      }
    }
    this.map.spawns.forEach(([x, y]) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.22, 0.36, 16),
        new THREE.MeshBasicMaterial({ color: '#5fb0ff', transparent: true, opacity: 0.6, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      const p = this.tileWorld(x, y);
      m.position.set(p.x, this.tileTopY(x, y) + 0.045, p.z);
      this.markerGroup.add(m);
    });
  }

  // ---------- reachable highlight (soft discs, not squares) ----------
  showReachable(cells, color = '#f6c453') {
    this.clearGroup(this.hiliteGroup);
    const geo = new THREE.CircleGeometry(0.34, 12);
    for (const c of cells) {
      const m = new THREE.Mesh(geo.clone(),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      const p = this.tileWorld(c.x, c.y);
      m.position.set(p.x, this.tileTopY(c.x, c.y) + 0.035, p.z);
      this.hiliteGroup.add(m);
    }
  }
  clearReachable() { this.clearGroup(this.hiliteGroup); }
}

// ============ PATHFINDING ============
export function findReachable(grid, start, budget, occupied, blockedNodes) {
  const key = (x, y) => x + ',' + y;
  const cost = new Map([[key(start.x, start.y), 0]]);
  const prev = new Map();
  const queue = [{ x: start.x, y: start.y, c: 0 }];
  while (queue.length) {
    queue.sort((a, b) => a.c - b.c);
    const cur = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const t = grid.tile(nx, ny);
      if (!t) continue;
      const curT = grid.tile(cur.x, cur.y);
      if (Math.abs(t.h - curT.h) > 1) continue;
      if (occupied.has(key(nx, ny))) continue;
      if (blockedNodes.has(key(nx, ny))) continue;
      const stepCost = t.prop === 'difficult' ? 2 : 1;
      const nc = cur.c + stepCost;
      if (nc > budget) continue;
      const k = key(nx, ny);
      if (cost.has(k) && cost.get(k) <= nc) continue;
      cost.set(k, nc);
      prev.set(k, key(cur.x, cur.y));
      queue.push({ x: nx, y: ny, c: nc });
    }
  }
  return { cost, prev, key };
}

export function tracePath(reach, start, dest) {
  const { prev, key } = reach;
  let k = key(dest.x, dest.y);
  if (!reach.cost.has(k)) return null;
  const path = [];
  while (k) {
    const [x, y] = k.split(',').map(Number);
    path.unshift({ x, y });
    if (x === start.x && y === start.y) break;
    k = prev.get(k);
  }
  return path;
}

// String-pulling: drop intermediate waypoints when the straight line between
// two cells crosses only walkable, unblocked tiles with gentle height steps.
export function smoothPath(grid, path, blocked, occupied) {
  if (!path || path.length < 3) return path;

  const lineWalkable = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const steps = Math.ceil(Math.hypot(dx, dy) * 4);
    let prevT = grid.tile(a.x, a.y);
    let prevK = a.x + ',' + a.y;
    for (let i = 1; i <= steps; i++) {
      const cx = Math.round(a.x + dx * i / steps);
      const cy = Math.round(a.y + dy * i / steps);
      const k = cx + ',' + cy;
      if (k === prevK) continue;
      const t = grid.tile(cx, cy);
      if (!t) return false;
      if (blocked.has(k) || occupied.has(k)) return false;
      if (Math.abs(t.h - prevT.h) > 1) return false;
      prevT = t; prevK = k;
    }
    return true;
  };

  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !lineWalkable(path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}
