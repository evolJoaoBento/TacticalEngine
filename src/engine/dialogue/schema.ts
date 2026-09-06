/**
 * Dialogue as authored data.
 *
 * `dialogue.ts` could always *run* a conversation; nothing could *hold* one. A
 * `Dialogue` was a TypeScript literal, so it could not be saved with a project,
 * edited in a tool, or shipped by anyone who was not editing the engine — the
 * same gap interactable checks had before `script/schema.ts`, and closed the same
 * way: this is the single shape, and `dialogue.ts` takes its types from here.
 *
 * Conditions, effects and checks come from `script/schema.ts` rather than being
 * restated, so a reply can do anything any other effect can.
 */

import { z } from 'zod';
import { contentIdSchema } from '../scene/primitives';
import { checkRequestSchema, conditionSchema, effectSchema } from '../script/schema';

export const dialogueLineSchema = z.object({
  /** Who is talking. Omitted for narration. */
  speaker: z.string().optional(),
  text: z.string(),
});

/**
 * A check inside a conversation: the ordinary check, plus somewhere to go
 * depending on how it went.
 */
export const dialogueCheckSchema = checkRequestSchema.extend({
  gotoOnSuccess: z.string().min(1).optional(),
  gotoOnFailure: z.string().min(1).optional(),
});

export const dialogueChoiceSchema = z.object({
  /** What the player's reply says. */
  text: z.string().min(1),
  /** A hint at the cost or consequence, shown under the reply. */
  detail: z.string().optional(),
  /** Hidden entirely when this fails, which is how knowledge gates a reply. */
  available: conditionSchema.optional(),
  /** Shown but not selectable when this fails — a visible locked option. */
  enabled: conditionSchema.optional(),
  check: dialogueCheckSchema.optional(),
  effects: z.array(effectSchema).optional(),
  /** Where to go next. Omitted ends the conversation. */
  goto: z.string().min(1).optional(),
});

/**
 * Where a node sits on the editor's canvas.
 *
 * Floats with no lower bound: these are canvas coordinates, not tile ones, and
 * keeping a dragged node out of negative space is the editor's policy rather
 * than something the document should refuse to hold. Optional, so a dialogue
 * written by hand parses and gets laid out automatically.
 */
export const canvasPointSchema = z.object({ x: z.number(), y: z.number() });

export const dialogueNodeSchema = z.object({
  id: z.string().min(1),
  position: canvasPointSchema.optional(),
  lines: z.array(dialogueLineSchema).default([]),
  /** Run when the node is entered, before its lines are shown. */
  onEnter: z.array(effectSchema).optional(),
  choices: z.array(dialogueChoiceSchema).optional(),
  /** Where to go with no choices at all — a straight line of narration. */
  goto: z.string().min(1).optional(),
});

export const dialogueSchema = z
  .object({
    id: contentIdSchema,
    start: z.string().min(1),
    nodes: z.array(dialogueNodeSchema).min(1),
  })
  .superRefine((dialogue, ctx) => {
    // A repeated node id makes `DialogueRunner` throw at construction; catching
    // it here means a bad file is rejected on load rather than mid-conversation.
    const seen = new Set<string>();
    dialogue.nodes.forEach((node, i) => {
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', i, 'id'],
          message: `duplicate node id "${node.id}"`,
        });
      }
      seen.add(node.id);
    });
    if (!seen.has(dialogue.start)) {
      ctx.addIssue({
        code: 'custom',
        path: ['start'],
        message: `start "${dialogue.start}" is not one of the dialogue's nodes`,
      });
    }
  });

export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export type DialogueCheck = z.infer<typeof dialogueCheckSchema>;
export type DialogueChoice = z.infer<typeof dialogueChoiceSchema>;
export type DialogueNode = z.infer<typeof dialogueNodeSchema>;
export type Dialogue = z.infer<typeof dialogueSchema>;
