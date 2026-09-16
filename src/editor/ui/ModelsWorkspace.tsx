/**
 * Imported models, as a workspace: what the project declares, where each one
 * came from, how it sits on a tile, and which of its clips play.
 *
 * A file picked here is read into the project itself, so one saved document
 * carries its art with it. The clip lists are the file's own animation names,
 * read back once it has loaded, so a state is chosen rather than typed.
 */

import { useEffect } from 'preact/hooks';
import { modelAssetSchema, type ModelAsset } from '../../engine/render/assets';
import { addAsset, removeAsset, updateAsset, type EditorSession } from '../session';
import { memory } from '../model-memory';

/** The small text button every workspace closes with, styled like the other four's. */
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

/** The model as the board will draw it, big enough to judge a tenth of a tile by. */
const PREVIEW_SIZE = 150;
const PREVIEW: Record<string, string | number> = {
  borderRadius: '4px',
  background: '#00000040',
  flex: 'none',
  // Top of the picture against the top of the controls, rather than centred on them.
  alignSelf: 'flex-start',
};

/** Everything that tunes one model, in a column to the right of its picture. */
const TUNING: Record<string, string | number> = { flex: 1, minWidth: 0 };

/** Controls fill their field rather than sitting beside its label. */
const CONTROL: Record<string, string | number> = { width: '100%', boxSizing: 'border-box' };

/** The four states a clip can be given, in the order the panel lists them. */
const CLIP_STATES = ['idle', 'walk', 'hit', 'fallen'] as const;
type ClipState = (typeof CLIP_STATES)[number];

/** A content id from a file name, the way the prompt used to derive one. */
function idFromFileName(name: string): string {
  const base = name.replace(/\.(glb|gltf)$/i, '');
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

/** An id nothing else in the project has taken. */
function freeId(session: EditorSession, wanted: string): string {
  if (!session.project.assets.some((a) => a.id === wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted}-${n}`;
    if (!session.project.assets.some((a) => a.id === candidate)) return candidate;
  }
}

/**
 * Where a model came from, in a line. An embedded file is megabytes of base64 —
 * printing it would fill the panel — so it is reported by size instead.
 */
function sourceLabel(url: string): string {
  if (!url.startsWith('data:')) return url;
  const base64 = url.slice(url.indexOf(',') + 1);
  const bytes = Math.floor((base64.length * 3) / 4);
  return bytes >= 1_048_576
    ? `embedded · ${(bytes / 1_048_576).toFixed(1)} MB`
    : `embedded · ${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
    reader.readAsDataURL(file);
  });
}

export function ModelsWorkspace(props: {
  session: EditorSession;
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  /** The clip names inside a loaded file; empty until it has arrived. */
  assetClips?: (id: string) => readonly string[];
  /** unknown | loading | ready | failed. */
  assetStatus?: (id: string) => string;
  /** Start loading what is declared, so clips can be listed. */
  onRequestAssets?: () => void;
  /** One model's settings changed; the file it already loaded still stands. */
  onAssetTuned?: (id: string) => void;
  /** A picture of a model as the board will draw it, base and all. */
  preview?: (id: string) => string | null;
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { session } = props;
  // Nothing loads until something draws it, so a model never placed has no
  // clips to offer. Opening this panel is as good a reason to load as drawing.
  useEffect(() => {
    props.onRequestAssets?.();
  }, []);

  const edit = (id: string, changes: Parameters<typeof updateAsset>[1]): void => {
    session.run(updateAsset(id, changes));
    // The browser remembers a model as it is now, so a scale tuned here is the
    // scale it comes back at rather than the one it arrived with.
    const tuned = session.project.assets.find((asset) => asset.id === id);
    if (tuned !== undefined) void memory().put(tuned);
    // Not `onAssetsChanged`: rebuilding the library would drop the loaded file
    // and empty the very clip list being chosen from.
    props.onAssetTuned?.(id);
    props.onChange();
  };

  const setClip = (asset: ModelAsset, state: ClipState, name: string): void => {
    const next: Record<string, string> = { ...(asset.clips ?? {}) };
    if (name === '') delete next[state];
    else next[state] = name;
    edit(asset.id, { clips: Object.keys(next).length === 0 ? null : next });
  };

  return (
    <div class="ph-workspace-panel" data-testid="models-panel">
      <div class="ph-workspace-body" data-testid="asset-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Models</strong>
          <button style={CLOSE_BUTTON} data-testid="close-models" onClick={props.onClose}>
            Close
          </button>
        </div>

        {session.project.assets.map((asset) => {
          const clips = props.assetClips?.(asset.id) ?? [];
          const preview = props.preview?.(asset.id) ?? null;
          const status = props.assetStatus?.(asset.id) ?? 'unknown';
          return (
            <div key={asset.id} data-asset={asset.id} style={{ marginBottom: '14px' }}>
              {/* The picture down the left, everything that adjusts it down the right. */}
              <div class="ph-row" style={{ alignItems: 'flex-start' }}>
                {/* Where it will stand, on a tile with its base under it: big enough that a
                    nudge of a tenth of a tile is something you can see. */}
                {preview !== null ? (
                  <img
                    src={preview}
                    alt=""
                    width={PREVIEW_SIZE}
                    height={PREVIEW_SIZE}
                    data-testid={`asset-preview-${asset.id}`}
                    style={PREVIEW}
                  />
                ) : null}
                <div style={TUNING}>
              <div class="ph-row">
                <span style={{ flex: 1 }}>
                  <strong>{asset.id}</strong> <small>{sourceLabel(asset.url)}</small>
                </span>
                <small data-testid={`asset-status-${asset.id}`}>{status}</small>
                <button
                  class="ph-mini"
                  title="Remove this model"
                  onClick={() => {
                    if (!confirm(`Remove model "${asset.id}"?`)) return;
                    session.run(removeAsset(asset.id));
                    // Removed here is removed for good: it does not come back with the editor.
                    void memory().forget(asset.id);
                    props.onAssetsChanged?.();
                    props.onChange();
                  }}
                >
                  ✕
                </button>
              </div>

              <div class="ph-row">
                <label class="ph-heading" style={FIELD}>
                  Scale
                  <input
                    class="ph-input"
                    style={CONTROL}
                    data-testid={`asset-scale-${asset.id}`}
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={asset.scale}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (n > 0) edit(asset.id, { scale: n });
                    }}
                  />
                </label>
                <label class="ph-heading" style={FIELD}>
                  Ground offset
                  <input
                    class="ph-input"
                    style={CONTROL}
                    data-testid={`asset-offset-${asset.id}`}
                    type="number"
                    step="0.05"
                    value={asset.groundOffset}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (Number.isFinite(n)) edit(asset.id, { groundOffset: n });
                    }}
                  />
                </label>
                <label class="ph-heading" style={FIELD}>
                  Rotation °
                  <input
                    class="ph-input"
                    style={CONTROL}
                    data-testid={`asset-rotation-${asset.id}`}
                    type="number"
                    step="15"
                    value={Math.round((asset.rotationY * 180) / Math.PI)}
                    onChange={(e) => {
                      const deg = Number(e.currentTarget.value);
                      if (Number.isFinite(deg)) edit(asset.id, { rotationY: (deg * Math.PI) / 180 });
                    }}
                  />
                </label>
              </div>

              <div class="ph-row">
                <label class="ph-heading" style={FIELD}>
                  X offset
                  <input
                    class="ph-input"
                    style={CONTROL}
                    data-testid={`asset-x-${asset.id}`}
                    type="number"
                    step="0.05"
                    value={asset.offsetX}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (Number.isFinite(n)) edit(asset.id, { offsetX: n });
                    }}
                  />
                </label>
                <label class="ph-heading" style={FIELD}>
                  Y offset
                  <input
                    class="ph-input"
                    style={CONTROL}
                    data-testid={`asset-y-${asset.id}`}
                    type="number"
                    step="0.05"
                    value={asset.offsetY}
                    onChange={(e) => {
                      const n = Number(e.currentTarget.value);
                      if (Number.isFinite(n)) edit(asset.id, { offsetY: n });
                    }}
                  />
                </label>
              </div>

              <div class="ph-row">
                {CLIP_STATES.map((state) => (
                  <label key={state} class="ph-heading" style={FIELD}>
                    {state}
                    <select
                      class="ph-select"
                      style={CONTROL}
                      data-testid={`asset-clip-${state}-${asset.id}`}
                      value={asset.clips?.[state] ?? ''}
                      onChange={(e) => setClip(asset, state, e.currentTarget.value)}
                    >
                      <option value="">
                        {state === 'idle' ? 'first in the file' : 'keep playing'}
                      </option>
                      {clips.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {clips.length === 0 ? (
                <div class="ph-note">
                  {status === 'failed'
                    ? 'This file did not load, so it has no clips to offer.'
                    : status === 'ready'
                      ? 'This file carries no animation clips.'
                      : 'Clip names appear once the file has loaded.'}
                </div>
              ) : null}
                </div>
              </div>
            </div>
          );
        })}

        <label class="ph-item" data-testid="add-model">
          + Model
          <input
            class="ph-file"
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={(e) => {
              const input = e.currentTarget;
              const file = input.files?.[0];
              if (file === undefined) return;
              void readAsDataUrl(file).then(async (url) => {
                const id = freeId(session, idFromFileName(file.name));
                const asset = modelAssetSchema.parse({ id, url, scale: 1 });
                session.run(addAsset(asset));
                // Awaited: a tab closed the moment after a file is picked must still have
                // written it, or the model is remembered only until the page goes away.
                await memory().put(asset);
                props.onAssetsChanged?.();
                props.onRequestAssets?.();
                props.onChange();
                // Let the same file be picked again after a remove.
                input.value = '';
              });
            }}
          />
        </label>
        <div class="ph-note">
          The file is stored in the project, so a save carries its art with it, and this browser
          remembers it for the next time the editor opens. Pick it from Terrain's Props tab, name it
          on an object, or point a creature at it from Combat.
        </div>
      </div>
    </div>
  );
}
