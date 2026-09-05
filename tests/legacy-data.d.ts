/**
 * Types for the legacy prototype's two pure-data modules, so tests can import the
 * real authored campaign as a fixture.
 *
 * `legacy/` is frozen and untyped by design (CONTEXT.md: keep the original
 * prototype runnable, do not modify it). `legacy/js/data.js` imports nothing and
 * `legacy/js/data-campaign.js` imports only `makeEnemy` from it, so neither pulls
 * in three.js or the DOM and both load cleanly under Vitest in node.
 *
 * These declarations describe only what the tests use, and deliberately keep the
 * loose legacy shapes (`h` for height, `w`/`h` for size, tuple spawns) rather than
 * tidying them — the importer's job is to cope with exactly this.
 */

declare module '*/legacy/js/data.js' {
  export interface LegacyTile {
    h: number;
    color: string;
    prop: null | 'difficult' | 'cover';
  }
  export interface LegacyMapDoc {
    id?: string;
    name: string;
    intro: string;
    w: number;
    h: number;
    tiles: LegacyTile[];
    nodes: Record<string, unknown>[];
    enemies: Record<string, unknown>[];
    triggers: Record<string, unknown>[];
    decos: Record<string, unknown>[];
    spawns: [number, number][];
    fog?: { band: number };
  }
  export function blankMap(w?: number, h?: number): LegacyMapDoc;
  export function demoMap(): LegacyMapDoc;
  export function makeNode(type: string, x: number, y: number): Record<string, unknown>;
  export function makeEnemy(
    x: number,
    y: number,
    group: number,
    type?: string,
  ): Record<string, unknown>;
  export function makeCampaign(
    maps: LegacyMapDoc[],
    name?: string,
  ): { campaign: true; name: string; scenes: LegacyMapDoc[]; start: number };
  export const ENEMY_TYPES: Record<string, Record<string, unknown>>;
}

declare module '*/legacy/js/data-campaign.js' {
  import type { LegacyMapDoc } from '*/legacy/js/data.js';
  export function campMap(): LegacyMapDoc;
  export function pitMap(): LegacyMapDoc;
  export function theaterMap(): LegacyMapDoc;
}
