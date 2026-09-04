// ============ POLYHEART DATA ============
// Static definitions: heroes, enemy templates, node defaults, demo map.

export const TRAITS = ['Agility', 'Strength', 'Finesse', 'Instinct', 'Presence', 'Knowledge'];

export const EFFECTS = {
  none:       { label: 'No effect' },
  open:       { label: 'Open / unlock node' },
  loot:       { label: 'Loot (+1 Hope, item found)' },
  damage:     { label: 'Trap (2 damage to roller)' },
  removeNode: { label: 'Destroy node' },
  giveKey:    { label: 'Give key…', needsParam: true, hint: 'key name' },
  setFlag:    { label: 'Set story flag…', needsParam: true, hint: 'flag name' },
  spawnGroup: { label: 'Start combat: group…', needsParam: true, hint: 'group #' },
  goto:       { label: 'Travel to scene…', needsParam: true, hint: 'scene id' },
};

export const HERO_DEFS = [
  {
    id: 'hero-kara', name: 'Kara', class: 'Sentinel', color: '#e06c4f', model: 'knight',
    traits: { Agility: 0, Strength: 2, Finesse: 0, Instinct: 1, Presence: 1, Knowledge: -1 },
    maxHp: 7, evasion: 11, speed: 4,
    weapon: { name: 'Greatblade', trait: 'Strength', dmg: 4, range: 1 },
  },
  {
    id: 'hero-finn', name: 'Finn', class: 'Nightwalker', color: '#5fb0ff', model: 'rogue',
    traits: { Agility: 2, Strength: -1, Finesse: 2, Instinct: 1, Presence: 0, Knowledge: 0 },
    maxHp: 5, evasion: 13, speed: 5,
    weapon: { name: 'Shortbow', trait: 'Finesse', dmg: 3, range: 4 },
  },
  {
    id: 'hero-mira', name: 'Mira', class: 'Seer', color: '#b07ae0', model: 'mage',
    traits: { Agility: 0, Strength: -1, Finesse: 1, Instinct: 2, Presence: 2, Knowledge: 1 },
    maxHp: 5, evasion: 12, speed: 4,
    weapon: { name: 'Spark Staff', trait: 'Instinct', dmg: 3, range: 3 },
  },
];

// Enemy stat blocks — keyed by type, usable from the editor's enemy palette.
// special: 'entangle' = hits slow the target (bramble tokens)
//          'nightmare' = Waking Nightmare: drains Hope at range, heals self
export const ENEMY_TYPES = {
  husk: {
    type: 'husk', name: 'Hollow Husk', model: 'husk',
    maxHp: 5, difficulty: 13, atkMod: 2, dmg: 2, speed: 3, range: 1,
  },
  bramble: {
    type: 'bramble', name: 'Tangle Bramble', model: 'bramble',
    maxHp: 3, difficulty: 12, atkMod: 1, dmg: 2, speed: 2, range: 1, special: 'entangle',
  },
  shadowHag: {
    type: 'shadowHag', name: 'Shadow Hag', model: 'shadowHag',
    maxHp: 14, difficulty: 14, atkMod: 3, dmg: 3, speed: 3, range: 4, special: 'nightmare',
  },
};

export const ENEMY_TEMPLATE = ENEMY_TYPES.husk;

export function defaultOutcomes(type) {
  const o = (text, effect) => ({ text, effect });
  switch (type) {
    case 'chest': return {
      hopeSuccess: o('The lock clicks open smoothly. Inside, treasure glints in the dim light.', 'loot'),
      fearSuccess: o('The lid creaks open — but the rusted hinge SHRIEKS, echoing down the corridors...', 'loot'),
      hopeFail:    o('The lock holds, but you withdraw your pick before it snaps. You can try again.', 'none'),
      fearFail:    o('A needle springs from the lock mechanism and bites your hand. Poison burns.', 'damage'),
    };
    case 'door': return {
      hopeSuccess: o('The mechanism yields silently. The way is open.', 'open'),
      fearSuccess: o('The door grinds open — far too loudly. Something stirs beyond.', 'open'),
      hopeFail:    o('The door refuses to budge, but you sense the trick of it now.', 'none'),
      fearFail:    o('Your effort echoes like a war drum. The door stays shut.', 'none'),
    };
    case 'pillar': return {
      hopeSuccess: o('You topple the crumbling pillar exactly where you wanted it. Dust settles.', 'removeNode'),
      fearSuccess: o('The pillar crashes down — and the whole chamber shudders ominously.', 'removeNode'),
      hopeFail:    o('The pillar wobbles but holds. You note the weakest crack for next time.', 'none'),
      fearFail:    o('Stone chips rain down on you as the pillar settles deeper into its base.', 'damage'),
    };
    default: return {
      hopeSuccess: o('Success, and fortune smiles.', 'none'),
      fearSuccess: o('Success, but at a cost.', 'none'),
      hopeFail:    o('Failure, yet hope remains.', 'none'),
      fearFail:    o('Failure, and the shadows lengthen.', 'none'),
    };
  }
}

export function makeNode(type, x, y) {
  const names = { chest: 'Old Wooden Chest', door: 'Iron-Banded Door', pillar: 'Crumbling Pillar', portal: 'Stone Gate' };
  const flavors = {
    chest: 'An old wooden chest sits rotting in the corner, its lock crusted with rust.',
    door: 'An iron-banded door blocks the way, its lock ancient but solid.',
    pillar: 'A crumbling stone pillar leans precariously, deep cracks running through its base.',
    portal: 'A stone gate hums with cold light. Something else waits on the far side.',
  };
  const traits = { chest: 'Finesse', door: 'Finesse', pillar: 'Strength' };
  const n = {
    id: 'node-' + Math.random().toString(36).slice(2, 8),
    type, x, y,
    name: names[type] || type,
    flavor: flavors[type] || '',
    trait: traits[type] || 'Instinct',
    dc: 12,
    outcomes: defaultOutcomes(type),
    open: false,
    requireKey: '',        // if set, party must hold this key to interact
    lockedText: '',        // shown when the key is missing
    goto: null,            // scene id — travel node (no roll)
  };
  if (type === 'portal') n.model = 'gate';
  return n;
}

// Grow or crop a map in place; out-of-bounds content is dropped.
export function resizeMap(m, w, h) {
  const tiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    tiles.push(x < m.w && y < m.h
      ? m.tiles[y * m.w + x]
      : { h: 0, color: '#5d8a4a', prop: null });
  }
  m.tiles = tiles; m.w = w; m.h = h;
  const inB = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  m.nodes = m.nodes.filter(n => inB(n.x, n.y));
  m.enemies = m.enemies.filter(e => inB(e.x, e.y));
  m.decos = (m.decos || []).filter(d => inB(d.x, d.y));
  for (const t of m.triggers) t.cells = t.cells.filter(([x, y]) => inB(x, y));
  m.triggers = m.triggers.filter(t => t.cells.length);
  m.spawns = m.spawns.filter(([x, y]) => inB(x, y));
  if (!m.spawns.length) m.spawns = [[1, 1]];
  return m;
}

// Wrap a single map into the campaign document format.
export function makeCampaign(maps, name = 'My Campaign') {
  for (const m of maps) m.id ??= 'scene-' + Math.random().toString(36).slice(2, 8);
  return { campaign: true, name, scenes: maps, start: 0 };
}

export function makeEnemy(x, y, group, type = 'husk') {
  const tpl = ENEMY_TYPES[type] || ENEMY_TYPES.husk;
  return {
    id: 'enemy-' + Math.random().toString(36).slice(2, 8),
    ...tpl,
    hp: tpl.maxHp,
    x, y, group,
  };
}

export function blankMap(w = 16, h = 12) {
  const tiles = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      tiles.push({ h: 0, color: '#5d8a4a', prop: null });
  return {
    name: 'Untitled Map', w, h, tiles,
    nodes: [], enemies: [], triggers: [], decos: [], spawns: [[1, 1], [2, 1], [1, 2]],
    intro: 'A new place, waiting for a story.',
  };
}

// ---- Demo map: "The Husk Vault" ----
export function demoMap() {
  const m = blankMap(22, 16);
  m.name = 'The Husk Vault';
  m.intro = 'Cold air drifts from the vault mouth. Moss-slick stone steps descend into a chamber half-swallowed by marsh water.';
  const T = (x, y) => m.tiles[y * m.w + x];
  const D = (type, x, y, rot = 0) => m.decos.push({ type, x, y, rot });

  // Palette
  const GRASS = '#5d8a4a', STONE = '#7a7f8c', MARSH = '#4a6b5d', DARK = '#565b6b', WALL = '#454a59';

  // Base grass with slight height noise on the west side
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    T(x, y).color = GRASS;
    if ((x * 3 + y * 5) % 9 === 0) T(x, y).color = '#548045';
    if ((x * 7 + y * 13) % 11 === 0 && x < 7) T(x, y).h = 1;
  }

  // Marsh band (difficult terrain), x 7..9
  for (let y = 1; y < m.h - 1; y++) for (let x = 7; x <= 9; x++) {
    T(x, y).color = MARSH; T(x, y).h = 0; T(x, y).prop = 'difficult';
    if ((x + y * 3) % 5 === 0) T(x, y).color = '#41615a';
  }

  // Stone vault floor, x 12..21
  for (let y = 0; y < m.h; y++) for (let x = 12; x < m.w; x++) {
    T(x, y).color = STONE; T(x, y).h = 0; T(x, y).prop = null;
    if ((x * 5 + y) % 7 === 0) T(x, y).color = '#70757f';
  }

  // Vault wall at x=12 with door gap at y=7
  for (let y = 0; y < m.h; y++) {
    if (y === 7) continue;
    T(12, y).h = 4; T(12, y).color = WALL;
  }

  // High ground plateau NE with ramps
  for (let y = 0; y < 5; y++) for (let x = 16; x < m.w; x++) { T(x, y).h = 2; T(x, y).color = DARK; }
  T(16, 5).h = 1; T(17, 5).h = 1; T(15, 2).h = 1;

  // Cover rocks
  [[4, 5], [4, 11], [14, 11], [17, 9], [19, 7]].forEach(([x, y]) => { T(x, y).prop = 'cover'; });

  // West wilds — pines, rocks, a dead tree
  D('pine', 2, 2); D('pine', 5, 1); D('pine', 1, 9); D('pine', 4, 13, 0.4); D('pine', 2, 12);
  D('pine', 6, 14, 0.7); D('deadTree', 5, 9); D('rock', 1, 5); D('rock', 6, 4); D('rock', 3, 14);
  // Vault dressing — braziers flank the door inside, old supplies rot in corners
  D('brazier', 14, 6); D('brazier', 14, 8);
  D('crate', 15, 14); D('barrel', 16, 14); D('crate', 20, 1); D('barrel', 20, 14);
  D('banner', 13, 2); D('banner', 13, 12, Math.PI);
  D('cart', 3, 7, -0.8);

  // Nodes
  const door = makeNode('door', 12, 7);
  door.name = 'Vault Door';
  door.flavor = 'An iron-banded vault door seals the eastern chamber. Its lock is ancient — but the tumblers may still turn.';
  door.dc = 13;
  const chest = makeNode('chest', 19, 13);
  chest.dc = 12;
  const pillar = makeNode('pillar', 14, 7);
  pillar.flavor = 'Just past the door, a crumbling pillar leans over the vault floor. One good shove could bring it down.';
  m.nodes.push(door, chest, pillar);

  // Enemies (group 1) inside the vault
  m.enemies.push(makeEnemy(16, 8, 1), makeEnemy(18, 3, 1), makeEnemy(19, 11, 1));

  // Trigger zone just past the door
  m.triggers.push({
    id: 'trig-' + Math.random().toString(36).slice(2, 8),
    group: 1, once: true,
    cells: [[13, 6], [13, 7], [13, 8], [14, 6], [14, 8], [15, 7]],
  });

  m.spawns = [[2, 7], [2, 8], [3, 7]];
  return m;
}
