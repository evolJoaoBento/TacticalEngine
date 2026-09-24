/**
 * Every name a project could be drawing a model by.
 *
 * What decides whether a model a project declares is one it uses: a save leaves out an embedded
 * model nothing names (`editor/asset-edits.ts`), so a model imported once and never placed does not
 * ride along in every file after it.
 *
 * Erring wide is the point. A model is named in many places - a prop, an object, a creature and its
 * type, a character, a kind of ground, a remix - and a creature or a character with no model of its
 * own is drawn by its stat block's or its class's id, which a summon inside a card's script can name
 * too. So rather than a list of fields that the next field would slip past, every string anywhere in
 * the document except the model declarations themselves counts. A name counted that draws nothing
 * keeps a few bytes; a name missed would drop a model a room is drawn with.
 */

import { OBJECT_BODIES } from './prop-functions';
import type { ProjectDoc } from './schema';

export function modelNamesIn(project: ProjectDoc): Set<string> {
  const named = new Set<string>(Object.values(OBJECT_BODIES));
  const walk = (value: unknown): void => {
    if (typeof value === 'string') named.add(value);
    else if (Array.isArray(value)) for (const item of value) walk(item);
    else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) walk(item);
  };
  for (const [key, value] of Object.entries(project)) if (key !== 'assets') walk(value);
  return named;
}
