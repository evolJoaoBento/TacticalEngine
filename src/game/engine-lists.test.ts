/**
 * The lists the page asks for as it opens (`engine-lists.ts`): the server's when it answers with the
 * right shape, and the ones the build carries when it does not - no server, a refusal, or anything else.
 */

import { describe, expect, it } from 'vitest';
import { asked, isMarks, listOfModels, type ShippedModel } from './engine-lists';

const BUILT: ShippedModel[] = [{ id: 'quim', url: '/models/Quim.glb', scale: 1 }];
const answering = (status: number, body: unknown) => (async () => ({ ok: status < 400, status, json: async () => body })) as unknown as typeof fetch;

describe('a list the page asks for', () => {
  it('is the server\u2019s when it answers: a model added, an ancestry given since the build', async () => {
    const now = [...BUILT, { id: 'arty', url: '/models/Arty.glb', scale: 1, ancestry: 'halfling' }];
    expect(await asked('/__models/shipped', BUILT, listOfModels, answering(200, now))).toEqual(now);
  });

  it('is the build\u2019s with no server, a refusal, or an answer of the wrong shape', async () => {
    const failing = (async () => { throw new TypeError('no server'); }) as unknown as typeof fetch;
    expect(await asked('/__models/shipped', BUILT, listOfModels, failing)).toBe(BUILT);
    expect(await asked('/__models/shipped', BUILT, listOfModels, answering(404, {}))).toBe(BUILT);
    expect(await asked('/__models/shipped', BUILT, listOfModels, answering(200, '<!doctype html>'))).toBe(BUILT);
    expect(await asked('/__models/shipped', BUILT, listOfModels, answering(200, [{ id: 'x' }]))).toBe(BUILT);
  });

  it('takes marks only of the three kinds', () => {
    expect(isMarks({ 'model:arty': 'ai-assisted', 'card:x': 'human-made' })).toBe(true);
    expect(isMarks({ 'model:arty': 'robot' })).toBe(false);
    expect(isMarks(['ai-assisted'])).toBe(false);
    expect(isMarks(null)).toBe(false);
  });
});
