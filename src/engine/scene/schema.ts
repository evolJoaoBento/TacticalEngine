/**
 * The authored scene and project documents, as zod schemas.
 *
 * These describe *content*, never runtime state. The legacy prototype wrote play
 * state straight back into its content objects (`node.used`, `enemy.hp`,
 * `trigger.fired`), which is why it could not save a session or replay one; that
 * separation is enforced here by keeping every mutable value in `SceneState`.
 *
 * Two deliberate choices worth stating:
 *
 * - Terrain is stored **by id**, not by palette index. A palette can be reordered
 *   or extended without invalidating a single authored map.
 * - Ids are authored and stable. The legacy `'node-' + Math.random()` ids could
 *   not survive a save/load round trip, and CONTEXT.md requires stable ids.
 */

import { z } from 'zod';
import { BUILD_LIMIT, buildingTilesSchema, structureTypeSchema } from './building';
import { itemSchema, lootTableSchema } from '../content/items';
import { abilitySchema } from '../content/abilities';
import { characterSheetSchema } from '../character/sheet-schema';
import { conditionDefSchema } from '../content/conditions';
import { questSchema } from '../content/quests';
import { modelAssetSchema } from '../render/assets';
import {
  adversaryDefSchema,
  ancestryDefSchema,
  armorDefSchema,
  classDefSchema,
  communityDefSchema,
  cardDefSchema,
  subclassDefSchema,
  weaponDefSchema,
} from '../content/pack/schema';
import { dialogueSchema } from '../dialogue/schema';
import { jumpRulesSchema } from '../rules/jump';
import { checkRequestSchema, effectSchema } from '../script/schema';
import {
  contentIdSchema,
  pointSchema,
  rollOutcomeSchema,
  traitSchema,
  type Point,
} from './primitives';

// The building blocks moved to `primitives.ts` to break an import cycle with
// `script/schema.ts`; they are re-exported so importers here are unchanged.
export { contentIdSchema, pointSchema, rollOutcomeSchema, traitSchema };
export type { Point, Trait } from './primitives';

/**
 * What an interaction does, and the roll that gates it.
 *
 * Both come from `script/schema.ts`, which is the single vocabulary the runner
 * executes. They used to be a narrower set defined here, which is why an
 * authored check could be saved but never run.
 */
export { effectSchema, checkRequestSchema };
export type { Effect, CheckRequest } from '../script/schema';

/** Scenery and encounter placements can be authored beyond the tactical board. */
const placementPointSchema = z.object({
  x: z.number().int().min(-BUILD_LIMIT).max(BUILD_LIMIT),
  y: z.number().int().min(-BUILD_LIMIT).max(BUILD_LIMIT),
  z: z.number().min(-BUILD_LIMIT).max(BUILD_LIMIT).multipleOf(0.25).optional(),
});

export const interactableSchema = z.object({
  id: contentIdSchema,
  kind: z.enum(['chest', 'door', 'pillar', 'portal', 'scripted']),
  position: placementPointSchema,
  name: z.string().default(''),
  flavor: z.string().default(''),
  /** Model key for the renderer. `null` means present but invisible. */
  model: z.string().nullable().default(null),
  /**
   * Which way it faces, in radians. A door hangs in a wall and a chest opens
   * towards the room, so an object is turned as a prop is. Defaulted, so a
   * document written before objects could be turned is still a document.
   */
  rotation: z.number().default(0),
  /** Whether a creature can walk through this tile. */
  blocksMovement: z.boolean().default(true),
  /**
   * What using it does with no roll involved. Runs before any `check`, so an
   * object can say something and then ask for one — or, with no check at all,
   * simply open a conversation.
   */
  effects: z.array(effectSchema).default([]),
  check: checkRequestSchema.optional(),
  /**
   * Usable again after the first time. A conversation wants this; a chest with
   * one set of loot in it does not.
   */
  repeatable: z.boolean().default(false),
  /** The party must hold this key to interact at all. */
  requiresKey: z.string().optional(),
  lockedText: z.string().default(''),
  /** Travel to another scene, with no roll. */
  goto: contentIdSchema.optional(),
  /**
   * Free-form markers a campaign script reads: the legacy one-shot's `heroKey`,
   * `crank`, `pillar` and `hagNode` flags all land here rather than becoming
   * engine concepts.
   */
  tags: z.array(z.string()).default([]),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
});
export type Interactable = z.infer<typeof interactableSchema>;

/** One adversary placed in a scene, referring to imported adversary content. */
export const adversaryPlacementSchema = z.object({
  id: contentIdSchema,
  /** Id of an `AdversaryDef` — see `content/srd/seansbox-adversaries.ts`. */
  adversary: contentIdSchema,
  position: placementPointSchema,
  /** Per-instance overrides: a named lieutenant, a wounded straggler. */
  name: z.string().optional(),
  hitPoints: z.number().int().positive().optional(),
  /**
   * Draw this one creature with something other than what its type uses. Unset
   * is the ordinary case: the type's entry in `adversaryModels` decides, and
   * failing that the adversary's own id.
   */
  model: z.string().min(1).optional(),
});
export type AdversaryPlacement = z.infer<typeof adversaryPlacementSchema>;

/**
 * A named encounter. The legacy prototype keyed combat off an integer `group` and
 * kept one trigger per group; naming them lets an encounter carry its own
 * trigger, objective and reward data.
 */
export const encounterSchema = z.object({
  id: contentIdSchema,
  name: z.string().default(''),
  adversaries: z.array(adversaryPlacementSchema).default([]),
  /** Stepping on any of these cells starts the encounter. */
  triggerCells: z.array(pointSchema).default([]),
  /** Whether it starts on its own, or waits for an effect to start it. */
  startsOnTrigger: z.boolean().default(true),
  /**
   * Its creatures stand on the map on nobody's side: a gallery, a crowd, prisoners in a cell.
   *
   * A fight counts every adversary in the room, whichever encounter placed it -- they all take the
   * GM's turns and the fight is not won while one stands. So creatures that are only there to be
   * looked at cannot be adversaries at all, and this is what says so: they are stood up neutral,
   * with their stat block and their model, and no fight ever counts them.
   */
  bystanders: z.boolean().optional(),
});
export type Encounter = z.infer<typeof encounterSchema>;

export const decoSchema = z.object({
  /** Optional, and only needed for decos the narrative refers to. */
  id: contentIdSchema.optional(),
  model: z.string().min(1),
  position: placementPointSchema,
  /** Rotation in radians. */
  rotation: z.number().default(0),
});
export type Deco = z.infer<typeof decoSchema>;

export const sceneSchema = z
  .object({
    id: contentIdSchema,
    name: z.string().default(''),
    intro: z.string().default(''),
    width: z.number().int().positive().max(512),
    height: z.number().int().positive().max(512),
    /** Terrain ids, row-major, `width * height` long. */
    terrain: z.array(z.string().min(1)),
    /** Elevation levels, row-major, `width * height` long. */
    heights: z.array(z.number().int()),
    /**
     * Per-tile CSS colour, row-major. Presentation only — the rules never read it —
     * but it is authored, so it belongs to the document.
     */
    tints: z.array(z.string()).optional(),
    spawns: z.array(pointSchema).min(1),
    interactables: z.array(interactableSchema).default([]),
    encounters: z.array(encounterSchema).default([]),
    decos: z.array(decoSchema).default([]),
    /** Sparse, stackable scenery outside the tactical height field as well as within it. */
    buildingTiles: buildingTilesSchema.optional(),
    /** Visual fog wall inset from the edges, in tiles. */
    fogBand: z.number().int().positive().optional(),
    /**
     * How far the room has grown west and north since it was made, in tiles: where the cell
     * that was `0,0` is now. Nothing in the room reads it - every coordinate was moved when the
     * corner was - but a game already being played here holds tiles counted from the old corner,
     * and this is how it learns how far they slid. Absent means the corner never moved.
     */
    origin: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
  })
  .superRefine((scene, ctx) => {
    const expected = scene.width * scene.height;
    for (const [field, array] of [
      ['terrain', scene.terrain],
      ['heights', scene.heights],
      ['tints', scene.tints],
    ] as const) {
      if (array !== undefined && array.length !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `expected ${expected} entries for a ${scene.width}x${scene.height} scene, got ${array.length}`,
        });
      }
    }
    const inBounds = (p: Point): boolean =>
      p.x < scene.width && p.y < scene.height;
    scene.spawns.forEach((p, i) => {
      if (!inBounds(p)) {
        ctx.addIssue({ code: 'custom', path: ['spawns', i], message: 'spawn is outside the scene' });
      }
    });
    const seen = new Set<string>();
    const requireUniqueId = (id: string, path: (string | number)[]): void => {
      if (seen.has(id)) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate id "${id}" in this scene` });
      }
      seen.add(id);
    };
    scene.interactables.forEach((it, i) => requireUniqueId(it.id, ['interactables', i, 'id']));
    scene.encounters.forEach((e, i) => {
      requireUniqueId(e.id, ['encounters', i, 'id']);
      e.adversaries.forEach((a, j) =>
        requireUniqueId(a.id, ['encounters', i, 'adversaries', j, 'id']),
      );
    });
  });
export type SceneDoc = z.infer<typeof sceneSchema>;

export const terrainTypeSchema = z.object({
  id: contentIdSchema,
  name: z.string().default(''),
  passable: z.boolean().default(true),
  cost: z.number().positive().default(1),
  providesCover: z.boolean().default(false),
  blocksSight: z.boolean().default(false),
  /** The ground's colour where this type lies, unless a tile has a tint of its own. */
  color: z.string().min(1).optional(),
  /** Drawn with this model on every tile of the type, rather than as coloured ground. */
  model: z.string().min(1).optional(),
  /**
   * How big that model stands, in tiles: `1` fills the cell. Absolute, replacing what the
   * model declares for itself — the same file is a creature shrunk into one cell and a
   * floor piece authored to fill it. Absent means the model's own size.
   */
  scale: z.number().positive().optional(),
  /**
   * The structure a tile of this kind is, by id. Absent means ground, which is what every
   * kind of tile was before there were both. Not an enum: a project declares its own
   * structures, so the list cannot live in the schema - `isStructure` is where that
   * question is asked, the same move `buildingTileSchema.shape` made.
   */
  structure: z.string().min(1).optional(),
});

/**
 * A piece of logic in code the project carries. The body is a JavaScript
 * function body run against a hook context (`script/hooks.ts`); `id` is what
 * a `run` effect or a `hook` condition names.
 */
export const codeSchema = z.object({
  id: contentIdSchema,
  name: z.string().default(''),
  /** What it is for, in words, for whoever opens the project next. */
  notes: z.string().default(''),
  source: z.string().default(''),
});

export type CodeDef = z.infer<typeof codeSchema>;

/**
 * The document version this build writes.
 *
 * A stored document older than this is rewritten at the door by `migrateDocument` before any
 * schema sees it; one newer is refused, because guessing at a format from a build that does not
 * exist yet is how a file gets quietly corrupted.
 */
export const CURRENT_FORMAT_VERSION = 5;


export const projectSchema = z
  .object({
    /**
     * Bumped when a persisted name changes. Both versions are accepted because a document
     * arrives here already migrated — `migrateDocument` runs at the door, before any schema —
     * and a project built in code is current by construction. A version this build does not
     * know is refused, which is what tells a player their file is from a newer build.
     */
    formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).default(CURRENT_FORMAT_VERSION),
    id: contentIdSchema,
    name: z.string().default(''),
    /** Omitted means the engine's default palette. */
    terrainPalette: z.array(terrainTypeSchema).min(1).optional(),
    /**
     * Structures the project declares, each some of the engine's four atoms put together.
     * The four are always present and always first, so a document naming one of them
     * resolves whatever this says; these are the ones beyond them.
     *
     * Optional rather than defaulted, like `terrainPalette` beside it: a default would
     * make a parsed document differ from the one it was parsed from, and would oblige
     * every project built in code to carry an empty array it never asked for.
     */
    structureTypes: z.array(structureTypeSchema).optional(),
    scenes: z.array(sceneSchema).min(1),
    /**
     * Conversations, addressed by id from a `startDialogue` effect. Project-level
     * rather than per-scene: the same character can be talked to in two places.
     */
    dialogues: z.array(dialogueSchema).default([]),
    /** Everything the party could carry in this campaign. */
    items: z.array(itemSchema).default([]),
    /** What a `loot` effect draws from. */
    lootTables: z.array(lootTableSchema).default([]),
    /**
     * What the party can be asked to do. Defaulted rather than versioned: a
     * project written before quests existed is still a valid project.
     */
    quests: z.array(questSchema).default([]),
    /** Imported models, by id. Content names them exactly as it names a procedural model. */
    assets: z.array(modelAssetSchema).default([]),
    /**
     * What each adversary type is drawn with, by adversary id. A type with no
     * entry here falls back to the game's own map and then to the adversary id
     * itself. Defaulted, so a project written before creatures could be
     * re-skinned is still a project.
     */
    adversaryModels: z.record(z.string(), z.string().min(1)).default({}),
    /**
     * The character content this project is played with: what a sheet's class,
     * ancestry and cards are chosen from. Defaulted like every other list here,
     * so a project written before content became data is still a project, and
     * an empty list means "whatever pack the app was given".
     */
    classes: z.array(classDefSchema).default([]),
    ancestries: z.array(ancestryDefSchema).default([]),
    communities: z.array(communityDefSchema).default([]),
    subclasses: z.array(subclassDefSchema).default([]),
    cards: z.array(cardDefSchema).default([]),
    weapons: z.array(weaponDefSchema).default([]),
    armors: z.array(armorDefSchema).default([]),
    /** The stat blocks its encounters place, by the ids those placements name. */
    adversaries: z.array(adversaryDefSchema).default([]),
    /**
     * What characters can do: domain cards, Light features, subclass features,
     * with their scripts. Defaulted, so an older project is still a project.
     */
    abilities: z.array(abilitySchema).default([]),
    /**
     * Logic in code, for what the effect vocabulary cannot say. Defaulted: a
     * project that never needed code is still a project.
     */
    code: z.array(codeSchema).default([]),
    /** What a named condition does to its bearer. Defaulted, like abilities. */
    conditionDefs: z.array(conditionDefSchema).default([]),
    /**
     * The party, as authored sheets. Everything mechanical is derived from the
     * class, ancestry and equipment a sheet names, so what is written down here
     * is the character rather than their numbers. Defaulted: a project written
     * before the party moved into the file is still a project, and the game
     * falls back on the sheets it ships with.
     */
    party: z.array(characterSheetSchema).default([]),
    /**
     * The house rule for height: what a step is, who jumps how far, the roll it asks, what a
     * fall costs. Optional rather than defaulted, like `terrainPalette`: a project that says
     * nothing plays by `DEFAULT_JUMP_RULES`, and saving it does not write them down.
     */
    jump: jumpRulesSchema.optional(),
    /** Scene the project opens on. */
    startScene: contentIdSchema,
  })
  .superRefine((project, ctx) => {
    const ids = new Set<string>();
    project.scenes.forEach((scene, i) => {
      if (ids.has(scene.id)) {
        ctx.addIssue({ code: 'custom', path: ['scenes', i, 'id'], message: `duplicate scene id "${scene.id}"` });
      }
      ids.add(scene.id);
    });
    const dialogueIds = new Set<string>();
    project.dialogues.forEach((dialogue, i) => {
      if (dialogueIds.has(dialogue.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['dialogues', i, 'id'],
          message: `duplicate dialogue id "${dialogue.id}"`,
        });
      }
      dialogueIds.add(dialogue.id);
    });
    const seen = new Set<string>();
    project.items.forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'id'], message: `duplicate item id "${item.id}"` });
      }
      seen.add(item.id);
    });
    const assetIds = new Set<string>();
    project.assets.forEach((asset, i) => {
      if (assetIds.has(asset.id)) {
        ctx.addIssue({ code: 'custom', path: ['assets', i, 'id'], message: `duplicate asset id "${asset.id}"` });
      }
      assetIds.add(asset.id);
    });
    const questIds = new Set<string>();
    project.quests.forEach((quest, i) => {
      if (questIds.has(quest.id)) {
        ctx.addIssue({ code: 'custom', path: ['quests', i, 'id'], message: `duplicate quest id "${quest.id}"` });
      }
      questIds.add(quest.id);
    });
    const abilityIds = new Set<string>();
    const partyIds = new Set<string>();
    project.party.forEach((sheet, i) => {
      if (partyIds.has(sheet.id)) {
        ctx.addIssue({ code: 'custom', path: ['party', i, 'id'], message: `duplicate character id "${sheet.id}"` });
      }
      partyIds.add(sheet.id);
    });
    project.abilities.forEach((ability, i) => {
      if (abilityIds.has(ability.id)) {
        ctx.addIssue({ code: 'custom', path: ['abilities', i, 'id'], message: `duplicate ability id "${ability.id}"` });
      }
      abilityIds.add(ability.id);
    });
    const tables = new Set<string>();
    project.lootTables.forEach((table, i) => {
      if (tables.has(table.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lootTables', i, 'id'],
          message: `duplicate loot table id "${table.id}"`,
        });
      }
      tables.add(table.id);
    });
    if (!ids.has(project.startScene)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startScene'],
        message: `startScene "${project.startScene}" is not one of the project's scenes`,
      });
    }
  });
export type ProjectDoc = z.infer<typeof projectSchema>;
