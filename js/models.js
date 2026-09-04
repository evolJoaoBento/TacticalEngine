// ============ MODEL LIBRARY ============
// Reusable low-poly miniature builders. Every builder returns a THREE.Group
// roughly 1 tile wide, standing on y=0. Used by play mode, the campaign,
// AND the map editor (enemy/deco palettes) — add a builder here and it is
// available everywhere.

import * as THREE from 'three';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...o });

function P(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.rotation.set(...rot);
  m.castShadow = true;
  return m;
}

// Round miniature base with a colored ring.
function tokenBase(ringColor) {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.34, 0.38, 0.08, 18), M('#2b2e3c'), [0, 0.04, 0]));
  const ring = P(new THREE.TorusGeometry(0.33, 0.025, 6, 18),
    M(ringColor, { emissive: ringColor, emissiveIntensity: 0.35 }), [0, 0.085, 0], [Math.PI / 2, 0, 0]);
  g.add(ring);
  return g;
}

// Head with two eye sockets. Spirit light is toggled via setSpiritEyes().
function makeHead(skin = '#e8d5b5', r = 0.12) {
  const g = new THREE.Group();
  g.add(P(new THREE.IcosahedronGeometry(r, 0), M(skin)));
  for (let i = 0; i < 2; i++) {
    const eye = P(new THREE.SphereGeometry(0.028, 6, 6), M('#1a1a22'), [i === 0 ? -0.05 : 0.05, 0.01, r * 0.85]);
    eye.name = 'eye' + i;
    g.add(eye);
  }
  return g;
}

// Light up 0/1/2 eyes with cold spirit light (one per inhabiting spirit).
export function setSpiritEyes(group, count) {
  let i = 0;
  group.traverse(o => {
    if (o.name === 'eye0' || o.name === 'eye1') {
      const on = i < count;
      o.material = M(on ? '#aef6ff' : '#1a1a22',
        on ? { emissive: '#7be8ff', emissiveIntensity: 1.6 } : {});
      o.scale.setScalar(on ? 1.4 : 1);
      i++;
    }
  });
}

function staff(len, tipMesh, woodColor = '#6b5236') {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.025, 0.03, len, 5), M(woodColor), [0, len / 2, 0]));
  if (tipMesh) { tipMesh.position.y = len + 0.05; g.add(tipMesh); }
  return g;
}

// ============ HEROES ============

function vanguardKnight(color = '#8d93a5') {
  const g = tokenBase('#c8cede');
  g.add(P(new THREE.CylinderGeometry(0.14, 0.18, 0.3, 6), M('#3f4350'), [0, 0.24, 0]));            // legs
  g.add(P(new THREE.BoxGeometry(0.36, 0.32, 0.24), M(color, { metalness: 0.3 }), [0, 0.52, 0]));   // cuirass
  g.add(P(new THREE.BoxGeometry(0.14, 0.1, 0.14), M(color, { metalness: 0.3 }), [-0.24, 0.66, 0]));// pauldrons
  g.add(P(new THREE.BoxGeometry(0.14, 0.1, 0.14), M(color, { metalness: 0.3 }), [0.24, 0.66, 0]));
  const head = makeHead('#d8c5a5', 0.11); head.position.y = 0.8; g.add(head);
  g.add(P(new THREE.CylinderGeometry(0.12, 0.13, 0.1, 8), M(color, { metalness: 0.4 }), [0, 0.88, 0])); // helm
  g.add(P(new THREE.ConeGeometry(0.05, 0.18, 5), M('#c0392b'), [0, 1.0, -0.02]));                  // plume
  // Tower shield
  g.add(P(new THREE.BoxGeometry(0.07, 0.55, 0.34), M('#5a6378', { metalness: 0.25 }), [-0.3, 0.42, 0.04]));
  g.add(P(new THREE.BoxGeometry(0.08, 0.4, 0.08), M('#d4af37', { metalness: 0.5 }), [-0.305, 0.42, 0.04]));
  // Sword
  g.add(P(new THREE.BoxGeometry(0.04, 0.42, 0.07), M('#cfd6e4', { metalness: 0.6 }), [0.3, 0.62, 0.06], [0, 0, -0.35]));
  g.add(P(new THREE.BoxGeometry(0.12, 0.04, 0.04), M('#d4af37'), [0.24, 0.44, 0.06]));
  return g;
}

function rogue(color = '#3d6b8f') {
  const g = tokenBase('#5fb0ff');
  g.add(P(new THREE.ConeGeometry(0.24, 0.55, 6), M(color), [0, 0.36, 0]));                          // cloak
  const head = makeHead('#e8d5b5', 0.11); head.position.y = 0.7; g.add(head);
  g.add(P(new THREE.ConeGeometry(0.15, 0.22, 6), M(color), [0, 0.82, -0.02], [0.25, 0, 0]));        // hood
  // Bow on the back
  g.add(P(new THREE.TorusGeometry(0.26, 0.02, 5, 10, Math.PI * 1.1), M('#7a5a36'),
    [0, 0.5, -0.18], [0, 0, Math.PI * 0.45]));
  g.add(P(new THREE.BoxGeometry(0.05, 0.3, 0.05), M('#4a3a26'), [0.18, 0.45, 0.12], [0, 0, 0.4])); // quiver
  return g;
}

function mage(color = '#7d54b8') {
  const g = tokenBase('#b07ae0');
  g.add(P(new THREE.ConeGeometry(0.26, 0.6, 7), M(color), [0, 0.38, 0]));                           // robe
  const head = makeHead('#e8d5b5', 0.11); head.position.y = 0.75; g.add(head);
  g.add(P(new THREE.ConeGeometry(0.2, 0.3, 7), M(color), [0, 0.95, 0]));                            // wizard hat
  g.add(P(new THREE.TorusGeometry(0.17, 0.035, 5, 12), M(color), [0, 0.84, 0], [Math.PI / 2, 0, 0]));// brim
  const orb = P(new THREE.IcosahedronGeometry(0.07, 0), M('#caa6ff', { emissive: '#9a5cff', emissiveIntensity: 0.9 }));
  const st = staff(0.85, orb); st.position.set(0.27, 0, 0.08); g.add(st);
  return g;
}

function battleMage() {
  const g = tokenBase('#ff9d45');
  g.add(P(new THREE.ConeGeometry(0.26, 0.6, 7), M('#8c3324'), [0, 0.38, 0]));                       // war robe
  g.add(P(new THREE.BoxGeometry(0.4, 0.08, 0.22), M('#4d4a55', { metalness: 0.3 }), [0, 0.62, 0])); // shoulder plate
  const head = makeHead('#d8b89a', 0.11); head.position.y = 0.78; g.add(head);
  g.add(P(new THREE.CylinderGeometry(0.115, 0.125, 0.07, 8), M('#4d4a55', { metalness: 0.4 }), [0, 0.86, 0])); // circlet
  // Ember shards orbiting the shoulders
  for (const [x, y, z] of [[-0.28, 0.7, 0.1], [0.3, 0.74, -0.06], [0.05, 0.95, 0.14]]) {
    g.add(P(new THREE.TetrahedronGeometry(0.05, 0), M('#ff7b33', { emissive: '#ff5a1f', emissiveIntensity: 1.4 }), [x, y, z], [0.5, 0.8, 0]));
  }
  const orb = P(new THREE.IcosahedronGeometry(0.085, 0), M('#ffb347', { emissive: '#ff6a00', emissiveIntensity: 1.6 }));
  const st = staff(0.9, orb, '#4a3026'); st.position.set(0.28, 0, 0.06); g.add(st);
  return g;
}

function frostMage() {
  const g = tokenBase('#9fd8ff');
  g.add(P(new THREE.ConeGeometry(0.26, 0.62, 7), M('#d7e8f5'), [0, 0.39, 0]));                      // pale robe
  g.add(P(new THREE.ConeGeometry(0.27, 0.2, 7), M('#8fb8d8'), [0, 0.62, 0]));                       // frosted mantle
  const head = makeHead('#e9e2f2', 0.11); head.position.y = 0.8; g.add(head);
  g.add(P(new THREE.ConeGeometry(0.16, 0.2, 6), M('#d7e8f5'), [0, 0.96, -0.02], [0.2, 0, 0]));      // hood
  // Floating ice shards
  for (const [x, y, z, r] of [[-0.3, 0.55, 0.05, 0.4], [0.32, 0.62, -0.08, 1.2], [-0.18, 0.92, -0.12, 0.8]]) {
    g.add(P(new THREE.OctahedronGeometry(0.06, 0), M('#bfeaff', { emissive: '#6fd2ff', emissiveIntensity: 1.1, transparent: true, opacity: 0.92 }), [x, y, z], [r, r, 0]));
  }
  const crystal = P(new THREE.OctahedronGeometry(0.09, 0), M('#bfeaff', { emissive: '#5fc8ff', emissiveIntensity: 1.5 }));
  const st = staff(0.9, crystal, '#7d92a8'); st.position.set(0.28, 0, 0.06); g.add(st);
  return g;
}

function villageDefender() {
  const g = tokenBase('#7ad17a');
  g.add(P(new THREE.CylinderGeometry(0.2, 0.24, 0.42, 7), M('#8a6f4d'), [0, 0.3, 0]));              // homespun tunic
  g.add(P(new THREE.BoxGeometry(0.3, 0.06, 0.2), M('#5c4632'), [0, 0.36, 0.08]));                   // belt
  g.add(P(new THREE.BoxGeometry(0.16, 0.2, 0.08), M('#4a3a26'), [-0.2, 0.42, -0.1], [0, 0, 0.3]));  // satchel
  const head = makeHead('#e8c5a0', 0.115); head.position.y = 0.66; g.add(head);
  g.add(P(new THREE.SphereGeometry(0.115, 7, 5, 0, Math.PI * 2, 0, 1.4), M('#5c4632'), [0, 0.7, 0]));// mop of hair
  // The Arcane Stick — a soldier's dropped staff, humming blue
  const tip = P(new THREE.IcosahedronGeometry(0.075, 0), M('#7fc8ff', { emissive: '#2f8fff', emissiveIntensity: 1.8 }));
  const st = staff(0.95, tip, '#3a4a5c'); st.position.set(0.28, 0, 0.05); st.rotation.z = -0.12; g.add(st);
  return g;
}

// ============ MONSTERS ============

function husk() {
  const g = tokenBase('#c2455a');
  // Hunched, ragged silhouette
  g.add(P(new THREE.ConeGeometry(0.27, 0.4, 5), M('#5c3340'), [0, 0.26, 0]));                       // ragged skirt
  g.add(P(new THREE.CylinderGeometry(0.12, 0.2, 0.34, 5), M('#7d4452'), [0, 0.52, 0.05], [0.5, 0, 0])); // bent torso
  const head = makeHead('#9c6b76', 0.11); head.position.set(0, 0.68, 0.2); head.rotation.x = 0.45; g.add(head);
  // Claws
  g.add(P(new THREE.ConeGeometry(0.045, 0.2, 4), M('#3c2330'), [-0.22, 0.42, 0.22], [1.2, 0, 0.4]));
  g.add(P(new THREE.ConeGeometry(0.045, 0.2, 4), M('#3c2330'), [0.22, 0.42, 0.22], [1.2, 0, -0.4]));
  g.add(P(new THREE.ConeGeometry(0.06, 0.16, 4), M('#4a2a38'), [0, 0.78, 0.1], [0, 0, 0]));         // horn stub
  return g;
}

function bramble() {
  const g = tokenBase('#a0522d');
  const core = P(new THREE.IcosahedronGeometry(0.22, 0), M('#4a3322'), [0, 0.3, 0]);
  g.add(core);
  g.add(P(new THREE.IcosahedronGeometry(0.15, 0), M('#5c4128'), [-0.18, 0.2, 0.12], [0.5, 1, 0]));
  g.add(P(new THREE.IcosahedronGeometry(0.13, 0), M('#3d2a1c'), [0.2, 0.22, -0.1], [1, 0.4, 0.6]));
  // Blood-red feeding core, faintly glowing between the thorns
  g.add(P(new THREE.IcosahedronGeometry(0.08, 0), M('#b3122e', { emissive: '#8a0a20', emissiveIntensity: 1.2 }), [0.02, 0.34, 0.08]));
  // Thorn spikes in all directions
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2, e = (i % 3 - 1) * 0.5;
    g.add(P(new THREE.ConeGeometry(0.03, 0.22, 4), M('#2e2118'),
      [Math.cos(a) * 0.24, 0.3 + e * 0.12, Math.sin(a) * 0.24],
      [Math.PI / 2 + e, 0, -a]));
  }
  return g;
}

function shadowHag() {
  const g = tokenBase('#6f42c8');
  // Bent, tattered silhouette
  g.add(P(new THREE.ConeGeometry(0.3, 0.75, 7), M('#241c33'), [0, 0.44, 0]));                       // cloak
  for (let i = 0; i < 5; i++) {                                                                     // tattered hem
    const a = (i / 5) * Math.PI * 2;
    g.add(P(new THREE.ConeGeometry(0.06, 0.18, 4), M('#1a1426'),
      [Math.cos(a) * 0.24, 0.1, Math.sin(a) * 0.24], [Math.PI, 0, 0]));
  }
  g.add(P(new THREE.SphereGeometry(0.1, 6, 5), M('#3a2d52'), [0, 0.86, 0.12]));                     // hunched shoulders
  const head = makeHead('#8a7f9c', 0.1); head.position.set(0, 0.92, 0.18); head.rotation.x = 0.5; g.add(head);
  setSpiritEyes(head, 2); // her eyes always burn white-cold
  g.add(P(new THREE.ConeGeometry(0.05, 0.16, 4), M('#8a7f9c'), [0, 0.88, 0.3], [1.3, 0, 0]));       // crooked nose/chin
  // Moon Staff — crescent of pale light
  const crescent = P(new THREE.TorusGeometry(0.11, 0.028, 5, 12, Math.PI * 1.4),
    M('#e8e6ff', { emissive: '#b8b0ff', emissiveIntensity: 1.6 }), [0, 0, 0], [0, 0, Math.PI * 0.8]);
  const st = staff(1.05, crescent, '#2e2640'); st.position.set(0.3, 0, 0.05); st.rotation.z = -0.15; g.add(st);
  return g;
}

function archfey() {
  const g = new THREE.Group(); // no base — he does not deign to stand on one
  // Long iridescent robe, hovering above the ground
  g.add(P(new THREE.ConeGeometry(0.3, 1.0, 8), M('#3da8a0', { metalness: 0.65, roughness: 0.25 }), [0, 0.75, 0]));
  g.add(P(new THREE.ConeGeometry(0.32, 0.3, 8), M('#7fe0d0', { metalness: 0.7, roughness: 0.2 }), [0, 1.15, 0])); // mantle
  const head = makeHead('#e9e2f2', 0.11); head.position.y = 1.42; g.add(head);
  setSpiritEyes(head, 2); // eyes like cold stars
  // Crown of starlight points
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(P(new THREE.ConeGeometry(0.025, 0.14, 4),
      M('#fff8d8', { emissive: '#ffe9a0', emissiveIntensity: 1.4 }),
      [Math.cos(a) * 0.1, 1.56, Math.sin(a) * 0.1]));
  }
  // Trailing silk wisps
  g.add(P(new THREE.ConeGeometry(0.08, 0.5, 5), M('#7fe0d0', { transparent: true, opacity: 0.55 }), [-0.3, 0.9, -0.1], [0, 0, 0.7]));
  g.add(P(new THREE.ConeGeometry(0.08, 0.5, 5), M('#caa6ff', { transparent: true, opacity: 0.55 }), [0.3, 0.95, 0.08], [0, 0, -0.7]));
  g.userData.hover = true; // render loop bobs anything flagged hover
  return g;
}

// ============ PROPS & DECOR ============

function tent() {
  const g = new THREE.Group();
  g.add(P(new THREE.ConeGeometry(0.55, 0.7, 4), M('#6e5a40'), [0, 0.35, 0], [0, Math.PI / 4, 0]));
  g.add(P(new THREE.ConeGeometry(0.1, 0.25, 4), M('#4a3a26'), [0, 0.78, 0]));
  return g;
}

function campfire() {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.add(P(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 5), M('#4a3a26'),
      [Math.cos(a) * 0.12, 0.07, Math.sin(a) * 0.12], [Math.PI / 2.4, a, 0]));
  }
  g.add(P(new THREE.ConeGeometry(0.13, 0.34, 6), M('#ff9d45', { emissive: '#ff6a00', emissiveIntensity: 1.8 }), [0, 0.25, 0]));
  g.add(P(new THREE.ConeGeometry(0.07, 0.2, 5), M('#ffe9a0', { emissive: '#ffd75e', emissiveIntensity: 2.2 }), [0, 0.34, 0]));
  const light = new THREE.PointLight('#ff8c42', 3, 4);
  light.position.y = 0.5;
  g.add(light);
  return g;
}

function piano() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.9, 0.45, 0.5), M('#16131c', { metalness: 0.4, roughness: 0.3 }), [0, 0.35, 0]));
  g.add(P(new THREE.BoxGeometry(0.8, 0.04, 0.14), M('#efe9dc'), [0, 0.6, 0.2]));                    // keys
  g.add(P(new THREE.BoxGeometry(0.85, 0.04, 0.45), M('#16131c', { metalness: 0.4 }), [0, 0.62, -0.06], [-0.5, 0, 0])); // open lid
  for (const x of [-0.35, 0.35]) g.add(P(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 5), M('#16131c'), [x, 0.13, 0.18]));
  return g;
}

function trunkProp() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.6, 0.34, 0.4), M('#5e2438'), [0, 0.17, 0]));                      // velvet-lined wardrobe trunk
  g.add(P(new THREE.BoxGeometry(0.6, 0.16, 0.4), M('#742c44'), [0, 0.42, -0.06], [-0.4, 0, 0]));
  g.add(P(new THREE.BoxGeometry(0.63, 0.5, 0.08), M('#d4af37', { metalness: 0.5 }), [0, 0.25, 0]));
  return g;
}

function floorboard() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.7, 0.05, 0.24), M('#6e5a40'), [0, 0.04, 0], [0, 0.12, 0]));
  g.add(P(new THREE.BoxGeometry(0.66, 0.05, 0.2), M('#4a3a26'), [0.04, 0.085, 0.02], [0, 0.12, 0.12])); // lifted plank
  return g;
}

function throne() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.8, 0.25, 0.8), M('#454a59'), [0, 0.125, 0]));                     // dais
  g.add(P(new THREE.BoxGeometry(0.5, 0.5, 0.45), M('#2e3340', { metalness: 0.3 }), [0, 0.5, -0.1]));
  g.add(P(new THREE.BoxGeometry(0.5, 0.9, 0.12), M('#2e3340', { metalness: 0.3 }), [0, 0.85, -0.3]));
  for (const x of [-0.2, 0, 0.2])
    g.add(P(new THREE.ConeGeometry(0.05, 0.3, 4), M('#d4af37', { emissive: '#b8962e', emissiveIntensity: 0.5, metalness: 0.6 }), [x, 1.42, -0.3]));
  return g;
}

function spectator() {
  // A bound fey onlooker — vines force them upright, faces split by false smiles
  const g = new THREE.Group();
  g.add(P(new THREE.ConeGeometry(0.18, 0.45, 6), M('#5a7d6e'), [0, 0.28, 0]));
  const head = makeHead('#cfe0c8', 0.095); head.position.y = 0.58; g.add(head);
  // Thorned vines binding the chest
  g.add(P(new THREE.TorusGeometry(0.17, 0.025, 5, 10), M('#2c4a33'), [0, 0.34, 0], [0.25, 0, 0.2]));
  g.add(P(new THREE.TorusGeometry(0.15, 0.022, 5, 10), M('#2c4a33'), [0, 0.22, 0], [-0.2, 0, -0.25]));
  return g;
}

function hut() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.5, 0.58, 0.55, 7), M('#4a4034'), [0, 0.28, 0]));
  g.add(P(new THREE.ConeGeometry(0.68, 0.5, 7), M('#2e2820'), [0, 0.8, 0]));
  g.add(P(new THREE.BoxGeometry(0.26, 0.34, 0.06), M('#16131c'), [0, 0.2, 0.55]));                  // dark doorway
  g.add(P(new THREE.SphereGeometry(0.05, 5, 4), M('#b8b0ff', { emissive: '#8a7fff', emissiveIntensity: 1.4 }), [0.2, 0.55, 0.5])); // witch-light
  return g;
}

function spotlight() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.1, 0.16, 1.1, 7), M('#454a59', { metalness: 0.3 }), [0, 0.55, 0]));
  g.add(P(new THREE.BoxGeometry(0.3, 0.22, 0.3), M('#2e3340', { metalness: 0.4 }), [0, 1.2, 0]));
  const lens = P(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 8), M('#3a3326'), [0, 1.2, 0.18], [Math.PI / 2.6, 0, 0]);
  lens.name = 'lens';
  g.add(lens);
  // Crank socket
  const socket = P(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 6), M('#16131c'), [0.18, 0.9, 0], [0, 0, Math.PI / 2]);
  socket.name = 'socket';
  g.add(socket);
  // Light beam (hidden until lit)
  const beam = P(new THREE.ConeGeometry(0.5, 2.6, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: '#fff3c0', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
    [0, 0.9, 1.4], [Math.PI / 2.6, 0, 0]);
  beam.name = 'beam';
  beam.visible = false;
  beam.castShadow = false;
  g.add(beam);
  return g;
}

function barrier() {
  // The Archfey's starlight shield
  const g = new THREE.Group();
  const shell = P(new THREE.CylinderGeometry(0.85, 0.85, 2.0, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: '#bfeaff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    [0, 1.0, 0]);
  shell.castShadow = false;
  g.add(shell);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(P(new THREE.OctahedronGeometry(0.045, 0), M('#fff8d8', { emissive: '#cfe8ff', emissiveIntensity: 1.5 }),
      [Math.cos(a) * 0.85, 0.5 + (i % 3) * 0.55, Math.sin(a) * 0.85]));
  }
  return g;
}

function gate() {
  const g = new THREE.Group();
  for (const x of [-0.45, 0.45]) g.add(P(new THREE.BoxGeometry(0.22, 1.5, 0.22), M('#565b6b'), [x, 0.75, 0]));
  g.add(P(new THREE.BoxGeometry(1.2, 0.22, 0.26), M('#454a59'), [0, 1.55, 0]));
  const swirl = P(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12),
    M('#7be8ff', { emissive: '#3fc8ff', emissiveIntensity: 1.2, transparent: true, opacity: 0.7 }),
    [0, 0.78, 0], [Math.PI / 2, 0, 0]);
  swirl.name = 'portal';
  g.add(swirl);
  return g;
}

function pine() {
  const g = new THREE.Group();
  const shade = 0.85 + Math.random() * 0.3;
  const green = new THREE.Color('#3d6b45').multiplyScalar(shade);
  g.add(P(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 5), M('#4a3a26'), [0, 0.2, 0]));
  g.add(P(new THREE.ConeGeometry(0.4, 0.6, 6), M(green), [0, 0.6, 0]));
  g.add(P(new THREE.ConeGeometry(0.3, 0.5, 6), M(green.clone().multiplyScalar(1.12)), [0, 1.0, 0]));
  g.add(P(new THREE.ConeGeometry(0.18, 0.4, 6), M(green.clone().multiplyScalar(1.25)), [0, 1.35, 0]));
  return g;
}

function deadTree() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.06, 0.12, 1.1, 5), M('#3d3429'), [0, 0.55, 0], [0, 0, 0.08]));
  g.add(P(new THREE.CylinderGeometry(0.03, 0.05, 0.55, 4), M('#3d3429'), [0.22, 1.0, 0], [0, 0, -0.9]));
  g.add(P(new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4), M('#332b22'), [-0.18, 0.85, 0.08], [0.3, 0, 0.9]));
  g.add(P(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 4), M('#332b22'), [0.05, 1.25, -0.06], [-0.4, 0, 0.25]));
  return g;
}

function rock() {
  const g = new THREE.Group();
  g.add(P(new THREE.IcosahedronGeometry(0.3, 0), M('#6e7480'), [0, 0.2, 0], [0.4, 0.7, 0.2]));
  g.add(P(new THREE.IcosahedronGeometry(0.18, 0), M('#7d8490'), [0.28, 0.12, 0.15], [1.1, 0.3, 0.5]));
  return g;
}

function barrel() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.18, 0.16, 0.42, 9), M('#6e5a40'), [0, 0.21, 0]));
  g.add(P(new THREE.TorusGeometry(0.18, 0.018, 5, 12), M('#4d4a55'), [0, 0.12, 0], [Math.PI / 2, 0, 0]));
  g.add(P(new THREE.TorusGeometry(0.18, 0.018, 5, 12), M('#4d4a55'), [0, 0.32, 0], [Math.PI / 2, 0, 0]));
  return g;
}

function crate() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.38, 0.38, 0.38), M('#7a6446'), [0, 0.19, 0], [0, 0.2, 0]));
  g.add(P(new THREE.BoxGeometry(0.42, 0.07, 0.07), M('#5c4632'), [0, 0.19, 0.17], [0, 0.2, 0.8]));
  g.add(P(new THREE.BoxGeometry(0.2, 0.2, 0.2), M('#6e5a40'), [0.22, 0.1, -0.18], [0, 0.6, 0]));
  return g;
}

function banner() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.03, 0.04, 1.5, 5), M('#4a3a26'), [0, 0.75, 0]));
  g.add(P(new THREE.BoxGeometry(0.42, 0.04, 0.04), M('#4a3a26'), [0.18, 1.42, 0]));
  g.add(P(new THREE.BoxGeometry(0.34, 0.62, 0.025), M('#7a2433'), [0.2, 1.1, 0]));
  g.add(P(new THREE.ConeGeometry(0.04, 0.12, 4), M('#d4af37', { metalness: 0.5 }), [0, 1.56, 0]));
  return g;
}

function brazier() {
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 5), M('#3a3d49', { metalness: 0.4 }), [0, 0.25, 0]));
  g.add(P(new THREE.CylinderGeometry(0.16, 0.08, 0.14, 7), M('#3a3d49', { metalness: 0.4 }), [0, 0.55, 0]));
  g.add(P(new THREE.ConeGeometry(0.1, 0.24, 5), M('#ff9d45', { emissive: '#ff6a00', emissiveIntensity: 1.6 }), [0, 0.7, 0]));
  g.add(P(new THREE.ConeGeometry(0.05, 0.14, 4), M('#ffe9a0', { emissive: '#ffd75e', emissiveIntensity: 2.0 }), [0, 0.78, 0]));
  return g;
}

function cart() {
  const g = new THREE.Group();
  g.add(P(new THREE.BoxGeometry(0.8, 0.22, 0.5), M('#6e5a40'), [0, 0.34, 0]));
  g.add(P(new THREE.BoxGeometry(0.8, 0.16, 0.05), M('#5c4632'), [0, 0.5, 0.22]));
  g.add(P(new THREE.BoxGeometry(0.8, 0.16, 0.05), M('#5c4632'), [0, 0.5, -0.22]));
  for (const x of [-0.25, 0.25]) for (const z of [0.26, -0.26])
    g.add(P(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 8), M('#4a3a26'), [x, 0.16, z], [Math.PI / 2, 0, 0]));
  g.add(P(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 4), M('#5c4632'), [0.55, 0.3, 0.1], [0, 0, -0.9]));
  return g;
}

function dummy() {
  // Training dummy — straw and old armor on a pole
  const g = new THREE.Group();
  g.add(P(new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5), M('#5c4632'), [0, 0.45, 0]));
  g.add(P(new THREE.BoxGeometry(0.55, 0.05, 0.05), M('#5c4632'), [0, 0.62, 0]));
  g.add(P(new THREE.CylinderGeometry(0.14, 0.18, 0.35, 6), M('#8a7a5c'), [0, 0.6, 0]));
  g.add(P(new THREE.SphereGeometry(0.11, 6, 5), M('#a89a78'), [0, 0.92, 0]));
  g.add(P(new THREE.CylinderGeometry(0.12, 0.13, 0.06, 6), M('#4d4a55', { metalness: 0.3 }), [0, 1.0, 0]));
  return g;
}

function curtain() {
  // A hanging stage curtain segment (tall, crimson, slightly waved)
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    g.add(P(new THREE.CylinderGeometry(0.16, 0.2, 2.0, 6), M(i % 2 ? '#5e2438' : '#742c44'),
      [(i - 1) * 0.3, 1.0, (i % 2) * 0.06]));
  }
  g.add(P(new THREE.BoxGeometry(1.0, 0.1, 0.3), M('#d4af37', { metalness: 0.5 }), [0, 2.05, 0]));
  return g;
}

// A fallen hero — the same model, laid in the dirt, colors drained.
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
  const g = new THREE.Group();
  g.add(inner);
  return g;
}

export const MODELS = {
  // heroes
  knight: vanguardKnight, rogue, mage,
  battleMage, frostMage, defender: villageDefender,
  // monsters
  husk, bramble, shadowHag, archfey,
  // props / decor (usable from the editor's deco palette)
  tent, campfire, piano, trunk: trunkProp, floorboard, throne,
  spectator, hut, spotlight, barrier, gate,
  pine, deadTree, rock, barrel, crate, banner, brazier, cart, dummy, curtain,
};

export function buildModel(name) {
  if (name?.startsWith('body:')) return body(name.slice(5));
  const fn = MODELS[name];
  return fn ? fn() : null;
}

// Names offered in the editor deco palette.
export const DECO_TYPES = [
  'tent', 'campfire', 'piano', 'trunk', 'floorboard', 'throne',
  'spectator', 'hut', 'barrier', 'gate',
  'pine', 'deadTree', 'rock', 'barrel', 'crate', 'banner', 'brazier', 'cart', 'dummy', 'curtain',
];

// Descriptions for the right-click inspector.
export const DECO_INFO = {
  tent: { name: 'Field Tent', desc: 'Canvas sagging with dew. Whoever slept here left in a hurry — or never woke.' },
  campfire: { name: 'Campfire', desc: 'Still burning. Nobody is feeding it, and yet it does not die.' },
  piano: { name: 'Grand Piano', desc: 'A concert grand, lid propped open. Something glints between the rusted strings.' },
  trunk: { name: 'Prop Trunk', desc: 'A velvet-lined wardrobe trunk stuffed with costumes of a hundred stolen faces.' },
  floorboard: { name: 'Loose Floorboard', desc: 'It creaks differently from the others. Hollow underneath.' },
  throne: { name: 'The Conductor\'s Throne', desc: 'Cold iron and colder gold. The seat of the Grand Conductor.' },
  spectator: { name: 'Bound Spectator', desc: 'A fey onlooker lashed to their seat by thorned vines, weeping behind a forced, unnatural smile.' },
  hut: { name: 'Crooked Hut', desc: 'It leans wrong. The witch-light in its window watches you back.' },
  barrier: { name: 'Starlight Barrier', desc: 'A shield of frozen starlight. Weapons strike only flickering reflections.' },
  gate: { name: 'Stone Gate', desc: 'A way through. The air beyond smells different — older, freer.' },
  pine: { name: 'Pine', desc: 'A wind-bent pine. Its needles never seem to fall.' },
  deadTree: { name: 'Dead Tree', desc: 'Bare branches like grasping fingers. Long dead, never rotting.' },
  rock: { name: 'Boulder', desc: 'Weathered stone, half-sunk in the earth.' },
  barrel: { name: 'Barrel', desc: 'Army-issue. Sloshes faintly when nudged.' },
  crate: { name: 'Supply Crates', desc: 'Stamped with a quartermaster\'s mark no one alive remembers.' },
  banner: { name: 'War Banner', desc: 'A crimson standard. The sigil has been carefully unpicked, thread by thread.' },
  brazier: { name: 'Brazier', desc: 'An iron basket of coals that burn without smoke.' },
  cart: { name: 'Supply Cart', desc: 'One wheel is splintered. The load is long gone.' },
  dummy: { name: 'Training Dummy', desc: 'Straw and dented plate on a pole. It has taken a thousand blows and holds no grudge.' },
  curtain: { name: 'Stage Curtain', desc: 'Heavy crimson velvet, gold-trimmed. It smells of dust and old applause.' },
};
