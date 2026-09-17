import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The models a project ships with, found rather than listed.
 *
 * Dropping a `.glb` into `public/models` is how a model gets into the game: this
 * reads that folder at startup and hands the app what it found, so nothing has to
 * be registered by hand and a file added later is picked up on the next restart.
 * `import.meta.glob` cannot do it — Vite keeps `publicDir` out of the module graph
 * on purpose, because those files are copied rather than bundled — so the list
 * comes through a virtual module instead.
 *
 * The id is the file's own name, tidied the way the Models panel tidies the name of a
 * picked file: `bandit-cutter.glb` is the model `bandit-cutter`, and `stone_golem.glb`
 * is `stone-golem`, which is what content refers to and what an adversary of that id is
 * drawn with. The url keeps the name the file actually has, which is what is served.
 */

/** Where the files live, under the served directory, and what the app imports to get them. */
export const MODELS_DIRECTORY = 'models';
const VIRTUAL = 'virtual:shipped-models';
const RESOLVED = '\0' + VIRTUAL;

/** One model the folder holds: its id, the URL it is served at, and how big it is drawn. */
export interface ShippedModel {
  id: string;
  url: string;
  scale: number;
}

/**
 * How much a shipped model is scaled down.
 *
 * Every file in the set measures two units across and two tall, which is a tile's
 * width twice over; half brings a creature down to standing in one. A file that
 * wants its own size says so in the Models panel, which writes it to the project.
 */
export const SHIPPED_SCALE = 0.5;

/** The `.glb` files in the folder, as models, sorted so a build is the same twice. */
export function shippedModels(publicDir: string): ShippedModel[] {
  let names: string[];
  try {
    names = readdirSync(join(publicDir, MODELS_DIRECTORY));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names
    .filter((name) => name.toLowerCase().endsWith('.glb') || name.toLowerCase().endsWith('.gltf'))
    .sort()
    .map((name) => ({
      id: name
        .replace(/\.(glb|gltf)$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
      url: `/${MODELS_DIRECTORY}/${name}`,
      scale: SHIPPED_SCALE,
    }));
}

/** Serves the found list as `virtual:shipped-models`, in dev and in a build alike. */
export function modelManifest(): Plugin {
  let publicDir = 'public';
  return {
    name: 'tactical-model-manifest',
    configResolved(config) {
      publicDir = config.publicDir || 'public';
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return `export const SHIPPED_MODELS = ${JSON.stringify(shippedModels(publicDir))};\n`;
    },
    /**
     * Watch the folder, so a file dropped in appears without a restart.
     *
     * Two things stand between a new `.glb` and the running page. Vite keeps `publicDir`
     * out of the module graph on purpose - those files are copied rather than bundled - so
     * nothing there is watched unless it is asked for. And the virtual module is loaded
     * once and held: the list the page has is the one read when it was first asked for, so
     * even a file that predates the server never appears. Invalidating it is what makes
     * the next request re-read the folder.
     */
    configureServer(server) {
      const folder = join(publicDir, MODELS_DIRECTORY);
      server.watcher.add(folder);
      const changed = (file: string): void => {
        // Separators differ by platform and the watcher reports the host's own, so the
        // folder is matched on the segment rather than on a prefix of the joined path.
        const path = file.replace(/\\/g, '/');
        if (!/\.(glb|gltf)$/i.test(path) || !path.includes(`/${MODELS_DIRECTORY}/`)) return;
        const module = server.moduleGraph.getModuleById(RESOLVED);
        if (module !== undefined) server.moduleGraph.invalidateModule(module);
        // A full reload rather than an HMR update: the list is read at startup by the
        // scene the whole game is built from, so nothing short of starting again shows it.
        server.hot.send({ type: 'full-reload' });
      };
      for (const event of ['add', 'unlink', 'change'] as const) server.watcher.on(event, changed);
    },
  };
}
