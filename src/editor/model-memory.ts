/**
 * The models a designer imported, remembered between sessions.
 *
 * A file picked in the Models panel is read into the project document, so a
 * saved project carries its own art with it — but the project itself is not kept
 * in the browser, and until now closing the tab lost every model imported into
 * one. This keeps the declarations beside the game's saves: the id, the settings
 * and the file itself, as the data URL the panel embedded.
 *
 * Not `localStorage`, which is where the saves live: that is a few megabytes for
 * everything, and one rigged character is several. IndexedDB holds them instead,
 * behind a store that is injected — the browser's in the app, a Map in a test —
 * so the rule about what comes back can be driven without a database. Every
 * touch is guarded, because a browser with storage turned off throws rather than
 * refusing politely, and losing an import is not worth losing the editor over.
 */

import { modelAssetSchema, type ModelAsset } from '../engine/render/assets';
import { addAsset, type EditorSession } from './session';

/** Where remembered models are kept. Asynchronous, because IndexedDB is. */
export interface ModelStore {
  /** Everything kept, as it was written: unparsed, because a store can hold anything. */
  all(): Promise<unknown[]>;
  put(asset: ModelAsset): Promise<void>;
  forget(id: string): Promise<void>;
}

/**
 * Which remembered models a project is still missing.
 *
 * The project wins every clash: a document that declares `fox` has its own fox,
 * settings and all, and what the browser remembers of an earlier one does not
 * reach over it. Anything the store cannot be read back as a model is skipped
 * rather than thrown — a row written by an older build is not a reason to fail
 * to open the editor.
 */
export function missingFrom(declared: readonly ModelAsset[], kept: readonly unknown[]): ModelAsset[] {
  const have = new Set(declared.map((asset) => asset.id));
  const missing: ModelAsset[] = [];
  for (const row of kept) {
    const parsed = modelAssetSchema.safeParse(row);
    if (!parsed.success || have.has(parsed.data.id)) continue;
    have.add(parsed.data.id);
    missing.push(parsed.data);
  }
  return missing;
}

/**
 * Lay what this browser remembers under a project: every model it does not
 * already declare is added to it. Answers how many came back, so a caller only
 * rebuilds the loader when something actually did.
 */
export function restoreInto(session: EditorSession, kept: readonly unknown[]): number {
  const missing = missingFrom(session.project.assets, kept);
  for (const asset of missing) session.run(addAsset(asset));
  return missing.length;
}

const DATABASE = 'tactical-engine';
const SHELF = 'models';

/** A store that keeps nothing, for a browser that will not have one. */
export const NO_STORE: ModelStore = {
  all: () => Promise.resolve([]),
  put: () => Promise.resolve(),
  forget: () => Promise.resolve(),
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SHELF)) request.result.createObjectStore(SHELF, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the model store would not open'));
  });
}

/** One request, as a promise, on a shelf opened for the occasion. */
function asked<T>(mode: IDBTransactionMode, act: (shelf: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = act(database.transaction(SHELF, mode).objectStore(SHELF));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('the model store refused'));
      }),
  );
}

/**
 * The browser's own store, or one that keeps nothing where there is no
 * IndexedDB to keep it in. A refusal is answered with what the caller would
 * have got from an empty store, so an editor opens either way.
 */
export function modelStore(): ModelStore {
  if (typeof indexedDB === 'undefined') return NO_STORE;
  return {
    all: () => asked<unknown[]>('readonly', (shelf) => shelf.getAll()).catch(() => []),
    put: (asset) => asked('readwrite', (shelf) => shelf.put(asset)).then(() => undefined).catch(() => undefined),
    forget: (id) => asked('readwrite', (shelf) => shelf.delete(id)).then(() => undefined).catch(() => undefined),
  };
}

let mine: ModelStore | null = null;

/** The one store this page keeps its models in. */
export function memory(): ModelStore {
  return (mine ??= modelStore());
}
