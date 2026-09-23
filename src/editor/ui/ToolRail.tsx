/**
 * A mode's tools, as a column of icons down the left of the board.
 *
 * Erase is the one tool two modes share, and it removes different things in
 * each, so its label says which.
 */

import type { EditorTool } from '../controller';
import type { EditorMode } from '../modes';
import { Icon } from './icons';

/** A tool's name, for a title, a button label, and the strip's hint text. */
export const TOOL_LABELS: Readonly<Record<EditorTool, string>> = {
  eraseTile: 'Erase building tiles',
  select: 'Select',
  placeTile: 'Place tiles',
  raise: 'Raise ground',
  lower: 'Lower ground',
  prop: 'Place a prop',
  adversary: 'Place a creature',
  trigger: 'Trigger cells',
  spawn: 'Party start',
  erase: 'Erase',
};

function labelFor(tool: EditorTool, mode: EditorMode): string {
  if (tool !== 'erase') return TOOL_LABELS[tool];
  return mode === 'combat' ? 'Erase a creature, trigger cell or party start' : 'Erase a prop or object';
}

/** What the rail needs to draw a mode's tools and report a pick. */
export interface ToolRailProps {
  mode: EditorMode;
  tools: readonly EditorTool[];
  current: EditorTool;
  onTool: (tool: EditorTool) => void;
}

export function ToolRail(props: ToolRailProps): preact.JSX.Element {
  return (
    <aside class="ph-rail ph-panel" data-testid="tool-rail">
      {props.tools.map((tool) => (
        <button
          key={tool}
          class={tool === props.current ? 'ph-tool ph-on' : 'ph-tool'}
          title={labelFor(tool, props.mode)}
          aria-label={labelFor(tool, props.mode)}
          aria-pressed={tool === props.current ? 'true' : 'false'}
          data-tool={tool}
          onClick={() => props.onTool(tool)}
        >
          <Icon name={tool} />
        </button>
      ))}
    </aside>
  );
}
