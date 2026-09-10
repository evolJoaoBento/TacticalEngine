/**
 * The editor's panel.
 *
 * Thin on purpose: it reads the controller and the session, and calls into them.
 * No decisions live here — which tile a click hit belongs to the viewport, and
 * what a click *means* belongs to `controller.ts`, which is why both of those are
 * tested and this is not.
 *
 * Styling is inline rather than in a stylesheet so the editor cannot be broken by
 * a page's CSS, and so this file is the whole of it.
 */

import { useEffect, useState } from 'preact/hooks';
import './editor.css';
import { SRD_CONDITIONS } from '../../engine/content/conditions';
import type { EditorController, EditorTool } from '../controller';
import type { EditorSession } from '../session';
import { addDialogue, removeDialogue, removeInteractable, updateInteractable } from '../session';
import type { AbilityDef } from '../../engine/content/abilities';
import type { SrdCharacterContent } from '../../engine/content/srd/daggersearch';
import { questSchema } from '../../engine/content/quests';
import { addQuest, removeQuest } from '../session';
import { addAsset, removeAsset } from '../session';
import { modelAssetSchema } from '../../engine/render/assets';
import { CodePanel } from './CodePanel';
import { AbilityPanel } from './AbilityPanel';
import { PartyPanel } from './PartyPanel';
import { ItemPanel } from './ItemPanel';
import { QuestEditor } from './QuestEditor';
import { dialogueSchema } from '../../engine/dialogue/schema';
import { DialogueGraph } from './DialogueGraph';
import { summarise, validateProject, type Problem } from '../validate';
import { Inspector } from './Inspector';

export interface EditorPanelProps {
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  session: EditorSession;
  controller: EditorController;
  terrainIds: readonly string[];
  propModels: readonly string[];
  adversaryIds: readonly string[];
  /** Switch back to playing. */
  onPlay: () => void;
  /** Play in the room being edited, arriving on its spawns; Shift-click a tile to arrive there. */
  onPlayHere?: () => void;
  onSwitchScene: (id: string) => void;
  onAddScene: (name: string) => void;
  onRenameScene: (id: string, name: string) => void;
  onRemoveScene: (id: string) => void;
  onSetStartScene: (id: string) => void;
  /** The scene the party is standing in, which need not be the one being edited. */
  playingScene: string;
  onSave: () => void;
  onLoad: (file: File) => void;
  /** Ids the validator should consider resolvable. */
  knownModels: ReadonlySet<string>;
  knownAdversaries: ReadonlySet<string>;
  /** Hooks the engine registers itself, listed in the Code panel. */
  nativeHooks: readonly string[];
  /** The cards the engine ships, listed beside the project's own. */
  libraryAbilities: readonly AbilityDef[];
  /** The vendored SRD content the Party panel picks from, and validates against. */
  characterContent: SrdCharacterContent;
}

const TOOLS: { tool: EditorTool; label: string; hint: string }[] = [
  { tool: 'select', label: 'Inspect', hint: 'Click a tile to see what is on it' },
  { tool: 'paintTerrain', label: 'Terrain', hint: 'Drag to paint' },
  { tool: 'raise', label: 'Raise', hint: 'Drag to raise ground' },
  { tool: 'lower', label: 'Lower', hint: 'Drag to lower ground' },
  { tool: 'prop', label: 'Prop', hint: 'Click to place, again to turn' },
  { tool: 'interactable', label: 'Object', hint: 'Chest, door, pillar, portal' },
  { tool: 'adversary', label: 'Enemy', hint: 'Click to place in the encounter' },
  { tool: 'trigger', label: 'Trigger', hint: 'Cells that start the encounter' },
  { tool: 'spawn', label: 'Spawn', hint: 'Where the party starts' },
  { tool: 'erase', label: 'Erase', hint: 'Remove props and objects' },
];

const panel: Record<string, string | number> = {
  position: 'absolute',
  top: 0,
  left: 0,
  width: '268px',
  maxHeight: '100vh',
  overflowY: 'auto',
  padding: '10px 12px 16px',
  background: 'var(--ph-panel)',
  color: 'var(--ph-text)',
  font: '13px/1.45 system-ui, sans-serif',
  pointerEvents: 'auto',
  boxSizing: 'border-box',
};

const heading: Record<string, string | number> = {
  margin: '14px 0 6px',
  font: '600 11px/1 system-ui, sans-serif',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ph-muted)',
};

function button(active: boolean): Record<string, string | number> {
  return {
    padding: '5px 8px',
    margin: '0 4px 4px 0',
    border: `1px solid ${active ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
    borderRadius: '4px',
    background: active ? 'var(--ph-accent-bg)' : 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
  };
}

export function EditorPanel(props: EditorPanelProps): preact.JSX.Element {
  const { session, controller } = props;
  // The session and controller are mutable objects rather than signals, so the
  // panel re-renders on a version counter the session bumps.
  const [version, setVersion] = useState(0);
  useEffect(() => session.subscribe(() => setVersion((v) => v + 1)), [session]);

  const [problems, setProblems] = useState<Problem[]>([]);
  const [showProblems, setShowProblems] = useState(false);
  /** The conversation whose graph is open over the map, if any. */
  const [graph, setGraph] = useState<string | null>(null);
  /** Whether the Code panel is open over the map. */
  const [code, setCode] = useState(false);
  /** Whether the Cards panel is open over the map. */
  const [cards, setCards] = useState(false);
  /** Whether the Party panel is open over the map. */
  const [party, setParty] = useState(false);
  /** Whether the Items panel is open over the map. */
  const [items, setItems] = useState(false);
  const [openQuest, setOpenQuest] = useState<string | null>(null);

  const scene = controller.scene;
  const state = controller.state;
  const selectedObject = controller.selectedInteractable();
  const bump = (): void => setVersion((v) => v + 1);

  const check = (): void => {
    setProblems(
      validateProject(session.project, {
        knownModels: props.knownModels,
        knownAdversaries: props.knownAdversaries,
        knownHooks: new Set(props.nativeHooks),
        knownConditions: new Set(SRD_CONDITIONS.map((c) => c.id)),
        characterContent: props.characterContent,
      }),
    );
    setShowProblems(true);
  };

  if (code) {
    return (
      <CodePanel
        session={session}
        nativeHooks={props.nativeHooks}
        onChange={bump}
        onClose={() => setCode(false)}
      />
    );
  }

  if (items) {
    return (
      <ItemPanel
        session={session}
        content={props.characterContent}
        hookIds={[...props.nativeHooks, ...session.project.code.map((entry) => entry.id)]}
        sceneIds={session.project.scenes.map((entry) => entry.id)}
        dialogueIds={session.project.dialogues.map((entry) => entry.id)}
        encounterIds={scene.encounters.map((entry) => entry.id)}
        quests={session.project.quests}
        onChange={bump}
        onClose={() => setItems(false)}
      />
    );
  }

  if (party) {
    return (
      <PartyPanel
        session={session}
        content={props.characterContent}
        onChange={bump}
        onClose={() => setParty(false)}
      />
    );
  }

  if (cards) {
    return (
      <AbilityPanel
        session={session}
        libraryAbilities={props.libraryAbilities}
        // A card's `run` can name either door: the engine's own hooks or the
        // project's code, which is exactly what the runner looks in.
        hookIds={[...props.nativeHooks, ...session.project.code.map((entry) => entry.id)]}
        adversaryIds={props.adversaryIds}
        sceneIds={session.project.scenes.map((entry) => entry.id)}
        dialogueIds={session.project.dialogues.map((entry) => entry.id)}
        encounterIds={scene.encounters.map((entry) => entry.id)}
        quests={session.project.quests}
        onChange={bump}
        onClose={() => setCards(false)}
      />
    );
  }

  const openGraph = session.project.dialogues.find((d) => d.id === graph) ?? null;
  if (openGraph !== null) {
    return (
      <DialogueGraph
        session={session}
        dialogue={openGraph}
        sceneIds={session.project.scenes.map((entry) => entry.id)}
        dialogueIds={session.project.dialogues.map((entry) => entry.id)}
        encounterIds={scene.encounters.map((entry) => entry.id)}
        quests={session.project.quests}
        onClose={() => setGraph(null)}
        onChange={bump}
      />
    );
  }

  return (
    <div style={panel} data-version={version}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ fontSize: '14px' }}>Editor</strong>
        <span style={{ color: 'var(--ph-muted)', fontSize: '12px' }}>
          {scene.name || scene.id} · {scene.width}×{scene.height}
          {session.dirty ? ' ·' : ''}
          {session.dirty ? <span style={{ color: 'var(--ph-warm)' }}> unsaved</span> : null}
        </span>
      </div>

      <div style={{ marginTop: '8px' }}>
        <button style={button(false)} onClick={props.onPlay}>
          ▶ Play
        </button>
        {props.onPlayHere !== undefined ? (
          <button style={button(false)} data-testid="play-here" title="Play in this room, from its spawns. Shift-click a tile to play from there." onClick={props.onPlayHere}>
            ▶ Play here
          </button>
        ) : null}
        <button
          style={button(false)}
          disabled={!session.canUndo}
          title={session.undoLabel ?? 'Nothing to undo'}
          onClick={() => {
            session.undo();
            bump();
          }}
        >
          ↶ Undo
        </button>
        <button
          style={button(false)}
          disabled={!session.canRedo}
          title={session.redoLabel ?? 'Nothing to redo'}
          onClick={() => {
            session.redo();
            bump();
          }}
        >
          ↷ Redo
        </button>
      </div>

      <div style={heading}>Tool</div>
      <div>
        {TOOLS.map((entry) => (
          <button
            key={entry.tool}
            title={entry.hint}
            style={button(state.tool === entry.tool)}
            onClick={() => {
              controller.setTool(entry.tool);
              bump();
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {state.tool === 'paintTerrain' ? (
        <>
          <div style={heading}>Terrain</div>
          <div>
            {props.terrainIds.map((id) => (
              <button
                key={id}
                style={button(state.terrainId === id)}
                onClick={() => {
                  controller.set('terrainId', id);
                  bump();
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {state.tool === 'prop' ? (
        <>
          <div style={heading}>Prop</div>
          <div>
            {props.propModels.map((id) => (
              <button
                key={id}
                style={button(state.propModel === id)}
                onClick={() => {
                  controller.set('propModel', id);
                  bump();
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {state.tool === 'interactable' ? (
        <>
          <div style={heading}>Object</div>
          <div>
            {(['chest', 'door', 'pillar', 'portal'] as const).map((kind) => (
              <button
                key={kind}
                style={button(state.interactableKind === kind)}
                onClick={() => {
                  controller.set('interactableKind', kind);
                  bump();
                }}
              >
                {kind}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {state.tool === 'adversary' ? (
        <>
          <div style={heading}>Adversary</div>
          <select
            value={state.adversaryId}
            style={{ width: '100%', padding: '4px', background: 'var(--ph-field)', color: 'inherit', border: '1px solid var(--ph-line)', borderRadius: '4px' }}
            onChange={(e) => {
              controller.set('adversaryId', (e.target as HTMLSelectElement).value);
              bump();
            }}
          >
            {props.adversaryIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </>
      ) : null}

      {state.tool === 'paintTerrain' || state.tool === 'raise' || state.tool === 'lower' ? (
        <>
          <div style={heading}>Brush</div>
          <div>
            {[1, 3, 5].map((size) => (
              <button
                key={size}
                style={button(state.brushSize === size)}
                onClick={() => {
                  controller.set('brushSize', size);
                  bump();
                }}
              >
                {size}×{size}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div style={heading}>Scenes</div>
      <div>
        {session.project.scenes.map((entry) => {
          const editing = entry.id === scene.id;
          const opens = session.project.startScene === entry.id;
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginBottom: '2px',
              }}
            >
              <button
                style={{ ...button(editing), flex: 1, textAlign: 'left', margin: 0 }}
                title={entry.id}
                onClick={() => props.onSwitchScene(entry.id)}
              >
                {entry.name || entry.id}
                <span style={{ color: 'var(--ph-muted)' }}>
                  {' '}
                  {entry.width}×{entry.height}
                </span>
                {opens ? <span style={{ color: 'var(--ph-warm)' }}> ▸</span> : null}
                {entry.id === props.playingScene ? (
                  <span style={{ color: 'var(--ph-good)' }}> ●</span>
                ) : null}
              </button>
              <button
                style={{ ...button(false), margin: 0 }}
                title="Rename"
                onClick={() => {
                  const name = prompt('Scene name', entry.name || entry.id);
                  if (name !== null && name !== '') props.onRenameScene(entry.id, name);
                }}
              >
                ✎
              </button>
              <button
                style={{ ...button(false), margin: 0 }}
                title={opens ? 'Already the opening scene' : 'Open the project here'}
                disabled={opens}
                onClick={() => props.onSetStartScene(entry.id)}
              >
                ▸
              </button>
              <button
                style={{ ...button(false), margin: 0 }}
                title={
                  opens
                    ? 'The opening scene cannot be deleted'
                    : session.project.scenes.length <= 1
                      ? 'A project needs at least one scene'
                      : 'Delete this scene'
                }
                disabled={opens || session.project.scenes.length <= 1}
                onClick={() => {
                  if (confirm(`Delete "${entry.name || entry.id}"?`)) props.onRemoveScene(entry.id);
                }}
              >
                ✕
              </button>
            </div>
          );
        })}
        <button
          style={button(false)}
          onClick={() => {
            const name = prompt('New scene name', 'New room');
            if (name !== null && name !== '') props.onAddScene(name);
          }}
        >
          + Scene
        </button>
      </div>
      <div style={{ color: 'var(--ph-muted)', fontSize: '11px', marginTop: '4px' }}>
        ▸ opens the project · ● the party is here
      </div>

      <div style={heading}>This scene</div>
      <div style={{ color: 'var(--ph-muted)', fontSize: '12px' }}>
        {scene.decos.length} props · {scene.interactables.length} objects ·{' '}
        {scene.encounters.reduce((n, e) => n + e.adversaries.length, 0)} enemies ·{' '}
        {scene.spawns.length} spawns
      </div>

      {state.tool === 'select' ? (
        selectedObject === null ? (
          <div style={{ ...heading, textTransform: 'none', letterSpacing: 0, color: 'var(--ph-muted)' }}>
            Click an object to edit what it does.
          </div>
        ) : (
          <Inspector
            interactable={selectedObject}
            sceneIds={session.project.scenes.map((s) => s.id)}
            dialogueIds={session.project.dialogues.map((d) => d.id)}
            encounterIds={scene.encounters.map((e) => e.id)}
            quests={session.project.quests}
            onChange={(changes) => {
              session.run(updateInteractable(scene.id, selectedObject.id, changes));
              bump();
            }}
            onDelete={() => {
              session.run(removeInteractable(scene.id, selectedObject.id));
              controller.selected = null;
              bump();
            }}
          />
        )
      ) : null}

      <div style={heading}>Conversations</div>
      <div>
        {session.project.dialogues.map((entry) => (
          <div key={entry.id} style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
            <button
              style={{ ...button(false), flex: 1, textAlign: 'left', margin: 0 }}
              onClick={() => setGraph(entry.id)}
            >
              {entry.id}
              <span style={{ color: 'var(--ph-muted)' }}> {entry.nodes.length} nodes</span>
            </button>
            <button
              style={{ ...button(false), margin: 0 }}
              title="Delete this conversation"
              onClick={() => {
                if (confirm(`Delete "${entry.id}"?`)) {
                  session.run(removeDialogue(entry.id));
                  if (graph === entry.id) setGraph(null);
                  bump();
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={button(false)}
          onClick={() => {
            const name = prompt('Conversation id', 'a-conversation');
            if (name === null || name === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.dialogues.some((d) => d.id === id)) return;
            session.run(
              addDialogue(
                dialogueSchema.parse({
                  id,
                  start: 'start',
                  nodes: [{ id: 'start', lines: [{ text: '' }] }],
                }),
              ),
            );
            setGraph(id);
            bump();
          }}
        >
          + Conversation
        </button>
      </div>

      <div style={heading}>Party, cards, items and code</div>
      <div>
        <button style={button(false)} data-testid="open-party" onClick={() => setParty(true)}>
          {session.project.party.length === 0 ? 'Write a character…' : `Party (${session.project.party.length})…`}
        </button>
        <button style={button(false)} data-testid="open-abilities" onClick={() => setCards(true)}>
          {session.project.abilities.length === 0 ? 'Write a card…' : `Cards (${session.project.abilities.length})…`}
        </button>
        <button style={button(false)} data-testid="open-items" onClick={() => setItems(true)}>
          {session.project.items.length === 0 ? 'Write an item…' : `Items (${session.project.items.length})…`}
        </button>
        <button style={button(false)} data-testid="open-code" onClick={() => setCode(true)}>
          {session.project.code.length === 0 ? 'Write logic in code…' : `Code (${session.project.code.length})…`}
        </button>
      </div>

      <div style={heading}>Quests</div>
      <div data-testid="quest-list">
        {session.project.quests.map((quest) => (
          <div key={quest.id}>
            <div style={{ display: 'flex', gap: '4px', marginBottom: '2px' }}>
              <button
                style={{ ...button(openQuest === quest.id), flex: 1, textAlign: 'left', margin: 0 }}
                data-quest={quest.id}
                onClick={() => setOpenQuest(openQuest === quest.id ? null : quest.id)}
              >
                {quest.name}
                <span style={{ color: 'var(--ph-muted)' }}> {quest.objectives.length} steps</span>
              </button>
              <button
                style={{ ...button(false), margin: 0 }}
                title="Delete this quest"
                onClick={() => {
                  if (confirm(`Delete "${quest.name}"?`)) {
                    session.run(removeQuest(quest.id));
                    if (openQuest === quest.id) setOpenQuest(null);
                    bump();
                  }
                }}
              >
                ✕
              </button>
            </div>
            {openQuest === quest.id ? (
              <QuestEditor session={session} quest={quest} onChange={bump} />
            ) : null}
          </div>
        ))}
        <button
          style={button(false)}
          onClick={() => {
            const name = prompt('Quest name', 'A quest');
            if (name === null || name.trim() === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.quests.some((q) => q.id === id)) return;
            session.run(
              addQuest(
                questSchema.parse({
                  id,
                  name: name.trim(),
                  objectives: [{ id: 'first-step', text: 'Do the first thing.' }],
                }),
              ),
            );
            setOpenQuest(id);
            bump();
          }}
        >
          + Quest
        </button>
      </div>

      <div style={heading}>Models</div>
      <div data-testid="asset-list">
        {session.project.assets.map((asset) => (
          <div key={asset.id} style={{ display: 'flex', gap: '4px', marginBottom: '2px', alignItems: 'center' }} data-asset={asset.id}>
            <span style={{ flex: 1, fontSize: '12px' }}>
              {asset.id}
              <span style={{ color: 'var(--ph-muted)' }}> {asset.url}</span>
            </span>
            <button
              style={{ ...button(false), margin: 0 }}
              title="Remove this model"
              onClick={() => {
                if (confirm(`Remove model "${asset.id}"?`)) {
                  session.run(removeAsset(asset.id));
                  props.onAssetsChanged?.();
                  bump();
                }
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={button(false)}
          onClick={() => {
            const url = prompt('Model file (.glb / .gltf URL)', '/models/thing.glb');
            if (url === null || url.trim() === '') return;
            const base = url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? 'model';
            const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
            if (session.project.assets.some((a) => a.id === id)) return;
            const scale = Number(prompt('Scale (a tile is one unit)', '1')) || 1;
            session.run(addAsset(modelAssetSchema.parse({ id, url: url.trim(), scale })));
            props.onAssetsChanged?.();
            bump();
          }}
        >
          + Model
        </button>
        <div style={{ color: 'var(--ph-muted)', fontSize: '11px', marginTop: '2px' }}>
          Name a model id in the Prop tool, or on an object, to use it.
        </div>
      </div>

      <div style={heading}>Project</div>
      <div>
        <button style={button(false)} onClick={props.onSave}>
          Save JSON
        </button>
        <label style={{ ...button(false), display: 'inline-block' }}>
          Load
          <input
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = (e.target as HTMLInputElement).files?.[0];
              if (file !== undefined) props.onLoad(file);
            }}
          />
        </label>
        <button style={button(showProblems)} onClick={check}>
          Check
        </button>
      </div>

      {showProblems ? (
        <>
          <div style={heading}>{summarise(problems)}</div>
          <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '12px' }}>
            {problems.slice(0, 30).map((problem, i) => (
              <li
                key={i}
                style={{ color: problem.severity === 'error' ? 'var(--ph-bad)' : 'var(--ph-warm)', marginBottom: '3px' }}
              >
                {problem.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
