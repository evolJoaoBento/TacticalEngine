/**
 * The project plans a `learnPlan` effect can name, handed to every effect list under the editor's shell at once
 * (`EditorShell`), rather than down through every panel that draws one.
 */

import { createContext } from 'preact';

export const PlanIds = createContext<readonly string[]>([]);
