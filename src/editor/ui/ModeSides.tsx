/**
 * What sits beside the board in each mode.
 *
 * Inspector: the selected object's properties (the object inspector from the
 * side panel; everything else joins it in the next slice). Terrain and Combat:
 * what the tool in hand does, the brush, the encounter creatures go into.
 * Interaction: the conversations, each opening its graph.
 */

import type { QuestDef } from '../../engine/content/quests';
import { useRef, useState } from 'preact/hooks';
import {
  LADDER_REACH,
  Z_STEP,
  levelFromDrag,
  roundToStep,
  rungFalloff,
  rungLabelled,
  rungSize,
} from '../height-ladder';
import {
  BUILD_LIMIT,
  BUILD_MATERIALS,
  BUILD_MATERIAL_IDS,
  isBuildCoordinate,
  isBuildZ,
} from '../../engine/scene/building';
import { dialogueSchema } from '../../engine/dialogue/schema';
import type { EditorController, EditorTool } from '../controller';
import {
  addDialogue,
  removeDialogue,
  removeInteractable,
  setAdversaryModel,
  updateAdversary,
  updateInteractable,
  type EditorSession,
} from '../session';
import { MODELS } from '../../engine/render/procedural/registry';
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
        <div class="ph-hint">Click an object on the board to change what it is and what it does. Drag anything on the board, a creature, a prop, an object or a party start, to move it.</div>
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
  eraseTile: 'Drag to remove the latest piece at each position and Z height. Click again to remove the next overlapping piece.',
  placeTile: 'Click to put down the tile picked below. A kind that is a structure is stamped at Z height and stacks; one that is not is painted flat. The brush covers a square either way.',
  raise: 'Drag to raise the ground a level. One drag is one undo.',
  lower: 'Drag to lower the ground a level. One drag is one undo.',
  prop: 'Hold Alt and point the mouse in the direction the prop should face, then click to place. Click an existing matching prop to turn it.',
  interactable: 'Click to place the object picked below; click an object again to remove it.',
  erase: 'Click a prop to remove it, then the object under it.',
};

const BRUSHED: readonly EditorTool[] = ['placeTile', 'raise', 'lower', 'eraseTile'];

/** Tools that place at `buildLevel`, and so want the Z controls beside them. */
const LEVELLED: readonly EditorTool[] = ['placeTile', 'eraseTile', 'prop', 'interactable'];

/**
 * The board-edge elevation ladder shared by terrain placement and creatures.
 *
 * One rung per quarter tile, drawn large around the level being placed at and
 * shrinking away from it, so the level the author is aiming for is the easiest
 * one to hit. Drag the ladder to scrub, click a rung to jump to it, or use the
 * buttons and the box for exact values — `height-ladder.ts` holds the maths.
 */
export function PlacementHeightControl(props: {
  controller: EditorController;
  onChange: () => void;
  kind: 'terrain' | 'creature';
}): preact.JSX.Element | null {
  const { controller } = props;
  const drag = useRef<
    { startY: number; startLevel: number; moved: boolean; captured: boolean } | null
  >(null);
  const justDragged = useRef(false);
  const visible = props.kind === 'creature'
    ? controller.state.tool === 'adversary'
    : LEVELLED.includes(controller.state.tool);
  if (!visible) return null;
  const level = controller.state.buildLevel;
  const setLevel = (value: number): void => {
    const clamped = Math.max(-BUILD_LIMIT, Math.min(BUILD_LIMIT, value));
    if (!isBuildZ(clamped)) return;
    if (clamped === controller.state.buildLevel) return;
    controller.setBuildLevel(clamped);
    props.onChange();
  };
  const stepBy = (by: number): void => {
    setLevel(roundToStep(level + by));
  };
  const inputLabel = props.kind === 'creature' ? 'Creature Z' : 'Build level';
  const rungs: preact.JSX.Element[] = [];
  for (let offset = LADDER_REACH; offset >= -LADDER_REACH; offset -= 1) {
    const value = roundToStep(level + offset * Z_STEP);
    if (Math.abs(value) > BUILD_LIMIT) continue;
    const size = rungSize(offset, value);
    const current = offset === 0;
    const whole = Number.isInteger(value);
    rungs.push(
      <button
        key={offset}
        class={current ? 'ph-height-rung ph-on' : 'ph-height-rung'}
        style={{ height: `${size.height}px`, opacity: size.opacity }}
        aria-label={`Z ${value}`}
        onClick={() => {
          if (justDragged.current) {
            justDragged.current = false;
            return;
          }
          setLevel(value);
        }}
      >
        <span
          class="ph-height-bar"
          style={{ width: `${size.width}px`, height: current ? '5px' : whole ? '3px' : '2px' }}
        />
        <span
          class="ph-height-rung-label"
          style={{ fontSize: `${8 + 3 * rungFalloff(offset)}px` }}
        >
          {rungLabelled(value, offset) ? value : ''}
        </span>
      </button>,
    );
  }
  return (
    <aside class="ph-height-control ph-panel" data-testid="placement-height">
      <div class="ph-height-title">Z</div>
      <button
        class="ph-height-step"
        aria-label="Raise build level"
        disabled={level >= BUILD_LIMIT}
        onClick={() => stepBy(Z_STEP)}
      >
        +
      </button>
      <div
        class="ph-height-ladder"
        data-testid="height-ladder"
        role="slider"
        tabIndex={0}
        aria-label="Placement height"
        aria-orientation="vertical"
        aria-valuemin={-BUILD_LIMIT}
        aria-valuemax={BUILD_LIMIT}
        aria-valuenow={level}
        aria-valuetext={`${level} tiles`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          justDragged.current = false;
          drag.current = { startY: e.clientY, startLevel: level, moved: false, captured: false };
        }}
        onPointerMove={(e) => {
          const gesture = drag.current;
          if (gesture === null) return;
          const dy = e.clientY - gesture.startY;
          if (Math.abs(dy) <= 2) return;
          gesture.moved = true;
          if (!gesture.captured) {
            // Capture only once this is a real drag. Capturing on pointerdown
            // would retarget the click that follows a plain tap, and the rung
            // under the pointer would never hear it.
            e.currentTarget.setPointerCapture(e.pointerId);
            gesture.captured = true;
          }
          setLevel(levelFromDrag(gesture.startLevel, dy));
        }}
        onPointerUp={(e) => {
          const gesture = drag.current;
          if (gesture === null) return;
          justDragged.current = gesture.moved;
          drag.current = null;
          if (gesture.captured && e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={() => {
          drag.current = null;
          justDragged.current = false;
        }}
        onWheel={(e) => {
          e.stopPropagation();
          // Any other way of moving the level ends the drag's claim on the next
          // click, which would otherwise be swallowed a gesture later.
          justDragged.current = false;
          stepBy(e.deltaY < 0 ? Z_STEP : -Z_STEP);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          e.preventDefault();
          e.stopPropagation();
          justDragged.current = false;
          stepBy(e.key === 'ArrowUp' ? Z_STEP : -Z_STEP);
        }}
      >
        {rungs}
      </div>
      <button
        class="ph-height-step"
        aria-label="Lower build level"
        disabled={level <= -BUILD_LIMIT}
        onClick={() => stepBy(-Z_STEP)}
      >
        −
      </button>
      <input
        class="ph-height-value"
        aria-label={inputLabel}
        title="Exact Z height in tile units"
        type="number"
        step="0.25"
        min={-BUILD_LIMIT}
        max={BUILD_LIMIT}
        value={level}
        onChange={(e) => {
          const value = typedNumber(e.currentTarget.value, isBuildZ);
          if (value !== null) setLevel(value);
        }}
      />
    </aside>
  );
}

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
  session: EditorSession;
  controller: EditorController;
  onChange: () => void;
  onNavigate?: (x: number, y: number) => void;
}): preact.JSX.Element {
  const { controller, session } = props;
  const tool = controller.state.tool;
  // What is in hand, not which tool: the placer stamps a piece when the kind of tile it
  // holds is a structure, so the controls a piece needs follow the tile rather than a verb.
  const structure = controller.heldStructure();
  const building = tool === 'eraseTile' || (tool === 'placeTile' && structure !== undefined);
  const [x, setX] = useState('0');
  const [y, setY] = useState('0');
  const goX = typedNumber(x, isBuildCoordinate);
  const goY = typedNumber(y, isBuildCoordinate);
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
          {structure === 'wall' ? (
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
          <div class="ph-heading">Piece height (Z)</div>
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
          <button
            class="ph-chip ph-rotate"
            data-testid="build-rotate"
            onClick={() => setRotation((controller.state.buildRotation + 1) % 4)}
          >
            Rotate · {controller.state.buildRotation * 90}° (Alt + mouse / R)
          </button>
        </>
      ) : null}
      {tool === 'prop' ? (
        <button class="ph-chip ph-rotate" data-testid="prop-rotate" onClick={() => setRotation((controller.state.buildRotation + 1) % 4)}>
          Rotate · {controller.state.buildRotation * 90}° (Alt + mouse / R)
        </button>
      ) : null}
      {tool === 'placeTile' ? (
        <div class="ph-note">
          {structure === undefined
            ? 'Painted flat, one kind to a cell. Give this kind a Structure in the Tiles workspace to stamp it as a piece that stacks instead.'
            : `Stamped as a ${structure} at the Z height below, stacking on whatever is already there. A walk over the cell reads whichever kind of tile ends up on top.`}
        </div>
      ) : null}
      {LEVELLED.includes(tool) ? (
        <>
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
  select: 'Click a creature to change what it is called and what it is drawn with.',
  adversary: 'Click to place the creature picked below in the encounter.',
  trigger: 'Click the cells that start the encounter when the party steps on one.',
  spawn: 'Click to add or remove a place the party starts.',
  erase: 'Click a creature to remove it, then a trigger cell, then a party start.',
};

/** What a kind of ground is drawn with now, or '' for the colour it has always had. */
function terrainModelOf(session: EditorSession, terrainId: string): string {
  return session.project.terrainPalette?.find((t) => t.id === terrainId)?.model ?? '';
}

/** Every model a creature can be pointed at: the library's, plus what the project imported. */
function modelChoices(session: EditorSession): string[] {
  return [
    ...new Set([...MODELS.map((m) => m.id), ...session.project.assets.map((a) => a.id)]),
  ].sort();
}

/**
 * The selected creature: what it is drawn with, what it is called, what it can
 * take. The model is two fields rather than one because the usual want is to
 * re-skin a whole type, and the exception is one standout creature.
 */
function SelectedCreature(props: {
  session: EditorSession;
  controller: EditorController;
  onChange: () => void;
}): preact.JSX.Element | null {
  const { session, controller } = props;
  const placement = controller.selectedPlacement();
  const encounterId = controller.selectedPlacementEncounter();
  if (placement === null || encounterId === null) return null;
  const sceneId = controller.sceneId;
  const choices = modelChoices(session);
  const edit = (changes: { model?: string | null; name?: string | null; hitPoints?: number | null }): void => {
    session.run(updateAdversary(sceneId, encounterId, placement.id, changes));
    props.onChange();
  };
  return (
    <div data-testid="selected-creature">
      <div class="ph-heading">Selected creature</div>
      <div class="ph-hint">{placement.adversary}</div>
      <label class="ph-heading">
        Model · every {placement.adversary}
        <select
          class="ph-select"
          data-testid="type-model"
          value={session.project.adversaryModels[placement.adversary] ?? ''}
          onChange={(e) => {
            const picked = e.currentTarget.value;
            session.run(setAdversaryModel(placement.adversary, picked === '' ? null : picked));
            props.onChange();
          }}
        >
          <option value="">Its own id</option>
          {choices.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </label>
      <label class="ph-heading">
        Model · this one only
        <select
          class="ph-select"
          data-testid="creature-model"
          value={placement.model ?? ''}
          onChange={(e) => {
            const picked = e.currentTarget.value;
            edit({ model: picked === '' ? null : picked });
          }}
        >
          <option value="">Whatever the type uses</option>
          {choices.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </label>
      <label class="ph-heading">
        Name
        <input
          class="ph-input"
          data-testid="creature-name"
          value={placement.name ?? ''}
          onChange={(e) => {
            const typed = e.currentTarget.value.trim();
            edit({ name: typed === '' ? null : typed });
          }}
        />
      </label>
      <label class="ph-heading">
        Hit points
        <input
          class="ph-input"
          data-testid="creature-hp"
          type="number"
          min="1"
          step="1"
          value={placement.hitPoints ?? ''}
          onChange={(e) => {
            const typed = e.currentTarget.value.trim();
            const n = Number(typed);
            edit({ hitPoints: typed === '' || !Number.isInteger(n) || n <= 0 ? null : n });
          }}
        />
      </label>
    </div>
  );
}

/** Combat mode's side: the tool in hand, the selected creature, and which encounter placements go into. */
export function CombatSide(props: {
  session: EditorSession;
  controller: EditorController;
  onChange: () => void;
}): preact.JSX.Element {
  const { controller } = props;
  const scene = controller.scene;
  const tool = controller.state.tool;
  const current = controller.state.encounterId ?? scene.encounters[0]?.id ?? '';
  return (
    <aside class="ph-side ph-panel" data-testid="combat-side">
      <div class="ph-heading">{TOOL_LABELS[tool]}</div>
      <div class="ph-hint">{COMBAT_HINTS[tool] ?? ''}</div>
      <SelectedCreature session={props.session} controller={controller} onChange={props.onChange} />
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
