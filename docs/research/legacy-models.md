# Legacy procedural model library (`legacy/js/models.js`) — research and port plan

Source: `C:\Users\joaoo\daggerheart game\legacy\js\models.js` (508 lines, ES module, imports only `three`).
Consumers: `legacy/js/grid.js`, `legacy/js/editor.js`, `legacy/js/game.js`, `legacy/js/campaign.js`, `legacy/js/data.js`, `legacy/js/data-campaign.js`.

Everything numeric below was measured by building every model with the real `three` 0.185.1 package under
Node 22 (no DOM, no WebGL) and traversing the resulting `THREE.Group`s. The measuring script is not part of the
repo (scratchpad `model-stats.mjs`); the method is described in section 9 so it can be reproduced as a unit test.
Nothing here was verified visually in a browser — see section 12 for the list of unverified items.

**No TTS / voice code exists in `models.js` or any of its consumers. Nothing to strip; nothing to re-add.**

---

## 1. What the library is

A single-file catalog of low-poly "miniature" builders. Each builder is a zero-argument function (three accept an
unused `color` parameter, see 4.1) that returns a fresh `THREE.Group` assembled from three.js primitive
geometries and `MeshStandardMaterial`s. The file header states the contract:

> Every builder returns a THREE.Group roughly 1 tile wide, standing on y=0. Used by play mode, the campaign, AND
> the map editor (enemy/deco palettes) — add a builder here and it is available everywhere.

Export surface (exact):

| Export | Line | Signature / shape |
|---|---|---|
| `setSpiritEyes` | 42 | `setSpiritEyes(group, count)` — lights 0/1/2 eye meshes named `eye0`/`eye1` |
| `MODELS` | 461 | `Record<string, () => THREE.Group>` with **31 keys** (6 heroes, 4 monsters, 21 props incl. `spotlight`) |
| `buildModel` | 473 | `buildModel(name)` → `THREE.Group \| null`; `'body:<heroKey>'` prefix synthesizes a fallen, desaturated hero |
| `DECO_TYPES` | 480 | `string[]` of **20** keys — the editor deco-palette allowlist (a subset of `MODELS`) |
| `DECO_INFO` | 487 | `Record<decoType, { name, desc }>` — 20 entries, right-click inspector text |

Private helpers (not exported): `M` (line 9), `P` (11), `tokenBase` (20), `makeHead` (30), `staff` (55), `body` (445).

`MODELS` keys not in `DECO_TYPES` (11): `knight, rogue, mage, battleMage, frostMage, defender, husk, bramble,
shadowHag, archfey, spotlight`. `DECO_TYPES` is only a palette allowlist; `grid.buildDeco()` accepts any `MODELS`
key, and campaign data does place `archfey` as a deco (`{ id: 'archfey-2', type: 'archfey', ... }`) even though the
editor cannot. Every `DECO_TYPES` entry has a `DECO_INFO` entry (verified: none missing).

---

## 2. Helpers and conventions (the "DSL")

### 2.1 Material factory `M`

```js
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...o });
```

- Always `MeshStandardMaterial`, always `flatShading: true`. Defaults therefore apply: `roughness = 1`,
  `metalness = 0` (confirmed on built materials).
- Option overrides used in the file: `metalness` 24 times (values 0.25–0.7), `emissive` 19 times
  (+ `emissiveIntensity` 0.35–2.2), `transparent: true` 6 times (opacity 0.12–0.92), `roughness` 3 times
  (0.2, 0.25, 0.3 — only `archfey` robe/mantle and the `piano` body).
- `MeshBasicMaterial` (unlit) is used exactly twice, both transparent, `depthWrite: false`, `side: DoubleSide`:
  the `spotlight` beam (`#fff3c0`, opacity 0.16) and the `barrier` shell (`#bfeaff`, opacity 0.12).
- **Every mesh gets its own material instance.** A built `knight` has 15 meshes and 15 distinct material objects.
  Nothing is shared or cached, neither geometry nor material, across or within builds. This is the main thing the
  port must change (section 10.3).

### 2.2 Part placer `P`

```js
function P(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos); m.rotation.set(...rot);
  m.castShadow = true;           // every part casts; receiveShadow is NOT set here
  return m;
}
```

`castShadow` is explicitly set to `false` afterwards only on the `spotlight` beam and the `barrier` shell.
`receiveShadow` is set later by consumers (`grid.buildNode` sets both on every mesh except the one named `beam`).

### 2.3 Token base `tokenBase(ringColor)`

Round miniature base used by all 6 heroes and 3 of 4 monsters (`archfey` has none — "he does not deign to stand on
one"):

- `CylinderGeometry(0.34, 0.38, 0.08, 18)` in `#2b2e3c` at y 0.04 (top of base at y = 0.08).
- `TorusGeometry(0.33, 0.025, 6, 18)` ring in `ringColor` with `emissive: ringColor, emissiveIntensity: 0.35`,
  laid flat (`rotation.x = π/2`) at y 0.085.
- Base footprint diameter = 0.76 world units (tile = 1.0).

The ring colour is **baked per builder**, not derived from the hero definition:

| Builder | Ring | Hero def `color` (data.js / data-campaign.js) | Match? |
|---|---|---|---|
| knight | `#c8cede` | Kara `#e06c4f` (demo) / Bram `#c8cede` (campaign) | only campaign |
| rogue | `#5fb0ff` | Finn `#5fb0ff` | yes |
| mage | `#b07ae0` | Mira `#b07ae0` | yes |
| battleMage | `#ff9d45` | Ardyn `#ff7b33` | no |
| frostMage | `#9fd8ff` | Iskra `#7fc8ff` | no |
| defender | `#7ad17a` | Tomé `#7ad17a` | yes |
| husk / bramble / shadowHag | `#c2455a` / `#a0522d` / `#6f42c8` | n/a | — |

Port decision: ring colour becomes a build parameter (`ringColor`), defaulting to the entity's colour.

### 2.4 Head `makeHead(skin = '#e8d5b5', r = 0.12)`

- `IcosahedronGeometry(r, 0)` skull in `skin`.
- Two eyes: `SphereGeometry(0.028, 6, 6)` in `#1a1a22`, at `x = ∓0.05, y = 0.01, z = r * 0.85`, named `eye0`
  (left, −x) and `eye1` (right, +x). Eyes on +z ⇒ **models face +z**. `grid.hopAlong` computes yaw as
  `atan2(dx, dz)`, consistent with +z forward.
- Heads are used by all 6 heroes, `husk`, `shadowHag`, `archfey` and the `spectator` prop (10 heads; 14 including
  the four `body:` variants the campaign uses ⇒ the 28 eye spheres in the totals below).
- Radii used: 0.11 (8 models), 0.115 (`defender`), 0.1 (`shadowHag`), 0.095 (`spectator`). Only `makeHead`'s
  default of 0.12 is never used.

### 2.5 Staff `staff(len, tipMesh, woodColor = '#6b5236')`

`CylinderGeometry(0.025, 0.03, len, 5)` from y 0 to `len`, optional `tipMesh` placed at `y = len + 0.05`. Used by
`mage` (0.85), `battleMage` (0.9), `frostMage` (0.9), `defender` (0.95), `shadowHag` (1.05). Always attached on the
model's **right side (+x ≈ 0.27–0.30, z ≈ 0.05–0.08)**; the knight's shield is on **−x** (x = −0.3) and its sword on
+x (x = 0.3). These are the de-facto `hand.R` / `hand.L` sockets.

### 2.6 Scale and placement conventions

- 1 world unit = 1 tile (`TILE = 1` in grid.js). Tokens are placed at the tile centre with `position.y =
  tileTopY(x, y)`; the model's own origin is meant to be its feet/base bottom at y = 0.
- Heroes are 0.96–1.10 tall and 0.75–0.84 wide (base-dominated). Monsters: `bramble` 0.49, `husk` 0.86,
  `shadowHag` 1.28 (1.03 wide because of the staff), `archfey` top at 1.63.
- Props range from `floorboard` (0.13 tall) to `curtain` (2.10) and `barrier` (2.00 tall, 1.71 wide); `tent` and
  `hut` exceed one tile (1.56 and 1.33 wide).
- Origin violators (measured `Box3.setFromObject` min y): `rock` −0.203 (intentionally half-sunk), `body:*` −0.192
  (laid in the dirt), `archfey` **+0.25** (floats; no base), `campfire` −0.04 (log ends), `spotlight` −0.028,
  `deadTree` −0.007. Everything else is within ±0.005 of 0.
- `spotlight`'s measured bbox is 1.00 × 1.86 × 2.94 **because `Box3.setFromObject` includes the hidden beam**
  (`visible = false` does not exclude it). Without the beam it is x −0.156..0.23, y 0..1.34, z −0.15..0.27. Any
  culling/BVH bounds in the port must exclude fx parts.

### 2.7 Named parts and flags (the only "hooks" the legacy code has)

| Name / flag | Set by | Read by |
|---|---|---|
| `eye0`, `eye1` (meshes) | `makeHead` | `setSpiritEyes` (material swap + scale) |
| `lens`, `socket`, `beam` (meshes) | `spotlight` | `grid.setPillarLit` (lens material clone, `beam.visible`); `grid.buildNode` skips `beam` for shadows |
| `portal` (mesh) | `gate` | nothing reads it (name only) |
| `userData.hover = true` | `archfey` | `grid.buildEnemyToken` / `grid.buildDeco` push the group into `hoverers` (bobbing animation). **`grid.buildNode` overwrites `userData` wholesale and never checks it**, so a hovering model placed as a node does not bob. |
| `lid` (chest), `panel` (door) | **`grid.buildNode` inline builders, not models.js** | `grid.animateNodeOpen` |

---

## 3. Spirit-eye system

```js
export function setSpiritEyes(group, count) {
  let i = 0;
  group.traverse(o => {
    if (o.name === 'eye0' || o.name === 'eye1') {
      const on = i < count;
      o.material = M(on ? '#aef6ff' : '#1a1a22', on ? { emissive: '#7be8ff', emissiveIntensity: 1.6 } : {});
      o.scale.setScalar(on ? 1.4 : 1);
      i++;
    }
  });
}
```

Behaviour (verified by building a knight and calling it):

- `count = 1` lights `eye0` only (traversal order = insertion order: `eye0` then `eye1`); `count ≥ 2` lights both;
  `count = 0` resets both. Lit eye: colour `#aef6ff`, emissive `#7be8ff` × 1.6, scale 1.4. Unlit: `#1a1a22`, no
  emissive, scale 1.
- **Allocates two new materials on every call and never disposes the old ones** (GPU program/uniform leak per call
  in the legacy app; harmless there because it is called a handful of times).
- It matches by name across the whole subtree, so it also affects `spectator` props and any `body:` node (both have
  `makeHead` eyes). The legacy code never calls it on those.

Where it is used:

- `grid.buildHeroToken(hero)`: `if (hero.spirit) setSpiritEyes(g, hero.spirit)` — **before** `register(hero.id, g)`.
- `grid.refreshSpiritEyes(hero)`: `setSpiritEyes(g, hero.spirit || 0)` — after registration. Because
  `register()` captured the old eye materials, `flash()` then holds dead references for the eyes (they simply stop
  flashing). Cosmetic in the legacy app; a reason not to copy the material-mutation design.
- `shadowHag()` and `archfey()` call `setSpiritEyes(head, 2)` at build time ("eyes always burn white-cold").
- Campaign: a hero is added with `spirit: 1` when a spirit takes a body (`campaign.js:149`); the inspector prints
  "N eye(s) alight" (`game.js:788`). `hero.spirit` is a number 0–2 stored on the hero object and carried across
  scenes.

Port decision: two **shared** eye materials (`eyeOff`, `eyeOn`) and `setSpiritEyes` swaps the mesh's material
*reference* and scale; zero allocation, no registry staleness. Eyes become hooks `eye.L` / `eye.R`.

---

## 4. Builder catalog

Columns: meshes; triangles; vertices (position attribute count, primitives are indexed); unique geometry
signatures; unique material parameter sets; emissive parts; transparent parts; measured bbox W×H×D (world units);
named parts / notes. Line numbers refer to `legacy/js/models.js`.

### 4.1 Heroes (all with `tokenBase`, `makeHead`, face +z)

| Key (`MODELS`) | Function / line | Meshes | Tris | Verts | Geo | Mat | Emis. | Bbox W×H×D | Distinguishing parts |
|---|---|---|---|---|---|---|---|---|---|
| `knight` | `vanguardKnight(color='#8d93a5')` L64 | 15 | 578 | 686 | 13 | 12 | 1 (ring) | 0.77×1.09×0.76 | legs cylinder `#3f4350`; cuirass box 0.36×0.32×0.24 + 2 pauldrons (`metalness 0.3`); helm cylinder (`metalness 0.4`); red plume cone `#c0392b`; tower shield on −x (box 0.07×0.55×0.34 `#5a6378` + gold boss `#d4af37`); sword on +x (box 0.04×0.42×0.07 `#cfd6e4` metalness 0.6, tilted −0.35 rad) + crossguard |
| `rogue` | `rogue(color='#3d6b8f')` L82 | 9 | 564 | 547 | 8 | 7 | 1 | 0.75×0.96×0.76 | cloak cone 0.24×0.55; hood cone tilted 0.25; bow = `TorusGeometry(0.26, 0.02, 5, 10, π·1.1)` on the back `#7a5a36`; quiver box |
| `mage` | `mage(color='#7d54b8')` L94 | 10 | 616 | 637 | 9 | 7 | 2 | 0.75×1.10×0.76 | robe cone 0.26×0.6 (7 seg); wizard hat cone + torus brim; staff 0.85 with `IcosahedronGeometry(0.07)` orb `#caa6ff` emissive `#9a5cff` × 0.9 |
| `battleMage` | `battleMage()` L105 | 13 | 538 | 640 | 10 | 10 | 5 | 0.75×1.02×0.76 | war robe `#8c3324`; shoulder plate; circlet; 3 orbiting `TetrahedronGeometry(0.05)` ember shards `#ff7b33` emissive `#ff5a1f` × 1.4; staff 0.9 (`#4a3026` wood) with orb `#ffb347` emissive `#ff6a00` × 1.6 |
| `frostMage` | `frostMage()` L120 | 13 | 520 | 622 | 10 | 9 | 5 (3 transp.) | 0.78×1.09×0.76 | pale robe `#d7e8f5`; frosted mantle; hood; 3 floating `OctahedronGeometry(0.06)` ice shards (`#bfeaff`, emissive `#6fd2ff` × 1.1, opacity 0.92); staff 0.9 (`#7d92a8`) with `OctahedronGeometry(0.09)` crystal emissive `#5fc8ff` × 1.5 |
| `defender` | `villageDefender()` L135 | 11 | 583 | 639 | 10 | 9 | 2 | 0.84×1.07×0.76 | homespun tunic cylinder `#8a6f4d`; belt; satchel on −x; hair = partial `SphereGeometry(0.115, 7, 5, 0, 2π, 0, 1.4)`; "Arcane Stick" staff 0.95 (`#3a4a5c`, `rotation.z = −0.12`) with icosahedron tip `#7fc8ff` emissive `#2f8fff` × 1.8 |

The `color` parameters of `vanguardKnight`, `rogue`, `mage` are never passed: `buildModel` calls `fn()` with no
arguments. They are dead parameters in practice.

### 4.2 Monsters

| Key | Function / line | Meshes | Tris | Verts | Geo | Mat | Emis. | Bbox | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `husk` | `husk()` L150 | 10 | 482 | 517 | 8 | 8 | 1 | 0.75×0.86×0.76 | base ring `#c2455a`; ragged skirt cone (5 seg); bent torso cylinder tilted 0.5 rad; head at (0, 0.68, 0.2) tilted 0.45; 2 claw cones; horn stub |
| `bramble` | `bramble()` L163 | 15 | 440 | 656 | 7 | 7 | 2 | 0.76×0.49×0.76 | base ring `#a0522d`; 3 icosahedron clumps; glowing feeding core `#b3122e` emissive `#8a0a20` × 1.2; **9 thorn cones** `ConeGeometry(0.03, 0.22, 4)` on a ring, `e = (i%3−1)·0.5` height/tilt jitter. No head, no eyes. |
| `shadowHag` | `shadowHag()` L181 | 15 | 678 | 702 | 10 | 9 | 4 | 1.03×1.28×0.77 | base ring `#6f42c8`; cloak cone 0.3×0.75 `#241c33`; 5 tattered-hem cones (inverted); hunched-shoulder sphere; head r 0.1 `#8a7f9c` tilted 0.5, **eyes lit at build** (`setSpiritEyes(head, 2)`); crooked nose cone; Moon Staff 1.05 (`#2e2640`) with crescent `TorusGeometry(0.11, 0.028, 5, 12, π·1.4)` `#e8e6ff` emissive `#b8b0ff` × 1.6 |
| `archfey` | `archfey()` L201 | 13 | 240 | 388 | 6 | 7 | 8 (2 transp.) | 1.04×1.38×0.64 (y 0.25..1.63) | **no base; `userData.hover = true`**; robe cone 0.3×1.0 `#3da8a0` metalness 0.65 roughness 0.25; mantle cone `#7fe0d0` metalness 0.7 roughness 0.2; head `#e9e2f2` at y 1.42, eyes lit at build; crown of 6 `ConeGeometry(0.025, 0.14, 4)` `#fff8d8` emissive `#ffe9a0` × 1.4 on a 0.1 ring at y 1.56; 2 silk-wisp cones (opacity 0.55, `#7fe0d0` / `#caa6ff`) tilted ±0.7 |

### 4.3 Props and decor (`DECO_TYPES` order; `spotlight` appended)

| Key | Function / line | Meshes | Tris | Verts | Geo | Mat | Emis. | Bbox W×H×D | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `tent` | `tent()` L224 | 2 | 16 | 38 | 2 | 2 | 0 | 1.56×0.90×1.56 | 4-sided cone rotated π/4 (square tent) `#6e5a40` + peak cone. Exceeds 1 tile. |
| `campfire` | `campfire()` L231 | 6 | 102 | 186 | 3 | 3 | 2 | 0.33×0.48×0.65 | 4 log cylinders `CylinderGeometry(0.045, 0.045, 0.42, 5)` tilted π/2.4; 2 flame cones (`#ff9d45` em `#ff6a00` × 1.8; `#ffe9a0` em `#ffd75e` × 2.2); **the only light in the library: `PointLight('#ff8c42', intensity 3, distance 4)` at y 0.5** |
| `piano` | `piano()` L246 | 5 | 76 | 140 | 4 | 4 | 0 | 0.90×0.75×0.54 | body box 0.9×0.45×0.5 `#16131c` metalness 0.4 roughness 0.3; keys strip `#efe9dc`; open lid rotated −0.5; 2 leg cylinders |
| `trunk` | `trunkProp()` L255 | 3 | 36 | 72 | 3 | 3 | 0 | 0.63×0.57×0.48 | velvet trunk `#5e2438`, half-open lid `#742c44` rotated −0.4, gold band `#d4af37` metalness 0.5 |
| `floorboard` | `floorboard()` L263 | 2 | 24 | 48 | 2 | 2 | 0 | 0.74×0.13×0.32 | two thin boxes, second one lifted/tilted 0.12 |
| `throne` | `throne()` L270 | 6 | 60 | 129 | 4 | 3 | 3 | 0.80×1.57×0.80 | dais 0.8×0.25×0.8 `#454a59`; seat + back `#2e3340` metalness 0.3; 3 gold finial cones (em `#b8962e` × 0.5, metalness 0.6) |
| `spectator` | `spectator()` L280 | 6 | 352 | 317 | 5 | 4 | 0 | 0.46×0.64×0.36 | cone body `#5a7d6e`, head r 0.095 `#cfe0c8` **with eyes**, 2 thorn-vine tori `#2c4a33`. Placed 24× (pit) and 32× (theater) — the instancing poster child. |
| `hut` | `hut()` L291 | 4 | 84 | 131 | 4 | 4 | 1 | 1.33×1.05×1.29 | 7-sided cylinder `#4a4034` + cone roof `#2e2820`; dark doorway box at z 0.55; witch-light sphere `#b8b0ff` em `#8a7fff` × 1.4 |
| `barrier` | `barrier()` L322 | 8 | 76 | 190 | 2 | 2 | 7 (1 transp.) | 1.71×2.00×1.75 | open cylinder shell r 0.85 h 2.0 (`MeshBasicMaterial`, opacity 0.12, DoubleSide, `castShadow=false`); 7 `OctahedronGeometry(0.045)` star motes `#fff8d8` em `#cfe8ff` × 1.5 at heights `0.5 + (i%3)·0.55` |
| `gate` | `gate()` L338 | 4 | 84 | 148 | 3 | 3 | 1 (transp.) | 1.20×1.66×0.26 | 2 posts 0.22×1.5×0.22 `#565b6b`, lintel `#454a59`; flat cylinder "portal" disc r 0.42 `#7be8ff` em `#3fc8ff` × 1.2 opacity 0.7, `name = 'portal'` |
| `pine` | `pine()` L350 | 4 | 56 | 115 | 4 | 4 | 0 | 0.69×1.55×0.80 | trunk + 3 stacked cones; **`Math.random()` shade 0.85–1.15 on `#3d6b45`**, tiers ×1.12 / ×1.25 brighter. The only non-deterministic builder (verified: two builds differ). |
| `deadTree` | `deadTree()` L361 | 4 | 68 | 118 | 4 | 2 | 0 | 0.85×1.41×0.32 | trunk cylinder tilted 0.08 + 3 branch cylinders (4 seg) `#3d3429` / `#332b22` |
| `rock` | `rock()` L370 | 2 | 40 | 120 | 2 | 2 | 0 | 0.92×0.81×0.87 (y −0.20..0.60) | 2 icosahedra `#6e7480` / `#7d8490` |
| `barrel` | `barrel()` L377 | 3 | 276 | 214 | 2 | 2 | 0 | 0.40×0.42×0.40 | 9-sided cylinder `#6e5a40` + 2 hoop tori `TorusGeometry(0.18, 0.018, 5, 12)` `#4d4a55` (the tori make it the heaviest prop per mesh) |
| `crate` | `crate()` L385 | 3 | 36 | 72 | 3 | 3 | 0 | 0.58×0.38×0.56 | big box rotated 0.2, plank, small box |
| `banner` | `banner()` L393 | 4 | 52 | 101 | 4 | 3 | 0 | 0.43×1.62×0.08 | pole 1.5, crossbar, crimson cloth `#7a2433` 0.34×0.62×0.025, gold finial |
| `brazier` | `brazier()` L402 | 4 | 66 | 122 | 4 | 3 | 2 | 0.31×0.85×0.30 | iron stem + bowl `#3a3d49` metalness 0.4; 2 flame cones (same palette as campfire, × 1.6 / × 2.0). **No light** (unlike campfire). |
| `cart` | `cart()` L411 | 8 | 180 | 308 | 4 | 3 | 0 | 1.16×0.56×0.57 | bed, 2 side rails, 4 wheel cylinders `CylinderGeometry(0.14, 0.14, 0.05, 8)`, shaft |
| `dummy` | `dummy()` L422 | 5 | 128 | 180 | 5 | 4 | 0 | 0.55×1.03×0.36 | pole, crossbar, straw torso, head sphere, helmet ring |
| `curtain` | `curtain()` L433 | 4 | 84 | 144 | 2 | 3 | 0 | 1.00×2.10×0.46 | 3 tall cylinders 2.0 (alternating `#742c44` / `#5e2438`, staggered z) + gold rail |
| `spotlight` | `spotlight()` L300 | 5 | 104 | 180 | 5 | 5 | 0 (1 transp.) | 1.00×1.86×2.94 incl. beam; 0.39×1.34×0.42 without | pole, head box, `lens` (cylinder tilted π/2.6, `#3a3326`), `socket` (cylinder on +x), `beam` = open `ConeGeometry(0.5, 2.6, 8, 1, true)` `MeshBasicMaterial` opacity 0.16, **`visible = false`, `castShadow = false`**, at (0, 0.9, 1.4). Not in `DECO_TYPES`; placed only by campaign data as scripted nodes (`pillar-1..4`). |

### 4.4 The `body:` synthesizer (L445)

```js
function body(heroModelName) {
  const inner = (MODELS[heroModelName] || villageDefender)();
  inner.traverse(o => {
    if (o.material && o.material.color) {
      o.material = o.material.clone();
      o.material.color.lerp(new THREE.Color('#3a3d49'), 0.55);
      if (o.material.emissive) o.material.emissive.multiplyScalar(0.15);
    }
  });
  inner.rotation.z = Math.PI / 2 - 0.12;
  inner.position.y = 0.18;
  return new THREE.Group().add(inner);   // (equivalent)
}
```

`buildModel('body:knight')` etc. Unknown keys fall back to the defender (verified: `body:zzz` → 11 meshes).
Used by the campaign's camp scene for the four corpses (`nodes[].model = 'body:' + heroKey`). Measured
`body:knight` bbox 1.13×0.86×0.76 with min y −0.192. Port decision: this is a **build option** (`pose: 'fallen'`,
`tint: { color, amount, emissiveScale }`), not a separate model.

### 4.5 Builders that live outside `models.js` (must be absorbed by the port)

`grid.js` builds these inline; the registry is incomplete without them:

| Where | Parts (all `MeshStandardMaterial`, flat) |
|---|---|
| `buildNode` chest (grid.js ≈ L479) | body `Box(0.55, 0.3, 0.38)` `#8a6238`; lid `Box(0.55, 0.14, 0.38)` `#a07845` **named `lid`** at y 0.37; band `Box(0.58, 0.46, 0.1)` `#4d4a55`. Open pose: `lid.position.z = −0.16; lid.rotation.x = −1.9` |
| `buildNode` door | frame `Box(0.95, 1.5, 0.18)` `#4d4a55`; panel `Box(0.7, 1.3, 0.1)` `#7a5a36` **named `panel`**. Open pose: `panel.rotation.y = 1.4; panel.position.x = 0.3` |
| `buildNode` pillar | column `Cylinder(0.22, 0.3, 1.5, 6)` `#8d8f9c`; cap `Box(0.6, 0.14, 0.6)` `#75788a` |
| `buildHeroToken` fallback | `Cone(0.22, 0.55, 6)` in `hero.color` (when `buildModel` returns null) |
| `buildEnemyToken` fallback | `Cylinder(0.1, 0.26, 0.5, 5)` `#7d4452` |
| `rebuildGround` tile props | cover rock `Icosahedron(0.26)` `#6e7480` at (+0.22, top+0.14, −0.18); difficult-terrain decal `Circle(0.32, 5)` `MeshBasicMaterial #2c3b33` opacity 0.55 |
| editor markers | trigger `Plane(0.9, 0.9)` `#ff8c42` α 0.3; spawn `Ring(0.22, 0.36, 16)` `#5fb0ff` α 0.6; reachable `Circle(0.34, 12)` α 0.2 |

---

## 5. `DECO_TYPES` and `DECO_INFO` (verbatim, for migration to content JSON)

`DECO_TYPES` (20, palette order): `tent, campfire, piano, trunk, floorboard, throne, spectator, hut, barrier, gate,
pine, deadTree, rock, barrel, crate, banner, brazier, cart, dummy, curtain`.

| Key | `name` | `desc` |
|---|---|---|
| tent | Field Tent | Canvas sagging with dew. Whoever slept here left in a hurry — or never woke. |
| campfire | Campfire | Still burning. Nobody is feeding it, and yet it does not die. |
| piano | Grand Piano | A concert grand, lid propped open. Something glints between the rusted strings. |
| trunk | Prop Trunk | A velvet-lined wardrobe trunk stuffed with costumes of a hundred stolen faces. |
| floorboard | Loose Floorboard | It creaks differently from the others. Hollow underneath. |
| throne | The Conductor's Throne | Cold iron and colder gold. The seat of the Grand Conductor. |
| spectator | Bound Spectator | A fey onlooker lashed to their seat by thorned vines, weeping behind a forced, unnatural smile. |
| hut | Crooked Hut | It leans wrong. The witch-light in its window watches you back. |
| barrier | Starlight Barrier | A shield of frozen starlight. Weapons strike only flickering reflections. |
| gate | Stone Gate | A way through. The air beyond smells different — older, freer. |
| pine | Pine | A wind-bent pine. Its needles never seem to fall. |
| deadTree | Dead Tree | Bare branches like grasping fingers. Long dead, never rotting. |
| rock | Boulder | Weathered stone, half-sunk in the earth. |
| barrel | Barrel | Army-issue. Sloshes faintly when nudged. |
| crate | Supply Crates | Stamped with a quartermaster's mark no one alive remembers. |
| banner | War Banner | A crimson standard. The sigil has been carefully unpicked, thread by thread. |
| brazier | Brazier | An iron basket of coals that burn without smoke. |
| cart | Supply Cart | One wheel is splintered. The load is long gone. |
| dummy | Training Dummy | Straw and dented plate on a pole. It has taken a thousand blows and holds no grudge. |
| curtain | Stage Curtain | Heavy crimson velvet, gold-trimmed. It smells of dust and old applause. |

`game.js:773` uses `DECO_INFO[d.type] || { name: d.type, desc: '' }` in the right-click inspector and appends
"Scenery — walkable, no effect on play". Decos are purely visual in the legacy rules (no blocking, no cover).

---

## 6. Aggregate geometry / material statistics

Measured over 35 builds = the 31 `MODELS` keys + the 4 `body:` variants the campaign uses
(`body:knight`, `body:defender`, `body:battleMage`, `body:frostMage`).

| Scope | Meshes | Triangles | Vertices |
|---|---|---|---|
| 31 `MODELS` keys | 216 | 7,239 | 9,107 |
| + 4 `body:` variants (35 builds) | 268 | 9,458 | 11,694 |

- Heaviest per model: `shadowHag` 678 tris, `mage` 616, `defender` 583, `knight` 578, `rogue` 564. Lightest:
  `tent` 16, `floorboard` 24, `trunk` / `crate` 36. Whole library merged is < 12 k vertices — vertex count is a
  non-issue; **draw calls and material switches are the cost** (one draw call per mesh in the legacy app).
- Geometry class usage (mesh count over 35 builds): Cylinder 62, Cone 60, Box 47, Sphere 33, Icosahedron 25,
  Torus 20, Octahedron 15, Tetrahedron 6. Only these 8 primitive classes are used; no custom `BufferGeometry`, no
  UV work, no textures anywhere.
- **129 unique geometry signatures** (class + constructor parameters) across the library. A shared cache keyed by
  signature therefore needs at most 129 `BufferGeometry` objects for everything. Most shared:
  `SphereGeometry(0.028, 6, 6)` × 28 (eyes), `CylinderGeometry(0.34, 0.38, 0.08, 18)` × 13 and
  `TorusGeometry(0.33, 0.025, 6, 18)` × 13 (token bases), `IcosahedronGeometry(0.11, 0)` × 10 (heads),
  `ConeGeometry(0.03, 0.22, 4)` × 9 (bramble thorns), `OctahedronGeometry(0.045, 0)` × 7 (barrier motes).
- **142 unique material parameter sets** across the 35 builds (colour, emissive, intensity, metalness, roughness,
  transparency, unlit); the tinted `body:` variants contribute the blends. A `MaterialLibrary` keyed by that
  signature collapses ~268 material instances to ≤ 142 shared ones.
- **Palette: 102 distinct hex literals in the source.** Most reused: `#4a3a26` dark wood × 9, `#5c4632` wood × 8,
  `#d4af37` gold × 6, `#6e5a40` plank × 5, `#4d4a55` iron × 5, `#16131c` near-black × 5, then `#ffe9a0`/`#ff9d45`/
  `#ff6a00` (flame), `#e8d5b5` (skin), `#bfeaff` (ice), `#454a59`/`#3a3d49`/`#2e3340` (stone/iron) × 3 each. Skin
  tones: `#e8d5b5`, `#d8c5a5`, `#d8b89a`, `#e8c5a0`, `#e9e2f2` (fey/frost), `#9c6b76` (husk), `#8a7f9c` (hag),
  `#cfe0c8` (spectator). Emissive accents are always a saturated sibling of the base colour (e.g. `#7fc8ff` →
  `#2f8fff`, `#ff9d45` → `#ff6a00`, `#caa6ff` → `#9a5cff`).
- The palette was tuned against `legacy/js/scene.js` lighting: `HemisphereLight('#bcc7ff', '#2a2418', 0.75)`,
  `DirectionalLight('#fff4e0', 1.6)` with a 2048² PCF-soft shadow map, background/fog `#181b26`, camera FOV 46. The
  same three.js light-intensity scale applies in 0.185, so the palette ports unchanged.

### 6.1 Instance counts on the shipped maps (why instancing matters)

Counted by building each legacy map (`data.js demoMap`, `data-campaign.js campMap/pitMap/theaterMap`) and summing
model meshes (terrain, inline chest/door/pillar, heroes and fog sprites excluded):

| Map | Size | Decos (by type) | Model nodes | Enemies | Meshes = draw calls (deco / node / enemy) |
|---|---|---|---|---|---|
| demo "The Husk Vault" | 22×16 | 19 (pine 6, rock 3, brazier 2, crate 2, barrel 2, banner 2, deadTree 1, cart 1) | 0 (3 inline) | husk × 3 | 70 / 0 / 30 = **100** |
| camp (phase 1) | 22×16 | 27 (tent 8, barrel 3, crate 3, deadTree 3, campfire 2, cart 2, banner 2, brazier 2, dummy 2) | 4 `body:*` | 0 | 100 / 52 / 0 = **152** |
| pit (phase 2) | 26×20 | 41 (spectator 24, banner 4, brazier 4, rock 3, deadTree 3, throne 1, archfey 1, hut 1) | 1 (model null) | bramble × 6 | 217 / 0 / 90 = **307** |
| theater (phase 3) | 24×18 | 47 (spectator 31, curtain 4, brazier 4, banner 2, crate 2, throne 1, archfey 1, barrier 1, barrel 1) | 8 (spotlight 4, piano, floorboard, spectator, trunk) | bramble × 5 | 262 / 36 / 75 = **373** |

Theater: 32 spectators × 6 meshes = 192 draw calls with 128 material objects for one prop type. With per-type
merged geometry + `InstancedMesh`, all static props on the theater map collapse to roughly 9 types × 1–3 layers ≈
15–25 draw calls; with a `BatchedMesh` per layer, 3.

---

## 7. How the legacy runtime drives the models (behaviours the port must reproduce)

All motion acts on the **root group transform**; only the parts listed in 2.7 are ever touched individually. There
is no skeletal or per-part animation in the legacy code — "named animation hooks" in the port are a new
capability, not a port of an existing one.

| Behaviour | Where | Numbers |
|---|---|---|
| Glide along path | `grid.hopAlong` | speed 4.6 tiles/s (`dur = max(total/4.6, 0.14)`); height follows `surfaceAt` + stride bob `abs(sin(d·π·2.2))·0.07`; yaw eased `yaw += dy·0.18` per frame toward `atan2(dx, dz)`; sway `rotation.z = sin(d·π·2.2)·0.05` |
| Bump attack | `grid.bumpAttack` | 0.22 s, faces target, lerps `sin(p·π)·0.4` of the way and back |
| Death | `grid.deathAnim` | 0.5 s: `rotation.z → π/2`, `scale → 0.6`, y down to max(0.05, y − 0.02) |
| Hover bob | `GridWorld` frame hook | `y = baseY + sin(t·1.6 + phase)·0.08 + 0.08`, `phase = Math.random()·6`; only for groups with `userData.hover` registered via `buildEnemyToken` / `buildDeco` |
| Text↔grid flash | `grid.register` / `grid.flash` | `register` collects every material that has `.emissive` (so `MeshBasicMaterial` beam/shell never flash); `flash` runs 0.9 s with `k = abs(sin(p·π·3))·0.9`, sets `emissive = (0.4k, 0.65k, k)` on **all** collected materials, then restores the base hex. Because glow parts keep their `emissiveIntensity` (1.2–2.2), the flash is uneven across parts. |
| Spotlight lit/unlit | `grid.setPillarLit` | clones the `lens` material; lit: colour `#fff3c0`, emissive `#ffe9a0` × 1.8; unlit: `#3a3326`, emissive black × 0; `beam.visible = lit` |
| Chest / door open | `grid.animateNodeOpen` | lid: 0.4 s `rotation.x → −1.9`, `position.z → −0.16`; panel: 0.5 s `rotation.y → 1.4`, `position.x → 0.3` |
| Node destroy | `grid.animateNodeDestroy` | 0.5 s `rotation.z → 1.2`, `scale → 0.15`, then removed |
| Placement | `grid.placeToken` / `buildDeco` / `buildNode` | tile centre, `y = tileTopY(x, y)`; decos and nodes apply `rotation.y = rot` (editor rotates decos in π/2 steps; campaign uses arbitrary radians) |
| Disposal | `grid.clearGroup` | traverses and disposes geometry + material of every child on scene rebuild (correct given nothing is shared; **wrong once resources are shared**) |
| Shadows | consumers | tokens: `castShadow = true` on all meshes; nodes: cast + receive on all except `beam`; decos: cast only where `castShadow === undefined` (never, since `P` sets it) |

Data references to models:

- `HERO_DEFS[].model` ∈ {`knight`, `rogue`, `mage`}; campaign party `model` ∈ {`battleMage`, `defender`,
  `frostMage`, `knight`} with `heroKey` equal to the model key.
- `ENEMY_TYPES[type].model` ∈ {`husk`, `bramble`, `shadowHag`}; `archfey` is never an enemy (deco only).
- `nodes[].model`: `'gate'` (portal nodes; `makeNode('portal')` sets it), `'body:<heroKey>'`, `'piano'`,
  `'floorboard'`, `'spectator'`, `'trunk'`, `'spotlight'`, or `null` (the Hag node is invisible until she spawns).
- `decos[]` = `{ type, x, y, rot?, id? }`; `id` only on scripted decos (`archfey-2`, `archfey-3`) for flashing.

---

## 8. Defects and design smells to avoid carrying over

1. No sharing: every build allocates fresh geometries and materials (216 meshes / 216 materials / 216 geometries for
   one of each model). 129 geometry and ≤ 142 material objects would suffice.
2. `setSpiritEyes` and `setPillarLit` allocate/clone materials per call and leak the old ones; `body()` clones every
   material of the inner model.
3. `flash()` mutates shared-looking state (material emissive) and holds stale references after eye swaps; unlit parts
   cannot flash; flash brightness depends on each part's `emissiveIntensity`.
4. `pine()` uses `Math.random()` → non-deterministic scenes (violates the engine's "seeded RNG everywhere" rule);
   `hoverers[].phase` is also random.
5. Builder colour parameters are unreachable through `buildModel`; ring colour is baked and disagrees with 3 of 7
   hero definitions.
6. `DECO_TYPES` (palette) ≠ `MODELS` (buildable): `archfey` and `spotlight` are data-only; `buildNode` drops
   `userData.hover`.
7. `campfire` embeds a `PointLight` inside the model group — a scene with 8 tents and 2 campfires is fine, but a
   prop library that can be instanced must not carry lights in geometry.
8. Fx parts (`beam`, `barrier` shell, wisps) inflate bounding boxes (spotlight depth 2.94 vs 0.42) and would wreck
   frustum culling / BVH bounds if used naïvely.
9. Origin inconsistencies (`rock` −0.20, `archfey` +0.25) are undocumented; the port should declare `standHeight`
   and `groundOffset` in the spec instead of relying on eyeballed constants.
10. No metadata: footprint, blocking, walkability, LOD, pick priority all live in consumer code or nowhere.

---

## 9. Reproducing the measurements as a test

The stats above came from a ~60-line ESM script executed with `node --input-type=module` from the project root
(so the bare `three` specifier resolves to the same `node_modules/three/build/three.module.js` the legacy file
imports). Per built group it traversed meshes, summed `geometry.index.count / 3` (triangles) and
`attributes.position.count` (vertices), keyed geometries by `geometry.type + JSON(geometry.parameters)` and
materials by `(type, color, emissive, emissiveIntensity, metalness, roughness, transparent/opacity, depthWrite,
side)`, and took `new THREE.Box3().setFromObject(group)`.

The same approach works under Vitest's node environment (the spike test already imports `three` there), so the
port's unit tests can build every registered spec headlessly and assert the invariants listed in 10.9.

---

## 10. Port recommendation

### 10.1 Placement in the new engine

- `src/engine/render/procedural/` — the spec types, primitive cache, material library, registry, builders, and
  batching helpers. This is the render layer (it imports `three`), but it never touches DOM/WebGL: `BufferGeometry`
  and materials are plain objects until a renderer compiles them, so all of it is unit-testable under Vitest/node.
- `src/engine/assets/ModelRef.ts` (DOM-free): the zod `ModelRef` schema and the resolver interface, so content and
  the editor can validate references without importing three.
- `content/props/*.json`, `content/adversaries/*.json`, `content/heroes/*.json`: the `DECO_INFO` text and the
  legacy `model` strings migrate into content as `ModelRef`s.

### 10.2 Declarative specs instead of imperative builders

Keep the legacy DSL feel (a part is *primitive + material + position + rotation*) but make it data:

```ts
export type PrimSpec =
  | { kind: 'box'; w: number; h: number; d: number }
  | { kind: 'cylinder'; rTop: number; rBottom: number; h: number; seg: number; open?: boolean }
  | { kind: 'cone'; r: number; h: number; seg: number; open?: boolean }
  | { kind: 'sphere'; r: number; wSeg: number; hSeg: number; thetaLength?: number }
  | { kind: 'icosahedron' | 'octahedron' | 'tetrahedron'; r: number }
  | { kind: 'torus'; r: number; tube: number; radSeg: number; tubSeg: number; arc?: number };

export interface MatSpec {
  color: string; emissive?: string; emissiveIntensity?: number;
  metalness?: number; roughness?: number;            // defaults 0 / 1 like three
  opacity?: number; unlit?: boolean; doubleSide?: boolean; depthWrite?: boolean;
}

export type Layer = 'lit' | 'glow' | 'fx';           // batching layer (see 10.5)

export interface PartSpec {
  prim: PrimSpec;
  mat: string;                                       // key into ProceduralModelSpec.palette
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: number | [number, number, number];
  parent?: string;                                   // hook this part hangs under; default 'root'
  hook?: string;                                     // this part also *is* a hook node (e.g. 'eye.L')
  layer?: Layer;                                     // default 'lit'; 'glow' if emissive; 'fx' if transparent/unlit
  castShadow?: boolean;                              // default: lit/glow true, fx false
  hidden?: boolean;                                  // e.g. fx.beam until lit
}

export interface HookSpec { pos: [number, number, number]; rot?: [number, number, number]; parent?: string }

export interface ProceduralModelSpec {
  id: string;                                        // 'knight', 'spectator' — stable content id
  category: 'hero' | 'monster' | 'prop' | 'node' | 'fx';
  palette: Record<string, MatSpec>;                  // named colours; overridable per project
  parts: PartSpec[];
  hooks?: Record<string, HookSpec>;                  // empties: 'hand.R', 'hand.L', 'light.fire', 'label'
  lights?: { hook: string; type: 'point'; color: string; intensity: number; distance: number }[];
  footprint: { w: number; d: number; walkable: boolean; blocksLos: boolean; cover?: boolean };
  standHeight: number;                               // HUD/label anchor (top of head), e.g. knight 1.09
  groundOffset?: number;                             // archfey 0.25 (float), rock −0.2
  motion?: { idle: 'none' | 'hover'; amp?: number; hz?: number };
  params?: { ringColor?: boolean; variant?: number; tint?: boolean; pose?: ('stand' | 'fallen')[] };
  info?: { name: string; desc: string };             // DECO_INFO
  tags: string[];                                    // 'tree', 'fire', 'seating', 'fey'
}
```

Why data: the editor lists and previews specs without executing code, projects can override palettes (a
`Record<string, MatSpec>` swap re-skins a model), instancing analysis is a pure function over `parts`, the whole
spec is hashable for determinism tests, and the same shape can be exported to JSON if a project wants to ship
custom procedural props.

Write the 31 legacy models (+ chest/door/pillar/cover-rock from grid.js) as TypeScript spec literals in
`src/engine/render/procedural/library/*.ts`, one file per category. Composite helpers from the legacy file become
spec fragments: `tokenBase(ringKey)`, `head(skinKey, r)`, `staff(len, tipPart)` are functions returning
`PartSpec[]` with hooks (`base`, `head`, `eye.L`, `eye.R`, `hand.R`).

### 10.3 Shared resources

- `PrimitiveCache`: `get(prim: PrimSpec): BufferGeometry` keyed by a canonical string of the spec (the 129
  signatures). Geometries are immutable after creation, so sharing across every mesh in the scene is safe. Add a
  `flat` vertex-colour attribute lazily when a merged/batched variant is requested (10.5).
- `MaterialLibrary`: `get(mat: MatSpec): Material` keyed by the material signature (≤ 142). Returns
  `MeshStandardMaterial({ flatShading: true })` or `MeshBasicMaterial` for `unlit`. Never mutate a returned
  material; state changes (lit lens, spirit eye) are expressed as *swaps between two shared materials*.
- Neither is disposed on scene rebuild; `BuiltModel.dispose()` only releases per-instance clones (there should be
  none in the normal path).

### 10.4 Registry and built-model contract

```ts
export interface BuildOptions {
  ringColor?: string;                 // token base ring (default: entity colour)
  spiritEyes?: 0 | 1 | 2;
  pose?: 'stand' | 'fallen';          // 'fallen' = legacy body(): rot.z = π/2 − 0.12, y += 0.18
  tint?: { color: string; amount: number; emissiveScale: number };   // legacy body(): '#3a3d49', 0.55, 0.15
  variant?: number;                   // seeded variation (pine shade), default from placement hash
  paletteOverride?: Partial<Record<string, MatSpec>>;
}

export interface BuiltModel {
  root: THREE.Group;                                  // origin at feet, faces +z, 1 unit = 1 tile
  hooks: Readonly<Record<string, THREE.Object3D>>;    // see hook standard below
  clips: THREE.AnimationClip[];                       // procedural clips targeting hook names
  spec: ProceduralModelSpec;
  bounds: THREE.Box3;                                 // lit + glow layers only (fx excluded)
  setSpiritEyes(n: 0 | 1 | 2): void;                  // material reference swap, no allocation
  setState(key: 'lit' | 'open' | 'portal', on: boolean): void;
  dispose(): void;
}

export class ProceduralModelRegistry {
  register(spec: ProceduralModelSpec): void;          // throws on duplicate id or invalid spec (zod)
  has(id: string): boolean;
  get(id: string): ProceduralModelSpec | undefined;
  list(filter?: { category?: ProceduralModelSpec['category']; tag?: string }): readonly ProceduralModelSpec[];
  build(id: string, opts?: BuildOptions): BuiltModel;
  buildMerged(id: string, opts?: BuildOptions): Record<Layer, THREE.BufferGeometry | null>;  // for instancing
  stats(id: string): { meshes: number; tris: number; verts: number; uniqueGeo: number; uniqueMat: number };
}
```

**Hook name standard** (shared with imported glTF: the glTF loader resolves the same names from node names, so
game code never knows which source produced the model):

| Hook | Procedural source | Purpose |
|---|---|---|
| `root` | the group | placement, hover/idle bob, death topple |
| `base` | `tokenBase` group | ring tint, selection glow |
| `body` | torso/robe part group | bump-attack lean, hit flinch |
| `head` | `makeHead` group | look-at, spirit eyes container |
| `eye.L`, `eye.R` | `eye0`, `eye1` meshes | spirit eyes |
| `hand.R`, `hand.L` | staff / sword / shield mount points | weapon swap, casting fx |
| `fx.beam`, `fx.lens`, `fx.socket` | spotlight parts | lit state |
| `fx.portal` | gate disc | portal open/close |
| `fx.core` | bramble feeding core, hut witch-light | pulse |
| `light.<name>` | `lights[]` entries (campfire) | light pool attachment |
| `label` | empty at `standHeight` | HUD name/HP anchor |

**Procedural clips**: generate `THREE.AnimationClip`s at build time with `KeyframeTrack`s that target hooks by name
(`'head.rotation[x]'`, `'root.position[y]'`): `idle` (none or hover bob `amp 0.08, 1.6 rad/s` = legacy),
`walk` (stride bob 0.07 at 2.2 cycles/tile + sway 0.05; root yaw is driven by the mover, not the clip),
`attack` (0.22 s lunge on `body`), `die` (0.5 s topple: `root.rotation.z → π/2`, scale 0.6),
`open` (chest lid / door panel, legacy numbers), `lit` (lens material swap + beam visible — a state, not a clip).
Because these are ordinary `AnimationClip`s, the same `AnimationMixer`-based animator component drives procedural
models and glTF models (whose clips come from the file) without branching.

### 10.5 Instancing-friendly design

Split every spec into three **layers** by material class, so each layer can share one material:

| Layer | Contents | Material (one per layer, shared scene-wide) | Shadows |
|---|---|---|---|
| `lit` | opaque standard parts | `MeshStandardMaterial({ vertexColors: true, flatShading: true })` + per-vertex `aMatParams` (metalness, roughness) via `onBeforeCompile` | cast + receive |
| `glow` | emissive opaque parts (flames, orbs, rings, motes, cores) | same material + per-vertex `aEmissive` (rgb × intensity) injected as `totalEmissiveRadiance += aEmissive.rgb * aEmissive.a` | cast |
| `fx` | transparent / unlit (beam, shell, wisps, ice shards, portal disc) | `MeshBasicMaterial`/`MeshStandardMaterial` transparent, `depthWrite: false` | none |

Only 24 parts override metalness and 3 override roughness; baking them into a 2-component vertex attribute costs
nothing and removes every material switch. If the shader hook is judged not worth it for a first cut, the fallback
is one material per *(layer, metalness, roughness)* tuple — still ≤ 6 materials for the whole library.

`buildMerged(id)` clones each part's cached geometry, applies the part transform, writes `color` (from `MatSpec`),
`aEmissive`, `aMatParams` attributes, and merges per layer with `BufferGeometryUtils.mergeGeometries` (verified
export in three 0.185.1's `examples/jsm/utils/BufferGeometryUtils.js`). Flat shading is computed in the fragment
shader from derivatives, so merged normals need no special care.

Tiers:

1. **Static props → `InstancedMesh` per (spec, layer)** on the map (`PropBatcher`). Capacity = placements +
   headroom; `setMatrixAt` from tile transform; `instanceColor` (`setColorAt`) for per-instance tint (pine variant,
   selection/flash highlight, editor ghost). Native raycast support; three-mesh-bvh accelerates it via
   `computeBoundsTree` on the merged geometry. Theater map: 9 prop types → ≈ 15–25 draw calls instead of 298.
2. **Cross-type batching → one `BatchedMesh` per layer** (`addGeometry` per spec-layer, `addInstance(geometryId)`
   per placement; `setColorAt`, `setVisibleAt`, `perObjectFrustumCulled`, `sortObjects` all verified present in
   0.185.1; three-mesh-bvh 0.9.14 exports `computeBatchedBoundsTree`). 3 draw calls for all static props. Do this
   only after tier 1 is measured, since `BatchedMesh` needs `setGeometrySize` budgets up front and its shadow/
   raycast paths are less battle-tested.
3. **Tokens (heroes, adversaries) stay `THREE.Group`s** built from shared geometry + shared layer materials, but
   merged into ≈ 4–6 rigid sections (`base`, `body`, `head`, `hand.R`, `hand.L`, fx) instead of 9–15 meshes, so
   hooks still exist while draw calls drop ~3×. Party + adversaries ≤ ~30 on a map ⇒ ≤ 180 calls worst case, which
   is fine; if a crowd scene ever needs more, tokens are also valid tier-1 instances with per-instance animation
   disabled.
4. **Lights leave geometry**: `lights[]` in the spec attaches to a `light.*` hook; a `LightPool` (budget e.g. 8
   point lights, nearest-to-camera) instantiates real `PointLight`s only for the closest emitters; the rest rely on
   the `glow` layer. Legacy campfire: `PointLight('#ff8c42', 3, 4)` at y 0.5.
5. **Bounds**: `bounds` and culling spheres computed from `lit + glow` only. Fx parts get their own bounds so a
   hidden beam never keeps a spotlight "visible".

**Highlight / flash without mutating materials**: instanced props use `instanceColor` lerp; tokens use a shared
`uHighlight` uniform injected by the same `onBeforeCompile` hook and set per object in `Object3D.onBeforeRender`
(uniform uploads happen per draw). This replaces `grid.register/flash` and works for unlit parts too.

**Spirit eyes under instancing**: eyes are only ever lit on tokens (Groups), so the shared-material swap in 10.3 is
sufficient; spectators/bodies never light eyes and can be fully merged.

### 10.6 Coexistence with imported glTF

```ts
export const ModelRef = z.union([
  z.object({ kind: z.literal('gltf'), asset: z.string(), fallback: z.string().optional() }),   // fallback = proc id
  z.object({ kind: z.literal('proc'), id: z.string(), variant: z.number().int().optional() }),
]);

export interface ModelSource {
  canResolve(ref: ModelRef): boolean;
  load(ref: ModelRef, opts: BuildOptions): Promise<BuiltModel>;
}
export class ModelResolver {
  constructor(private sources: ModelSource[]) {}    // [GltfAssetSource, ProceduralSource, PlaceholderSource]
  resolve(ref: ModelRef, opts?: BuildOptions): Promise<BuiltModel>;
}
```

- `GltfAssetSource` wraps the project's imported assets (`GLTFLoader`, cloned with `SkeletonUtils.clone` for
  skinned rigs); it maps node names to the hook standard and exposes the file's clips. On a missing/failed asset it
  returns the `fallback` procedural model (or the category placeholder) and reports the substitution to the editor's
  problems panel — never a silent blank.
- `ProceduralSource` is the registry from 10.4; it is synchronous internally but exposed through the same async
  interface.
- `PlaceholderSource` builds a labelled capsule/box from category + footprint when nothing else resolves (replaces
  the cone/cylinder fallbacks in `grid.js`).
- The editor palette lists `list()` from every source with a source badge; a project can override a procedural id
  with a glTF asset by content (`{ kind: 'gltf', asset, fallback: 'knight' }`), which is the migration path from
  placeholders to real art without touching scenes.
- The `hooks`/`clips`/`bounds`/`setState` contract is identical for both sources; nothing above the resolver
  branches on `kind`.

### 10.7 Determinism

- Ban `Math.random` in the library (lint rule + unit test that builds every spec twice and compares a hash of
  geometry signatures, material signatures and part transforms).
- `pine` shade becomes `0.85 + 0.3 * hash01(variant)`; the placement layer derives `variant` from a seeded hash of
  (scene id, x, y) so rebuilds are stable, matching `grid.js`'s own `hash(x, y)` approach for terrain.
- Hover phase = `hash01(entity id) * 2π` instead of `Math.random() * 6`.

### 10.8 Migration map (legacy → new)

| Legacy | New |
|---|---|
| `MODELS[key]()` / `buildModel(key)` | `registry.build(key, opts)` with the same 31 ids (`knight`, `rogue`, … `curtain`, `spotlight`) |
| `buildModel('body:' + heroKey)` | `build(heroKey, { pose: 'fallen', tint: { color: '#3a3d49', amount: 0.55, emissiveScale: 0.15 } })` |
| `setSpiritEyes(group, n)` | `built.setSpiritEyes(n)` |
| `userData.hover` | `spec.motion = { idle: 'hover', amp: 0.08, hz: 1.6 }` → `idle` clip |
| `DECO_TYPES` | `registry.list({ category: 'prop' })` filtered by a per-project palette allowlist in content |
| `DECO_INFO[key]` | `content/props/<key>.json` `{ id, name, desc, model: { kind: 'proc', id }, footprint }` |
| `ENEMY_TYPES[t].model`, `HERO_DEFS[].model`, `nodes[].model`, `decos[].type` | `ModelRef` fields; legacy-map importer rewrites strings to `{ kind: 'proc', id }` and `'body:x'` to `{ kind: 'proc', id: 'x' }` + `pose: 'fallen'` on the placement |
| grid.js inline chest / door / pillar | specs `chest` (hooks `lid`), `door` (hook `panel`), `pillar`; `open` clip |
| grid.js cover rock, fallback cone/cylinder | `cover-rock` spec; `PlaceholderSource` |
| `grid.register` / `flash` | highlight uniform / `instanceColor` (10.5) |
| `grid.setPillarLit` | `built.setState('lit', on)` (lens material swap between two shared materials, beam visibility) |
| `grid.clearGroup` disposing everything | scene teardown releases only instance buffers; caches persist |
| `campfire` `PointLight` | `lights: [{ hook: 'light.fire', type: 'point', color: '#ff8c42', intensity: 3, distance: 4 }]` + `LightPool` |

### 10.9 Tests to ship with the port (Vitest, node)

- Every registered spec builds; `build()` twice yields identical signature hashes (determinism).
- Invariants per spec: `bounds.min.y ∈ [−0.01, 0.05]` unless `groundOffset` declared; footprint ≤ declared
  `footprint` (+0.05 tolerance); tokens have `head`, `eye.L`, `eye.R`, `base` hooks; every `hook`/`parent`
  reference resolves; no duplicate hook names; `fx` parts have `castShadow = false`.
- Registry-wide: unique geometry signatures ≤ 140 and unique material signatures ≤ 150 (regression guards
  against silent un-sharing; current values 129 / ≤ 142); total tris of the 31 originals within ±5 % of 7,239.
- `buildMerged` per layer has `color`, `aEmissive`, `aMatParams` attributes and the expected triangle count
  (sum of the layer's parts).
- `PropBatcher` on a synthetic placement list creates exactly (types × layers used) `InstancedMesh`es with the
  right `count`.
- E2E (Playwright, existing headless WebGL2 setup): a gallery scene that builds all specs in a grid, asserts
  `renderer.info.render.calls` ≤ a budget (e.g. ≤ 40 for 31 static models + 10 tokens) and captures a screenshot
  for visual review.

---

## 11. Suggested build order

1. `PrimSpec`/`MatSpec`/`ProceduralModelSpec` + zod schema; `PrimitiveCache`; `MaterialLibrary`.
2. Registry + `build()` producing Groups with hooks; port heroes first (they exercise base, head, eyes, staff,
   shield), then monsters, then props, then grid.js inline nodes.
3. `buildMerged()` + `PropBatcher` (tier 1) + highlight uniform; measure draw calls on a theater-sized scene.
4. `ModelRef` + `ModelResolver` with `ProceduralSource` and `PlaceholderSource`; `GltfAssetSource` plugs in when the
   asset importer lands (tests/fixtures already carry `Duck.glb`, `Fox.glb`, `BoxTextured.glb`).
5. Legacy-map importer rewrite of model strings; content JSON for `DECO_INFO`.
6. `BatchedMesh` tier and `LightPool` when profiling says so.

---

## 12. Not verified in this session

- No visual check in a browser; all shape/scale statements come from geometry parameters and measured bounding
  boxes, not from screenshots.
- Legacy draw-call and frame-time figures are inferred from mesh counts (one draw call per mesh, no batching in the
  legacy code); `renderer.info` was not read from a running legacy session.
- The `onBeforeCompile` per-vertex emissive/metalness/roughness injection and the per-object `uHighlight` uniform
  via `onBeforeRender` were not prototyped here; both are standard three.js patterns but the exact shader-chunk
  anchors for 0.185 should be confirmed when implemented.
- `BatchedMesh` shadow casting and three-mesh-bvh `computeBatchedBoundsTree` were confirmed to exist in the
  installed packages (three 0.185.1, three-mesh-bvh 0.9.14) but were not executed.
- `mergeGeometries` on the cached primitives assumes identical attribute sets (`position`, `normal`, `uv`) — true
  for all 8 primitive classes used, but the added `color`/`aEmissive`/`aMatParams` attributes must be present on
  every part before merging or `mergeGeometries` returns `null`.
- The glTF hook-name mapping depends on the naming convention adopted for imported assets; nothing in the repo
  yet defines it.
