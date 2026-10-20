/**
 * The camp a new game begins at: a clearing round a fire, the character just made standing by it,
 * and the rest of the company - Quim, Violet, Scarlet, Arty, Pint and Ganja - gathered round.
 *
 * The party is the new character alone at first. Each of the company is a figure at the fire to talk
 * to, and a companion of the project's (`camp-company.ts`): asked along, they join the party and
 * their figure leaves the fire, four to a party (`joinParty`). The one whose model the character took
 * is not there, nor anyone who would share the character's id. At the clearing's west edge stands the
 * portal an adventure is begun through, with the party as it stands (`adventure-portal.ts`).
 *
 * Built in code rather than read from a file, so the camp is always whole and always this build's;
 * the project it makes lists the SRD character pack (`listed-packs.ts`), which is what the
 * character is made of.
 */

import type { CharacterSheet } from '../engine/character/sheet';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema, type ProjectDoc } from '../engine/scene/schema';
import { propFunctionSchema } from '../engine/scene/prop-function-schema';
import { idFromName } from './new-character';
import { companionConversation, companionDialogue, companyFor, figureOf } from './camp-company';
import { ADVENTURE_PORTAL } from './adventure-portal';

/** The company, by the model each is drawn with. */
export const CAMP_CREW = ['quim', 'violet', 'scarlet', 'arty', 'pint', 'ganja'] as const;

const WIDTH = 18;
const HEIGHT = 14;
/** The fire, in the middle of the clearing. */
const FIRE = { x: 9, y: 6 };
/** The portal, at the clearing's west edge, facing the fire. */
export const PORTAL_AT = { x: 3, y: 8 };

/** The ground the camp is laid on: the grass, dirt and trodden grass the demo's own camp uses. */
const PALETTE = [
  { id: 'floor', name: 'Floor', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#5d8a4a' },
  { id: 'grass', name: 'Grass Ground', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#618950', model: 'grass-ground', scale: 1, structure: 'floor' },
  { id: 'dirt', name: 'Dirt Ground', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#6b6350', model: 'dirt-ground', scale: 1, structure: 'floor' },
  { id: 'trodden', name: 'Grass Dirt Ground', passable: true, cost: 1, providesCover: false, blocksSight: false, color: '#6f7a4c', model: 'grass-dirt-ground', scale: 1, structure: 'floor' },
];

/** The things of a camp, round the edge of the clearing. */
const PROPS: readonly { model: string; x: number; y: number; rotation?: number }[] = [
  { model: 'cart-prop', x: 3, y: 3, rotation: 0.5 },
  { model: 'barrel-prop', x: 5, y: 2 },
  { model: 'barrel-prop', x: 2, y: 5 },
  { model: 'crate-prop', x: 14, y: 3 },
  { model: 'crate-prop', x: 15, y: 4, rotation: 0.3 },
  { model: 'banner-prop', x: 9, y: 1 },
  { model: 'standing-torch-prop', x: 6, y: 10 },
  { model: 'standing-torch-prop', x: 12, y: 10 },
  { model: 'training-dummy-prop', x: 15, y: 10, rotation: -0.6 },
  { model: 'tree-prop', x: 0, y: 0 },
  { model: 'tree-prop', x: 17, y: 1, rotation: 0.8 },
  { model: 'tree-prop', x: 0, y: 12, rotation: 1.9 },
  { model: 'tree-prop', x: 17, y: 12, rotation: 2.6 },
  { model: 'tree-prop', x: 0, y: 7, rotation: 3.4 },
  { model: 'rock-prop', x: 7, y: 12 },
  { model: 'rock-prop', x: 12, y: 0, rotation: 1.2 },
];

/** Where each of the company stands: in a ring round the fire, a little over two tiles out. */
export function crewPlaces(): { model: string; x: number; y: number; rotation: number }[] {
  return CAMP_CREW.map((model, i) => {
    // The ring runs from the south-west round by the north to the south-east, and is open to the
    // south, where the new character comes in. Angles are on the board: y grows southward.
    const angle = Math.PI * (0.8 + (1.4 * i) / (CAMP_CREW.length - 1));
    const x = Math.round(FIRE.x + Math.cos(angle) * 2.6);
    const y = Math.round(FIRE.y + Math.sin(angle) * 2.3);
    // Each faces the fire.
    return { model, x, y, rotation: Math.atan2(FIRE.x - x, FIRE.y - y) };
  });
}

/** A camp project for a character just made: theirs, with the company at the fire. */
export function campProject(sheet: CharacterSheet, now: number = Date.now()): ProjectDoc {
  // Plain ground, with the grass, dirt and trodden grass laid on it as floor pieces at level 0 - the
  // way the demo lays its own. A ground tile painted as terrain is stamped as a piece standing on the
  // ground, which is what left the first camp floating.
  const ground: Record<string, { x: number; y: number; level: number; shape: string; material: 'stone'; rotation: number; tile: string }> = {};
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      // A trodden ring round the fire, and a path in from the south.
      const out = Math.hypot(x - FIRE.x, (y - FIRE.y) * 1.1);
      const tile = out <= 1.5 ? 'dirt' : out <= 3.6 || (x >= FIRE.x - 1 && x <= FIRE.x && y > FIRE.y) ? 'trodden' : 'grass';
      ground[`${x},${y},0`] = { x, y, level: 0, shape: 'floor', material: 'stone', rotation: 0, tile };
    }
  }
  const scene = sceneSchema.parse({ ...blankScene('camp', WIDTH, HEIGHT), name: 'The camp', intro: 'The fire is lit, and the company is gathered round it.', buildingTiles: ground });
  scene.spawns = [{ x: FIRE.x, y: FIRE.y + 4 }];
  // The one whose model the new character took stays away: nobody meets their twin at the fire.
  const company = companyFor(sheet);
  const asked = new Map(company.map(({ sheet: theirs, companion }) => [companion.creation.model, theirs.id]));
  scene.decos = [
    { id: 'camp-fire', model: 'camp-fire-prop', position: { ...FIRE }, rotation: 0, solid: true },
    {
      id: ADVENTURE_PORTAL,
      model: 'portal-prop',
      position: { ...PORTAL_AT },
      rotation: Math.atan2(FIRE.x - PORTAL_AT.x, FIRE.y - PORTAL_AT.y),
      solid: true,
      function: propFunctionSchema.parse({
        kind: 'script',
        object: 'portal',
        name: 'The portal',
        flavor: 'A ring of old stone, humming. Through it, wherever the party means to go.',
        repeatable: true,
        effects: [{ kind: 'openContainer' }],
      }),
    },
    ...crewPlaces()
      .filter((figure) => asked.has(figure.model))
      .map((figure) => ({
        id: figureOf(figure.model),
        model: figure.model,
        position: { x: figure.x, y: figure.y },
        rotation: figure.rotation,
        solid: true,
        function: { kind: 'interaction' as const, dialogue: companionDialogue(asked.get(figure.model)!) },
      })),
    ...PROPS.map((prop) => ({ id: `${prop.model}-${prop.x}-${prop.y}`, model: prop.model, position: { x: prop.x, y: prop.y }, rotation: prop.rotation ?? 0, solid: true })),
  ];
  return projectSchema.parse({
    id: `camp-${idFromName(sheet.name)}-${now.toString(36)}`,
    name: `${sheet.name}'s camp`,
    terrainPalette: PALETTE,
    scenes: [scene],
    startScene: 'camp',
    party: [sheet],
    companions: company.map(({ sheet: theirs }) => theirs),
    dialogues: company.map(({ sheet: theirs, companion }) => companionConversation(theirs, companion)),
    packs: ['srd-characters'],
  });
}
