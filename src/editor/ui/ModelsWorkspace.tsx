/**
 * Imported models, as a workspace: what the project declares, where each one
 * loads from, and a way to add another by URL.
 */

import { modelAssetSchema } from '../../engine/render/assets';
import { addAsset, removeAsset, type EditorSession } from '../session';

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

export function ModelsWorkspace(props: {
  session: EditorSession;
  /** The project's model list changed; the loader should follow. */
  onAssetsChanged?: () => void;
  onChange: () => void;
  onClose: () => void;
}): preact.JSX.Element {
  const { session } = props;
  return (
    <div class="ph-workspace-panel" data-testid="models-panel">
      <div class="ph-workspace-body" data-testid="asset-list">
        <div class="ph-row">
          <strong style={{ flex: 1 }}>Models</strong>
          <button style={CLOSE_BUTTON} data-testid="close-models" onClick={props.onClose}>
            Close
          </button>
        </div>
        {session.project.assets.map((asset) => (
          <div key={asset.id} class="ph-row" data-asset={asset.id}>
            <span style={{ flex: 1 }}>
              {asset.id} <small>{asset.url}</small>
            </span>
            <button
              class="ph-mini"
              title="Remove this model"
              onClick={() => {
                if (!confirm(`Remove model "${asset.id}"?`)) return;
                session.run(removeAsset(asset.id));
                props.onAssetsChanged?.();
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          class="ph-item"
          data-testid="add-model"
          onClick={() => {
            const url = prompt('Model file (.glb / .gltf URL)', '/models/thing.glb');
            if (url === null || url.trim() === '') return;
            const base = url.split('/').pop()?.replace(/\.(glb|gltf)$/i, '') ?? 'model';
            const id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
            if (session.project.assets.some((a) => a.id === id)) return;
            const scale = Number(prompt('Scale (a tile is one unit)', '1')) || 1;
            session.run(addAsset(modelAssetSchema.parse({ id, url: url.trim(), scale })));
            props.onAssetsChanged?.();
            props.onChange();
          }}
        >
          + Model
        </button>
        <div class="ph-note">Pick an imported model from Terrain's Props tab, or name it on an object, to use it.</div>
      </div>
    </div>
  );
}
