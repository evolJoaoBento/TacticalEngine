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
import { PropFunctionEditor } from './PropFunctionEditor';
import { SheetEditor } from './SheetEditor';
import { setCreatureInteraction } from '../creature-edits';
import type { AdversaryInteraction, AdversaryPlacement } from '../../engine/scene/schema';
import type { ContentPack } from '../../engine/content/pack/import';
import { portalPartner } from '../../engine/scene/prop-functions';

/** The ids an effect list picks from rather than having them typed. */
export interface PickableIds {
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

/** Inspector mode's side: the clicked object's properties, or a hint to click one. */
/**
 * The function picker, bound to the prop the panel is showing.
 *
 * `andNext` is the Terrain panel's rule for its settings, that a change applies to the prop being
 * shown and to the next one placed alike. The Inspector places nothing, so there it is only the
 * prop being shown.
 */
function PropFunctionField(props: { session: EditorSession; controller: EditorController; andNext?: boolean; onChange: () => void }): preact.JSX.Element {
  const { session, controller } = props;
  const chosen = controller.selectedDeco;
  return (
    <PropFunctionEditor
      // One per prop: a pair id half-typed into one is not left standing in the next one shown.
      key={chosen === null ? 'next' : `prop-${controller.selectedProp}`}
      value={chosen === null ? controller.state.propFunction : chosen.function}
      onChange={(next) => {
        if (props.andNext === true || chosen === null) controller.set('propFunction', next);
        controller.setSelectedFunction(next);
        props.onChange();
      }}
      items={session.project.items.map((item) => ({ id: item.id, name: item.name }))}
      pairTakenBy={(pair) => controller.pairTakenBy(pair, chosen?.id)}
      partnerOf={(pair) => portalPartner(session.project, pair, chosen?.id ?? null)?.prop.id ?? null}
      sceneIds={session.project.scenes.map((scene) => scene.id)}
      dialogueIds={session.project.dialogues.map((dialogue) => dialogue.id)}
      encounterIds={controller.scene.encounters.map((encounter) => encounter.id)}
      quests={session.project.quests}
    />
  );
}

export function InspectorSide(props: {
  session: EditorSession;
  controller: EditorController;
  ids: PickableIds;
  onChange: () => void;
  /** What a character's sheet is written from: the Party panel's content and models. */
  characterContent: ContentPack;
  models: readonly string[];
}): preact.JSX.Element {
  const { session, controller } = props;
  const object = controller.selectedInteractable();
  const prop = controller.selectedDeco;
  const start = controller.selectedStart;
  const sceneId = controller.sceneId;
  // Whoever begins on the start in hand: party member `i` stands on start `i % starts`.
  const starts = controller.scene.spawns.length;
  const starting = start === null ? [] : session.project.party.filter((_, i) => i % starts === start);
  return (
    <aside class="ph-side ph-panel" data-testid="inspector-side">
      {object === null && prop === null && start !== null ? (
        // A party start is a character: the Party panel's own form, for whoever begins there.
        <div data-testid="start-inspector" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div class="ph-heading">Party start {start + 1}</div>
          {starting.length === 0 ? (
            <div class="ph-note">
              Nobody begins here: the party has {session.project.party.length}, and this is start {start + 1}. Add a character in the Party workspace to fill it.
            </div>
          ) : (
            starting.map((sheet) => (
              <SheetEditor key={sheet.id} session={session} content={props.characterContent} models={props.models} sheetId={sheet.id} onChange={props.onChange} />
            ))
          )}
        </div>
      ) : object === null && prop !== null ? (
        // A door, a chest, a portal: what used to be an object is a prop with a function.
        <div data-testid="prop-inspector">
          <div class="ph-heading">{prop.id ?? prop.model}</div>
          <div class="ph-note">
            {prop.model} at {prop.position.x}, {prop.position.y}
            {prop.span !== undefined && prop.span > 1 ? `, ${prop.span}×${prop.span}` : ''}
          </div>
          <label class="ph-heading">
            Drawn with
            <select class="ph-select" data-testid="prop-model" value={prop.model} onChange={(e) => {
              controller.remodelSelected((e.target as HTMLSelectElement).value);
              props.onChange();
            }}>
              {modelChoices(session).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <div class="ph-heading">What it does</div>
          <PropFunctionField session={session} controller={controller} onChange={props.onChange} />
          <div class="ph-row ph-wrap">
            <button
              class={prop.solid === true ? 'ph-chip ph-on' : 'ph-chip'}
              data-testid="inspector-prop-solid"
              onClick={() => {
                controller.solidifySelected(prop.solid !== true);
                props.onChange();
              }}
            >
              Solid
            </button>
          </div>
        </div>
      ) : object === null ? (
        <div class="ph-hint">Click a prop on the board to change what it does - open, hold things, lead somewhere, ask for a roll. Drag anything on the board, a creature, a prop or a party start, to move it.</div>
      ) : (
        <Inspector
          interactable={object}
          models={modelChoices(session)}
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
  placeTile: 'Click to put down the kind of tile picked below. It is stamped at the Z height beside it and stacks on whatever is already there. The brush covers a square.',
  raise: 'Drag to raise the ground a level. One drag is one undo.',
  lower: 'Drag to lower the ground a level. One drag is one undo.',
  prop: 'Hold Alt and point the mouse in the direction the prop should face, then click to place. Click an existing matching prop to turn it.',
  erase: 'Click a prop to remove it, then the object under it.',
  select: 'Drag anything on the board - a creature, a prop, an object, a party start, or in Terrain a placed tile - to move it. One undo puts it back. Hold Alt to turn what a prop, an object or a tile will land facing; the wheel lifts a tile in hand.',
};

const BRUSHED: readonly EditorTool[] = ['placeTile', 'raise', 'lower', 'eraseTile'];

/**
 * Tools that place at `buildLevel`, and so want the Z controls beside them.
 *
 * `placeTile` is not one of them by itself: it places kinds of tile that are structures and
 * nothing else, so a placer holding anything else has nothing to put down and a Z ladder
 * beside it is a control that changes nothing. `levelled` asks the further question.
 */
const LEVELLED: readonly EditorTool[] = ['eraseTile', 'prop'];
/** The blocks a prop can be placed across. One is a prop on its tile; the rest cover more ground. */
const PROP_SPANS: readonly number[] = [1, 2, 3, 4, 5, 6, 8];

/**
 * Whether what is in hand is placed at a height: one of the levelled tools, or the placer
 * holding a kind of tile that stacks.
 */
function levelled(controller: EditorController): boolean {
  return LEVELLED.includes(controller.state.tool) || controller.placesStructure();
}

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
  // Select has the ladder too: it raises and lowers whatever Select took hold of, and is the build
  // plane when it holds nothing.
  const selecting = props.kind === 'terrain' && controller.state.tool === 'select';
  const visible = props.kind === 'creature'
    ? controller.state.tool === 'adversary'
    : levelled(controller) || selecting;
  if (!visible) return null;
  const level = (selecting ? controller.selectionLevel : null) ?? controller.state.buildLevel;
  const setLevel = (value: number): void => {
    const clamped = Math.max(-BUILD_LIMIT, Math.min(BUILD_LIMIT, value));
    if (!isBuildZ(clamped)) return;
    if (clamped === level) return;
    if (selecting) controller.setSelectionLevel(clamped);
    else controller.setBuildLevel(clamped);
    props.onChange();
  };
  const stepBy = (by: number): void => {
    setLevel(roundToStep(level + by));
  };
  const inputLabel = props.kind === 'creature' ? 'Creature Z' : selecting && controller.selectionLevel !== null ? 'Selected Z' : 'Build level';
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
  /**
   * The prop the panel is aimed at, when one has been placed or clicked.
   *
   * Which is not only the Props tool's business: Select takes hold of a prop as readily, and a
   * prop picked up with Select and no way to change it is the thing that made this a bug.
   */
  const chosen = controller.selectedDeco;
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
      {tool === 'prop' || chosen !== null ? (
        <>
          <button class="ph-chip ph-rotate" data-testid="prop-rotate" onClick={() => setRotation((controller.state.buildRotation + 1) % 4)}>
            Rotate · {controller.state.buildRotation * 90}° (Alt + mouse / R)
          </button>
          <div class="ph-heading">Size</div>
          <div class="ph-row ph-wrap" data-testid="prop-spans">
            {PROP_SPANS.map((span) => (
              <button
                key={span}
                class={(chosen?.span ?? controller.state.propSpan) === span ? 'ph-chip ph-on' : 'ph-chip'}
                data-span={span}
                onClick={() => {
                  // Both, always: the prop being shown changes, and the next one is placed like
                  // it, so a button never means two things depending on what is selected. With
                  // nothing selected only the second half does anything.
                  controller.set('propSpan', span);
                  controller.resizeSelected(span);
                  props.onChange();
                }}
              >
                {span}×{span}
              </button>
            ))}
          </div>
          <div class="ph-note" data-testid="prop-chosen">
            {chosen === null
              ? "The same model drawn across that much ground, as one prop rather than a tile's worth repeated: the tile clicked is the block's north-west corner, and a click anywhere in the block afterwards turns or erases the whole of it. Scenery at any size - a walk goes straight through."
              : `Showing the ${chosen.model} you placed or clicked. Size and Rotate change that one, and the next prop is placed the same way; click bare ground to put down a new one.`}
          </div>
          <div class="ph-heading">Function</div>
          <PropFunctionField session={session} controller={controller} andNext onChange={props.onChange} />
          <div class="ph-row ph-wrap">
            <button
              class={(chosen === null ? controller.state.propSolid : chosen.solid === true) ? 'ph-chip ph-on' : 'ph-chip'}
              data-testid="prop-solid"
              onClick={() => {
                const next = !(chosen === null ? controller.state.propSolid : chosen.solid === true);
                controller.set('propSolid', next);
                controller.solidifySelected(next);
                props.onChange();
              }}
            >
              Solid
            </button>
          </div>
          <div class="ph-note">
            Off, a prop is scenery: a walk goes straight through it, and what the ground costs is
            the Tiles workspace's to say. On, the whole block it covers is barred - nothing walks
            through it and nothing sees through it - so a boulder three tiles across is an obstacle
            three tiles across. The floor under it is left where it is, so the prop keeps standing
            on the ground rather than on top of its own block.
          </div>
          <div class="ph-row ph-wrap">
            <button class="ph-chip" data-testid="prop-save-remix" onClick={() => { controller.saveRemix(); props.onChange(); }}>
              Save as remix
            </button>
            {controller.pickedPreset === null ? null : (
              <button
                class="ph-chip"
                data-testid="prop-remove-remix"
                onClick={() => { controller.removeRemix(controller.pickedPreset!); props.onChange(); }}
              >
                Remove remix
              </button>
            )}
          </div>
          <div class="ph-note">
            A remix is these settings under a name, kept in the project and offered in the Props
            strip beside the models, so another six-tile boulder facing north is one click rather
            than three. It places an ordinary prop: removing the remix later leaves everything
            placed from it exactly where it is.
          </div>
        </>
      ) : null}
      {tool === 'placeTile' ? (
        <div class="ph-note">
          {structure === undefined
            ? 'Nothing in hand stacks. Give a kind of tile a Structure in the Tiles workspace to place it.'
            : `Stamped as a ${structure} at the Z height below, stacking on whatever is already there. A walk over the cell reads whichever kind of tile ends up on top.`}
        </div>
      ) : null}
      {levelled(controller) ? (
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
              A piece is a kind of tile, so a walk over the cell reads whichever one ends up
              on top. A piece placed before kinds and structures were one thing carries no
              kind, and stays scenery a walk goes straight through.
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

/**
 * Every model a creature or an object can be pointed at: the library's, plus what the
 * project imported - which is every `.glb` in `public/models`, discovered at build time.
 */
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
      <CreatureInteraction
        session={session}
        placement={placement}
        onChange={(interaction) => {
          session.run(setCreatureInteraction(sceneId, encounterId, placement.id, interaction));
          props.onChange();
        }}
      />
    </div>
  );
}

const INTERACTION_HINTS: Readonly<Record<AdversaryInteraction['kind'], string>> = {
  friendly: "On nobody's side until the conversation says otherwise. Clicking it talks rather than attacks.",
  threshold: 'Fights until a blow leaves it with this much of its Hit Points or less. Then it stops, the fight holds, and the conversation opens - once. Whatever the conversation leaves it as, it stays.',
};

/**
 * What a creature says besides fighting: nothing, a conversation it opens friendly, or one it
 * stops a fight for at a share of its Hit Points. A consequence node in the conversation, or a
 * reply's effects, turn it hostile or friendly (`setAttitude`).
 */
function CreatureInteraction(props: {
  session: EditorSession;
  placement: AdversaryPlacement;
  onChange: (interaction: AdversaryInteraction | null) => void;
}): preact.JSX.Element {
  const current = props.placement.interaction;
  const dialogues = props.session.project.dialogues.map((d) => d.id);
  const dialogue = current?.dialogue ?? dialogues[0] ?? '';
  const percent = current?.kind === 'threshold' ? current.percent : 50;
  const make = (kind: string, conversation = dialogue, share = percent): AdversaryInteraction | null =>
    kind === 'friendly' ? { kind, dialogue: conversation } : kind === 'threshold' ? { kind, dialogue: conversation, percent: share } : null;
  return (
    <div data-testid="creature-interaction-editor">
      <label class="ph-heading">
        Interaction
        <select class="ph-select" data-testid="creature-interaction" value={current?.kind ?? ''} onChange={(e) => props.onChange(make(e.currentTarget.value))}>
          <option value="">None</option>
          <option value="friendly" disabled={dialogues.length === 0}>Friendly</option>
          <option value="threshold" disabled={dialogues.length === 0}>Threshold</option>
        </select>
      </label>
      {dialogues.length === 0 ? <div class="ph-hint">Write a conversation in Interaction mode first; this is where it is given to a creature.</div> : null}
      {current === undefined ? null : (
        <>
          <div class="ph-hint">{INTERACTION_HINTS[current.kind]}</div>
          <label class="ph-heading">
            Conversation
            <select class="ph-select" data-testid="creature-dialogue" value={current.dialogue} onChange={(e) => props.onChange(make(current.kind, e.currentTarget.value))}>
              {dialogues.includes(current.dialogue) ? null : <option value={current.dialogue}>{current.dialogue} (missing)</option>}
              {dialogues.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          {current.kind === 'threshold' ? (
            <label class="ph-heading">
              At or under, % of Hit Points
              <input
                class="ph-input"
                data-testid="creature-threshold"
                type="number"
                min="1"
                max="99"
                step="1"
                value={current.percent}
                onChange={(e) => {
                  const n = Math.round(Number(e.currentTarget.value));
                  if (Number.isFinite(n)) props.onChange(make('threshold', current.dialogue, Math.min(99, Math.max(1, n))));
                }}
              />
            </label>
          ) : null}
        </>
      )}
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
