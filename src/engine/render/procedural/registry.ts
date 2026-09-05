/**
 * The model registry: content ids to specs.
 *
 * Content refers to a model by string — the legacy `model: 'husk'` and
 * `type: 'pine'` fields survive the import unchanged — and this is where those
 * strings resolve. An unknown id resolves to a placeholder rather than throwing,
 * because one bad reference in a map should not take the map down; `missing()`
 * lets an editor list them.
 */

import type { ProceduralModelSpec } from './spec';
import { HERO_MODELS } from './library/heroes';
import { MONSTER_MODELS } from './library/monsters';
import { PROP_MODELS } from './library/props';

/** Stands in for a model that content asked for and the library does not have. */
export const placeholder: ProceduralModelSpec = {
  id: 'placeholder',
  category: 'prop',
  standHeight: 0.6,
  tags: ['placeholder'],
  info: { name: 'Missing Model', desc: 'Content referred to a model the library does not define.' },
  palette: {
    marker: { color: '#c05ac0', emissive: '#7a2a7a', emissiveIntensity: 0.6 },
  },
  parts: [
    { prim: { kind: 'box', w: 0.4, h: 0.4, d: 0.4 }, mat: 'marker', pos: [0, 0.2, 0] },
    { prim: { kind: 'cone', r: 0.12, h: 0.2, seg: 4 }, mat: 'marker', pos: [0, 0.5, 0] },
  ],
};

const ALL: readonly ProceduralModelSpec[] = [...HERO_MODELS, ...MONSTER_MODELS, ...PROP_MODELS];

export class ModelRegistry {
  private readonly specs = new Map<string, ProceduralModelSpec>();
  private readonly missingIds = new Set<string>();

  constructor(specs: readonly ProceduralModelSpec[] = ALL) {
    for (const spec of specs) {
      if (this.specs.has(spec.id)) throw new Error(`duplicate model id "${spec.id}"`);
      this.specs.set(spec.id, spec);
    }
  }

  has(id: string): boolean {
    return this.specs.has(id);
  }

  /** The spec for an id, or the placeholder — never null, never a throw. */
  get(id: string): ProceduralModelSpec {
    const spec = this.specs.get(id);
    if (spec !== undefined) return spec;
    this.missingIds.add(id);
    return placeholder;
  }

  /** Register or replace a spec — how a project adds its own models. */
  add(spec: ProceduralModelSpec): void {
    this.specs.set(spec.id, spec);
    this.missingIds.delete(spec.id);
  }

  /** Every id the library knows, sorted. */
  ids(): string[] {
    return [...this.specs.keys()].sort();
  }

  byCategory(category: ProceduralModelSpec['category']): ProceduralModelSpec[] {
    return [...this.specs.values()].filter((s) => s.category === category);
  }

  /** Ids content asked for that the library could not supply. */
  missing(): string[] {
    return [...this.missingIds].sort();
  }
}

/** The library as shipped. */
export const MODELS = ALL;
