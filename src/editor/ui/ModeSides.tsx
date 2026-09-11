/**
 * What sits beside the board in each mode.
 *
 * Inspector: the selected object's properties (the object inspector from the
 * side panel; everything else joins it in the next slice). Terrain and Combat:
 * what the tool in hand does, the brush, the encounter creatures go into.
 * Interaction: the conversations, each opening its graph.
 */

import type { QuestDef } from '../../engine/content/quests';
import { useState } from 'preact/hooks';
import {
  BUILD_LIMIT,
  BUILD_MATERIALS,
  BUILD_MATERIAL_IDS,
  BUILD_SHAPES,
  isBuildCoordinate,
  isBuildZ,
} from '../../engine/scene/building';
import { dialogueSchema } from '../../engine/dialogue/schema';
import type { EditorController, EditorTool } from '../controller';
import {
  addDialogue,
  removeDialogue,
  removeInteractable,
  updateInteractable,
  type EditorSession,
} from '../session';
import { Inspector } from './Inspector';
import { TOOL_LABELS } from './ToolRail';

/** The ids an effect list picks from rather than having them typed. */
export interface PickableIds {
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

/** Inspector mode's side: the clicked object's properties, or a hint to click one. */
export function InspectorSide(props: {
  session: EditorSession;
  controller: EditorController;
  ids: PickableIds;
  onChange: () => void;
}): preact.JSX.Element {
  const { session, controller } = props;
  const object = controller.selectedInteractable();
  const sceneId = controller.sceneId;
  return (
    <aside class="ph-side ph-panel" data-testid="inspector-side">
      {object === null ? (
        <div class="ph-hint">Click an object on the board to change what it is and what it does.</div>
      ) : (
        <Inspector
          interactable={object}
          {...props.ids}
          onChange={(changes) => {
            session.run(updateInteractable(sceneId, object.id, changes));
            props.onChange();
          }}
          onDelete={() => {
            session.run(removeInteractable(sceneId, object.id));
            controller.selected = null;
            props.onChange();
          }}
        />
      )}
    </aside>
  );
}

const TERRAIN_HINTS: Partial<Record<EditorTool, string>> = {
  buildTile: 'Drag to place pieces at Z height. Each new stroke adds pieces, including at occupied positions. R turns walls to the next edge.',
  eraseTile: 'Drag to remove the latest piece at each position and Z height. Click again to remove the next overlapping piece.',
  paintTerrain: 'Drag across the board to paint the ground picked below.',
  raise: 'Drag to raise the ground a level. One drag is one undo.',
  lower: 'Drag to lower the ground a level. One drag is one undo.',
  prop: 'Click to place the prop picked below; click it again to turn it.',
  interactable: 'Click to place the object picked below; click an object again to remove it.',
  erase: 'Click a prop to remove it, then the object under it.',
};

const BRUSHED: readonly EditorTool[] = ['paintTerrain', 'raise', 'lower', 'buildTile', 'eraseTile'];

/** Tools that place at `buildLevel`, and so want the Z controls beside them. */
const LEVELLED: readonly EditorTool[] = ['buildTile', 'eraseTile', 'prop', 'interactable'];

/** The four edges a wall can sit on, in the order its rotation numbers them. */
const WALL_EDGES: readonly string[] = ['North', 'West', 'South', 'East'];

/** A number typed into a field, with an empty box meaning "nothing yet" rather than 0. */
function typedNumber(value: string, valid: (n: number) => boolean): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return valid(n) ? n : null;
}

/** Terrain mode's side: the tool in hand, and the brush size when one applies. */
export function TerrainSide(props: {
  controller: EditorController;
  onChange: () => void;
  onNavigate?: (x: number, y: number) => void;
}): preact.JSX.Element {
  const { controller } = props;
  const tool = controller.state.tool;
  const building = tool === 'buildTile' || tool === 'eraseTile';
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const goX = typedNumber(x, isBuildCoordinate);
  const goY = typedNumber(y, isBuildCoordinate);
  const setZ = (value: number): void => {
    controller.setBuildLevel(value);
    props.onChange();
  };
  const setRotation = (rotation: number): void => {
    controller.end();
    controller.set('buildRotation', rotation);
    props.onChange();
  };
  return (
    <aside class="ph-side ph-panel" data-testid="terrain-side">
      <div class="ph-heading">{TOOL_LABELS[tool]}</div>
      <div class="ph-hint">{TERRAIN_HINTS[tool] ?? ''}</div>
      {building ? (
        <>
          <div class="ph-heading">Tile pieces</div>
          <div class="ph-row ph-build-pieces">
            {BUILD_SHAPES.map((shape) => (
              <button
                key={shape}
                class={controller.state.buildShape === shape ? 'ph-chip ph-on' : 'ph-chip'}
                data-testid={`build-${shape}`}
                onClick={() => {
                  controller.set('buildShape', shape);
                  props.onChange();
                }}
              >
                {shape[0]!.toUpperCase() + shape.slice(1)}
              </button>
            ))}
          </div>
          <div class="ph-heading">Material</div>
          <div class="ph-row">
            {BUILD_MATERIAL_IDS.map((material) => (
              <button
                key={material}
                class={controller.state.buildMaterial === material ? 'ph-chip ph-on' : 'ph-chip'}
                style={{ borderBottom: `3px solid ${BUILD_MATERIALS[material]}` }}
                onClick={() => {
                  controller.set('buildMaterial', material);
                  props.onChange();
                }}
              >
                {material}
              </button>
            ))}
          </div>
          {controller.state.buildShape === 'wall' ? (
            <>
              <div class="ph-heading">Wall edge</div>
              <div class="ph-row">
                {WALL_EDGES.map((edge, rotation) => (
                  <button
                    key={edge}
                    class={controller.state.buildRotation === rotation ? 'ph-chip ph-on' : 'ph-chip'}
                    aria-label={`Wall ${edge}`}
                    onClick={() => setRotation(rotation)}
                  >
                    {edge}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <label class="ph-heading">
            Piece height (Z)
            <input
              class="ph-input"
              aria-label="Piece height"
              type="number"
              min="0.25"
              max="16"
              step="0.25"
              value={controller.state.buildHeight}
              onChange={(e) => {
                const value = Number(e.currentTarget.value);
                if (value < 0.25 || value > 16 || !Number.isInteger(value * 4)) return;
                controller.end();
                controller.set('buildHeight', value);
                props.onChange();
              }}
            />
          </label>
          <button
            class="ph-item"
            data-testid="build-rotate"
            onClick={() => setRotation((controller.state.buildRotation + 1) % 4)}
          >
            Rotate · {controller.state.buildRotation * 90}° (R)
          </button>
        </>
      ) : null}
      {LEVELLED.includes(tool) ? (
        <>
          <div class="ph-heading">Z · Vertical position</div>
          <div class="ph-row">
            <button
              class="ph-chip"
              aria-label="Lower build level"
              disabled={controller.state.buildLevel <= -BUILD_LIMIT}
              onClick={() => setZ(controller.state.buildLevel - 0.25)}
            >
              −
            </button>
            <input
              class="ph-input"
              aria-label="Build level"
              title="Z height in tile units"
              type="number"
              step="0.25"
              min={-BUILD_LIMIT}
              max={BUILD_LIMIT}
              value={controller.state.buildLevel}
              onChange={(e) => {
                const value = typedNumber(e.currentTarget.value, isBuildZ);
                if (value !== null) setZ(value);
              }}
            />
            <button
              class="ph-chip"
              aria-label="Raise build level"
              disabled={controller.state.buildLevel >= BUILD_LIMIT}
              onClick={() => setZ(controller.state.buildLevel + 0.25)}
            >
              +
            </button>
          </div>
          <div class="ph-heading">Go to coordinates</div>
          <div class="ph-row">
            <input class="ph-input" aria-label="Build X" type="number" value={x} onInput={(e) => setX(e.currentTarget.value)} />
            <input class="ph-input" aria-label="Build Y" type="number" value={y} onInput={(e) => setY(e.currentTarget.value)} />
            <button
              class="ph-chip"
              disabled={goX === null || goY === null}
              onClick={() => {
                if (goX !== null && goY !== null) props.onNavigate?.(goX, goY);
              }}
            >
              Go
            </button>
          </div>
          <div class="ph-note">
            Build up to ±1,000,000 tiles in each direction. Right-drag or WASD pans; wheel zooms.
            Page Up/Down changes level.
          </div>
          {building ? (
            <div class="ph-note">
              Building tiles are scenery. Party movement still uses the original ground map.
            </div>
          ) : null}
        </>
      ) : null}
      {BRUSHED.includes(tool) ? (
        <>
          <div class="ph-heading">Brush</div>
          <div class="ph-row">
            {[1, 3, 5].map((size) => (
              <button
                key={size}
                class={controller.state.brushSize === size ? 'ph-chip ph-on' : 'ph-chip'}
                data-brush={size}
                onClick={() => {
                  controller.set('brushSize', size);
                  props.onChange();
                }}
              >
                {size}×{size}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}

const COMBAT_HINTS: Partial<Record<EditorTool, string>> = {
  adversary: 'Click to place the creature picked below in the encounter.',
  trigger: 'Click the cells that start the encounter when the party steps on one.',
  spawn: 'Click to add or remove a place the party starts.',
  erase: 'Click a creature to remove it, then a trigger cell, then a party start.',
};

/** Combat mode's side: the tool in hand, and which encounter placements go into. */
export function CombatSide(props: { controller: EditorController; onChange: () => void }): preact.JSX.Element {
  const { controller } = props;
  const scene = controller.scene;
  const tool = controller.state.tool;
  const current = controller.state.encounterId ?? scene.encounters[0]?.id ?? '';
  return (
    <aside class="ph-side ph-panel" data-testid="combat-side">
      <div class="ph-heading">{TOOL_LABELS[tool]}</div>
      <div class="ph-hint">{COMBAT_HINTS[tool] ?? ''}</div>
      <label class="ph-heading">
        Z · Creature height
        <input
          class="ph-input"
          aria-label="Creature Z"
          type="number"
          step="0.25"
          min={-BUILD_LIMIT}
          max={BUILD_LIMIT}
          value={controller.state.buildLevel}
          onChange={(e) => {
            const value = typedNumber(e.currentTarget.value, isBuildZ);
            if (value === null) return;
            controller.setBuildLevel(value);
            props.onChange();
          }}
        />
      </label>
      <div class="ph-heading">Encounter</div>
      {scene.encounters.length === 0 ? (
        <div class="ph-hint">None yet. The first creature or trigger cell you place starts one.</div>
      ) : (
        <select
          class="ph-select"
          data-testid="encounter-select"
          value={current}
          onChange={(e) => {
            controller.set('encounterId', (e.target as HTMLSelectElement).value);
            props.onChange();
          }}
        >
          {scene.encounters.map((encounter) => (
            <option key={encounter.id} value={encounter.id}>
              {encounter.name || encounter.id} · {encounter.adversaries.length} creatures · {encounter.triggerCells.length} cells
            </option>
          ))}
        </select>
      )}
    </aside>
  );
}

/** Interaction mode's side: the project's conversations, each opening its graph. */
export function InteractionSide(props: {
  session: EditorSession;
  onOpen: (dialogueId: string) => void;
  onChange: () => void;
}): preact.JSX.Element {
  const { session } = props;
  return (
    <aside class="ph-side ph-side-left ph-panel" data-testid="interaction-side">
      <div class="ph-heading">Conversations</div>
      {session.project.dialogues.map((entry) => (
        <div key={entry.id} class="ph-row">
          <button class="ph-item" onClick={() => props.onOpen(entry.id)}>
            {entry.id} <small>{entry.nodes.length} nodes</small>
          </button>
          <button
            class="ph-mini"
            title="Delete this conversation"
            onClick={() => {
              if (!confirm(`Delete "${entry.id}"?`)) return;
              session.run(removeDialogue(entry.id));
              props.onChange();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        class="ph-item"
        data-testid="add-conversation"
        onClick={() => {
          const name = prompt('Conversation id', 'a-conversation');
          if (name === null || name === '') return;
          const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          if (id === '' || session.project.dialogues.some((d) => d.id === id)) return;
          session.run(
            addDialogue(dialogueSchema.parse({ id, start: 'start', nodes: [{ id: 'start', lines: [{ text: '' }] }] })),
          );
          props.onOpen(id);
          props.onChange();
        }}
      >
        + Conversation
      </button>
      <div class="ph-note">
        What an object does is still edited in the Inspector. It moves here with the interaction graph.
      </div>
    </aside>
  );
}
