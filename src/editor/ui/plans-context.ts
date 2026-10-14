/**
 * What an effect list offers that only the editor's shell knows, handed to every effect list under it at once
 * (`EditorShell`) rather than down through every panel that draws one: the project plans a "Teach a project plan"
 * effect can name, and the cards and the party members a "Give a card" effect can name.
 */

import { createContext } from 'preact';

export interface EffectChoices {
  planIds: readonly string[];
  cardIds: readonly string[];
  partyIds: readonly string[];
}

export const EffectChoicesContext = createContext<EffectChoices>({ planIds: [], cardIds: [], partyIds: [] });
