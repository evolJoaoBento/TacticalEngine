// ============ ONE-SHOT CAMPAIGN: "THE CONDUCTOR'S STAGE" ============
// Drives the three-phase Daggerheart one-shot on top of the Game engine
// via its hook system. Owns all branching state (path/mood, cranks, puzzle).

import {
  buildParty, BLESSINGS, CAMP_INTRO, FOG_LOOP_LINES, FLASHBACKS,
  PIT_INTRO, PROCLAMATION, HAG_PITCH, HAG_DEAL_DONE, HAG_FIGHT_WIN,
  OPENINGS, RIDDLES, ENDINGS, OUTRO,
  CAMP_GATE, PIT_PORTAL_ARENA, PIT_PORTAL_HUT, THEATER_REINFORCE,
  campMap, pitMap, theaterMap,
} from './data-campaign.js';
import { makeEnemy } from './data.js';
import { ref, esc } from './ui.js';

const CRANK_ORDER = ['crank-piano', 'crank-floorboard', 'crank-spectator', 'crank-trunk'];

export class Campaign {
  constructor(sm, grid, dice, ui, game) {
    this.sm = sm; this.grid = grid; this.dice = dice; this.ui = ui; this.game = game;
    this.active = false;
    this.onExit = null; // set by main: return to free play
  }

  hooks() {
    return {
      onNodeInteract: (n, h) => this.nodeInteract(n, h),
      onHeroMoved: h => this.heroMoved(h),
      onFearRoll: r => this.fearRoll(r),
      onEnemyPhaseStart: () => this.enemyPhaseStart(),
      onCombatEnd: g => this.combatEnd(g),
    };
  }

  start() {
    this.active = true;
    this.partyDefs = buildParty();   // full roster (uninhabited)
    this.party = [];                 // live hero objects, carried between phases
    this.mood = null;                // entertained | insulted | vengeful
    this.knowsCranks = false;
    this.ended = false;
    this.startPhase(1);
  }

  exit() {
    this.active = false;
    this.onExit?.();
  }

  startOpts() {
    return {
      party: this.party,
      hooks: this.hooks(),
      quietIntro: true,
      onRestart: () => this.restartPhase(),
    };
  }

  restartPhase() {
    // Death is not the end here — the Archfey rewinds the scene, annoyed.
    for (const p of this.party) { p.hp = p.maxHp; p.hope = 2; p.slow = 0; }
    this.ui.log('Reality stutters. A bored voice sighs: <i>"No, no, no — from the top. Corpses are SO last act."</i>', 'fear');
    this.startPhase(this.phase, { keepLog: true });
  }

  // ---------------- PHASE ROUTER ----------------
  async startPhase(n, { keepLog } = {}) {
    this.phase = n;
    for (const p of this.party) { p.blessingUsed = false; p.slow = 0; }
    if (!keepLog) this.ui.clearLog();

    if (n === 1) {
      this.inhabited = 0;
      this.party = [];
      const g = this.game;
      g.start(campMap(), { ...this.startOpts(), party: [], noSpawn: true });
      this.ui.logHeader('PHASE 1 — WAKING UP');
      for (const p of CAMP_INTRO) this.ui.log(esc(p));
      this.ui.log(`Four bodies lie in the dirt: ` +
        campMap().nodes.map(b => ref(b.id, b.name)).join('; ') + '.', 'narration');
      this.ui.setContext('You are spirits. Click a body to inhabit it.');
      this.ui.setBadge('SPIRITS ADRIFT', '');
    }

    if (n === 2) {
      this.game.start(pitMap(), this.startOpts());
      this.ui.logHeader('PHASE 2 — THE PIT');
      await this.ui.story({ title: 'The Rim of the Pit', paragraphs: PIT_INTRO });
      await this.ui.story({ title: 'The Archfey\'s Proclamation', paragraphs: PROCLAMATION });
      for (const p of PIT_INTRO) this.ui.log(esc(p));
      this.ui.log('Above the pit, ' + ref('archfey-2', 'the Archfey') + ' watches from his floating balcony: ' +
        '<i>"Might you want your freedom? Come and fight for it!"</i>', 'fear');
      this.ui.log(`Three roads from here: <b>descend the southern stairs</b> into the pit and fight for his amusement... ` +
        `or seek ${ref('hag', 'the hunched figure')} skulking by the crooked hut on the southwest rim.`, 'system');
      this.ui.setContext('Descend into the pit (Arena), or approach the figure by the hut (the Hag).');
    }

    if (n === 3) {
      this.cranksHeld = 0;
      this.cranksFound = 0;
      this.riddleIdx = 0;
      this.bramblesSpawned = 0;
      this.game.start(theaterMap(), this.startOpts());
      this.ui.logHeader('PHASE 3 — THE CONDUCTOR\'S STAGE');
      const mood = this.mood || 'entertained';
      const titles = {
        entertained: 'The Archfey — Entertained',
        insulted: 'The Archfey — Insulted',
        vengeful: 'The Archfey — Vengeful',
      };
      await this.ui.story({ title: titles[mood], paragraphs: OPENINGS[mood] });
      for (const p of OPENINGS[mood]) this.ui.log(esc(p), 'fear');
      this.ui.log(`${ref('archfey-3', 'The Archfey')} lounges behind a shimmering <b>starlight barrier</b> — no blade or spell will reach him. ` +
        `Four <b>spotlight pillars</b> stand dark around the stage. Find the <b>4 hidden crank handles</b>, light the pillars, ` +
        `and align the lights onto his throne.`, 'narration');

      if (this.knowsCranks) {
        this.ui.log(`You already know where the cranks are hidden: ` +
          `${ref('crank-piano', 'the Grand Piano')}, ${ref('crank-floorboard', 'the loose floorboard')}, ` +
          `${ref('crank-spectator', 'the weeping spectator')}, and ${ref('crank-trunk', 'the Prop Trunk')}.`, 'hope');
        CRANK_ORDER.forEach(id => this.grid.flash(id));
      } else {
        this.ui.log('He has promised the script "piece by piece" — <i>every time Fear takes the dice, he will recite a riddle.</i>', 'system');
      }

      if (mood !== 'entertained') {
        // Skip paths: the stage is hostile from the first heartbeat
        await new Promise(r => setTimeout(r, 400));
        this.game.enterCombatGroup(1,
          `Brambles burst from beneath the seats — and worse: ${ref('archfey-3', 'the Archfey')} flexes his fingers like a puppeteer. ` +
          `<i>His malice hunts you while you search.</i>`);
      } else {
        this.ui.setContext('Search the stage. Hover the log\'s blue words to spot objects. Fear rolls invite his meddling.');
      }
    }
  }

  // ---------------- HOOK: NODE INTERACTION ----------------
  async nodeInteract(node, hero) {
    if (!this.active) return false;

    // ---- Phase 1: bodies & the gate ----
    if (node.heroKey) {
      const fb = FLASHBACKS[node.heroKey];
      await this.ui.story({ title: '💀 ' + fb.title, paragraphs: fb.memories, button: 'Take the body' });
      const def = this.partyDefs.find(d => d.heroKey === node.heroKey);
      // Remove the body, stand the hero up in its place
      this.game.map.nodes = this.game.map.nodes.filter(x => x.id !== node.id);
      this.grid.rebuildNodes();
      const h = this.game.addHero({ ...def, spirit: 1, blessing: BLESSINGS[node.heroKey] }, node.x, node.y);
      this.party = this.game.heroes;
      this.inhabited++;
      this.ui.log(`The spirit sinks into the cold flesh — and <b>${esc(h.name)}, ${esc(h.class)}</b>, draws breath. ` +
        `One eye kindles with ${'<span class="ref">spirit light</span>'}. Blessing gained: <b>✦ ${esc(h.blessing.name)}</b>.`, 'hope');
      this.game.refreshHud();
      if (this.inhabited === this.partyDefs.length) {
        const gate = { id: 'gate', type: 'scripted', model: 'gate', x: CAMP_GATE.x, y: CAMP_GATE.y, name: 'a gap in the fog' };
        this.game.map.nodes.push(gate);
        this.grid.buildNode(gate);
        this.ui.logHeader('THE FOG PARTS');
        this.ui.log(`All four bodies walk again. At the northern edge of the camp, the fog peels back from ${ref('gate', 'a stone gate')} that was never there before.`, 'narration');
        this.ui.setContext('Walk the party to the gate and step through.');
      } else {
        this.ui.setContext(`${this.inhabited}/4 bodies inhabited. The rest still lie in the dirt.`);
      }
      return true;
    }

    if (node.id === 'gate' && this.phase === 1) {
      const go = await this.ui.askChoice({
        title: 'The Gate in the Fog',
        html: '<p>Cold air breathes through the arch. Whatever waits beyond, the camp is done with you.</p>',
        options: [
          { label: 'Step through', detail: 'Leave the camp behind.', value: true },
          { label: 'Not yet', value: false },
        ],
      });
      if (go) await this.startPhase(2);
      return true;
    }

    // ---- Phase 2: the Hag & the portal ----
    if (node.hagNode) { await this.hagEncounter(node, hero); return true; }

    if (node.id === 'portal') {
      const go = await this.ui.askChoice({
        title: 'The Backdoor',
        html: '<p>A slit of cold violet light hums in the air. Beyond it: rafters, dust, and the smell of an old theater.</p>',
        options: [
          { label: 'Step through the backdoor', detail: 'On to the final act.', value: true },
          { label: 'Linger', value: false },
        ],
      });
      if (go) await this.startPhase(3);
      return true;
    }

    // ---- Phase 3: cranks & pillars ----
    if (node.crank) { await this.crankInteract(node, hero); return true; }
    if (node.pillar) { await this.pillarInteract(node, hero); return true; }

    return false;
  }

  // ---------------- PHASE 2: THE HAG ----------------
  async hagEncounter(node, hero) {
    if (this.mood) { this.ui.log('Only a cold patch of shadow remains by the hut.', 'system'); return; }
    await this.ui.story({ title: 'The Shadow Hag', paragraphs: HAG_PITCH });
    for (const p of HAG_PITCH.slice(1)) this.ui.log(esc(p), 'fear');
    const choice = await this.ui.askChoice({
      title: 'The Hag\'s Bargain',
      html: '<p>Her too-long fingers flex. The white of her eyes is the white of deep frost.</p>',
      options: [
        { label: '🤝 Take the deal', detail: 'Trade your Spirit Blessings for a backdoor and the crank locations. Skip the arena. (The Archfey will be INSULTED.)', value: 'deal' },
        { label: '⚔ Attack her', detail: 'Fight the Shadow Hag for her Moon Staff. Hard fight — but you keep everything. (The Archfey will be VENGEFUL.)', value: 'fight' },
        { label: '↩ Walk away', detail: 'The pit and its arena remain. (Fight for his amusement.)', value: 'leave' },
      ],
    });

    if (choice === 'deal') {
      for (const h of this.game.heroes) { h.blessing = null; h.blessingUsed = false; }
      this.game.refreshHud();
      this.mood = 'insulted';
      this.knowsCranks = true;
      await this.ui.story({ title: 'The Deal Is Struck', paragraphs: HAG_DEAL_DONE });
      this.ui.logHeader('PATH CHOSEN — THE DEAL');
      this.ui.log('The spirit light dims in your eyes. <b>All Spirit Blessings are gone.</b>', 'fear');
      this.ui.log(esc(HAG_DEAL_DONE[1]), 'narration');
      this.spawnPortal(PIT_PORTAL_HUT.x, PIT_PORTAL_HUT.y);
      return;
    }

    if (choice === 'fight') {
      this.pendingFightPath = true;
      this.ui.logHeader('PATH CHOSEN — THE FIGHT');
      this.ui.log('"Naughty children," she hisses, unfolding to twice her height, "should be <b>punished</b>."', 'fear');
      const hag = makeEnemy(node.x, node.y, 2, 'shadowHag');
      this.game.map.enemies.push(hag);
      this.game.map.nodes = this.game.map.nodes.filter(x => x.id !== node.id);
      this.grid.rebuildNodes();
      this.grid.buildEnemyToken(hag);
      await this.game.enterCombatGroup(2,
        `${ref(hag.id, 'The Shadow Hag')} rakes the air with too many fingers. ` +
        `<i>She feeds on nightmares at range and knits her own wounds — close the distance fast.</i>`);
      return;
    }

    this.ui.log('You back away from the hut. Her chuckle follows you like smoke.', 'system');
  }

  spawnPortal(x, y) {
    const portal = { id: 'portal', type: 'scripted', model: 'gate', x, y, name: 'the backdoor portal' };
    this.game.map.nodes.push(portal);
    this.grid.buildNode(portal);
    this.grid.flash('portal');
    this.ui.log(`${ref('portal', 'A backdoor portal')} tears open near the hut. The way to the final act stands ready.`, 'hope');
    this.ui.setContext('Step the party through the portal when ready.');
  }

  // ---------------- HOOK: COMBAT END ----------------
  async combatEnd(group) {
    if (!this.active) return;

    if (this.phase === 2 && group === 1 && !this.mood) {
      // Arena cleared — Path 1
      this.mood = 'entertained';
      this.ui.logHeader('PATH CHOSEN — THE ARENA');
      this.ui.log(`Above you, ${ref('archfey-2', 'the Archfey')} applauds slowly, genuinely delighted. ` +
        `<i>"Oh, BRAVO, little ghosts."</i> The thorned vines loosen a fraction on a hundred weeping faces.`, 'hope');
      this.spawnPortal(PIT_PORTAL_ARENA.x, PIT_PORTAL_ARENA.y);
      return;
    }

    if (this.phase === 2 && group === 2) {
      // Hag slain — Path 3
      this.mood = 'vengeful';
      this.knowsCranks = true;
      for (const h of this.game.heroes) h.weapon = { ...h.weapon, dmg: h.weapon.dmg + 1 };
      await this.ui.story({ title: 'The Moon Staff', paragraphs: HAG_FIGHT_WIN });
      this.ui.logHeader('THE MOON STAFF');
      this.ui.log('Her splintered staff hums with stolen moonlight. <b>+1 damage to every hero\'s weapon.</b>', 'hope');
      this.game.refreshHud();
      this.spawnPortal(2, 11);
      return;
    }

    if (this.phase === 3) {
      this.ui.log('The stage falls quiet — but the Archfey\'s smile never wavers. <i>"Intermission. Do continue searching."</i>', 'system');
    }
  }

  // ---------------- PHASE 3: CRANKS ----------------
  async crankInteract(node, hero) {
    if (!hero) return;
    if (Math.abs(hero.x - node.x) + Math.abs(hero.y - node.y) > 1) {
      this.ui.log(`${esc(hero.name)} is too far from ${ref(node.id, node.name)}.`, 'system');
      this.grid.flash(node.id);
      return;
    }
    if (node.found) { this.ui.log(`${ref(node.id, node.name)} has already given up its secret.`, 'system'); return; }
    if (this.game.mode === 'combat' && this.game.tokens <= 0) return;

    const res = await this.game.actionRoll({
      hero, trait: node.trait, dc: node.dc,
      title: `Search ${node.name} — ${node.trait} DC ${node.dc}`,
      flavor: this.knowsCranks
        ? 'You know a crank handle is hidden here. You just have to get it out.'
        : 'Something might be hidden here — the Archfey\'s riddles seem to point this way.',
    });
    if (!res) return;
    if (this.game.mode === 'combat') { this.game.tokens--; this.game.refreshHud(); }

    if (res.success) {
      node.found = true;
      this.cranksFound++;
      this.cranksHeld++;
      this.ui.log(`${ref(node.id, node.name)} — ${esc(node.foundText)}`, 'success');
      this.ui.log(`<b>Crank handle secured!</b> (${this.cranksFound}/4 found, ${this.cranksHeld} in hand) — fit it into a dark ${ref('pillar-1', 'spotlight pillar')}.`, 'hope');
    } else if (res.withFear) {
      this.ui.log(`The hiding place bites back — thorned vines whip out of the dark!`, 'fear');
      await this.game.damageHero(hero, 2, 'Hidden thorns');
    } else {
      this.ui.log(`Nothing yields — yet. The hiding spot can be tried again.`, 'system');
    }

    if (this.game.mode === 'combat') {
      if (res.withFear) return this.game.enemyPhase('Rolled with Fear — the stage strikes back.');
      if (this.game.tokens <= 0) return this.game.enemyPhase('The party is spent.');
    }
  }

  litCount() { return this.game.map.nodes.filter(n => n.pillar && n.lit).length; }

  async pillarInteract(node, hero) {
    if (!hero) return;
    if (Math.abs(hero.x - node.x) + Math.abs(hero.y - node.y) > 1) {
      this.ui.log(`${esc(hero.name)} is too far from the ${ref(node.id, 'spotlight pillar')}.`, 'system');
      this.grid.flash(node.id);
      return;
    }

    if (!node.inserted) {
      if (this.cranksHeld <= 0) {
        this.ui.log(`The pillar\'s crank socket is <b>empty</b>. Find a crank handle first.`, 'system');
        return;
      }
      this.cranksHeld--;
      node.inserted = true;
      node.lit = true;
      this.grid.setPillarLit(node, true);
      this.ui.log(`${esc(hero.name)} slots a crank into the ${ref(node.id, 'pillar')} and winds hard — the spotlight <b>blazes to life</b>. (${this.litCount()}/4 lit)`, 'success');
    } else if (!node.lit) {
      node.lit = true;
      this.grid.setPillarLit(node, true);
      this.ui.log(`${esc(hero.name)} re-cranks the sabotaged ${ref(node.id, 'pillar')}. The beam snaps back on. (${this.litCount()}/4 lit)`, 'success');
    } else if (this.litCount() < 4) {
      this.ui.log(`This pillar already burns. ${4 - this.litCount()} more remain dark.`, 'system');
      return;
    }

    if (this.litCount() === 4) await this.alignRoll(hero);
  }

  async alignRoll(hero) {
    const k = hero.traits.Knowledge ?? 0, f = hero.traits.Finesse ?? 0;
    const trait = k >= f ? 'Knowledge' : 'Finesse';
    this.ui.logHeader('THE FOUR LIGHTS');
    this.ui.log('All four spotlights burn. The beams swing wild — they must be <b>aligned onto the throne</b>.', 'narration');
    const res = await this.game.actionRoll({
      hero, trait, dc: 13,
      title: `Align the spotlights — ${trait} DC 13`,
      flavor: 'Mirrors, angles, timing. One clean pass and every light lands on the Grand Conductor at once.',
    });
    if (!res) return;
    if (res.success) return this.finale();
    this.ui.log('The beams cross, scatter, miss — and somewhere above, slow mocking applause. <i>Re-align them (click any lit pillar).</i>', 'fear');
  }

  // ---------------- THE ARCHFEY ACTS (takeover / riddles / sabotage) ----------------
  async archfeyActs() {
    if (this.phase !== 3 || this.ended) return;
    const g = this.game;
    const alive = g.heroes.filter(h => h.hp > 0);
    if (!alive.length) return;
    this.ui.logHeader('THE ARCHFEY ACTS');

    // Arena path: a riddle for each crank still hidden
    if (this.mood === 'entertained' && !this.knowsCranks) {
      const hidden = CRANK_ORDER.filter(id => !g.map.nodes.find(n => n.id === id)?.found);
      if (hidden.length) {
        const id = hidden[this.riddleIdx % hidden.length];
        this.riddleIdx++;
        this.ui.log(`${ref('archfey-3', 'The Archfey')} drawls a riddle from his throne: ${esc(RIDDLES[id])}`, 'fear');
      }
    }

    const victim = alive[Math.floor(Math.random() * alive.length)];

    if (this.mood === 'entertained') {
      // Sabotage: puppet a hero into cranking a lit pillar backward
      const lit = g.map.nodes.filter(n => n.pillar && n.lit);
      if (lit.length) {
        const p = lit[Math.floor(Math.random() * lit.length)];
        p.lit = false;
        this.grid.setPillarLit(p, false);
        this.grid.flash(victim.id);
        this.ui.log(`<b>TAKEOVER!</b> ${esc(victim.name)}'s eye flashes iridescent — their legs carry them, screaming inside, ` +
          `to the ${ref(p.id, 'spotlight pillar')}, and their own hands crank the light <b>back off</b>. (${this.litCount()}/4 lit)`, 'fear');
      }
    } else {
      // Punishment: puppet a hero into striking an ally
      const others = alive.filter(h => h !== victim);
      if (others.length) {
        others.sort((a, b) => (Math.abs(a.x - victim.x) + Math.abs(a.y - victim.y)) - (Math.abs(b.x - victim.x) + Math.abs(b.y - victim.y)));
        const target = others[0];
        this.grid.flash(victim.id);
        this.ui.log(`<b>TAKEOVER!</b> Starlight floods ${esc(victim.name)}'s eyes — and their ${esc(victim.weapon.name)} ` +
          `swings at <b>${esc(target.name)}</b> while the Archfey giggles.`, 'fear');
        await this.grid.bumpAttack(victim.id, target.x, target.y);
        await this.game.damageHero(target, Math.max(1, victim.weapon.dmg - 1), `${victim.name} (puppeted)`);
      }
      // Reinforcements crawl from beneath the seats
      if (this.game.mode === 'combat' && this.bramblesSpawned < 4) {
        const [x, y] = THEATER_REINFORCE[this.bramblesSpawned % THEATER_REINFORCE.length];
        const b = makeEnemy(x, y, 1, 'bramble');
        this.game.map.enemies.push(b);
        this.grid.buildEnemyToken(b);
        this.bramblesSpawned++;
        this.ui.log(`Another ${ref(b.id, 'tangle bramble')} tears itself free of the seating vines.`, 'fear');
      }
    }
  }

  async fearRoll() {
    if (this.phase === 3) return this.archfeyActs();
    if (this.phase === 2 && !this.mood) {
      this.ui.log('Above the pit, the Archfey leans forward a fraction. <i>"Oh, do that again."</i>', 'fear');
    }
  }

  async enemyPhaseStart() {
    if (this.phase === 3) return this.archfeyActs();
  }

  // ---------------- HOOK: MOVEMENT (fog loop) ----------------
  async heroMoved(h) {
    if (this.phase !== 1) return;
    const m = this.game.map;
    // The fog wall is two tiles thick — stepping into it loops you to the far side
    if (h.x <= 1 || h.y <= 1 || h.x >= m.w - 2 || h.y >= m.h - 2) {
      // Stepping near the gate doesn't loop
      const gate = m.nodes.find(n => n.id === 'gate');
      if (gate && Math.abs(h.x - gate.x) + Math.abs(h.y - gate.y) <= 1) return;
      h.x = Math.min(Math.max(m.w - 1 - h.x, 2), m.w - 3);
      h.y = Math.min(Math.max(m.h - 1 - h.y, 2), m.h - 3);
      const g = this.grid.heroTokens.get(h.id);
      if (g) this.grid.placeToken(g, h.x, h.y);
      this.ui.log(esc(FOG_LOOP_LINES[Math.floor(Math.random() * FOG_LOOP_LINES.length)]), 'fear');
    }
  }

  // ---------------- FINALE ----------------
  async finale() {
    this.ended = true;
    const mood = this.mood || 'entertained';
    this.ui.logHeader('THE SCRIPT CRACKS');
    this.ui.log('Four beams slam onto the throne at once. The starlight barrier rings like struck glass — ' +
      `and shatters into a snow of dying sparks. ${ref('archfey-3', 'The Archfey')} looks down at his own hands, ` +
      'and laughs — freely, for the first time.', 'success');
    await this.ui.story({
      title: { entertained: 'Ending — The Arena', insulted: 'Ending — The Deal', vengeful: 'Ending — The Fight' }[mood],
      paragraphs: ENDINGS[mood],
    });
    for (const p of ENDINGS[mood]) this.ui.log(esc(p), 'hope');
    await this.ui.story({ title: 'Outro', paragraphs: OUTRO, button: 'Fade to black' });
    for (const p of OUTRO) this.ui.log(esc(p), 'narration');
    this.ui.showEnd(true,
      'End of the one-shot. The town below the ridge waits — and someone there is already looking for you.',
      () => this.exit());
  }
}
