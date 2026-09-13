// ============ MAP CREATOR SUITE ============
// Terrain sculpting, tile properties, node placement + scripting,
// enemy/trigger/spawn placement, JSON save/load.

import { makeNode, makeEnemy, ENEMY_TYPES, blankMap, resizeMap, makeCampaign } from './data.js';
import { DECO_TYPES } from './models.js';

export class Editor {
  constructor(sm, grid, ui) {
    this.sm = sm; this.grid = grid; this.ui = ui;
    this.active = false;
    this.tool = 'raise';
    this.painting = false;
    this.lastCell = null;
    this.map = null;

    this.toolbar = document.getElementById('editor-toolbar');
    this.colorInput = document.getElementById('paint-color');
    this.groupSelect = document.getElementById('group-select');

    // Palettes built from the shared registries — new models/types show up automatically
    this.enemyTypeSelect = document.getElementById('enemy-type-select');
    this.enemyTypeSelect.innerHTML = Object.entries(ENEMY_TYPES)
      .map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
    this.decoTypeSelect = document.getElementById('deco-type-select');
    this.decoTypeSelect.innerHTML = DECO_TYPES
      .map(t => `<option value="${t}">${t}</option>`).join('');

    this.toolbar.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
    });

    // ---- Campaign scene manager ----
    this.sceneSelect = document.getElementById('scene-select');
    this.sceneSelect.addEventListener('change', () => this.switchScene(parseInt(this.sceneSelect.value)));
    document.getElementById('scene-add').addEventListener('click', () => this.addScene());
    document.getElementById('scene-rename').addEventListener('click', () => this.renameScene());
    document.getElementById('scene-del').addEventListener('click', () => this.deleteScene());
    document.getElementById('map-resize').addEventListener('click', () => this.resizeCurrent());
    document.getElementById('map-intro').addEventListener('click', () => this.editIntro());
  }

  get scenes() { return this.campaign?.scenes || []; }

  renderSceneSelect() {
    this.sceneSelect.innerHTML = this.scenes
      .map((s, i) => `<option value="${i}">${i + 1}. ${s.name}</option>`).join('');
    this.sceneSelect.value = String(this.sceneIdx);
  }

  switchScene(idx) {
    if (idx < 0 || idx >= this.scenes.length) return;
    this.persist();
    this.sceneIdx = idx;
    this.map = this.scenes[idx];
    this.refresh();
    this.ui.log(`Editing scene <b>${this.map.name}</b> (${this.map.w}×${this.map.h}).`, 'system');
  }

  addScene() {
    const w = Math.min(Math.max(parseInt(prompt('New scene width (8–48):', '24')) || 24, 8), 48);
    const h = Math.min(Math.max(parseInt(prompt('New scene height (8–48):', '18')) || 18, 8), 48);
    const m = blankMap(w, h);
    m.id = 'scene-' + Math.random().toString(36).slice(2, 8);
    m.name = prompt('Scene name:', 'Scene ' + (this.scenes.length + 1)) || ('Scene ' + (this.scenes.length + 1));
    this.scenes.push(m);
    this.switchScene(this.scenes.length - 1);
    this.renderSceneSelect();
    this.ui.log(`Scene added. Link scenes with the <b>⊙ Portal</b> tool — set its target in <b>Inspect</b>.`, 'system');
  }

  renameScene() {
    const name = prompt('Scene name:', this.map.name);
    if (name) { this.map.name = name; this.renderSceneSelect(); this.persist(); }
  }

  deleteScene() {
    if (this.scenes.length <= 1) { this.ui.log('A campaign needs at least one scene.', 'system'); return; }
    if (!confirm(`Delete scene "${this.map.name}"? Portals pointing at it will go dead.`)) return;
    this.scenes.splice(this.sceneIdx, 1);
    this.sceneIdx = Math.max(0, this.sceneIdx - 1);
    this.map = this.scenes[this.sceneIdx];
    this.refresh();
    this.renderSceneSelect();
    this.persist();
  }

  resizeCurrent() {
    const w = parseInt(prompt(`Width (8–48), currently ${this.map.w}:`, this.map.w));
    const h = parseInt(prompt(`Height (8–48), currently ${this.map.h}:`, this.map.h));
    if (!w || !h) return;
    resizeMap(this.map, Math.min(Math.max(w, 8), 48), Math.min(Math.max(h, 8), 48));
    this.refresh();
    this.persist();
    this.ui.log(`Map resized to ${this.map.w}×${this.map.h}.`, 'system');
  }

  editIntro() {
    const intro = prompt('Scene intro text (read when the scene loads):', this.map.intro || '');
    if (intro !== null) { this.map.intro = intro; this.persist(); }
  }

  setTool(tool) {
    this.tool = tool;
    this.toolbar.querySelectorAll('.tool-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.tool === tool));
    const hints = {
      raise: 'Drag across tiles to raise terrain.',
      lower: 'Drag across tiles to lower terrain.',
      wall: 'Drag to paint solid walls (blocks movement; impassable height).',
      portal: 'Click to place a portal, then Inspect it to choose the target scene.',
      paint: 'Drag to paint tile color.',
      difficult: 'Drag to mark difficult terrain (movement ×2).',
      cover: 'Drag to place cover (+2 Evasion for occupant).',
      clearprop: 'Drag to clear tile properties.',
      chest: 'Click a tile to place a chest, then Inspect to script it.',
      door: 'Click a tile to place a door (blocks movement until opened).',
      pillar: 'Click a tile to place a crumbling pillar (blocks movement).',
      enemy: 'Click to place the selected enemy type in the selected encounter group.',
      deco: 'Click to place scenery. Click again on the same tile to rotate it.',
      trigger: `Drag to paint a combat trigger zone for the selected group.`,
      spawn: 'Click to add party spawn points (first 3 used).',
      erase: 'Click to remove nodes, enemies, triggers, or spawns.',
      inspect: 'Click a node to open its script: flavor text, trait, DC, and the four Daggerheart outcomes.',
    };
    this.ui.setContext('EDITOR — ' + (hints[tool] || ''));
  }

  // Accepts a campaign document; edits one scene at a time.
  enter(campaign) {
    this.active = true;
    this.campaign = campaign;
    this.sceneIdx = Math.min(this.sceneIdx || 0, campaign.scenes.length - 1);
    this.map = campaign.scenes[this.sceneIdx];
    this.refresh();
    this.renderSceneSelect();
    this.toolbar.classList.remove('hidden');
    this.ui.setBadge('CAMPAIGN EDITOR', 'editor');
    // Left mouse reserved for tools; rotate with right mouse
    this.sm.controls.mouseButtons = { LEFT: -1, MIDDLE: 1, RIGHT: 0 }; // ROTATE=0, DOLLY=1
    this.setTool(this.tool);
    this.ui.clearLog();
    this.ui.logHeader('CAMPAIGN CREATOR');
    this.ui.log('Build multi-scene campaigns: sculpt terrain (<b>▮ Wall</b> for solid walls), script nodes with ' +
      'per-roll effects (keys, flags, combats, scene jumps), link scenes with <b>⊙ Portal</b> nodes, ' +
      'and manage scenes in the SCENES panel. Right-drag rotates. <b>▶ Play</b> tests from the current scene.', 'system');
  }

  refresh() {
    this.grid.build(this.map);
    this.grid.rebuildMarkers(true);
    this.rebuildEnemies();
    this.sm.focusMap(this.map.w, this.map.h);
  }

  exit() {
    this.active = false;
    this.toolbar.classList.add('hidden');
    this.grid.rebuildMarkers(false);
    this.sm.controls.mouseButtons = { LEFT: 0, MIDDLE: 1, RIGHT: 2 }; // restore: rotate/dolly/pan
    this.persist();
  }

  rebuildEnemies() {
    this.grid.enemyTokens.forEach((g, id) => this.grid.removeToken(id));
    for (const e of this.map.enemies) if (e.hp > 0) this.grid.buildEnemyToken(e);
  }

  persist() {
    try { localStorage.setItem('polyheart-campaign', JSON.stringify(this.campaign)); } catch {}
  }

  // ---------- pointer ----------
  onPointerDown(ev) {
    if (!this.active || ev.button !== 0) return;
    this.painting = true;
    this.lastCell = null;
    this.applyAt(ev);
  }
  onPointerMove(ev) {
    if (!this.active) return;
    if (this.painting) this.applyAt(ev);
    else this.hoverInfo(ev);
  }
  onPointerUp() {
    if (this.painting) { this.painting = false; this.persist(); }
  }

  cellAt(ev) {
    return this.grid.pickCell(ev);
  }

  hoverInfo(ev) {
    const c = this.cellAt(ev);
    if (!c) return;
    const t = this.grid.tile(c.x, c.y);
    this.ui.setContext(`EDITOR — tile ${c.x},${c.y} · h=${t.h}${t.prop ? ' · ' + t.prop : ''} · tool: ${this.tool}`);
  }

  applyAt(ev) {
    const c = this.cellAt(ev);
    if (!c) return;
    const key = c.x + ',' + c.y;
    const dragTool = ['raise', 'lower', 'wall', 'paint', 'difficult', 'cover', 'clearprop', 'trigger'].includes(this.tool);
    if (dragTool && this.lastCell === key) return;
    if (!dragTool && this.lastCell !== null) return; // click tools fire once per press
    this.lastCell = key;

    const t = this.grid.tile(c.x, c.y);
    const group = parseInt(this.groupSelect.value);

    switch (this.tool) {
      case 'raise': t.h = Math.min(t.h + 1, 8); this.grid.buildTile(c.x, c.y); break;
      case 'lower': t.h = Math.max(t.h - 1, 0); this.grid.buildTile(c.x, c.y); break;
      case 'wall':
        if (t.h >= 4) { t.h = 0; } // toggle: painting a wall again removes it
        else { t.h = 4; t.color = '#454a59'; }
        this.grid.buildTile(c.x, c.y);
        break;
      case 'paint': t.color = this.colorInput.value; this.grid.buildTile(c.x, c.y); break;
      case 'difficult': t.prop = 'difficult'; this.grid.buildTile(c.x, c.y); break;
      case 'cover': t.prop = 'cover'; this.grid.buildTile(c.x, c.y); break;
      case 'clearprop': t.prop = null; this.grid.buildTile(c.x, c.y); break;

      case 'chest': case 'door': case 'pillar': case 'portal': {
        if (this.nodeAt(c)) break;
        const n = makeNode(this.tool, c.x, c.y);
        if (this.tool === 'portal') {
          // Default target: the next scene in the campaign, if any
          const next = this.scenes[this.sceneIdx + 1];
          n.goto = next ? next.id : null;
        }
        this.map.nodes.push(n);
        this.grid.buildNode(n);
        this.ui.log(`Placed <b>${n.name}</b> at ${c.x},${c.y}. Use <b>Inspect</b> to script it.`, 'system');
        break;
      }
      case 'enemy': {
        if (this.enemyAt(c)) break;
        const e = makeEnemy(c.x, c.y, group, this.enemyTypeSelect.value);
        this.map.enemies.push(e);
        this.grid.buildEnemyToken(e);
        this.ui.log(`Placed <b>${e.name}</b> (group ${group}) at ${c.x},${c.y}.`, 'system');
        break;
      }
      case 'deco': {
        this.map.decos ??= [];
        const existing = this.map.decos.find(d => d.x === c.x && d.y === c.y);
        if (existing) { // rotate in place
          existing.rot = ((existing.rot || 0) + Math.PI / 2) % (Math.PI * 2);
        } else {
          this.map.decos.push({ type: this.decoTypeSelect.value, x: c.x, y: c.y, rot: 0 });
        }
        this.grid.rebuildDecos();
        break;
      }
      case 'trigger': {
        let trig = this.map.triggers.find(tr => tr.group === group);
        if (!trig) {
          trig = { id: 'trig-' + Math.random().toString(36).slice(2, 8), group, once: true, cells: [] };
          this.map.triggers.push(trig);
        }
        if (!trig.cells.some(([x, y]) => x === c.x && y === c.y)) trig.cells.push([c.x, c.y]);
        this.grid.rebuildMarkers(true);
        break;
      }
      case 'spawn':
        if (!this.map.spawns.some(([x, y]) => x === c.x && y === c.y)) {
          this.map.spawns.push([c.x, c.y]);
          this.grid.rebuildMarkers(true);
        }
        break;
      case 'erase': this.eraseAt(c); break;
      case 'inspect': {
        const n = this.nodeAt(c);
        if (n) this.openNodeScript(n);
        break;
      }
    }
  }

  nodeAt(c) { return this.map.nodes.find(n => n.x === c.x && n.y === c.y); }
  enemyAt(c) { return this.map.enemies.find(e => e.x === c.x && e.y === c.y); }

  eraseAt(c) {
    const n = this.nodeAt(c);
    if (n) {
      this.map.nodes = this.map.nodes.filter(x => x !== n);
      this.grid.rebuildNodes();
      return;
    }
    const e = this.enemyAt(c);
    if (e) {
      this.map.enemies = this.map.enemies.filter(x => x !== e);
      this.grid.removeToken(e.id);
      return;
    }
    const deco = (this.map.decos || []).find(d => d.x === c.x && d.y === c.y);
    if (deco) {
      this.map.decos = this.map.decos.filter(d => d !== deco);
      this.grid.rebuildDecos();
      return;
    }
    for (const trig of this.map.triggers) {
      trig.cells = trig.cells.filter(([x, y]) => !(x === c.x && y === c.y));
    }
    this.map.triggers = this.map.triggers.filter(t => t.cells.length);
    this.map.spawns = this.map.spawns.filter(([x, y]) => !(x === c.x && y === c.y));
    this.grid.rebuildMarkers(true);
  }

  openNodeScript(node) {
    this.ui.openNodePanel(node, {
      scenes: this.scenes.map(s => ({ id: s.id, name: s.name })),
      onApply: () => { this.persist(); this.ui.log(`Node <b>${node.name}</b> updated.`, 'system'); },
      onDelete: n => {
        this.map.nodes = this.map.nodes.filter(x => x.id !== n.id);
        this.grid.rebuildNodes();
        this.persist();
      },
    });
  }

  // ---------- file ops ----------
  download() {
    const blob = new Blob([JSON.stringify(this.campaign, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (this.campaign.name || 'campaign').replace(/\W+/g, '-').toLowerCase() + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Accepts a campaign document OR a legacy single-map file (auto-wrapped).
  loadJson(text) {
    const doc = JSON.parse(text);
    let campaign;
    if (doc.campaign && Array.isArray(doc.scenes)) {
      campaign = doc;
      for (const m of campaign.scenes) {
        if (!m.tiles || !m.w || !m.h) throw new Error(`Scene "${m.name || '?'}" is missing tiles/w/h`);
        m.nodes ??= []; m.enemies ??= []; m.triggers ??= []; m.decos ??= []; m.spawns ??= [[1, 1]];
        m.id ??= 'scene-' + Math.random().toString(36).slice(2, 8);
      }
    } else {
      if (!doc.tiles || !doc.w || !doc.h) throw new Error('Not a Tactical Engine map or campaign');
      doc.nodes ??= []; doc.enemies ??= []; doc.triggers ??= []; doc.decos ??= []; doc.spawns ??= [[1, 1]];
      campaign = makeCampaign([doc], doc.name || 'Imported Map');
    }
    this.campaign = campaign;
    this.sceneIdx = 0;
    if (this.active) this.enter(campaign);
    return campaign;
  }
}
