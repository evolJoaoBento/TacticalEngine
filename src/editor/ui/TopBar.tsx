/**
 * The top bar: the Project and Content menus, the four modes, the room, undo,
 * and Play.
 *
 * Presentation only. Which menu is open belongs to the shell, and which mode is
 * in hand belongs to the controller; this draws them and reports clicks.
 */

import type { EditorSession } from '../session';
import { EDITOR_MODES, MODE_LABELS, type EditorMode } from '../modes';
import type { Problem } from '../validate';
import { Icon } from './icons';

/** Which of the top bar's dropdowns is open, or none. */
export type Menu = 'project' | 'content' | 'scenes';
/** The long-lived editors that open as a workspace under the bar. */
export type Workspace = 'party' | 'cards' | 'items' | 'quests' | 'code' | 'models';

interface ContentEntry {
  workspace: Workspace;
  label: string;
  /** Kept from the side panel, so the specs that opened panels still find them. */
  testId: string;
  count: (session: EditorSession) => number;
}

const WRITTEN: readonly ContentEntry[] = [
  { workspace: 'party', label: 'Party', testId: 'open-party', count: (s) => s.project.party.length },
  { workspace: 'cards', label: 'Cards', testId: 'open-abilities', count: (s) => s.project.abilities.length },
  { workspace: 'items', label: 'Items & loot', testId: 'open-items', count: (s) => s.project.items.length },
  { workspace: 'quests', label: 'Quests', testId: 'open-quests', count: (s) => s.project.quests.length },
  { workspace: 'code', label: 'Code', testId: 'open-code', count: (s) => s.project.code.length },
];

const IMPORTED: ContentEntry = {
  workspace: 'models',
  label: 'Models',
  testId: 'open-models',
  count: (s) => s.project.assets.length,
};

/** What the top bar needs to draw itself and report a click. */
export interface TopBarProps {
  session: EditorSession;
  mode: EditorMode;
  menu: Menu | null;
  sceneName: string;
  sceneSize: string;
  /** What the last Check found; null before one has run. */
  problems: readonly Problem[] | null;
  /** The scene menu, drawn under its button while open. */
  sceneMenu: preact.JSX.Element;
  onMode: (mode: EditorMode) => void;
  onMenu: (menu: Menu | null) => void;
  onWorkspace: (workspace: Workspace) => void;
  onSave: () => void;
  onLoad: (file: File) => void;
  onCheck: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPlay: () => void;
  onPlayHere?: () => void;
}

export function TopBar(props: TopBarProps): preact.JSX.Element {
  const { session, menu } = props;
  const toggle = (which: Menu): void => props.onMenu(menu === which ? null : which);
  const errors = props.problems?.filter((problem) => problem.severity === 'error').length ?? 0;
  const entry = (item: ContentEntry): preact.JSX.Element => (
    <button
      key={item.workspace}
      class="ph-item"
      data-testid={item.testId}
      onClick={() => {
        props.onMenu(null);
        props.onWorkspace(item.workspace);
      }}
    >
      {item.label} <small>{item.count(session)}</small>
    </button>
  );

  return (
    <header class="ph-topbar" data-testid="top-bar">
      <div class="ph-brand">
        <b>◆</b> PolyHeart Editor
      </div>

      <div class="ph-menu-wrap">
        <button
          class={menu === 'project' ? 'ph-menu-button ph-open' : 'ph-menu-button'}
          data-testid="open-project"
          onClick={() => toggle('project')}
        >
          Project<span class="ph-caret">▾</span>
          {errors > 0 ? <span class="ph-badge">{errors}</span> : null}
        </button>
        {menu === 'project' ? (
          <div class="ph-menu" data-testid="project-menu">
            <button
              class="ph-item"
              data-testid="save-project"
              onClick={() => {
                props.onMenu(null);
                props.onSave();
              }}
            >
              Save JSON
            </button>
            <label class="ph-item" data-testid="load-project">
              Load…
              <input
                class="ph-file"
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  props.onMenu(null);
                  if (file !== undefined) props.onLoad(file);
                }}
              />
            </label>
            <button
              class="ph-item"
              data-testid="check-project"
              onClick={() => {
                props.onMenu(null);
                props.onCheck();
              }}
            >
              Check <small>{props.problems === null ? '' : `${props.problems.length} found`}</small>
            </button>
          </div>
        ) : null}
      </div>

      <div class="ph-menu-wrap">
        <button
          class={menu === 'content' ? 'ph-menu-button ph-open' : 'ph-menu-button'}
          data-testid="open-content"
          onClick={() => toggle('content')}
        >
          Content<span class="ph-caret">▾</span>
        </button>
        {menu === 'content' ? (
          <div class="ph-menu" data-testid="content-menu">
            {WRITTEN.map(entry)}
            <div class="ph-sep" />
            {entry(IMPORTED)}
          </div>
        ) : null}
      </div>

      <nav class="ph-modes" aria-label="Editor modes">
        {EDITOR_MODES.map((mode, i) => (
          <button
            key={mode}
            class={mode === props.mode ? 'ph-mode ph-on' : 'ph-mode'}
            data-testid={`mode-${mode}`}
            aria-pressed={mode === props.mode ? 'true' : 'false'}
            title={`${MODE_LABELS[mode]} (${i + 1})`}
            onClick={() => props.onMode(mode)}
          >
            <Icon name={mode} />
            {MODE_LABELS[mode]}
            <kbd>{i + 1}</kbd>
          </button>
        ))}
      </nav>

      <div class="ph-right">
        <div class="ph-menu-wrap">
          <button class="ph-scene-button" data-testid="open-scenes" onClick={() => toggle('scenes')}>
            {props.sceneName} <small>{props.sceneSize}</small>
            <span class="ph-caret">▾</span>
          </button>
          {menu === 'scenes' ? props.sceneMenu : null}
        </div>
        <button
          class="ph-icon-button"
          data-testid="undo"
          title={session.undoLabel === null ? 'Nothing to undo' : `Undo ${session.undoLabel}`}
          aria-label="Undo"
          disabled={!session.canUndo}
          onClick={props.onUndo}
        >
          <Icon name="undo" />
        </button>
        <button
          class="ph-icon-button"
          data-testid="redo"
          title={session.redoLabel === null ? 'Nothing to redo' : `Redo ${session.redoLabel}`}
          aria-label="Redo"
          disabled={!session.canRedo}
          onClick={props.onRedo}
        >
          <Icon name="redo" />
        </button>
        {session.dirty ? <span class="ph-dirty">● unsaved</span> : null}
        {props.onPlayHere !== undefined ? (
          <button
            class="ph-button"
            data-testid="play-here"
            title="Play in this room, from its spawns. Shift-click a tile to play from there."
            onClick={props.onPlayHere}
          >
            ▶ Play here
          </button>
        ) : null}
        <button class="ph-button ph-primary" data-testid="play" onClick={props.onPlay}>
          ▶ Play
        </button>
      </div>
    </header>
  );
}
