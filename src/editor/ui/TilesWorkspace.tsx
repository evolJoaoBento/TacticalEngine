/**
 * The kinds of tile a project has, as a workspace.
 *
 * `terrainPalette` was always the registry - the placer picks from it, a grid is built
 * from it, a walk costs what it says - but nothing could put an entry in it except
 * editing the JSON by hand. This is where a kind of tile is made: what it is called, what
 * colour it is, what walking over it costs, and what it is drawn with.
 *
 * A project that declares no palette means "the engine's four". Adding to it writes those
 * four down first, because a list with one entry in it would say the project had one kind
 * of ground and every scene painted on the others would fall back to it.
 */

import { useState } from 'preact/hooks';
import { contentIdSchema } from '../../engine/scene/primitives';
import { structureTypes } from '../../engine/scene/building';
import { toContentId } from '../../engine/content/types';
import type { EditorController } from '../controller';
import type { EditorSession } from '../session';
import { defaultPalette, tileIdTaken, tilesStandingOn, type TileType } from '../terrain-edits';

/** The small text button every workspace closes with, styled like the other five's. */
const CLOSE_BUTTON: Record<string, string | number> = {
  padding: '3px 8px',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
};

/** A labelled field: the name above, the control under it, sharing a flex row. */
const FIELD: Record<string, string | number> = { flex: 1, display: 'block', minWidth: 0 };
const CONTROL: Record<string, string | number> = { width: '100%', boxSizing: 'border-box' };

/** The colour a new kind of tile starts as, until somebody says otherwise. */
const NEW_COLOR = '#6b6350';

export function TilesWorkspace(props: {
  session: EditorSession;
  /**
   * The controller rather than the session alone, unlike the other workspaces: a kind of
   * tile is the ground itself, so every edit here has to reach the board, and only the
   * controller's `'terrain'` change does that.
   */
  controller: EditorController;
  /** Every model the project can draw with: the library's, plus what it imported. */
  models?: readonly string[];
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { controller, session } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');

  // The declared palette, or the engine's four shown as what adding would write down. The
  // same function the edits use to write them, rather than a copy of it here that had
  // already fallen a field behind.
  const types: readonly TileType[] = session.project.terrainPalette ?? defaultPalette();
  const tile = types.find((t) => t.id === open) ?? null;

  const edit = (changes: Parameters<EditorController['updateTile']>[1]): void => {
    if (tile === null) return;
    controller.updateTile(tile.id, changes);
    props.onChange();
  };

  const add = (): void => {
    const id = toContentId(adding);
    if (id === '' || !contentIdSchema.safeParse(id).success || tileIdTaken(session.project, id)) return;
    controller.addTile({
      id,
      name: adding.trim(),
      passable: true,
      cost: 1,
      providesCover: false,
      blocksSight: false,
      color: NEW_COLOR,
    });
    setAdding('');
    setOpen(id);
    props.onChange();
  };

  return (
    <div class="ph-workspace-panel" data-testid="tiles-panel">
      <div class="ph-workspace-list" data-testid="tile-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Tiles</strong>
          <button style={CLOSE_BUTTON} data-testid="close-tiles" onClick={props.onClose}>
            Close
          </button>
        </div>

        {types.map((type) => (
          <div key={type.id} class="ph-row">
            <button
              class={type.id === open ? 'ph-item ph-on' : 'ph-item'}
              data-tile={type.id}
              onClick={() => setOpen(type.id)}
            >
              <span
                aria-hidden="true"
                style={{
                  display: 'inline-block',
                  width: '12px',
                  height: '12px',
                  marginRight: '6px',
                  borderRadius: '2px',
                  verticalAlign: 'middle',
                  background: type.color ?? NEW_COLOR,
                }}
              />
              {type.name !== '' ? type.name : type.id}{' '}
              <small>{type.passable ? `costs ${type.cost}` : 'impassable'}</small>
            </button>
            <button
              class="ph-mini"
              title="Remove this kind of tile"
              data-testid={`remove-tile-${type.id}`}
              onClick={() => {
                // Cells naming it are left alone: they fall back to the first kind and
                // Check reports each one, so say how many before it happens.
                const standing = tilesStandingOn(session.project, type.id);
                const warning = standing === 0
                  ? `Remove "${type.name !== '' ? type.name : type.id}"?`
                  : `${standing} tile${standing === 1 ? '' : 's'} stand on "${type.name !== '' ? type.name : type.id}" and will fall back to the first kind. Remove it?`;
                if (!confirm(warning)) return;
                controller.removeTile(type.id);
                if (open === type.id) setOpen(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <div class="ph-row">
          <input
            class="ph-input"
            style={{ flex: 1 }}
            data-testid="new-tile-name"
            placeholder="New tile, by name"
            value={adding}
            onInput={(e) => setAdding(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button class="ph-mini" data-testid="add-tile" disabled={adding.trim() === ''} onClick={add}>
            + Tile
          </button>
        </div>
        <div class="ph-note">
          What a kind of tile says is what the game reads: a walk costs what it costs here,
          and a wall blocks sight because this says so. The placer puts them down.
        </div>
      </div>

      {tile === null ? (
        <div class="ph-workspace-body ph-hint">Pick a kind of tile to change what it is.</div>
      ) : (
        <div class="ph-workspace-body" data-testid="tile-editor">
          <div class="ph-heading">{tile.name !== '' ? tile.name : tile.id}</div>

          <div class="ph-row">
            <label class="ph-heading" style={FIELD}>
              Name
              <input
                class="ph-input"
                style={CONTROL}
                data-testid="tile-name"
                value={tile.name}
                onChange={(e) => edit({ name: e.currentTarget.value })}
              />
            </label>
            <label class="ph-heading" style={FIELD}>
              Colour
              <input
                class="ph-input"
                style={CONTROL}
                data-testid="tile-color"
                type="color"
                value={tile.color ?? NEW_COLOR}
                onChange={(e) => edit({ color: e.currentTarget.value })}
              />
            </label>
          </div>

          <div class="ph-row">
            <label class="ph-heading" style={FIELD}>
              Movement cost
              <input
                class="ph-input"
                style={CONTROL}
                data-testid="tile-cost"
                type="number"
                min="0.25"
                step="0.25"
                value={tile.cost}
                disabled={!tile.passable}
                onChange={(e) => {
                  const cost = Number(e.currentTarget.value);
                  if (cost > 0) edit({ cost });
                }}
              />
            </label>
          </div>

          <label class="ph-row" data-testid="tile-passable">
            <input
              type="checkbox"
              checked={tile.passable}
              onChange={(e) => edit({ passable: e.currentTarget.checked })}
            />
            <span style={{ flex: 1 }}>Can be walked on</span>
          </label>

          <label class="ph-row" data-testid="tile-cover">
            <input
              type="checkbox"
              checked={tile.providesCover}
              onChange={(e) => edit({ providesCover: e.currentTarget.checked })}
            />
            <span style={{ flex: 1 }}>Gives cover to whoever stands here</span>
          </label>

          <label class="ph-row" data-testid="tile-blocks-sight">
            <input
              type="checkbox"
              checked={tile.blocksSight}
              onChange={(e) => edit({ blocksSight: e.currentTarget.checked })}
            />
            <span style={{ flex: 1 }}>Blocks line of sight through it</span>
          </label>

          <div class="ph-heading">Structure</div>
          <select
            class="ph-select"
            data-testid="tile-structure"
            aria-label={`What kind of structure ${tile.id} is`}
            value={tile.structure ?? ''}
            onChange={(e) => {
              const picked = e.currentTarget.value;
              edit(picked === '' ? { structure: undefined } : { structure: picked });
            }}
          >
            <option value="">Ground, not a structure</option>
            {structureTypes().map((type) => (
              <option key={type.id} value={type.id}>{type.name !== '' ? type.name : type.id}</option>
            ))}
          </select>
          <div class="ph-note">
            Ground is painted flat, one kind to a cell. A structure is stamped as a piece
            that stacks, and what a walk over that cell costs is read off whichever kind of
            tile ended up on top.
          </div>

          <div class="ph-heading">Drawn with</div>
          <select
            class="ph-select"
            data-testid="tile-model"
            aria-label={`What ${tile.id} is drawn with`}
            value={tile.model ?? ''}
            onChange={(e) => {
              const picked = e.currentTarget.value;
              controller.setTerrainModel(tile.id, picked === '' ? null : picked);
              props.onChange();
            }}
          >
            <option value="">Colour, not a model</option>
            {(props.models ?? []).map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
          {tile.model === undefined ? null : (
            <div class="ph-row">
              <label class="ph-heading" style={FIELD}>
                Size, in tiles
                <input
                  class="ph-input"
                  style={CONTROL}
                  data-testid="tile-scale"
                  type="number"
                  min="0.05"
                  step="0.05"
                  placeholder="the model's own"
                  value={tile.scale ?? ''}
                  onChange={(e) => {
                    // Cleared goes back to the model's own size, which is not the same as
                    // a size of zero - so an empty box deletes the field rather than
                    // writing a number that would make every tile of the kind vanish.
                    const typed = e.currentTarget.value.trim();
                    if (typed === '') {
                      edit({ scale: undefined });
                      return;
                    }
                    const scale = Number(typed);
                    if (scale > 0) edit({ scale });
                  }}
                />
              </label>
            </div>
          )}
          <div class="ph-note">
            Every tile of this kind stands one of these, at the size set here: 1 fills the
            cell. The size belongs to the kind of tile rather than to the file, because the
            same export is a creature shrunk into one cell and a floor piece made to fill
            it. What a walk costs and what a click hits is the tile itself, not the model,
            so a file that fails to load leaves the room playable.
          </div>
        </div>
      )}
    </div>
  );
}
