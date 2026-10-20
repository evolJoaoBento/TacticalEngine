/**
 * The rooms of the project, as a dropdown under the scene button: switch,
 * rename, make the opening scene, delete, add. The same list and the same
 * refusals the side panel had - the opening scene and the last scene stay.
 */

import type { EditorSession } from '../session';
import { lightFromText } from '../scene-edits';

/** What the scene menu needs to draw the list and report a pick. */
export interface SceneMenuProps {
  session: EditorSession;
  /** The scene being edited. */
  editing: string;
  /** The scene the party is standing in, which need not be the one being edited. */
  playingScene: string;
  onSwitch: (id: string) => void;
  onAdd: (name: string) => void;
  onRename: (id: string, name: string) => void;
  /** A room's own light set (`SceneDoc.light`): a level, or daylight. */
  onLight: (id: string, light: number | undefined) => void;
  onRemove: (id: string) => void;
  onSetStart: (id: string) => void;
  onClose: () => void;
}

export function SceneMenu(props: SceneMenuProps): preact.JSX.Element {
  const scenes = props.session.project.scenes;
  const start = props.session.project.startScene;
  return (
    <div class="ph-menu ph-menu-right" data-testid="scene-menu">
      {scenes.map((scene) => {
        const opens = start === scene.id;
        return (
          <div key={scene.id} class="ph-scene-row">
            <button
              class={scene.id === props.editing ? 'ph-item ph-on' : 'ph-item'}
              data-scene={scene.id}
              title={scene.id}
              onClick={() => {
                props.onSwitch(scene.id);
                props.onClose();
              }}
            >
              <span>
                {scene.name || scene.id} <small>{scene.width}×{scene.height}</small>
                {opens ? <span class="ph-warm"> ▸</span> : null}
                {scene.id === props.playingScene ? <span class="ph-good"> ●</span> : null}
              </span>
            </button>
            <button
              class="ph-mini"
              title="Rename"
              onClick={() => {
                const name = prompt('Scene name', scene.name || scene.id);
                if (name !== null && name !== '') props.onRename(scene.id, name);
              }}
            >
              ✎
            </button>
            <button
              class="ph-mini"
              data-testid="scene-light"
              title={scene.light === undefined ? 'Light: daylight' : `Light: ${Math.round(scene.light * 100)}% of daylight`}
              onClick={() => {
                const typed = prompt('How much light the room has, 10 to 100% (empty for daylight). Its fires and torches light a dim one.', scene.light === undefined ? '100' : String(Math.round(scene.light * 100)));
                if (typed === null) return;
                const light = lightFromText(typed);
                if (light !== null) props.onLight(scene.id, light);
              }}
            >
              {scene.light === undefined ? '☀' : '☾'}
            </button>
            <button
              class="ph-mini"
              title={opens ? 'Already the opening scene' : 'Open the project here'}
              disabled={opens}
              onClick={() => props.onSetStart(scene.id)}
            >
              ▸
            </button>
            <button
              class="ph-mini"
              title={
                opens
                  ? 'The opening scene cannot be deleted'
                  : scenes.length <= 1
                    ? 'A project needs at least one scene'
                    : 'Delete this scene'
              }
              disabled={opens || scenes.length <= 1}
              onClick={() => {
                if (confirm(`Delete "${scene.name || scene.id}"?`)) props.onRemove(scene.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div class="ph-sep" />
      <button
        class="ph-item"
        data-testid="add-scene"
        onClick={() => {
          const name = prompt('New scene name', 'New room');
          if (name !== null && name !== '') {
            props.onAdd(name);
            props.onClose();
          }
        }}
      >
        + New scene
      </button>
      <div class="ph-note">▸ opens the project · ● the party is here</div>
    </div>
  );
}
