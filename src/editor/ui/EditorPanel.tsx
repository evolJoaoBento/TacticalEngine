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
import type { EditorController, EditorTool } from '../controller';
import type { EditorSession } from '../session';
import { summarise, validateProject, type Problem } from '../validate';

export interface EditorPanelProps {
  session: EditorSession;
  controller: EditorController;
  terrainIds: readonly string[];
  propModels: readonly string[];
  adversaryIds: readonly string[];
  /** Switch back to playing. */
  onPlay: () => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  /** Ids the validator should consider resolvable. */
  knownModels: ReadonlySet<string>;
  knownAdversaries: ReadonlySet<string>;
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
  background: 'rgba(16,18,24,0.94)',
  color: '#e8e6df',
  font: '13px/1.45 system-ui, sans-serif',
  pointerEvents: 'auto',
  boxSizing: 'border-box',
};

const heading: Record<string, string | number> = {
  margin: '14px 0 6px',
  font: '600 11px/1 system-ui, sans-serif',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#8ea3b0',
};

function button(active: boolean): Record<string, string | number> {
  return {
    padding: '5px 8px',
    margin: '0 4px 4px 0',
    border: `1px solid ${active ? '#69d2ff' : '#39404d'}`,
    borderRadius: '4px',
    background: active ? 'rgba(105,210,255,0.18)' : 'transparent',
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

  const scene = controller.scene;
  const state = controller.state;
  const bump = (): void => setVersion((v) => v + 1);

  const check = (): void => {
    setProblems(
      validateProject(session.project, {
        knownModels: props.knownModels,
        knownAdversaries: props.knownAdversaries,
      }),
    );
    setShowProblems(true);
  };

  return (
    <div style={panel} data-version={version}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <strong style={{ fontSize: '14px' }}>Editor</strong>
        <span style={{ color: '#8ea3b0', fontSize: '12px' }}>
          {scene.name || scene.id} · {scene.width}×{scene.height}
          {session.dirty ? ' ·' : ''}
          {session.dirty ? <span style={{ color: '#f6c453' }}> unsaved</span> : null}
        </span>
      </div>

      <div style={{ marginTop: '8px' }}>
        <button style={button(false)} onClick={props.onPlay}>
          ▶ Play
        </button>
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
            style={{ width: '100%', padding: '4px', background: '#1b1f28', color: 'inherit', border: '1px solid #39404d', borderRadius: '4px' }}
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

      <div style={heading}>Scene</div>
      <div style={{ color: '#8ea3b0', fontSize: '12px' }}>
        {scene.decos.length} props · {scene.interactables.length} objects ·{' '}
        {scene.encounters.reduce((n, e) => n + e.adversaries.length, 0)} enemies ·{' '}
        {scene.spawns.length} spawns
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
                style={{ color: problem.severity === 'error' ? '#ff8f7a' : '#f6c453', marginBottom: '3px' }}
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
