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
 *
 * And the project's imported materials (**Surfaces**, `surface-import.ts`): a zip from ambientCG - or a material's
 * images loose - dropped here, or picked with **+ Surface**, becomes a material and four kinds of tile drawn in it, a
 * block, a wall, a floor slab and a staircase, ready in the Terrain strip. Each material is tuned here, and removed
 * here with its four kinds; a kind of tile made by hand may be drawn in one too. A texture on Poly Haven comes the
 * same way by its name, downloaded (`engine/content/poly-haven.ts`): one of the starters suggested, or any id typed.
 */

import { useState } from 'preact/hooks';
import { contentIdSchema } from '../../engine/scene/primitives';
import { structureTypes } from '../../engine/scene/building';
import { toContentId } from '../../engine/content/types';
import type { EditorController } from '../controller';
import type { EditorSession } from '../session';
import { defaultPalette, tileIdTaken, tilesStandingOn, type TileType } from '../terrain-edits';
import { JumpRulesEditor } from './JumpRulesEditor';
import { Icon } from './icons';
import { AiBadge, artMarkHandlers } from './AiMark';
import { SURFACE_SIZES, addImported, addPolyHaven, compressMaps, isCompressedSurface, linkPolyHaven, type SurfaceSize } from '../surface-import';
import { POLY_HAVEN_STARTERS, polyHavenId } from '../../engine/content/poly-haven';

/** The back arrow every workspace returns to the board with, before its title, styled like the others'. */
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

/** What `open` holds while the jump rules are showing: no kind of tile can be called this, since an id has no space in it. */
const JUMP_RULES = 'jump rules';

/** What `open` holds while a material is showing: its id after this, which no kind of tile's id can be. */
const SURFACE = 'surface ';

/** A material's sliders: what each tunes, its range, and what it is called. */
const TUNINGS = [
  { key: 'size', label: 'Size, in tiles per repeat', min: 0.25, max: 8, step: 0.25 },
  { key: 'depth', label: 'Depth', min: 0, max: 0.2, step: 0.01 },
  { key: 'normalScale', label: 'Normal strength', min: 0, max: 2, step: 0.05 },
  { key: 'roughness', label: 'Roughness', min: 0, max: 2, step: 0.05 },
  { key: 'tint', label: "Tint, from its kind's colour", min: 0, max: 1, step: 0.05 },
] as const;

/** The repeat typed rather than slid: any size the schema takes, to match a reference exactly. */
const SIZE_TYPED = { min: 0.05, max: 16 };

/** Where a linked material's maps are: not asked for yet, on their way and how far, in, or why they would not come. */
function fetchNote(state: { status: string; said?: string | undefined; error?: string | undefined } | undefined): string {
  switch (state?.status) {
    case 'loading':
      return `Fetching it now: ${state.said ?? 'waiting'}…`;
    case 'ready':
      return 'In this browser, and drawn.';
    case 'failed':
      return `It could not be fetched (${state.error ?? 'no reason given'}): its tiles are drawn in their kind's colour until the page is opened again.`;
    default:
      return 'Fetched when a tile in it is first drawn.';
  }
}

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
  /** How a material's maps are getting on (`SurfaceLibrary`): for a linked one, whether it is fetched yet, and how far. */
  surfaceStatus?: (id: string) => { status: string; said?: string | undefined; error?: string | undefined };
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { controller, session } = props;
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState('');
  const [size, setSize] = useState<SurfaceSize>(1024);
  /** What the last import said: under way, why it failed, or the files it did not read. */
  const [importing, setImporting] = useState<string | null>(null);
  /** The Poly Haven texture named to download: a starter picked, or an id or a link typed. */
  const [haven, setHaven] = useState('');
  const surfaces = session.project.surfaces ?? [];
  const surface = open !== null && open.startsWith(SURFACE) ? (surfaces.find((s) => s.id === open.slice(SURFACE.length)) ?? null) : null;

  /** A material imported from the files given, its four kinds added, and its block picked in the strip. */
  const importFiles = async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return;
    setImporting('Importing…');
    const { id, said } = await addImported(controller, files, size, (taken) => tileIdTaken(session.project, taken));
    if (id !== null) setOpen(`${SURFACE}${id}`);
    setImporting(said);
    props.onChange();
  };

  /**
   * A Poly Haven texture downloaded and imported as files would be - carried in the project - or linked: imported the
   * same, but only its name kept in the project and its maps in this browser. Either says how it is getting on.
   */
  const importHaven = async (linked = false): Promise<void> => {
    const id = polyHavenId(haven);
    if (id === null) {
      setImporting('Name a Poly Haven texture: its id (rock_wall_08) or its page (polyhaven.com/a/rock_wall_08).');
      return;
    }
    const progress = (said: string): void => setImporting(`${id} from Poly Haven: ${said}…`);
    progress('asking for it');
    const taken = (other: string): boolean => tileIdTaken(session.project, other);
    const { id: made, said } = linked ? await linkPolyHaven(controller, id, size, taken, { progress }) : await addPolyHaven(controller, id, size, taken, fetch, progress);
    if (made !== null) {
      setOpen(`${SURFACE}${made}`);
      setHaven('');
    }
    setImporting(said);
    props.onChange();
  };

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
    <div
      class="ph-workspace-panel"
      data-testid="tiles-panel"
      // A material dropped anywhere on the panel is imported, as + Surface would.
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void importFiles([...(e.dataTransfer?.files ?? [])]);
      }}
    >
      <div class="ph-workspace-list" data-testid="tile-list">
        <div class="ph-row">
          <button style={CLOSE_BUTTON} data-testid="close-tiles" onClick={props.onClose} aria-label="Back" title="Back to the board">
            <Icon name="back" size={16} />
          </button>
          <strong style={{ flex: 1 }}>Tiles</strong>
        </div>

        <div class="ph-heading" title="Imported materials: each gives four kinds of tile drawn in it">Surfaces</div>
        {surfaces.map((made) => (
          <div key={made.id} class="ph-row">
            <button class={open === `${SURFACE}${made.id}` ? 'ph-item ph-on' : 'ph-item'} data-surface={made.id} onClick={() => setOpen(`${SURFACE}${made.id}`)}>
              {made.name !== '' ? made.name : made.id} <small>{made.parallax ? 'with depth' : 'flat'}</small>
            </button>
            <button
              class="ph-mini"
              title="Remove this material and its four tiles"
              data-testid={`remove-surface-${made.id}`}
              onClick={() => {
                if (!confirm(`Remove "${made.name || made.id}"? This removes its four tiles too.`)) return;
                controller.removeSurface(made.id);
                if (open === `${SURFACE}${made.id}`) setOpen(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <div class="ph-row">
          <label class="ph-mini" style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} title="An ambientCG zip, or a material's images: each becomes four tiles">
            + Surface
            <input
              type="file"
              accept=".zip,image/*"
              multiple
              data-testid="surface-file"
              style={{ display: 'none' }}
              onChange={(e) => {
                const input = e.currentTarget;
                void importFiles([...(input.files ?? [])]).then(() => (input.value = ''));
              }}
            />
          </label>
          <select class="ph-select" data-testid="surface-resolution" aria-label="How big its maps are kept" value={size} onChange={(e) => setSize(Number(e.currentTarget.value) as SurfaceSize)}>
            {SURFACE_SIZES.map((side) => (
              <option key={side} value={side}>{side === 512 ? '512 px' : `${side / 1024}K`}</option>
            ))}
          </select>
        </div>
        <div class="ph-row">
          <input
            class="ph-input"
            style={{ flex: 1, minWidth: 0 }}
            list="poly-haven-starters"
            data-testid="poly-haven-id"
            aria-label="A Poly Haven texture"
            placeholder="Poly Haven id or link"
            title="A texture from polyhaven.com (CC0): pick one, or paste its id (rock_wall_08) or its page's address"
            value={haven}
            onInput={(e) => setHaven(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void importHaven();
            }}
          />
          <datalist id="poly-haven-starters">
            {POLY_HAVEN_STARTERS.map((starter) => (
              <option key={starter.id} value={starter.id} label={`${starter.group}: ${starter.name}`} />
            ))}
          </datalist>
          <button class="ph-mini" data-testid="poly-haven-add" title="Download it from Poly Haven: four tiles drawn in it, its maps carried in the project" onClick={() => void importHaven()}>
            Download
          </button>
          <button
            class="ph-mini"
            data-testid="poly-haven-link"
            title="Link it: four tiles drawn in it, the project naming it and this browser keeping its maps - any other browser fetches them from Poly Haven the first time it draws it. The project stays small."
            onClick={() => void importHaven(true)}
          >
            Link
          </button>
        </div>
        {importing === null ? null : (
          <div class="ph-note" data-testid="surface-status">
            {importing}
          </div>
        )}
        <div class="ph-heading">Kinds of tile</div>

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
              <span {...artMarkHandlers(type.model === undefined ? null : `model:${type.model}`)}>
                {type.name !== '' ? type.name : type.id}{' '}
                <AiBadge art={type.model === undefined ? null : `model:${type.model}`} inline />
              </span>{' '}
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
        {/* How high the kinds above stand is ground; what the game makes of that height is here. */}
        <div class="ph-row">
          <button class={open === JUMP_RULES ? 'ph-item ph-on' : 'ph-item'} data-testid="open-jump-rules" onClick={() => setOpen(JUMP_RULES)}>
            Height and jumping <small>{session.project.jump === undefined ? 'the defaults' : 'set by this project'}</small>
          </button>
        </div>
        <div class="ph-note">
          What a kind of tile says is what the game reads: a walk costs what it costs here,
          and a wall blocks sight because this says so. The placer puts them down.
        </div>
      </div>

      {open === JUMP_RULES ? (
        <JumpRulesEditor session={session} onChange={props.onChange} />
      ) : surface !== null ? (
        <div class="ph-workspace-body" data-testid="surface-editor">
          <div class="ph-heading">{surface.name !== '' ? surface.name : surface.id}</div>
          <label class="ph-heading" style={FIELD}>
            Name
            <input class="ph-input" style={CONTROL} data-testid="surface-name" value={surface.name} onChange={(e) => {
              controller.updateSurface(surface.id, { name: e.currentTarget.value });
              props.onChange();
            }} />
          </label>
          {TUNINGS.map((tuning) => (
            <label key={tuning.key} class="ph-heading" style={{ display: 'block' }}>
              {tuning.label} <small>{surface[tuning.key]}</small>
              <input
                type="range"
                style={CONTROL}
                data-testid={`surface-${tuning.key}`}
                min={tuning.min}
                max={tuning.max}
                step={tuning.step}
                value={surface[tuning.key]}
                disabled={tuning.key === 'depth' && !surface.parallax}
                onInput={(e) => {
                  controller.updateSurface(surface.id, { [tuning.key]: Number(e.currentTarget.value) });
                  props.onChange();
                }}
              />
              {tuning.key !== 'size' ? null : (
                <input
                  class="ph-input"
                  style={CONTROL}
                  type="number"
                  data-testid="surface-size-typed"
                  aria-label="Size, in tiles per repeat, typed"
                  min={SIZE_TYPED.min}
                  max={SIZE_TYPED.max}
                  step="any"
                  value={surface.size}
                  onChange={(e) => {
                    // Out of range or not a number is left as it was: the box shows the size again.
                    const typed = Number(e.currentTarget.value);
                    if (Number.isFinite(typed) && typed >= SIZE_TYPED.min && typed <= SIZE_TYPED.max) controller.updateSurface(surface.id, { size: typed });
                    props.onChange();
                  }}
                />
              )}
            </label>
          ))}
          <div class="ph-note">
            Tint at 0 draws the material in its own colours. Raised, it takes the colour of the kind of tile it is drawn
            on - and on the ground a cell's own tint - until at 1 its average is that colour, its detail kept.
          </div>
          {/* The ground too: every cell of a kind ticked here is drawn in this material. */}
          <div class="ph-heading">Ground drawn in it</div>
          {types.filter((kind) => kind.structure === undefined && kind.id !== 'void').map((kind) => (
            <label key={kind.id} class="ph-row" data-testid={`surface-ground-${kind.id}`}>
              <input
                type="checkbox"
                checked={kind.surface === surface.id}
                onChange={(e) => {
                  controller.updateTile(kind.id, e.currentTarget.checked ? { surface: surface.id } : { surface: undefined });
                  props.onChange();
                }}
              />
              <span style={{ flex: 1 }}>{kind.name !== '' ? kind.name : kind.id}</span>
              {kind.surface !== undefined && kind.surface !== surface.id ? <small>in {surfaces.find((s) => s.id === kind.surface)?.name ?? kind.surface}</small> : null}
            </label>
          ))}
          {isCompressedSurface(surface) ? null : (
            <div class="ph-row" data-testid="surface-uncompressed">
              <span class="ph-note" style={{ flex: 1 }}>
                Not compressed for the graphics card: it takes four times the memory a compressed material does.
              </span>
              <button
                class="ph-mini"
                data-testid="surface-compress"
                onClick={() => {
                  const id = surface.id;
                  setImporting('Compressing…');
                  void compressMaps(surface).then(
                    (maps) => {
                      controller.compressSurface(id, maps);
                      setImporting(`Compressed ${surface.name || id} for the graphics card.`);
                      props.onChange();
                    },
                    (failure: unknown) => setImporting(`Not compressed: ${failure instanceof Error ? failure.message : String(failure)}`),
                  );
                }}
              >
                Compress
              </button>
            </div>
          )}
          <div class="ph-note">
            {surface.parallax
              ? 'Depth is how far the material reads into a face, in tiles: mortar sinking behind bricks.'
              : 'This material came with no height map, so it is drawn flat: its normals still catch the light.'}{' '}
            {surface.source === undefined ? null : <>From {surface.source}.</>}{' '}
            {surface.polyHaven === undefined ? null : (
              <span data-testid="surface-linked">
                Linked, not carried: fetched from Poly Haven ({surface.polyHaven.id}) the first time it is drawn, and kept in this browser after, so the project stays small.{' '}
                <span data-testid="surface-fetch">{fetchNote(props.surfaceStatus?.(surface.id))}</span>{' '}
              </span>
            )}
            Its four tiles are in the Terrain strip; each is a
            kind of tile here, below.
          </div>
        </div>
      ) : tile === null ? (
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
            Only a kind that is a structure can be placed: it is stamped as a piece that
            stacks, and what a walk over that cell costs is read off whichever kind of tile
            ended up on top. Ground is the substrate under all of it - every cell holds a
            kind and it is still drawn - but it is not something the placer puts down.
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
          <div class="ph-heading">Surface</div>
          <select
            class="ph-select"
            data-testid="tile-surface"
            aria-label={`What material ${tile.id} is drawn in`}
            value={tile.surface ?? ''}
            onChange={(e) => {
              const picked = e.currentTarget.value;
              edit(picked === '' ? { surface: undefined } : { surface: picked });
            }}
          >
            <option value="">None: its colour</option>
            {surfaces.map((made) => (
              <option key={made.id} value={made.id}>{made.name !== '' ? made.name : made.id}</option>
            ))}
          </select>
          {tile.surface === undefined ? null : (
            <label class="ph-heading" style={FIELD}>
              Repeat, in tiles
              <input
                class="ph-input"
                style={CONTROL}
                data-testid="tile-surface-size"
                type="number"
                min={SIZE_TYPED.min}
                max={SIZE_TYPED.max}
                step="any"
                placeholder={`the material's: ${surfaces.find((made) => made.id === tile.surface)?.size ?? 1}`}
                value={tile.surfaceSize ?? ''}
                onChange={(e) => {
                  // Cleared goes back to the material's own repeat; a size the schema refuses is left as it was.
                  const typed = e.currentTarget.value.trim();
                  if (typed === '') {
                    edit({ surfaceSize: undefined });
                    return;
                  }
                  const size = Number(typed);
                  if (Number.isFinite(size) && size >= SIZE_TYPED.min && size <= SIZE_TYPED.max) edit({ surfaceSize: size });
                  else props.onChange();
                }}
              />
            </label>
          )}
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
