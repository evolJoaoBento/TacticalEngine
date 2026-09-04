// ============ ONE-SHOT CAMPAIGN DATA ============
// "The Conductor's Stage" — a Daggerheart one-shot in three phases:
// 1. Waking Up (the quiet camp, four bodies, the fog loop)
// 2. The Pit (the Archfey's arena and the three paths)
// 3. The Theater (the universal spotlight puzzle)

import { makeEnemy } from './data.js';

// ---------- THE PARTY (the four bodies) ----------
export function buildParty() {
  return [
    {
      id: 'pc-battleMage', name: 'Ardyn', class: 'Battle Mage', color: '#ff7b33', model: 'battleMage',
      heroKey: 'battleMage',
      traits: { Agility: 0, Strength: 0, Finesse: -1, Instinct: 1, Presence: 1, Knowledge: 2 },
      maxHp: 5, evasion: 11, speed: 4,
      weapon: { name: 'Emberbolt', trait: 'Knowledge', dmg: 3, range: 4 },
    },
    {
      id: 'pc-defender', name: 'Tomé', class: 'Village Defender', color: '#7ad17a', model: 'defender',
      heroKey: 'defender',
      traits: { Agility: 1, Strength: 1, Finesse: 0, Instinct: 1, Presence: 2, Knowledge: -1 },
      maxHp: 6, evasion: 12, speed: 4,
      weapon: { name: 'The Arcane Stick', trait: 'Presence', dmg: 3, range: 2 },
    },
    {
      id: 'pc-frostMage', name: 'Iskra', class: 'Frost Mage', color: '#7fc8ff', model: 'frostMage',
      heroKey: 'frostMage',
      traits: { Agility: 0, Strength: -1, Finesse: 1, Instinct: 2, Presence: 0, Knowledge: 1 },
      maxHp: 5, evasion: 12, speed: 4,
      weapon: { name: 'Frost Lance', trait: 'Instinct', dmg: 3, range: 4 },
    },
    {
      id: 'pc-knight', name: 'Bram', class: 'Vanguard Knight', color: '#c8cede', model: 'knight',
      heroKey: 'knight',
      traits: { Agility: 1, Strength: 2, Finesse: 0, Instinct: 0, Presence: 1, Knowledge: -1 },
      maxHp: 8, evasion: 13, speed: 3,
      weapon: { name: 'Tower Blade', trait: 'Strength', dmg: 4, range: 1 },
    },
  ];
}

// ---------- SPIRIT BLESSINGS ----------
// Granted when a spirit takes a body. One use per scene. Lost if traded to the Hag.
export const BLESSINGS = {
  battleMage: {
    name: 'Cinder Nova',
    desc: 'A ring of spirit-fire: 3 damage to every enemy within 3 tiles.',
    async use(game, h) {
      const targets = game.map.enemies.filter(e =>
        e.hp > 0 && Math.abs(e.x - h.x) + Math.abs(e.y - h.y) <= 3);
      if (!targets.length) { game.ui.log('The nova blooms over empty ground.', 'system'); return; }
      for (const e of targets) await game.damageEnemy(e, 3, 'Cinder Nova');
    },
  },
  defender: {
    name: 'Hearthlight',
    desc: 'The warmth of a kitchen long gone: every living hero heals 2 HP.',
    async use(game) {
      for (const a of game.heroes) if (a.hp > 0) a.hp = Math.min(a.hp + 2, a.maxHp);
      game.ui.log('Bread, flour, laughter — for one breath the war is far away. <b>The party heals 2 HP.</b>', 'hope');
    },
  },
  frostMage: {
    name: 'Hoarfrost Bind',
    desc: 'Eternal ice seizes the nearest enemy within 4 tiles: 2 damage, and it loses its next activation.',
    async use(game, h) {
      const targets = game.map.enemies
        .filter(e => e.hp > 0 && Math.abs(e.x - h.x) + Math.abs(e.y - h.y) <= 4)
        .sort((a, b) => (Math.abs(a.x - h.x) + Math.abs(a.y - h.y)) - (Math.abs(b.x - h.x) + Math.abs(b.y - h.y)));
      const e = targets[0];
      if (!e) { game.ui.log('The frost finds nothing to bite.', 'system'); return; }
      await game.damageEnemy(e, 2, 'Hoarfrost Bind');
      if (e.hp > 0) { e.frozen = true; game.ui.log('Ice crawls up its limbs — it is <b>bound</b> until it breaks free.', 'hope'); }
    },
  },
  knight: {
    name: 'Shield Wall',
    desc: 'The tower shield remembers the line: all heroes gain +2 Evasion until the end of the next enemy phase.',
    async use(game) {
      game.shieldWall = true;
      game.ui.log('Shields lock. <b>+2 Evasion for the whole party</b> until the line breaks.', 'hope');
    },
  },
};

// ---------- PHASE 1 TEXTS ----------
export const CAMP_INTRO = [
  'Silence. A war camp at the hour when even sentries dream. Cookfires burned to embers, tents sagging with dew — and you, drifting above it all, weightless, formless. Four of you. Four pale wisps of spirit light.',
  'Below, in the dirt, lie four dead bodies.',
  'The fog around the camp is a wall. You have already tried to leave — it simply turns you around, sets you back where you began. The bodies are the only doors out of this place.',
];

export const FOG_LOOP_LINES = [
  'The fog swallows you... and spits you out on the far side of the camp. The world here is a closed circle.',
  'You walk into the mist. Ten steps later you are walking out of it — on the opposite edge. The camp will not let go.',
  'Grey nothing, the smell of cold ash, and then — the same tents again. There is no road out except through the dead.',
];

// The four death flashbacks (read when a spirit enters a body).
export const FLASHBACKS = {
  battleMage: {
    title: 'The Battle Mage — Fire',
    memories: [
      'The Smell of Ozone and Ash — You remember perfectly the scent of the air just after conjuring an electric barrier at the military academy; burnt metal mingling with the soft perfume of the linden trees that grew in the training yard.',
      'The Healer\'s Laugh — A vivid memory of a cold winter night in a garrison tavern, where the clean, contagious laughter of your platoon\'s healer — the same one you watched flee — made you forget, for a few hours, the casualty report you had to sign the next morning.',
      'The Silver Promise — The tactile feel of a silver signet ring you used to spin on your little finger whenever anxiety gripped you before a charge — a promise made to someone that you would come home, though their name now slips through your fingers like water.',
    ],
  },
  defender: {
    title: 'The Village Defender — The Arcane Stick',
    memories: [
      'Hands Dirty with Earth and Flour — A peaceful memory of a spring morning, helping your family knead bread at the wooden kitchen table, laughing as the children blew flour at each other, dusting the floor white before the chaos began.',
      'The Taste of Blood and Iron — The exact moment the village militia sounded the alarm; the headlong sprint through narrow lanes as you swallowed dry panic, the bitter taste of fear and metal climbing your throat.',
      'The Blue Light of the Unknown — The cold, hypnotic glow of the arcane staff you saw a soldier drop in the village square. You remember that magical light reflected in your family\'s wide eyes as you begged them to stay hidden in the alley.',
    ],
  },
  frostMage: {
    title: 'The Frost Mage — Ice',
    memories: [
      'The Silence of the High Snow — You remember the absolute comfort of absolute isolation on the peaks of the northern mountains, where the only sounds were the soft crack of ice beneath your boots and your own breath condensing in the frozen air.',
      'The Touch of the Crystal — The painful, fascinating memory of your first day of initiation, when you were made to hold a shard of eternal ice with bare hands until your own magic awoke to shield you from the burn of the cold.',
      'A Distant Lullaby — The echo of a melody hummed by a soft, aged voice, heard throughout your childhood whenever winter storms rattled the wooden windows of your old home.',
    ],
  },
  knight: {
    title: 'The Vanguard Knight — Frontlines',
    memories: [
      'The Weight of Iron on Your Shoulders — The grinding physical memory of marching for days under torrential rain, leather armor straps cutting into your skin, the rhythmic clatter of metal on metal echoing like a collective heartbeat.',
      'The Warmth of the Campfire — The sense of belonging as you shared a mug of thin, lukewarm stew with your shield-brother, trading exaggerated stories of monsters and old battles to mask the trembling of your hands.',
      'The Cry of Command — The deafening blast of the war horn sounding the advance. You remember the surge of adrenaline that raised your tower shield, shutting out the world to focus only on the shoulders of the soldier in front of you.',
    ],
  },
};

// ---------- PHASE 2 TEXTS ----------
export const PIT_INTRO = [
  'As you step through the damp mists, the silence of the war camp is shattered by a terrifying cacophony. You stand at the upper rim of an enormous stone pit.',
  'In the stands all around you, hundreds of elven and fey spectators are lashed to their seats by thorn-studded vines. Their faces are streaked with tears and their eyes are wide with horror — yet their mouths are stretched into broad, unnatural smiles, forced to scream and applaud at the top of their lungs.',
  'Down on the floor of the pit, two soldiers in mismatched armor are locked in desperate combat. One drops his weapon, hands shaking, and cries out: "Please don\'t do this, I am your friend!" The other, weeping openly but unable to stop his own arms, drives a jagged spear straight through his friend\'s chest.',
  'The victim sinks to his knees, breathing his last, as the killer collapses over the body, sobbing hysterically — while the crowd around them screams and applauds in twisted, forced celebration.',
];

export const PROCLAMATION = [
  'Suddenly, a figure manifests on a vast floating balcony overlooking the pit. Wrapped in shifting, iridescent silks, eyes glittering like cold stars, the Archfey surveys the carnage with a bored, elegant smile. He raises his hands, and his voice carries perfectly through the arena:',
  '"Might you want your freedom? Come and fight for it! Only those who entertain me shall be granted passage to the world beyond!"',
];

export const HAG_PITCH = [
  'A hunched figure detaches itself from the shadow of a crooked hut at the rim of the pit. Her eyes burn cold and white, and her voice is dry leaves on stone:',
  '"Look at them. Tricked into a game where the only prize is losing your soul to an Archfey\'s amusement... But the pit is not the only way out of this prison. I can open a backdoor."',
  '"All I need is a taste of that strange spirit light in your eyes. Give me your blessings, and you can bypass his entire circus completely unscathed."',
];

export const HAG_DEAL_DONE = [
  'Her fingers — too long, too many joints — brush each of your faces in turn. Something warm leaves you. The world dims by exactly one candle.',
  '"Lovely," she sighs, fuller now, younger around the mouth. "The cranks, then, as promised. Four of them, hidden on his precious stage: jammed in the strings of the GRAND PIANO... beneath the loose FLOORBOARD at center stage... bound to the vines of a weeping SPECTATOR in the front row... and locked inside the velvet PROP TRUNK at the back."',
  'She tears a slit in the air behind her hut — a backdoor of cold violet light.',
];

export const HAG_FIGHT_WIN = [
  'The Hag folds in on herself like burnt paper, shrieking, and what remains is a splintered staff crowned with a sliver of cold moon. The Moon Staff hums in your hands — its light peels back lies.',
  'In its pale glare you see what she knew: four cranks, hidden on the Archfey\'s stage — the GRAND PIANO\'s strings, the loose FLOORBOARD at center stage, the vines of a front-row SPECTATOR, and the velvet PROP TRUNK at the back.',
  'The staff splits the air behind her hut into a ragged backdoor portal. (+1 damage to every hero\'s weapon.)',
];

// ---------- PHASE 3 TEXTS ----------
export const OPENINGS = {
  entertained: [
    '"Bravo! Oh, spectacular! It has been decades since a group of playthings bled so beautifully in the dirt for my court! You have earned your place on my grand stage, little ghosts."',
    '"But the final act is always the hardest to write. Let us play a game of hide-and-seek. I\'ve hidden the keys to your exit, and to make it fair, I shall give you the script piece by piece. Let\'s see how well you dance when I pull your strings!"',
  ],
  insulted: [
    '"Did you truly think you could cheat me? That you could scurry through the back door like rats, carrying the stinking rot of that wretched Hag? You dare deny me my entertainment?!"',
    '"If you will not bleed for my court willingly, then I shall make you tear each other apart for my malice. Look upon your allies, little ghosts — they are my weapons now. Let the slaughter begin!"',
  ],
  vengeful: [
    '"So, the stray spirits have teeth. You slaughtered my gatekeeper and broke into my sanctuary wielding her splintered bones? How delightfully vicious. You think that staff makes you gods?"',
    '"You are nothing but echoes trapped in stolen meat! If it is a bloodbath you want, I am more than happy to oblige. Let us see if you can find the locks before your own hands choke the life out of your friends!"',
  ],
};

export const RIDDLES = {
  'crank-piano': '"I have eighty-eight keys but cannot open a single door; I sing when you strike me, but I weep on the floor."',
  'crank-floorboard': '"Everyone walks over me, but I never complain; I hide in the dark where the dead have lain."',
  'crank-spectator': '"I cheer for your pain though my heart is in dread; I wear a bright smile but I wish I were dead."',
  'crank-trunk': '"I wear many faces but have none of my own; I dress for the court but I sit here alone."',
};

export const ENDINGS = {
  entertained: [
    '"Magnificent! Truly magnificent! You solved the riddles, you kept your wits, and you danced beautifully to the rhythm of my stage. You have broken my illusion, little ghosts, and proven yourselves worthy."',
    '"You have passed my game, and so, your true journey begins. Step out into the great sandbox — your freedom is well earned. But you still don\'t know what you are, do you? If you want to find out where you came from, head into the town just beyond the ridge. I am certain the right person will FIND YOU if you head there. Go on, heroes. Show the world what you can do!"',
  ],
  insulted: [
    '"Well, well, well. You bypassed my arena, bartered with the Hag, and still managed to out-sprint my malice! I threw my worst at you, and you handled it with absolute precision. You refuse to be helpless playthings, and that is exactly what I wanted to see."',
    '"You have broken my stage and earned your passage. Step out into the great sandbox, little ghosts. But remember, this was just a microcosm. If you want to truly find out where you came from, go into the town ahead. I am certain the right person will FIND YOU if you head there. Good luck — you are going to need that sharp intuition out there!"',
  ],
  vengeful: [
    '"Incredible. You tore through my camp, struck down my gatekeeper, and forced your way into my sanctuary with absolute defiance. I needed to know if you had the fire inside you to survive what comes next — and you have a raging inferno."',
    '"You have shattered my glass and earned your freedom. Step out into the great sandbox, little ghosts. You are ready. But your past remains a mystery, does it not? If you want to know where you truly came from, head down into the town. I am certain the right person will FIND YOU if you head there. Go forth, and let them see your fire!"',
  ],
};

export const OUTRO = [
  'The gigantic stone gates behind the throne grind open with a thunderous roar, letting in a fresh breeze from the real world. The borrowed bodies knit themselves whole, every wound closing — and you find yourselves standing on a high mountain ridge, looking out over a vast new world, the welcoming lights of a bustling town blinking in the distance.',
  '[Fade to Black. End of One-Shot.]',
];

// Positions the campaign script needs (kept beside the maps that define them).
export const CAMP_GATE = { x: 11, y: 2 };
export const PIT_PORTAL_ARENA = { x: 12, y: 10 };
export const PIT_PORTAL_HUT = { x: 6, y: 17 };
export const THEATER_REINFORCE = [[2, 9], [21, 9], [4, 16], [19, 16]];

// ============ MAPS ============

function base(w, h, color = '#4a4438') {
  const tiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles.push({ h: 0, color, prop: null });
  return { w, h, tiles, nodes: [], enemies: [], triggers: [], decos: [], spawns: [] };
}
const T = (m, x, y) => m.tiles[y * m.w + x];
const D = (m, type, x, y, rot = 0) => m.decos.push({ type, x, y, rot });

// ---- Phase 1: the quiet war camp (22 x 16) ----
export function campMap() {
  const m = base(22, 16, '#4a4438');
  m.name = 'The Quiet Camp';
  m.intro = '';
  m.fog = { band: 2 };   // real drifting fog wall around the camp
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const t = T(m, x, y);
    // Two-tile fog wall
    if (x <= 1 || y <= 1 || x >= m.w - 2 || y >= m.h - 2) {
      t.color = (x === 0 || y === 0 || x === m.w - 1 || y === m.h - 1) ? '#1f1e27' : '#2a2933';
      continue;
    }
    if ((x * 5 + y * 3) % 7 === 0) t.color = '#524c3e';        // trampled grass
    if ((x * 11 + y * 7) % 13 === 0) t.color = '#3f3a30';      // mud patches
  }
  // Dirt paths crossing at the fire
  for (let x = 2; x < 20; x++) T(m, x, 8).color = '#5a5142';
  for (let y = 2; y < 14; y++) T(m, 11, y).color = '#5a5142';

  // Central fire + a second cookfire
  D(m, 'campfire', 11, 8);
  D(m, 'campfire', 5, 12);
  // Tents — a proper encampment
  D(m, 'tent', 4, 4, 0.3); D(m, 'tent', 6, 3, -0.4); D(m, 'tent', 17, 4, 0.7);
  D(m, 'tent', 19, 6, -0.2); D(m, 'tent', 4, 11, 0.5); D(m, 'tent', 18, 12, -0.6);
  D(m, 'tent', 8, 13, 0.1); D(m, 'tent', 15, 3, 0.9);
  // Supplies & camp life
  D(m, 'cart', 14, 12, 0.4); D(m, 'cart', 3, 7, -1.2);
  D(m, 'barrel', 12, 3); D(m, 'barrel', 16, 11); D(m, 'barrel', 6, 6);
  D(m, 'crate', 5, 6); D(m, 'crate', 16, 5); D(m, 'crate', 10, 13);
  D(m, 'banner', 10, 3); D(m, 'banner', 13, 3, Math.PI);
  D(m, 'brazier', 7, 8); D(m, 'brazier', 15, 8);
  D(m, 'dummy', 17, 9, 0.4); D(m, 'dummy', 19, 10, -0.3);
  D(m, 'deadTree', 3, 13); D(m, 'deadTree', 19, 3); D(m, 'deadTree', 2, 3);

  // The four bodies, fallen around the central fire
  const bodies = [
    ['battleMage', 8, 6, 'a scorched figure in a war-mage\'s robes'],
    ['defender', 14, 6, 'a villager clutching a faintly glowing staff'],
    ['frostMage', 8, 10, 'a pale figure rimed with frost that will not melt'],
    ['knight', 14, 10, 'an armored soldier, tower shield still strapped to one arm'],
  ];
  for (const [key, x, y, desc] of bodies) {
    m.nodes.push({
      id: 'body-' + key, type: 'scripted', model: 'body:' + key,
      x, y, name: desc, heroKey: key,
    });
  }
  m.spawns = [[11, 8]];
  return m;
}

// ---- Phase 2: the pit (26 x 20) ----
export function pitMap() {
  const m = base(26, 20, '#565b6b');
  m.name = 'The Pit';
  m.intro = '';
  // Outer rim walk (h3), seating tier (h2), pit floor (h0)
  for (const t of m.tiles) t.h = 3;
  for (let y = 3; y <= 16; y++) for (let x = 2; x <= 23; x++) {
    T(m, x, y).h = 2; T(m, x, y).color = '#6b7080';
  }
  for (let y = 5; y <= 14; y++) for (let x = 6; x <= 19; x++) {
    T(m, x, y).h = 0; T(m, x, y).color = '#8a7a5c';
    if ((x * 7 + y * 5) % 11 === 0) T(m, x, y).color = '#94835f';
  }
  // The duel's aftermath, center pit
  T(m, 12, 9).color = '#6e4a42'; T(m, 13, 9).color = '#6e4a42'; T(m, 12, 10).color = '#75503f';
  // Cover rocks in the pit
  T(m, 8, 7).prop = 'cover'; T(m, 17, 12).prop = 'cover'; T(m, 9, 12).prop = 'cover';
  // South stairs down
  T(m, 12, 15).h = 1; T(m, 13, 15).h = 1;
  T(m, 12, 15).color = T(m, 13, 15).color = '#7a8090';
  // The Archfey's balcony, looming north
  for (const [x, y] of [[11, 0], [12, 0], [13, 0], [14, 0], [11, 1], [12, 1], [13, 1], [14, 1]]) {
    T(m, x, y).h = 6; T(m, x, y).color = '#454a59';
  }
  D(m, 'throne', 12, 0, Math.PI);
  m.decos.push({ id: 'archfey-2', type: 'archfey', x: 13, y: 0, rot: Math.PI });
  D(m, 'banner', 11, 1); D(m, 'banner', 14, 1);

  // Bound spectators ringing the seating tier
  for (let x = 4; x <= 21; x += 2) D(m, 'spectator', x, 3, Math.PI);
  for (let x = 4; x <= 21; x += 3) { if (x !== 12 && x !== 13) D(m, 'spectator', x, 16, 0); }
  for (let y = 5; y <= 14; y += 2) { D(m, 'spectator', 3, y, Math.PI / 2); D(m, 'spectator', 22, y, -Math.PI / 2); }
  // Rim dressing
  D(m, 'brazier', 2, 2); D(m, 'brazier', 23, 2); D(m, 'brazier', 11, 15); D(m, 'brazier', 14, 15);
  D(m, 'banner', 2, 17); D(m, 'banner', 23, 17);
  D(m, 'rock', 24, 5); D(m, 'rock', 1, 10); D(m, 'rock', 24, 14);
  // The Hag's corner — dead trees and a crooked hut
  D(m, 'hut', 3, 17, 0.4);
  D(m, 'deadTree', 2, 16); D(m, 'deadTree', 5, 18); D(m, 'deadTree', 1, 18);
  m.nodes.push({
    id: 'hag', type: 'scripted', model: null, x: 4, y: 17,
    name: 'a hunched figure in the hut\'s shadow', hagNode: true,
  });
  // The Tangle Bramble Swarm, dormant in the pit (group 1 — the Arena path)
  for (const [x, y] of [[8, 6], [15, 6], [10, 9], [16, 9], [8, 12], [14, 12]]) {
    m.enemies.push(makeEnemy(x, y, 1, 'bramble'));
  }
  // Stepping onto the pit floor = choosing the Arena
  m.triggers.push({
    id: 'trig-arena', group: 1, once: true,
    cells: [[10, 14], [11, 14], [12, 14], [13, 14], [14, 14], [15, 14],
    [10, 13], [11, 13], [12, 13], [13, 13], [14, 13], [15, 13]],
  });
  m.spawns = [[12, 18], [13, 18], [11, 18], [14, 18]];
  return m;
}

// ---- Phase 3: the theater (24 x 18) ----
export function theaterMap() {
  const m = base(24, 18, '#3c3845');
  m.name = 'The Conductor\'s Stage';
  m.intro = '';
  // Stage (raised wood)
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 22; x++) {
    T(m, x, y).h = 1; T(m, x, y).color = (x + y) % 5 ? '#6e5a40' : '#65523a';
  }
  // Crimson curtain backdrop + side walls
  for (let x = 0; x < m.w; x++) { T(m, x, 0).h = 4; T(m, x, 0).color = '#5e2438'; }
  for (let y = 1; y <= 6; y++) { T(m, 0, y).h = 4; T(m, 0, y).color = '#5e2438'; T(m, 23, y).h = 4; T(m, 23, y).color = '#5e2438'; }
  // Throne dais
  for (const [x, y] of [[11, 1], [12, 1]]) { T(m, x, y).h = 2; T(m, x, y).color = '#454a59'; }
  D(m, 'throne', 11, 1, Math.PI);
  m.decos.push({ id: 'archfey-3', type: 'archfey', x: 12, y: 1, rot: Math.PI });
  D(m, 'barrier', 12, 1);
  // Hanging curtain segments along the backdrop
  D(m, 'curtain', 3, 1); D(m, 'curtain', 7, 1); D(m, 'curtain', 16, 1); D(m, 'curtain', 20, 1);
  // Stage steps into the house
  for (const x of [10, 11, 12, 13]) { T(m, x, 6).color = '#5a4c38'; }
  // Aisles
  for (let y = 7; y < m.h; y++) { T(m, 11, y).color = '#4a4652'; T(m, 12, y).color = '#4a4652'; }
  for (let x = 1; x < 23; x++) T(m, x, 12).color = '#46424f';
  // Bound audience, row after row
  for (const y of [8, 10, 14, 16]) {
    for (let x = 3; x <= 20; x += 2) {
      if (x === 11 || x === 12) continue;
      if (y === 8 && x === 5) continue; // the weeping spectator (crank node) sits here
      D(m, 'spectator', x, y, Math.PI + (x - 11.5) * 0.04);
    }
  }
  // House dressing
  D(m, 'brazier', 1, 8); D(m, 'brazier', 22, 8); D(m, 'brazier', 1, 16); D(m, 'brazier', 22, 16);
  D(m, 'banner', 1, 12); D(m, 'banner', 22, 12, Math.PI);
  D(m, 'crate', 2, 2); D(m, 'barrel', 21, 2); D(m, 'crate', 2, 5);

  // The four crank hiding spots
  m.nodes.push(
    {
      id: 'crank-piano', type: 'scripted', model: 'piano', x: 5, y: 2, rot: 0.5,
      name: 'The Grand Piano', crank: true, trait: 'Finesse', dc: 11,
      foundText: 'You ease the crank handle out from between the piano\'s rusted strings — one low note moans across the stage.',
    },
    {
      id: 'crank-floorboard', type: 'scripted', model: 'floorboard', x: 11, y: 3,
      name: 'a loose floorboard at center stage', crank: true, trait: 'Instinct', dc: 11,
      foundText: 'The hollow board lifts away. In the dusty dark beneath the stage, a crank handle — and old, old bloodstains.',
    },
    {
      id: 'crank-spectator', type: 'scripted', model: 'spectator', x: 5, y: 8, rot: Math.PI,
      name: 'a weeping spectator in the front row', crank: true, trait: 'Presence', dc: 12,
      foundText: 'You hold the spectator\'s gaze and gently work the crank free of the thorned vines crushing their chest. Their smile never moves, but their eyes say thank you.',
    },
    {
      id: 'crank-trunk', type: 'scripted', model: 'trunk', x: 18, y: 2, rot: -0.4,
      name: 'the velvet-lined Prop Trunk', crank: true, trait: 'Strength', dc: 11,
      foundText: 'The trunk\'s lock shears off. Beneath folded costumes of a hundred stolen faces lies the final crank handle.',
    },
  );
  // The four spotlight pillars
  const pillars = [[3, 2, 0.8], [20, 2, -0.8], [3, 7, 0.3], [20, 7, -0.3]];
  pillars.forEach(([x, y, r], i) => {
    m.nodes.push({
      id: 'pillar-' + (i + 1), type: 'scripted', model: 'spotlight', x, y, rot: r + Math.PI,
      name: 'Spotlight Pillar', pillar: true, lit: false,
    });
  });
  // Brambles lurking in the aisles (skip paths face these)
  for (const [x, y] of [[5, 11], [18, 11], [8, 15], [15, 15], [3, 13]]) {
    m.enemies.push(makeEnemy(x, y, 1, 'bramble'));
  }
  m.spawns = [[11, 17], [12, 17], [10, 17], [13, 17]];
  return m;
}
