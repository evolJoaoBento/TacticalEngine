// ============ GAME LOGIC ============
// Exploration + tactical combat using the Daggerheart duality-dice adaptation.
// Core roll: Hope d12 + Fear d12 + trait modifier vs Difficulty.
// Any roll "with Fear" during combat hands the initiative to the enemies.

import { HERO_DEFS } from './data.js';
import { findReachable, tracePath, smoothPath } from './grid.js';
import { ref, esc } from './ui.js';
import { DECO_INFO } from './models.js';

const ITEMS = ['a pouch of silver teeth', 'a vial of moonlit ichor', 'an opal signet ring',
  'a bundle of dry torches', 'a silvered dagger', 'a map fragment inked in blood'];

export class Game {
  constructor(sm, grid, dice, ui) {
    this.sm = sm; this.grid = grid; this.dice = dice; this.ui = ui;
    this.mode = 'idle';      // explore | combat
    this.busy = false;
    this.fear = 0;
    this.heroes = [];
    this.selected = null;
    this.activeGroup = null; // encounter group in combat
    this.tokens = 0;
    this.running = false;
  }

  // ---------- lifecycle ----------
  // opts: { party, noSpawn, hooks, onRestart, quietIntro }
  start(map, opts = {}) {
    this.sourceJson = JSON.stringify(map);
    this.opts = opts;
    this.hooks = opts.hooks || {};
    this.map = map;
    this.grid.build(map);
    this.grid.rebuildMarkers(false);
    this.sm.focusMap(map.w, map.h);

    this.fear = 0;
    this.mode = 'explore';
    this.busy = false;
    this.running = true;
    this.activeGroup = null;
    this.tokens = 0;
    // Party-wide keys & story flags — persist across scene transitions when the
    // runner passes the same sets back in (user campaigns).
    this.keys = opts.keys || new Set();
    this.flags = opts.flags || new Set();

    // Enemy tokens (dormant until a trigger fires)
    for (const e of map.enemies) if (e.hp > 0) this.grid.buildEnemyToken(e);

    // Spawn party (campaign may defer spawning — spirits inhabit bodies later)
    const defs = opts.party || HERO_DEFS;
    this.heroes = [];
    this.selected = null;
    if (!opts.noSpawn) {
      defs.forEach((d, i) => {
        const s = map.spawns[i % map.spawns.length] || [1, 1];
        this.addHero(d, s[0], s[1], { quiet: true });
      });
      if (this.heroes.length) this.selected = this.heroes[0].id;
    }

    if (!opts.quietIntro) {
      this.ui.clearLog();
      this.ui.logHeader(map.name.toUpperCase());
      this.ui.log(this.introHtml(map), 'narration');
      this.ui.setContext('Click a hero to select. Click a tile to move. Right-click anything to inspect it.');
    }
    this.ui.setBadge('EXPLORATION', '');
    this.refreshHud();
  }

  // Add a hero mid-scene (used by the campaign when a spirit takes a body).
  addHero(def, x, y, { quiet } = {}) {
    const h = {
      ...def,
      traits: { ...def.traits },
      // Carried-over heroes keep their wounds; the fallen are revived on a restart
      hp: def.hp !== undefined && def.hp > 0 ? def.hp : def.maxHp,
      hope: def.hope !== undefined ? def.hope : 2,
      slow: 0,
      x, y,
    };
    this.heroes.push(h);
    this.grid.buildHeroToken(h);
    if (!this.selected) this.selected = h.id;
    if (!quiet) this.refreshHud();
    return h;
  }

  restart() {
    if (this.opts?.onRestart) return this.opts.onRestart();
    this.start(JSON.parse(this.sourceJson), this.opts);
  }

  stop() {
    this.running = false;
    this.mode = 'idle';
    this.grid.clearReachable();
  }

  introHtml(map) {
    let html = esc(map.intro || '');
    // Weave node references into the intro so hover-flash works from line one
    if (map.nodes.length) {
      const bits = map.nodes.map(n => ref(n.id, n.name.toLowerCase()));
      html += ` You make out ${bits.join(', ')}${map.enemies.length ? ', and unmoving silhouettes deeper in' : ''}.`;
    }
    return html;
  }

  refreshHud() {
    this.ui.renderParty(this.heroes, this.selected, id => this.selectHero(id), id => this.useBlessing(id));
    this.ui.renderFear(this.fear);
    this.ui.renderTokens(this.tokens, this.maxTokens(), this.mode === 'combat');
  }

  maxTokens() { return this.heroes.filter(h => h.hp > 0).length + 1; }

  hero(id) { return this.heroes.find(h => h.id === id); }
  enemy(id) { return this.map.enemies.find(e => e.id === id); }
  selectedHero() { return this.hero(this.selected); }

  // ---------- occupancy ----------
  occupiedSet(exceptId) {
    const s = new Set();
    for (const h of this.heroes) if (h.hp > 0 && h.id !== exceptId) s.add(h.x + ',' + h.y);
    for (const e of this.map.enemies) if (e.hp > 0 && e.id !== exceptId) s.add(e.x + ',' + e.y);
    return s;
  }
  // Exploration variant: allies don't block each other — the party flows as a group.
  occupiedByEnemies() {
    const s = new Set();
    for (const e of this.map.enemies) if (e.hp > 0) s.add(e.x + ',' + e.y);
    return s;
  }
  blockedNodeSet() {
    const s = new Set();
    for (const n of this.map.nodes) {
      if (n.type === 'door' && n.open) continue;
      s.add(n.x + ',' + n.y);
    }
    return s;
  }

  // ---------- selection / movement ----------
  selectHero(id) {
    const h = this.hero(id);
    if (!h || h.hp <= 0) return;
    this.selected = id;
    this.refreshHud();
    this.showMoveRange();
    this.ui.setContext(`${h.name} selected — ${h.weapon.name} (range ${h.weapon.range}, ${h.weapon.trait}).`);
  }

  effectiveSpeed(h) { return Math.max(1, h.speed - (h.slow || 0)); }

  showMoveRange() {
    const h = this.selectedHero();
    if (!h || this.mode === 'idle') { this.grid.clearReachable(); return; }
    const budget = this.mode === 'combat' ? this.effectiveSpeed(h) : h.speed + 4;
    const occ = this.mode === 'combat' ? this.occupiedSet(h.id) : this.occupiedByEnemies();
    const reach = findReachable(this.grid, h, budget, occ, this.blockedNodeSet());
    const cells = [...reach.cost.keys()].map(k => {
      const [x, y] = k.split(',').map(Number); return { x, y };
    });
    this.grid.showReachable(cells, this.mode === 'combat' ? '#5fb0ff' : '#f6c453');
  }

  async moveHero(dest) {
    const h = this.selectedHero();
    if (!h) return;
    if (this.mode === 'combat' && this.tokens <= 0) return;

    const budget = this.mode === 'combat' ? this.effectiveSpeed(h) : h.speed + 4;
    const occ = this.mode === 'combat' ? this.occupiedSet(h.id) : this.occupiedByEnemies();
    const reach = findReachable(this.grid, h, budget, occ, this.blockedNodeSet());
    let path = tracePath(reach, h, dest);
    if (!path || path.length < 2) {
      this.ui.setContext('Out of reach.');
      return;
    }

    // Combat triggers can interrupt the move mid-path
    let triggered = null;
    if (this.mode === 'explore') {
      for (let i = 1; i < path.length; i++) {
        triggered = this.triggerAt(path[i].x, path[i].y);
        if (triggered) { path = path.slice(0, i + 1); break; }
      }
    }

    this.busy = true;
    this.grid.clearReachable();
    await this.grid.hopAlong(h.id, smoothPath(this.grid, path, this.blockedNodeSet(), occ));
    const end = path[path.length - 1];
    h.x = end.x; h.y = end.y;
    this.busy = false;

    if (this.mode === 'combat') {
      this.tokens--;
      this.refreshHud();
      if (this.tokens <= 0) return this.enemyPhase('The party is spent.');
    }

    if (triggered) return this.enterCombat(triggered);
    // Out of combat the rest of the party follows the leader
    if (this.mode === 'explore') await this.followParty(h, path);
    // Campaign hook: fog loops, zone scripts, scene transitions
    if (this.hooks.onHeroMoved) await this.hooks.onHeroMoved(h);
    this.showMoveRange();
  }

  // ---------- party follow (exploration only) ----------
  // Followers trail the leader along the cells it just vacated (conga line).
  // They never step into untriggered combat zones — they stop short instead.
  async followParty(leader, leaderPath) {
    const followers = this.heroes.filter(x => x.hp > 0 && x.id !== leader.id);
    if (!followers.length || leaderPath.length < 2) return;

    // Closest follower claims the nearest trail slot
    const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    followers.sort((a, b) => dist(a, leader) - dist(b, leader));

    const taken = new Set([leader.x + ',' + leader.y]);
    const blocked = this.blockedNodeSet();
    const enemies = this.occupiedByEnemies();
    const moves = [];
    let trailIdx = leaderPath.length - 2;

    for (const f of followers) {
      // Preferred target: first free cell walking the trail backwards from the leader
      let target = null;
      for (let i = Math.min(trailIdx, leaderPath.length - 2); i >= 0 && !target; i--) {
        const c = leaderPath[i];
        if (!taken.has(c.x + ',' + c.y)) target = c;
      }
      trailIdx--;

      const occ = new Set([...enemies, ...taken]);
      const reach = findReachable(this.grid, f, 60, occ, blocked);

      // Fallback: any free reachable cell within 2 tiles of the leader
      let path = target ? tracePath(reach, f, target) : null;
      if (!path) {
        let best = null, bestCost = Infinity;
        for (const k of reach.cost.keys()) {
          const [x, y] = k.split(',').map(Number);
          if (taken.has(k)) continue;
          const d = Math.abs(x - leader.x) + Math.abs(y - leader.y);
          if (d >= 1 && d <= 2 && reach.cost.get(k) < bestCost) { best = { x, y }; bestCost = reach.cost.get(k); }
        }
        if (best) path = tracePath(reach, f, best);
      }
      if (!path || path.length < 2) { taken.add(f.x + ',' + f.y); continue; } // stuck or already in place

      // Never drag a follower into a combat trigger — stop just before it
      for (let i = 1; i < path.length; i++) {
        if (this.triggerAt(path[i].x, path[i].y)) { path = path.slice(0, i); break; }
      }
      if (path.length < 2) { taken.add(f.x + ',' + f.y); continue; }

      const end = path[path.length - 1];
      taken.add(end.x + ',' + end.y);
      moves.push({ f, path, end });
    }

    if (!moves.length) return;
    this.busy = true;
    await Promise.all(moves.map(async m => {
      await this.grid.hopAlong(m.f.id, smoothPath(this.grid, m.path, blocked, enemies));
      m.f.x = m.end.x; m.f.y = m.end.y;
    }));
    this.busy = false;
  }

  triggerAt(x, y) {
    return this.map.triggers.find(t =>
      !t.fired && t.cells.some(([cx, cy]) => cx === x && cy === y) &&
      this.map.enemies.some(e => e.group === t.group && e.hp > 0)
    ) || null;
  }

  // ---------- the duality roll ----------
  // Returns null if cancelled, else outcome record. Handles Hope/Fear bookkeeping.
  async actionRoll({ hero, trait, dc, title, flavor, bonus = 0 }) {
    const baseMod = (hero.traits[trait] ?? 0) + bonus;
    const ans = await this.ui.askRoll({
      title, flavor, trait, mod: baseMod, dc, canSpendHope: hero.hope > 0,
    });
    if (!ans.go) return null;

    let mod = baseMod;
    if (ans.spendHope) { hero.hope--; mod += 2; this.refreshHud(); }

    this.busy = true;
    const { hope, fear } = await this.dice.roll();
    const total = hope + fear + mod;
    const crit = hope === fear;
    const success = crit || total >= dc;
    const withHope = hope > fear;
    const category = crit ? 'crit'
      : success ? (withHope ? 'hopeSuccess' : 'fearSuccess')
      : (withHope ? 'hopeFail' : 'fearFail');

    // Resource bookkeeping
    if (crit) { hero.hope = Math.min(hero.hope + 1, 6); }
    else if (withHope) { hero.hope = Math.min(hero.hope + 1, 6); }
    else { this.fear = Math.min(this.fear + 1, 12); }

    const labels = {
      crit: ['CRITICAL SUCCESS!', 'hope'],
      hopeSuccess: ['SUCCESS with HOPE', 'hope'],
      fearSuccess: ['SUCCESS with FEAR', 'fear'],
      hopeFail: ['FAILURE with HOPE', 'hope'],
      fearFail: ['FAILURE with FEAR', 'fear'],
    };
    const [label, cls] = labels[category];
    this.dice.showResult(
      `${label}<span class="sub">${hope} + ${fear} ${mod >= 0 ? '+ ' + mod : '− ' + (-mod)} = ${total} vs DC ${dc}</span>`,
      cls);

    this.ui.log(
      `<b>${esc(hero.name)}</b> — ${esc(title)}: <b>${label}</b><br>` +
      this.ui.rollDetail({ hope, fear, mod, total, dc }),
      cls);

    if (crit) this.ui.log(`${esc(hero.name)} gains 1 Hope, and momentum surges.`, 'hope');
    else if (withHope) this.ui.log(`${esc(hero.name)} gains 1 Hope.`, 'hope');
    else this.ui.log(`The GM gains 1 Fear...`, 'fear');

    this.refreshHud();
    // Pause so the player reads the dice before the world reacts
    await new Promise(r => setTimeout(r, 1100));
    this.busy = false;

    const result = { category, crit, success, withHope, withFear: !withHope && !crit, hope, fear, mod, total, dc };
    // Campaign hook: out-of-combat Fear consequences (the Archfey is listening)
    if (result.withFear && this.mode !== 'combat' && this.hooks.onFearRoll) {
      await this.hooks.onFearRoll(result);
    }
    return result;
  }

  // ---------- node interaction ----------
  async interactNode(node) {
    const h = this.selectedHero();
    // Scripted nodes (campaign) get first refusal — before adjacency checks,
    // since spirits and scene scripts have their own rules.
    if (this.hooks.onNodeInteract && await this.hooks.onNodeInteract(node, h)) return;
    if (!h) return;
    if (!node.outcomes && node.goto == null) return; // model-only scenery node
    if (Math.abs(h.x - node.x) + Math.abs(h.y - node.y) > 1) {
      this.ui.log(`${esc(h.name)} is too far from ${ref(node.id, node.name)}.`, 'system');
      this.grid.flash(node.id);
      return;
    }

    // Key requirement gates everything — travel and checks alike
    if (node.requireKey && !this.keys.has(node.requireKey)) {
      this.ui.log(`${ref(node.id, node.name)} — ` +
        esc(node.lockedText || `It will not yield. You need: ${node.requireKey}.`), 'fear');
      this.grid.flash(node.id);
      return;
    }

    // Travel node (campaign scene transition) — no roll, just a choice
    if (node.goto != null && node.goto !== '') {
      if (!this.opts.onGoto) {
        this.ui.log(`${ref(node.id, node.name)} hums, but leads nowhere from here.`, 'system');
        return;
      }
      const go = await this.ui.askChoice({
        title: node.name,
        html: `<p>${esc(node.flavor || 'Step through?')}</p>`,
        options: [
          { label: 'Travel onward', detail: 'The party moves together.', value: true },
          { label: 'Stay', value: false },
        ],
      });
      if (go) this.opts.onGoto(node.goto);
      return;
    }

    if (node.used) {
      this.ui.log(`${ref(node.id, node.name)} has given all it has.`, 'system');
      return;
    }
    if (this.mode === 'combat' && this.tokens <= 0) return;

    const result = await this.actionRoll({
      hero: h, trait: node.trait, dc: node.dc,
      title: `${node.name} — ${node.trait} DC ${node.dc}`,
      flavor: node.flavor,
    });
    if (!result) return;

    if (this.mode === 'combat') { this.tokens--; this.refreshHud(); }

    const key = result.category === 'crit' ? 'hopeSuccess' : result.category;
    const outcome = node.outcomes[key];
    this.ui.log(`${ref(node.id, node.name)} — ${esc(outcome.text)}`, result.withHope || result.crit ? 'narration' : 'fear');
    const mapBefore = this.map;
    await this.applyEffect(node, h, outcome, result);
    if (this.map !== mapBefore) return; // a goto effect changed scenes mid-flow

    if (this.mode === 'combat') {
      if (result.withFear) return this.enemyPhase('Your moment of weakness invites them in.');
      if (this.tokens <= 0) return this.enemyPhase('The party is spent.');
    }
    this.refreshHud();
  }

  async applyEffect(node, hero, outcome, result) {
    const effect = typeof outcome === 'string' ? outcome : outcome.effect;
    const param = typeof outcome === 'string' ? '' : (outcome.param || '');
    switch (effect) {
      case 'giveKey':
        if (param && !this.keys.has(param)) {
          this.keys.add(param);
          this.ui.log(`The party obtains <b>🗝 ${esc(param)}</b>.`, 'hope');
        }
        node.used = true;
        break;
      case 'setFlag':
        if (param) this.flags.add(param);
        node.used = true;
        break;
      case 'spawnGroup': {
        node.used = true;
        const grp = parseInt(param) || 1;
        if (this.mode !== 'combat' && this.map.enemies.some(e => e.group === grp && e.hp > 0)) {
          await new Promise(r => setTimeout(r, 300));
          await this.enterCombatGroup(grp);
        }
        break;
      }
      case 'goto':
        node.used = true;
        if (param && this.opts.onGoto) this.opts.onGoto(param);
        else this.ui.log('The way shimmers... but leads nowhere from here.', 'system');
        return;
      case 'open':
        node.open = true; node.used = true;
        await this.grid.animateNodeOpen(node);
        this.showMoveRange();
        break;
      case 'loot': {
        node.open = true; node.used = true;
        await this.grid.animateNodeOpen(node);
        hero.hope = Math.min(hero.hope + 1, 6);
        const item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
        this.ui.log(`${esc(hero.name)} finds <b>${esc(item)}</b>. (+1 Hope)`, 'hope');
        break;
      }
      case 'damage':
        await this.damageHero(hero, 2, node.name);
        break;
      case 'removeNode':
        node.used = true;
        await this.grid.animateNodeDestroy(node);
        this.map.nodes = this.map.nodes.filter(n => n.id !== node.id);
        this.showMoveRange();
        break;
    }
    this.refreshHud();
  }

  // ---------- combat ----------
  async enterCombat(trigger) {
    trigger.fired = true;
    return this.enterCombatGroup(trigger.group);
  }

  async enterCombatGroup(group, introHtml) {
    this.mode = 'combat';
    this.activeGroup = group;
    this.tokens = this.maxTokens();
    this.ui.setBadge('⚔ COMBAT', 'combat');
    this.ui.logHeader('COMBAT BEGINS');
    const foes = this.activeEnemies();
    this.ui.log(introHtml ||
      `The silhouettes lurch into motion — ${foes.map(e => ref(e.id, e.name)).join(', ')} ` +
      `turn hollow eyes toward the party. <i>Spend action tokens freely; roll with Fear and the enemy seizes the moment.</i>`,
      'combat');
    this.refreshHud();
    this.showMoveRange();
    this.ui.setContext('COMBAT — move (1 token), attack (1 token). Fear rolls hand the turn to the enemy.');
  }

  activeEnemies() {
    return this.map.enemies.filter(e => e.group === this.activeGroup && e.hp > 0);
  }

  async attack(targetId) {
    const h = this.selectedHero();
    const e = this.enemy(targetId);
    if (!h || !e || e.hp <= 0) return;
    if (this.mode !== 'combat') {
      this.ui.log(`${ref(e.id, e.name)} stands eerily still. Not yet hostile — not yet.`, 'system');
      this.grid.flash(e.id);
      return;
    }
    if (this.tokens <= 0) return;
    const dist = Math.abs(h.x - e.x) + Math.abs(h.y - e.y);
    if (dist > h.weapon.range) {
      this.ui.setContext(`Out of range — ${h.weapon.name} reaches ${h.weapon.range}.`);
      return;
    }

    // High ground: +1 when striking from above
    const hBonus = (this.grid.tile(h.x, h.y).h > this.grid.tile(e.x, e.y).h) ? 1 : 0;
    // Cover: defender on cover tile is harder to hit
    const coverPenalty = this.grid.tile(e.x, e.y).prop === 'cover' ? 2 : 0;

    const result = await this.actionRoll({
      hero: h, trait: h.weapon.trait, dc: e.difficulty + coverPenalty, bonus: hBonus,
      title: `Attack ${e.name} — ${h.weapon.name}`,
      flavor: hBonus ? 'You hold the high ground.' : (coverPenalty ? 'Your target hugs the cover.' : ''),
    });
    if (!result) return;

    this.tokens--;
    await this.grid.bumpAttack(h.id, e.x, e.y);

    if (result.success) {
      let dmg = h.weapon.dmg + (result.withHope || result.crit ? 1 : 0);
      if (result.crit) dmg += h.weapon.dmg; // crit: double-ish
      e.hp -= dmg;
      this.ui.log(`${esc(h.name)}'s ${esc(h.weapon.name)} hits ${ref(e.id, e.name)} for <b>${dmg}</b> damage.` +
        (e.hp <= 0 ? ' It collapses into dust and splinters.' : ` (${Math.max(e.hp, 0)} HP left)`),
        e.hp <= 0 ? 'success' : 'combat');
      if (e.hp <= 0) await this.grid.deathAnim(e.id);
    } else {
      this.ui.log(`${esc(h.name)} misses ${ref(e.id, e.name)}.`, 'combat');
    }
    this.refreshHud();

    if (this.activeEnemies().length === 0) return this.endCombat();
    if (result.withFear) return this.enemyPhase('Rolled with Fear — the hollow things surge.');
    if (this.tokens <= 0) return this.enemyPhase('The party is spent.');
    this.showMoveRange();
  }

  async enemyPhase(reason) {
    this.busy = true;
    this.grid.clearReachable();
    this.ui.logHeader('ENEMY PHASE');
    this.ui.log(esc(reason), 'fear');
    this.ui.setContext('The enemy moves...');
    await new Promise(r => setTimeout(r, 500));

    // Campaign hook: Archfey takeovers, riddles, reinforcements
    if (this.hooks.onEnemyPhaseStart) await this.hooks.onEnemyPhaseStart();
    if (this.mode !== 'combat') { this.busy = false; return; } // hook may end the fight

    // GM spends Fear for a surge: +2 to every attack this phase
    let surge = 0;
    if (this.fear >= 4) {
      this.fear -= 4;
      surge = 2;
      this.ui.log('The GM spends <b>4 Fear</b> — a cold surge sharpens every hollow claw (+2 to enemy attacks).', 'fear');
      this.refreshHud();
    }

    for (const e of this.activeEnemies()) {
      const alive = this.heroes.filter(h => h.hp > 0);
      if (!alive.length) break;

      if (e.frozen) {
        e.frozen = false;
        this.ui.log(`${ref(e.id, e.name)} strains against hoarfrost shackles — and cannot act.`, 'system');
        continue;
      }

      // Waking Nightmare: the Hag feeds on Hope at range
      if (e.special === 'nightmare' && Math.random() < 0.5) {
        const victims = alive.filter(h => Math.abs(h.x - e.x) + Math.abs(h.y - e.y) <= 5 && h.hope > 0);
        if (victims.length) {
          for (const v of victims) v.hope = Math.max(0, v.hope - 1);
          e.hp = Math.min(e.hp + 1, e.maxHp);
          this.ui.log(`${ref(e.id, e.name)} spreads a <b>Waking Nightmare</b> — ` +
            `${victims.map(v => esc(v.name)).join(', ')} relive childhood terrors and lose 1 Hope. The Hag knits her wounds.`, 'fear');
          this.refreshHud();
          await new Promise(r => setTimeout(r, 350));
          continue;
        }
      }

      // Nearest hero by manhattan distance
      alive.sort((a, b) =>
        (Math.abs(a.x - e.x) + Math.abs(a.y - e.y)) - (Math.abs(b.x - e.x) + Math.abs(b.y - e.y)));
      const target = alive[0];
      const atkRange = e.range || 1;

      // Move toward target until within range
      let dist = Math.abs(target.x - e.x) + Math.abs(target.y - e.y);
      if (dist > atkRange) {
        const reach = findReachable(this.grid, e, e.speed, this.occupiedSet(e.id), this.blockedNodeSet());
        let best = null, bestD = dist;
        for (const k of reach.cost.keys()) {
          const [x, y] = k.split(',').map(Number);
          const d = Math.abs(target.x - x) + Math.abs(target.y - y);
          if (d < bestD || (d === bestD && best && reach.cost.get(k) < reach.cost.get(best.x + ',' + best.y))) {
            bestD = d; best = { x, y };
          }
        }
        if (best) {
          const path = tracePath(reach, e, best);
          if (path) {
            await this.grid.hopAlong(e.id, smoothPath(this.grid, path, this.blockedNodeSet(), this.occupiedSet(e.id)));
            e.x = best.x; e.y = best.y;
          }
        }
        dist = Math.abs(target.x - e.x) + Math.abs(target.y - e.y);
      }

      // Attack if in range
      if (dist <= atkRange && target.hp > 0) {
        await this.grid.bumpAttack(e.id, target.x, target.y);
        const roll = Math.floor(Math.random() * 12) + 1;
        const coverBonus = this.grid.tile(target.x, target.y).prop === 'cover' ? 2 : 0;
        const shieldBonus = this.shieldWall ? 2 : 0;
        const total = roll + e.atkMod + surge;
        const needed = target.evasion + coverBonus + shieldBonus;
        if (total >= needed) {
          await this.damageHero(target, e.dmg, e.name);
          if (e.special === 'entangle' && target.hp > 0) {
            target.slow = (target.slow || 0) + 1;
            this.ui.log(`Thorned vines coil around ${esc(target.name)} — <b>movement slowed</b> (-1 speed, stacks).`, 'fear');
          }
        } else {
          this.ui.log(`${ref(e.id, e.name)} lashes at ${esc(target.name)} — and misses. ` +
            `<span class="roll-detail">${roll} + ${e.atkMod + surge} = ${total} vs Evasion ${needed}</span>`, 'system');
        }
      }
      await new Promise(r => setTimeout(r, 250));
    }

    this.shieldWall = false; // blessing lasts one enemy phase
    this.busy = false;
    if (this.heroes.every(h => h.hp <= 0)) return; // defeat already shown
    this.tokens = this.maxTokens();
    this.ui.logHeader('PARTY PHASE');
    this.ui.log('Tokens refreshed. The party acts.', 'system');
    this.refreshHud();
    this.showMoveRange();
    this.ui.setContext('Your move.');
  }

  async damageHero(h, dmg, sourceName) {
    h.hp -= dmg;
    this.ui.log(`<b>${esc(sourceName)}</b> hits <b>${esc(h.name)}</b> for <b>${dmg}</b> damage.` +
      (h.hp <= 0 ? ` ${esc(h.name)} falls!` : ''), 'combat');
    if (h.hp <= 0) {
      await this.grid.deathAnim(h.id);
      if (h.id === this.selected) {
        const next = this.heroes.find(x => x.hp > 0);
        if (next) this.selected = next.id;
      }
      if (this.heroes.every(x => x.hp <= 0)) {
        this.ui.showEnd(false, 'The hollow things drag the fallen into the dark. The vault keeps its secrets.',
          () => this.restart());
      }
    }
    this.refreshHud();
  }

  async endCombat() {
    const group = this.activeGroup;
    this.mode = 'explore';
    this.activeGroup = null;
    this.shieldWall = false;
    for (const h of this.heroes) h.slow = 0;
    this.ui.setBadge('EXPLORATION', '');
    this.ui.logHeader('COMBAT ENDS');
    for (const h of this.heroes) if (h.hp > 0) h.hope = Math.min(h.hope + 1, 6);
    this.ui.log('The last foe crumbles. The survivors breathe — each gains <b>1 Hope</b>.', 'hope');
    this.refreshHud();
    this.showMoveRange();
    this.ui.setContext('Exploration resumes.');
    if (this.hooks.onCombatEnd) return this.hooks.onCombatEnd(group);
    if (this.map.enemies.every(e => e.hp <= 0)) {
      if (this.opts.onGoto) {
        // Multi-scene campaign: clearing one area isn't the end of the story
        this.ui.log('The area falls silent. The road goes on.', 'success');
        return;
      }
      setTimeout(() => this.ui.showEnd(true,
        'The vault stands silent. Whatever cursed these halls is spent — for now. Loot what remains.',
        () => this.restart()), 600);
    }
  }

  // ---------- spirit blessings ----------
  async useBlessing(heroId) {
    const h = this.hero(heroId);
    if (!h || h.hp <= 0 || !h.blessing || h.blessingUsed || this.busy || this.dice.active) return;
    if (this.mode === 'combat' && this.tokens <= 0) return;
    h.blessingUsed = true;
    if (this.mode === 'combat') this.tokens--;
    this.ui.logHeader('SPIRIT BLESSING');
    this.ui.log(`${esc(h.name)}'s spirit eye flares — <b>${esc(h.blessing.name)}</b>! <i>${esc(h.blessing.desc)}</i>`, 'hope');
    this.grid.flash(h.id);
    this.busy = true;
    await h.blessing.use(this, h);
    this.busy = false;
    this.refreshHud();
    if (this.mode === 'combat') {
      if (this.activeEnemies().length === 0) return this.endCombat();
      if (this.tokens <= 0) return this.enemyPhase('The party is spent.');
      this.showMoveRange();
    }
  }

  // Helper for blessing effects / scripted damage to enemies.
  async damageEnemy(e, dmg, sourceName) {
    e.hp -= dmg;
    this.ui.log(`<b>${esc(sourceName)}</b> sears ${ref(e.id, e.name)} for <b>${dmg}</b> damage.` +
      (e.hp <= 0 ? ' It is destroyed.' : ` (${Math.max(e.hp, 0)} HP left)`), e.hp <= 0 ? 'success' : 'combat');
    if (e.hp <= 0) await this.grid.deathAnim(e.id);
  }

  // ---------- input ----------
  async handleClick(ev) {
    if (!this.running || this.busy || this.dice.active) return;
    // Tokens and nodes take priority; otherwise the click lands on terrain
    const hit = this.sm.pick(ev, [
      ...this.grid.tokenGroup.children,
      ...this.grid.nodeGroup.children,
    ]);
    if (hit) {
      let o = hit.object;
      while (o && !o.userData?.kind) o = o.parent;
      if (o) {
        const { kind, id } = o.userData;
        if (kind === 'hero') return this.selectHero(id);
        if (kind === 'enemy') return this.attack(id);
        if (kind === 'node') {
          const node = this.map.nodes.find(n => n.id === id);
          if (node) return this.interactNode(node);
          return;
        }
      }
    }
    const cell = this.grid.pickCell(ev);
    if (cell) return this.moveHero(cell);
  }

  // ---------- right-click inspect ----------
  inspectAt(ev) {
    if (!this.running || this.dice.active) return;
    let hit = this.sm.pick(ev, [
      ...this.grid.tokenGroup.children,
      ...this.grid.nodeGroup.children,
      ...this.grid.decoGroup.children,
    ]);
    let o = hit?.object;
    while (o && !o.userData?.kind && !o.userData?.deco) o = o.parent;
    if (!o) {
      // Nothing solid hit — inspect the terrain tile under the cursor
      const cell = this.grid.pickCell(ev);
      if (!cell) { this.ui.hideInspect(); return; }
      o = { userData: { kind: 'tile', x: cell.x, y: cell.y } };
    }

    const row = (k, v) => `<div class="ins-row"><span>${esc(k)}</span><b>${v}</b></div>`;
    let html = null;

    if (o.userData.deco) {
      const d = o.userData.deco;
      const info = DECO_INFO[d.type] || { name: d.type, desc: '' };
      html = `<h4>🏞 ${esc(info.name)}</h4><p>${esc(info.desc)}</p>` + row('Type', 'Scenery — walkable, no effect on play');
    } else if (o.userData.kind === 'hero') {
      const h = this.hero(o.userData.id);
      if (!h) return;
      const traits = Object.entries(h.traits).map(([k, v]) => `${k.slice(0, 3).toUpperCase()} ${v >= 0 ? '+' : ''}${v}`).join(' · ');
      html = `<h4 style="color:${h.color}">⚔ ${esc(h.name)} — ${esc(h.class)}</h4>` +
        row('HP', `${Math.max(h.hp, 0)} / ${h.maxHp}`) +
        row('Hope', `${h.hope} / 6`) +
        row('Evasion', h.evasion + (this.shieldWall ? ' (+2 Shield Wall)' : '')) +
        row('Speed', this.effectiveSpeed(h) + (h.slow ? ` (slowed ${h.slow})` : '')) +
        row('Weapon', `${esc(h.weapon.name)} — ${esc(h.weapon.trait)}, ${h.weapon.dmg} dmg, range ${h.weapon.range}`) +
        `<p class="ins-traits">${traits}</p>` +
        (h.blessing ? row('✦ Blessing', `${esc(h.blessing.name)}${h.blessingUsed ? ' (spent)' : ''}`) +
          `<p>${esc(h.blessing.desc)}</p>` : '') +
        (h.spirit ? row('Spirit', `${h.spirit} eye${h.spirit > 1 ? 's' : ''} alight`) : '');
    } else if (o.userData.kind === 'enemy') {
      const e = this.enemy(o.userData.id);
      if (!e) return;
      const specials = {
        entangle: 'Entangle — its hits wrap the target in vines (stacking −1 speed until combat ends).',
        nightmare: 'Waking Nightmare — drains 1 Hope from heroes within 5 tiles and knits its own wounds.',
      };
      html = `<h4 class="ins-enemy">☠ ${esc(e.name)}</h4>` +
        row('HP', `${Math.max(e.hp, 0)} / ${e.maxHp}`) +
        row('Difficulty', e.difficulty + ' (to hit it)') +
        row('Attack', `+${e.atkMod}, ${e.dmg} dmg, range ${e.range || 1}`) +
        row('Speed', e.speed) +
        (e.special ? `<p>${esc(specials[e.special] || e.special)}</p>` : '') +
        (e.frozen ? row('Status', 'Bound in hoarfrost — loses its next activation') : '') +
        row('Status', this.mode === 'combat' && e.group === this.activeGroup && e.hp > 0 ? 'HOSTILE' : (e.hp > 0 ? 'Dormant — not yet hostile' : 'Destroyed'));
    } else if (o.userData.kind === 'node') {
      const n = this.map.nodes.find(x => x.id === o.userData.id);
      if (!n) return;
      html = `<h4>◈ ${esc(n.name)}</h4>` +
        (n.flavor ? `<p>${esc(n.flavor)}</p>` : '') +
        (n.goto ? row('Travel', 'Leads to another scene') : '') +
        (n.requireKey ? row('Locked', `Requires 🗝 ${esc(n.requireKey)}${this.keys.has(n.requireKey) ? ' (held)' : ''}`) : '') +
        (n.dc && !n.goto ? row('Check', `${esc(n.trait)} vs DC ${n.dc}`) : '') +
        (n.pillar ? row('State', n.lit ? 'Spotlight LIT' : (n.inserted ? 'Crank inserted — dark (re-crank it)' : 'Dark — crank socket empty')) : '') +
        (n.crank ? row('State', n.found ? 'Searched — crank taken' : 'Unsearched') : '') +
        (n.type === 'door' ? row('State', n.open ? 'Open' : 'Locked — blocks movement') : '') +
        (n.type === 'chest' ? row('State', n.used ? 'Emptied' : 'Sealed') : '') +
        (n.type === 'pillar' && !n.pillar ? row('State', 'Blocks movement — can be toppled') : '');
    } else if (o.userData.kind === 'tile') {
      const { x, y } = o.userData;
      const t = this.grid.tile(x, y);
      const props = {
        difficult: 'Difficult terrain — movement through here costs double.',
        cover: 'Cover — a token standing here gains +2 Evasion / +2 Difficulty to be hit.',
      };
      html = `<h4>▦ Tile ${x}, ${y}</h4>` +
        row('Elevation', t.h + (t.h > 0 ? ' (high ground: +1 to attacks against lower targets)' : '')) +
        (t.prop ? `<p>${props[t.prop]}</p>` : row('Terrain', 'Open ground'));
    }

    if (html) this.ui.showInspect(html, ev);
  }

  handleHover(ev) {
    if (!this.running || this.busy || this.dice.active) return;
    const hit = this.sm.pick(ev, [
      ...this.grid.tokenGroup.children,
      ...this.grid.nodeGroup.children,
    ]);
    let o = hit?.object;
    while (o && !o.userData?.kind) o = o.parent;
    if (!o) {
      const cell = this.grid.pickCell(ev);
      if (!cell) return;
      const t = this.grid.tile(cell.x, cell.y);
      const bits = [`Tile ${cell.x},${cell.y}`, `elevation ${t.h}`];
      if (t.prop === 'difficult') bits.push('DIFFICULT TERRAIN (move ×2)');
      if (t.prop === 'cover') bits.push('COVER (+2 Evasion)');
      this.ui.setContext(bits.join(' · '));
      return;
    }
    const { kind, id } = o.userData;
    if (kind === 'enemy') {
      const e = this.enemy(id);
      if (e) this.ui.setContext(`${e.name} — HP ${Math.max(e.hp, 0)}/${e.maxHp} · Difficulty ${e.difficulty} · hits for ${e.dmg}`);
    } else if (kind === 'node') {
      const n = this.map.nodes.find(nn => nn.id === id);
      if (n) this.ui.setContext(n.dc ? `${n.name} — ${n.trait} DC ${n.dc}${n.used || n.found ? ' (spent)' : ''}` : n.name);
    } else if (kind === 'hero') {
      const h = this.hero(id);
      if (h) this.ui.setContext(`${h.name} the ${h.class} — HP ${h.hp}/${h.maxHp}, Hope ${h.hope}`);
    }
  }
}
