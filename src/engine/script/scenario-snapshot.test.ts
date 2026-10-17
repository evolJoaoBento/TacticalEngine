/**
 * The scenario as a save and a board carry it (`scenario-snapshot.ts`): the project plans learned and the work done
 * on each go with it - and nothing at all is written for them until one is learned, so a scenario without one reads
 * exactly as it always did.
 */

import { describe, expect, it } from 'vitest';
import { restoreScenario, scenarioSnapshot, scenarioSnapshotSchema } from './scenario-snapshot';
import { createScenarioState } from './world';

describe('the scenario, as a save carries it', () => {
  it('keeps the project plans learned and their work, and writes nothing for them before one is', () => {
    const scenario = createScenarioState();
    expect('projects' in scenarioSnapshot(scenario)).toBe(false);
    scenario.projects.set('blade', 1);
    scenario.projects.set('book', 0);
    const snapshot = scenarioSnapshot(scenario);
    expect(snapshot.projects).toEqual([['blade', 1], ['book', 0]]);
    const back = createScenarioState();
    restoreScenario(back, scenarioSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot))));
    expect([...back.projects]).toEqual([['blade', 1], ['book', 0]]);
    // A snapshot from before there were plans: none.
    restoreScenario(back, scenarioSnapshotSchema.parse({ variables: {}, flags: [], items: [], actorId: null }));
    expect(back.projects.size).toBe(0);
  });
});
