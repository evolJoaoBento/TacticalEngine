/**
 * Importer for the legacy PolyHeart map and campaign format.
 *
 * The prototype in `legacy/` is the user's existing content and stays runnable and
 * unmodified; this reads its documents and produces engine `SceneDoc`s. Shapes are
 * catalogued in `docs/research/legacy-game.md` section 8.
 *
 * Three things the legacy format left implicit and this makes explicit:
 *
 * - **Passability.** A legacy tile was a wall only because its height arithmetic
 *   made it unreachable: the editor's Wall tool set `h = 4`, and a step needed
 *   `|dh| <= 1`. Tiles at or above `WALL_HEIGHT` become `wall` terrain, and the
 *   height is kept so elevation still reads the same.
 * - **Ids.** Legacy ids came from `Math.random()` and could not survive a save
 *   round trip. Anything missing a stable id gets one derived from the scene and
 *   the position, so re-importing the same document twice gives the same ids.
 * - **Runtime state in content.** `open`, `used`, `fired` and the scripted node
 *   flags are dropped from the document; they belong to `SceneState`.
 *
 * Never throws: an entry it cannot read is skipped and reported.
 */

import type { ContentIssue } from '../content/types';
import { toContentId } from '../content/types';
import { CURRENT_FORMAT_VERSION } from './schema';
import type {
  Deco,
  Effect,
  Encounter,
  Interactable,
  Point,
  ProjectDoc,
  SceneDoc,
  Trait,
} from './schema';

/** The editor's Wall tool set this height; nothing could step up to it from the floor. */
export const WALL_HEIGHT = 4;

export interface LegacyTile {
  h?: unknown;
  color?: unknown;
  prop?: unknown;
}

export interface LegacyMap {
  id?: unknown;
  name?: unknown;
  intro?: unknown;
  w?: unknown;
  h?: unknown;
  tiles?: unknown;
  nodes?: unknown;
  enemies?: unknown;
  triggers?: unknown;
  decos?: unknown;
  spawns?: unknown;
  fog?: unknown;
}

export interface LegacyCampaign {
  campaign?: unknown;
  name?: unknown;
  scenes?: unknown;
}

/**
 * Legacy enemy `type` keys mapped onto SRD adversary content ids.
 *
 * Only Tangle Bramble exists in the SRD; Hollow Husk and Shadow Hag are the
 * prototype's homebrew, so they keep their own ids and a project must supply
 * stat blocks for them. That is a content gap, not an import failure, so the
 * import succeeds and the missing definition surfaces when the scene is loaded.
 */
export const LEGACY_ADVERSARY_IDS: Readonly<Record<string, string>> = {
  bramble: 'tangle-bramble',
  husk: 'hollow-husk',
  shadowHag: 'shadow-hag',
};

const TRAITS: Readonly<Record<string, Trait>> = {
  agility: 'agility',
  strength: 'strength',
  finesse: 'finesse',
  instinct: 'instinct',
  presence: 'presence',
  knowledge: 'knowledge',
};

const OUTCOME_KEYS = {
  hopeSuccess: 'successWithHope',
  fearSuccess: 'successWithFear',
  hopeFail: 'failureWithHope',
  fearFail: 'failureWithFear',
} as const;

/** Interactable kinds the legacy editor could place. Anything else is `scripted`. */
const KINDS = new Set(['chest', 'door', 'pillar', 'portal']);

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Translate one legacy effect key plus its string parameter into a typed effect. */
export function convertEffect(effect: unknown, param: unknown): Effect | null {
  const key = asString(effect) ?? 'none';
  const text = asString(param) ?? '';
  switch (key) {
    case 'none':
      return { kind: 'none' };
    case 'open':
      return { kind: 'open' };
    case 'loot':
      return { kind: 'loot' };
    // The legacy trap always dealt a flat 2; it becomes an authored amount.
    case 'damage':
      return { kind: 'damage', amount: 2 };
    case 'removeNode':
      return { kind: 'remove' };
    case 'giveKey':
      return text === '' ? null : { kind: 'giveKey', key: text };
    case 'setFlag':
      return text === '' ? null : { kind: 'setFlag', flag: text };
    case 'spawnGroup':
      return text === '' ? null : { kind: 'startEncounter', encounter: encounterId(text) };
    case 'goto':
      return text === '' ? null : { kind: 'goto', scene: toContentId(text) };
    default:
      return null;
  }
}

/** Legacy encounters were numbered groups; they become named encounter ids. */
export function encounterId(group: string | number): string {
  return `group-${toContentId(String(group))}`;
}

/**
 * A stable id from a scene and a position, for content the legacy format gave a
 * random id. Re-importing the same document produces the same ids.
 */
function positionalId(prefix: string, point: Point): string {
  return `${prefix}-${point.x}-${point.y}`;
}

function readPoint(source: { x?: unknown; y?: unknown }): Point | null {
  const x = asInteger(source.x);
  const y = asInteger(source.y);
  return x === null || y === null || x < 0 || y < 0 ? null : { x, y };
}

export interface LegacyImportResult {
  project: ProjectDoc | null;
  issues: ContentIssue[];
}

/** Import a legacy campaign document, or a bare map (which is wrapped in one). */
export function importLegacyCampaign(
  document: LegacyCampaign | LegacyMap,
  options: { id?: string; name?: string } = {},
): LegacyImportResult {
  const issues: ContentIssue[] = [];
  const source = 'legacy';

  const rawScenes = Array.isArray((document as LegacyCampaign).scenes)
    ? ((document as LegacyCampaign).scenes as LegacyMap[])
    : [document as LegacyMap];

  const scenes: SceneDoc[] = [];
  const usedIds = new Set<string>();

  rawScenes.forEach((rawScene, index) => {
    const result = importLegacyScene(rawScene, index, usedIds);
    issues.push(...result.issues);
    if (result.scene !== null) {
      usedIds.add(result.scene.id);
      scenes.push(result.scene);
    }
  });

  if (scenes.length === 0) {
    issues.push({ source, entry: 'campaign', field: 'scenes', message: 'no scene could be read' });
    return { project: null, issues };
  }

  const name = asString((document as LegacyCampaign).name) ?? options.name ?? 'Imported Campaign';
  return {
    project: {
      formatVersion: CURRENT_FORMAT_VERSION,
      // toContentId returns '' (not undefined) for a name with no usable characters.
      id: options.id ?? (toContentId(name) || 'imported'),
      name,
      // A legacy campaign has no party: the game falls back on its own sheets.
      party: [],
      abilities: [],
      code: [],
      conditionDefs: [],
      scenes,
      dialogues: [],
      items: [],
      lootTables: [],
      quests: [],
      assets: [],
      // A legacy campaign re-skins nothing: every creature is drawn as its own id.
      adversaryModels: {},
      // It brings no content of its own either: the party is built from whatever
      // pack the app was given, exactly as it was before content became data.
      classes: [],
      ancestries: [],
      communities: [],
      subclasses: [],
      domainCards: [],
      weapons: [],
      armors: [],
      adversaries: [],
      startScene: scenes[0]!.id,
    },
    issues,
  };
}

/** Import one legacy map into a scene. Returns `null` when the map is unusable. */
export function importLegacyScene(
  map: LegacyMap,
  index = 0,
  takenIds: ReadonlySet<string> = new Set(),
): { scene: SceneDoc | null; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const source = 'legacy';
  const name = asString(map.name) ?? `Scene ${index + 1}`;

  const id = uniqueSceneId(asString(map.id) ?? name, index, takenIds);
  const fail = (field: string, message: string): void => {
    issues.push({ source, entry: name, field, message });
  };

  const width = asInteger(map.w);
  const height = asInteger(map.h);
  if (width === null || height === null || width <= 0 || height <= 0) {
    fail('w/h', `expected positive integers, got ${JSON.stringify([map.w, map.h])}`);
    return { scene: null, issues };
  }

  const tiles = Array.isArray(map.tiles) ? (map.tiles as LegacyTile[]) : null;
  if (tiles === null || tiles.length !== width * height) {
    fail('tiles', `expected ${width * height} tiles, got ${tiles === null ? 'none' : tiles.length}`);
    return { scene: null, issues };
  }

  const terrain: string[] = new Array(tiles.length);
  const heights: number[] = new Array(tiles.length);
  const tints: string[] = new Array(tiles.length);
  tiles.forEach((tile, i) => {
    const level = asInteger(tile.h) ?? 0;
    heights[i] = level;
    const prop = asString(tile.prop);
    terrain[i] =
      level >= WALL_HEIGHT ? 'wall' : prop === 'difficult' ? 'difficult' : prop === 'cover' ? 'cover' : 'floor';
    tints[i] = asString(tile.color) ?? '';
  });

  const spawns: Point[] = [];
  for (const raw of Array.isArray(map.spawns) ? map.spawns : []) {
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const point = readPoint({ x: raw[0], y: raw[1] });
    if (point !== null && point.x < width && point.y < height) spawns.push(point);
  }
  if (spawns.length === 0) {
    // resizeMap guaranteed at least one spawn; a hand-edited file might not.
    fail('spawns', 'no usable spawn point; defaulting to (0, 0)');
    spawns.push({ x: 0, y: 0 });
  }

  const interactables = importInteractables(map, width, height, fail);
  const encounters = importEncounters(map, width, height, fail);
  const decos = importDecos(map, width, height);

  const fogBand = asInteger(
    typeof map.fog === 'object' && map.fog !== null ? (map.fog as { band?: unknown }).band : undefined,
  );

  return {
    scene: {
      id,
      name,
      intro: asString(map.intro) ?? '',
      width,
      height,
      terrain,
      heights,
      tints,
      spawns,
      interactables,
      encounters,
      decos,
      ...(fogBand !== null && fogBand > 0 ? { fogBand } : {}),
    },
    issues,
  };
}

function uniqueSceneId(preferred: string, index: number, taken: ReadonlySet<string>): string {
  const base = toContentId(preferred) || `scene-${index + 1}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function importInteractables(
  map: LegacyMap,
  width: number,
  height: number,
  fail: (field: string, message: string) => void,
): Interactable[] {
  const out: Interactable[] = [];
  const seen = new Set<string>();

  for (const raw of (Array.isArray(map.nodes) ? map.nodes : []) as Record<string, unknown>[]) {
    const point = readPoint(raw);
    if (point === null || point.x >= width || point.y >= height) {
      fail('nodes', `node ${JSON.stringify(raw['id'])} is outside the scene`);
      continue;
    }
    const rawType = asString(raw['type']) ?? 'scripted';
    const kind = KINDS.has(rawType) ? (rawType as Interactable['kind']) : 'scripted';

    // Legacy random ids are not stable, so anything that is not already a
    // readable id is replaced by one derived from the position.
    const rawId = asString(raw['id']) ?? '';
    let id = /^(?:node|enemy|trig)-[a-z0-9]{6}$/.test(rawId) ? '' : toContentId(rawId);
    if (id === '' || seen.has(id)) id = positionalId(kind, point);
    if (seen.has(id)) {
      fail('nodes', `two nodes share the tile (${point.x}, ${point.y}); the second was dropped`);
      continue;
    }
    seen.add(id);

    const interactable: Interactable = {
      id,
      kind,
      position: point,
      // The legacy editor had no roll-free effects; a check is all it wrote.
      effects: [],
      name: asString(raw['name']) ?? '',
      flavor: asString(raw['flavor']) ?? '',
      model: asString(raw['model']),
      blocksMovement: true,
      // A lock that refused once can be tried again; a chest's one set of loot cannot.
      repeatable: kind === 'door',
      lockedText: asString(raw['lockedText']) ?? '',
      tags: [],
      data: {},
    };

    const requiresKey = asString(raw['requireKey']) ?? '';
    if (requiresKey !== '') interactable.requiresKey = requiresKey;
    const goto = asString(raw['goto']);
    if (goto !== null && goto !== '') interactable.goto = toContentId(goto);

    const check = importCheck(raw);
    if (check !== null) interactable.check = check;

    // Scripted nodes identified themselves with ad-hoc boolean fields; those
    // become tags and data rather than engine concepts.
    for (const flag of ['crank', 'pillar', 'hagNode']) {
      if (raw[flag] === true) interactable.tags.push(flag);
    }
    const heroKey = asString(raw['heroKey']);
    if (heroKey !== null) {
      interactable.tags.push('heroKey');
      interactable.data['heroKey'] = heroKey;
    }
    const foundText = asString(raw['foundText']);
    if (foundText !== null) interactable.data['foundText'] = foundText;

    out.push(interactable);
  }
  return out;
}

/** Outcome name -> the field on a check that holds that outcome's effects. */
const CHECK_KEYS = {
  criticalSuccess: 'onCriticalSuccess',
  successWithHope: 'onSuccessWithHope',
  successWithFear: 'onSuccessWithFear',
  failureWithHope: 'onFailureWithHope',
  failureWithFear: 'onFailureWithFear',
} as const;

function importCheck(raw: Record<string, unknown>): Interactable['check'] | null {
  const outcomes = raw['outcomes'];
  if (typeof outcomes !== 'object' || outcomes === null) return null;
  const trait = TRAITS[(asString(raw['trait']) ?? '').toLowerCase()];
  const difficulty = asInteger(raw['dc']);
  if (trait === undefined || difficulty === null || difficulty <= 0) return null;

  // The legacy outcome held a line of text beside its effect. Text *is* an
  // effect in the unified vocabulary, so it becomes a leading `log` — which is
  // what the narrative pane wanted from it anyway, and means one walk over an
  // effect list sees everything an outcome does.
  const check: NonNullable<Interactable['check']> = { trait, difficulty };
  for (const [legacyKey, key] of Object.entries(OUTCOME_KEYS)) {
    const entry = (outcomes as Record<string, unknown>)[legacyKey];
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as { text?: unknown; effect?: unknown; param?: unknown };
    const effects: Effect[] = [];
    const text = asString(record.text) ?? '';
    if (text !== '') effects.push({ kind: 'log', text, tone: 'narration' });
    const effect = convertEffect(record.effect, record.param);
    if (effect !== null && effect.kind !== 'none') effects.push(effect);
    if (effects.length > 0) check[CHECK_KEYS[key]] = effects;
  }
  return check;
}

function importEncounters(
  map: LegacyMap,
  width: number,
  height: number,
  fail: (field: string, message: string) => void,
): Encounter[] {
  const byGroup = new Map<number, Encounter>();
  const encounterFor = (group: number): Encounter => {
    let encounter = byGroup.get(group);
    if (encounter === undefined) {
      encounter = {
        id: encounterId(group),
        name: `Group ${group}`,
        adversaries: [],
        triggerCells: [],
        startsOnTrigger: true,
      };
      byGroup.set(group, encounter);
    }
    return encounter;
  };

  for (const raw of (Array.isArray(map.enemies) ? map.enemies : []) as Record<string, unknown>[]) {
    const point = readPoint(raw);
    if (point === null || point.x >= width || point.y >= height) {
      fail('enemies', `enemy ${JSON.stringify(raw['id'])} is outside the scene`);
      continue;
    }
    const group = asInteger(raw['group']) ?? 1;
    const type = asString(raw['type']) ?? 'husk';
    const encounter = encounterFor(group);
    encounter.adversaries.push({
      id: positionalId(`${encounter.id}-${toContentId(type)}`, point),
      adversary: LEGACY_ADVERSARY_IDS[type] ?? toContentId(type),
      position: point,
      ...(asString(raw['name']) === null ? {} : { name: asString(raw['name'])! }),
    });
  }

  for (const raw of (Array.isArray(map.triggers) ? map.triggers : []) as Record<string, unknown>[]) {
    const group = asInteger(raw['group']);
    if (group === null) continue;
    const encounter = encounterFor(group);
    for (const cell of Array.isArray(raw['cells']) ? (raw['cells'] as unknown[]) : []) {
      if (!Array.isArray(cell) || cell.length < 2) continue;
      const point = readPoint({ x: cell[0], y: cell[1] });
      if (point !== null && point.x < width && point.y < height) encounter.triggerCells.push(point);
    }
  }

  return [...byGroup.entries()].sort(([a], [b]) => a - b).map(([, encounter]) => encounter);
}

function importDecos(map: LegacyMap, width: number, height: number): Deco[] {
  const out: Deco[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(map.decos) ? map.decos : []) as Record<string, unknown>[]) {
    const point = readPoint(raw);
    const model = asString(raw['type']);
    if (point === null || model === null || point.x >= width || point.y >= height) continue;

    const deco: Deco = { model, position: point, rotation: Number(raw['rot'] ?? 0) || 0 };
    // Only decos the narrative refers to had ids; keep those, they are hand-written.
    const rawId = asString(raw['id']);
    if (rawId !== null && rawId !== '') {
      const id = toContentId(rawId);
      if (id !== '' && !seen.has(id)) {
        seen.add(id);
        deco.id = id;
      }
    }
    out.push(deco);
  }
  return out;
}
