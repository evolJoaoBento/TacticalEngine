// ============ POLYHEART BOOTSTRAP ============
import { SceneManager } from './scene.js';
import { GridWorld } from './grid.js';
import { DiceManager } from './dice.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { Editor } from './editor.js';
import { Campaign } from './campaign.js';
import { demoMap, blankMap, makeCampaign } from './data.js';

const canvas = document.getElementById('gl');
const sm = new SceneManager(canvas);
const grid = new GridWorld(sm);
const ui = new UI(id => grid.flash(id));
const dice = new DiceManager(sm, grid, ui);
const game = new Game(sm, grid, dice, ui);
const editor = new Editor(sm, grid, ui);
const campaign = new Campaign(sm, grid, dice, ui, game);

// ---- Campaign document: the editor's source of truth ----
let masterCampaign = (() => {
  try {
    const saved = localStorage.getItem('polyheart-campaign');
    if (saved) {
      const c = JSON.parse(saved);
      if (c.campaign && c.scenes?.length) return c;
    }
    // Migrate a legacy single-map save
    const legacy = localStorage.getItem('polyheart-map');
    if (legacy) return makeCampaign([JSON.parse(legacy)], 'My Campaign');
  } catch {}
  return makeCampaign([demoMap()], 'My Campaign');
})();
editor.campaign = masterCampaign;
editor.sceneIdx = 0;
editor.map = masterCampaign.scenes[0];

// ---- Mode switching ----
const btnPlay = document.getElementById('btn-play');
const btnEditor = document.getElementById('btn-editor');
const btnCampaign = document.getElementById('btn-campaign');
let mode = 'play';

function setActive(btn) {
  for (const b of [btnPlay, btnEditor, btnCampaign]) b.classList.toggle('active', b === btn);
}

// Plays the user campaign: scenes are cloned, the party + keys/flags carry
// across portal transitions, and the editor master stays pristine.
function enterPlay() {
  mode = 'play';
  setActive(btnPlay);
  campaign.active = false;
  editor.exit();

  const scenes = JSON.parse(JSON.stringify(masterCampaign.scenes));
  const keys = new Set(), flags = new Set();
  const startIdx = Math.min(editor.sceneIdx || 0, scenes.length - 1);

  const startScene = (map, party) => {
    game.start(map, {
      party,                       // undefined on first scene -> default heroes
      keys, flags,
      onGoto: sceneId => {
        const target = scenes.find(s => s.id === sceneId);
        if (!target) {
          ui.log(`The portal sputters — its destination no longer exists (scene "${sceneId}").`, 'fear');
          return;
        }
        const liveParty = game.heroes;          // carry hp/hope/blessings over
        ui.logHeader('SCENE CHANGE');
        startScene(target, liveParty);
      },
    });
  };
  startScene(scenes[startIdx]);
}

function enterEditor() {
  mode = 'editor';
  setActive(btnEditor);
  campaign.active = false;
  ui.hideInspect();
  game.stop();
  editor.enter(masterCampaign);
}

function enterCampaign() {
  mode = 'campaign';
  setActive(btnCampaign);
  editor.exit();
  campaign.start();
}

campaign.onExit = enterPlay;
btnPlay.addEventListener('click', enterPlay);
btnEditor.addEventListener('click', enterEditor);
btnCampaign.addEventListener('click', enterCampaign);

// ---- File ops ----
document.getElementById('btn-save').addEventListener('click', () => {
  editor.campaign = masterCampaign;
  editor.download();
});
document.getElementById('btn-new').addEventListener('click', () => {
  if (!confirm('Start a new blank campaign? The current one is replaced (saved to localStorage until you edit).')) return;
  const name = prompt('Campaign name:', 'New Campaign') || 'New Campaign';
  const m = blankMap(24, 18);
  m.name = 'Scene 1';
  masterCampaign = makeCampaign([m], name);
  editor.sceneIdx = 0;
  mode === 'editor' ? editor.enter(masterCampaign) : enterPlay();
});
const fileInput = document.getElementById('file-input');
document.getElementById('btn-load').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const f = fileInput.files[0];
  if (!f) return;
  try {
    masterCampaign = editor.loadJson(await f.text());
    ui.log(`Loaded campaign <b>${masterCampaign.name}</b> (${masterCampaign.scenes.length} scene${masterCampaign.scenes.length > 1 ? 's' : ''}).`, 'system');
    if (mode === 'play') enterPlay(); else editor.enter(masterCampaign);
  } catch (err) {
    ui.log('Load failed: ' + err.message, 'fear');
  }
  fileInput.value = '';
});

// ---- Pointer routing ----
let downPos = null;       // left-button click-vs-drag
let rightDownPos = null;  // right-button click-vs-drag (inspect)
let hoverThrottle = 0;

canvas.addEventListener('contextmenu', ev => ev.preventDefault());

canvas.addEventListener('pointerdown', ev => {
  if (dice.active) return dice.onPointerDown(ev);
  if (mode === 'editor') return editor.onPointerDown(ev);
  if (ev.button === 0) { downPos = { x: ev.clientX, y: ev.clientY }; ui.hideInspect(); }
  if (ev.button === 2) rightDownPos = { x: ev.clientX, y: ev.clientY };
});

canvas.addEventListener('pointermove', ev => {
  if (dice.active) return dice.onPointerMove(ev);
  if (mode === 'editor') return editor.onPointerMove(ev);
  const now = performance.now();
  if (now - hoverThrottle > 80) { hoverThrottle = now; game.handleHover(ev); }
});

canvas.addEventListener('pointerup', ev => {
  if (dice.active) return dice.onPointerUp(ev);
  if (mode === 'editor') return editor.onPointerUp(ev);
  if (ev.button === 0 && downPos) {
    const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
    downPos = null;
    if (moved < 6) game.handleClick(ev); // click, not a camera drag
  }
  if (ev.button === 2 && rightDownPos) {
    const moved = Math.hypot(ev.clientX - rightDownPos.x, ev.clientY - rightDownPos.y);
    rightDownPos = null;
    if (moved < 6) game.inspectAt(ev); // right-click, not a camera pan
  }
});

window.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    document.querySelectorAll('.modal:not(#end-modal)').forEach(m => m.classList.add('hidden'));
    ui.hideInspect();
  }
});

// ---- Go ----
enterPlay();

// Debug / modding handle
window.PH = { sm, grid, dice, game, editor, ui, campaign };
