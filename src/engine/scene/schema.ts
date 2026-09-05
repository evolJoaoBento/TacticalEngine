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

/** Kebab-case, stable across saves. */
export const contentIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'ids are lowercase kebab- or snake-case');

export const traitSchema = z.enum([
  'agility',
  'strength',
  'finesse',
  'instinct',
  'presence',
  'knowledge',
]);
export type Trait = z.infer<typeof traitSchema>;

export const rollOutcomeSchema = z.enum([
  'criticalSuccess',
  'successWithHope',
  'successWithFear',
  'failureWithHope',
  'failureWithFear',
]);

export const pointSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});
export type Point = z.infer<typeof pointSchema>;

/**
 * What an interaction does. The legacy effect vocabulary, given typed parameters
 * instead of a `param` string that every consumer re-parsed.
 */
export const effectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('open') }),
  z.object({ kind: z.literal('remove') }),
  z.object({ kind: z.literal('loot'), table: contentIdSchema.optional() }),
  z.object({ kind: z.literal('damage'), amount: z.number().int().positive() }),
  z.object({ kind: z.literal('giveKey'), key: z.string().min(1) }),
  z.object({ kind: z.literal('setFlag'), flag: z.string().min(1) }),
  z.object({ kind: z.literal('startEncounter'), encounter: contentIdSchema }),
  z.object({ kind: z.literal('goto'), scene: contentIdSchema }),
]);
export type Effect = z.infer<typeof effectSchema>;

export const outcomeSchema = z.object({
  text: z.string().default(''),
  effects: z.array(effectSchema).default([]),
});

/** An action roll gating an interaction. */
export const checkSchema = z.object({
  trait: traitSchema,
  difficulty: z.number().int().positive(),
  /**
   * Text and effects per outcome. Every entry is optional; a missing outcome
   * falls back to the next less specific one at runtime — a critical success
   * reads `successWithHope` when it has no entry of its own.
   */
  outcomes: z
    .object({
      criticalSuccess: outcomeSchema.optional(),
      successWithHope: outcomeSchema.optional(),
      successWithFear: outcomeSchema.optional(),
      failureWithHope: outcomeSchema.optional(),
      failureWithFear: outcomeSchema.optional(),
    })
    .default({}),
});
export type Check = z.infer<typeof checkSchema>;

export const interactableSchema = z.object({
  id: contentIdSchema,
  kind: z.enum(['chest', 'door', 'pillar', 'portal', 'scripted']),
  position: pointSchema,
  name: z.string().default(''),
  flavor: z.string().default(''),
  /** Model key for the renderer. `null` means present but invisible. */
  model: z.string().nullable().default(null),
  /** Whether a creature can walk through this tile. */
  blocksMovement: z.boolean().default(true),
  check: checkSchema.optional(),
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
  position: pointSchema,
  /** Per-instance overrides: a named lieutenant, a wounded straggler. */
  name: z.string().optional(),
  hitPoints: z.number().int().positive().optional(),
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
});
export type Encounter = z.infer<typeof encounterSchema>;

export const decoSchema = z.object({
  /** Optional, and only needed for decos the narrative refers to. */
  id: contentIdSchema.optional(),
  model: z.string().min(1),
  position: pointSchema,
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
    /** Visual fog wall inset from the edges, in tiles. */
    fogBand: z.number().int().positive().optional(),
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
});

export const projectSchema = z
  .object({
    /** Bumped when a migration is needed; validated so old files fail loudly. */
    formatVersion: z.literal(1).default(1),
    id: contentIdSchema,
    name: z.string().default(''),
    /** Omitted means the engine's default palette. */
    terrainPalette: z.array(terrainTypeSchema).min(1).optional(),
    scenes: z.array(sceneSchema).min(1),
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
    if (!ids.has(project.startScene)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startScene'],
        message: `startScene "${project.startScene}" is not one of the project's scenes`,
      });
    }
  });
export type ProjectDoc = z.infer<typeof projectSchema>;
