/**
 * Turn a loot-card export into the engine's equipment catalogue.
 *
 *   node tools/loot-cards.mjs <export.zip> [--no-images]
 *
 * The export is a zip holding `cards.json` - every card's name, category, tier or roll, weapon or
 * armour numbers, feature and text - and `cards/<id>.png`, one finished card per file. Two things
 * come out:
 *
 *   - `src/engine/content/equipment/catalogue.json`: the weapons and armour as the engine's own
 *     `weaponDefSchema` / `armorDefSchema` rows, and an item for every card, weapons and armour
 *     included, since an item is what the party carries and a weapon is what a sheet wields. Every
 *     row is read back through the zod schemas by `catalogue.test.ts`, so a card this maps wrong
 *     fails there rather than in a fight.
 *   - `public/equipment/<id>.webp`: each card's picture, re-encoded as WebP by a headless Chromium
 *     at the size it was drawn. That folder is not committed - the pictures live on Hugging Face,
 *     named in `equipment.lock.json`, and `npm run models` brings them down - so after running this,
 *     upload the folder and write the lock (`tools/lock-equipment.mjs`).
 *
 * What a card does not say, this decides, and says so in `docs/DEVELOPING.md`: what each is worth
 * in gold (by tier for weapons and armour, by its loot roll for everything else), which kind of item
 * it is, that a weapon of the Spellcast "trait" swings with its wielder's own spellcast trait, and
 * what the health and stamina potions do when drunk (`POTIONS`).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [zipPath, ...flags] = process.argv.slice(2);
if (zipPath === undefined) {
  console.error('usage: node tools/loot-cards.mjs <export.zip> [--no-images]');
  process.exit(1);
}
const withImages = !flags.includes('--no-images');

const files = unzipSync(readFileSync(zipPath));
const named = (suffix) => Object.keys(files).find((name) => name.endsWith(suffix));
const index = named('/cards.json') ?? named('cards.json');
if (index === undefined) throw new Error(`${zipPath} holds no cards.json`);
const exported = JSON.parse(new TextDecoder().decode(files[index]));
if (!Array.isArray(exported.cards)) throw new Error(`${index} has no card list`);
const folder = index.slice(0, index.length - 'cards.json'.length);

const RANGE = { Melee: 'melee', 'Very Close': 'veryClose', Close: 'close', Far: 'far', 'Very Far': 'veryFar' };
const BURDEN = { 'One-Handed': 'oneHanded', 'Two-Handed': 'twoHanded' };
const TYPES = { physical: ['physical'], magic: ['magic'], 'physical or magic': ['physical', 'magic'] };

/** "d8+3" as the engine's dice expression: one die unless it says more, and nothing added unless it says so. */
function dice(text) {
  const match = /^(\d*)d(\d+)(?:\+(\d+))?$/.exec(text.trim());
  if (match === null) throw new Error(`damage "${text}" is not NdS+M`);
  return { count: match[1] === '' ? 1 : Number(match[1]), sides: Number(match[2]), modifier: match[3] === undefined ? 0 : Number(match[3]) };
}

function known(table, value, what, id) {
  if (!(value in table)) throw new Error(`${id}: no ${what} "${value}"`);
  return table[value];
}

/**
 * What a thing fetches, in gold, where the card is silent: a house rule, not the card's. Weapons
 * and armour by tier - a secondary weapon at a little over half a primary's - and everything else
 * by its roll on the loot table, since a higher roll is a rarer find.
 */
const WEAPON_WORTH = [10, 25, 60, 150];
const ARMOR_WORTH = [15, 35, 80, 200];
function worth(card) {
  const tier = Math.min(Math.max(card.tier ?? 1, 1), 4) - 1;
  switch (card.category) {
    case 'primary-weapon': return WEAPON_WORTH[tier];
    case 'secondary-weapon': return Math.ceil(WEAPON_WORTH[tier] * 0.6);
    case 'armor': return ARMOR_WORTH[tier];
    case 'consumable': return 2 + Math.ceil((card.roll ?? 1) / 6);
    default: return 5 + Math.ceil((card.roll ?? 1) / 2);
  }
}

/**
 * What drinking one does, for the consumables whose card is a plain number the effect vocabulary
 * says directly: the health and stamina potions. Every other consumable is its text, as a text-only
 * card is, until somebody scripts it.
 */
const POTIONS = {
  'consumable-minor-health-potion': ['heal', '1d4'],
  'consumable-health-potion': ['heal', '1d4+1'],
  'consumable-major-health-potion': ['heal', '1d4+2'],
  'consumable-minor-stamina-potion': ['stress', '1d4'],
  'consumable-stamina-potion': ['stress', '1d4+1'],
  'consumable-major-stamina-potion': ['stress', '1d4+2'],
};
function use(id) {
  const potion = POTIONS[id];
  if (potion === undefined) return [];
  const [what, dice] = potion;
  return what === 'heal'
    ? [{ kind: 'heal', dice, target: { kind: 'actor' } }, { kind: 'log', text: 'The potion goes down warm, and the wounds knit.', tone: 'good' }]
    : [{ kind: 'clearStress', amount: { dice }, target: { kind: 'actor' } }, { kind: 'log', text: 'The potion steadies the hands and clears the head.', tone: 'good' }];
}

const weapons = [];
const armors = [];
const items = [];
for (const card of exported.cards) {
  const id = card.id;
  const features = card.feature === undefined || card.feature === null ? [] : [{ name: card.feature.name, text: card.feature.text }];
  let kind = 'trinket';
  if (card.category === 'primary-weapon' || card.category === 'secondary-weapon') {
    kind = 'weapon';
    const w = card.weapon;
    const types = known(TYPES, w.damage.type, 'damage type', id);
    weapons.push({
      id,
      name: card.name,
      tier: card.tier ?? 1,
      slot: card.category === 'secondary-weapon' ? 'secondary' : types.includes('physical') ? 'primaryPhysical' : 'primaryMagic',
      trait: w.trait.toLowerCase(),
      range: known(RANGE, w.range, 'range', id),
      damage: { ...dice(w.damage.dice), types },
      burden: known(BURDEN, w.burden, 'burden', id),
      features,
    });
  } else if (card.category === 'armor') {
    kind = 'armor';
    armors.push({
      id,
      name: card.name,
      tier: card.tier ?? 1,
      baseThresholds: { major: card.armor.thresholds.major, severe: card.armor.thresholds.severe },
      baseScore: card.armor.baseScore,
      features,
    });
  } else if (card.category === 'consumable') {
    kind = 'consumable';
  } else if (card.category !== 'item') {
    throw new Error(`${id}: no category "${card.category}"`);
  }
  items.push({
    id,
    name: card.name,
    kind,
    description: card.plainText ?? '',
    ...(kind === 'weapon' || kind === 'armor' ? { contentId: id } : {}),
    // A sword is one sword; potions pile up.
    stackable: kind === 'consumable',
    value: worth(card),
    ...(card.tier === null || card.tier === undefined ? {} : { tier: card.tier }),
    ...(card.image === undefined ? {} : { card: `${id}.webp` }),
    ...(use(id).length === 0 ? {} : { use: use(id) }),
  });
}

const out = join(root, 'src', 'engine', 'content', 'equipment', 'catalogue.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ weapons, armors, items }, null, 1)}\n`);
console.log(`${out}: ${weapons.length} weapons, ${armors.length} armour, ${items.length} items`);

if (withImages) {
  const { chromium } = await import('playwright');
  const target = join(root, 'public', 'equipment');
  mkdirSync(target, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let before = 0;
  let after = 0;
  for (const card of exported.cards) {
    if (card.image === undefined) continue;
    const png = files[folder + card.image];
    if (png === undefined) throw new Error(`${card.id}: ${card.image} is not in the zip`);
    const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
    const webp = await page.evaluate(async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.toDataURL('image/webp', 0.82);
    }, url);
    const bytes = Buffer.from(webp.slice(webp.indexOf(',') + 1), 'base64');
    writeFileSync(join(target, `${card.id}.webp`), bytes);
    before += png.length;
    after += bytes.length;
  }
  await browser.close();
  console.log(`${target}: ${(before / 1e6).toFixed(1)} MB of PNG as ${(after / 1e6).toFixed(1)} MB of WebP`);
}
