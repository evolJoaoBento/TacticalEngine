import { describe, it, expect } from 'vitest';
import { TileGrid } from '../grid/grid';
import { createBad } from '../rules/resources';
import { SceneState, createAdversaryEntity, createPartyEntity } from '../scene/state';
import {
  DEFAULT_TOKENS_PER_CHARACTER,
  EncounterRunner,
  type EncounterOptions,
} from './encounter';

function setup(options: EncounterOptions = {}, bad = 0): {
  state: SceneState;
  encounter: EncounterRunner;
} {
  const state = new SceneState(
    { id: 'room' },
    new TileGrid({ width: 6, height: 3 }),
    createBad(bad),
  );
  state.addEntity(createPartyEntity('kara', 'sentinel', 0));
  state.addEntity(createPartyEntity('finn', 'nightwalker', 1));
  state.addEntity(createAdversaryEntity('husk-a', 'husk', 4, { hitPoints: 3, stress: 2 }));
  state.addEntity(createAdversaryEntity('husk-b', 'husk', 5, { hitPoints: 3, stress: 2 }));
  return { state, encounter: new EncounterRunner(state, 'group-1', options) };
}

const fell = (state: SceneState, id: string): void => {
  const entity = state.entity(id)!;
  entity.alive = false;
  entity.hitPoints = { max: entity.hitPoints.max, marked: entity.hitPoints.max };
};

describe('starting an encounter', () => {
  it('marks it started and gives the spotlight to the party', () => {
    const { state, encounter } = setup();
    const view = encounter.start();
    expect(state.encounter('group-1')).toMatchObject({ started: true, triggered: true });
    expect(view.side).toBe('party');
    expect(view.round).toBe(1);
    expect(view.outcome).toBe('ongoing');
    expect(view.ready).toEqual(['kara', 'finn']);
  });

  it('is idempotent', () => {
    const { encounter } = setup();
    encounter.start();
    encounter.start();
    expect(encounter.log.filter((e) => e.kind === 'started')).toHaveLength(1);
  });
});

describe('the spotlight policy', () => {
  it('lets the party keep acting until a roll hands the spotlight over', () => {
    const { encounter } = setup();
    encounter.start();

    expect(encounter.act('kara').side).toBe('party');
    expect(encounter.act('finn').side).toBe('party');
    // Acting twice in a row is legal: there is no per-character action limit.
    expect(encounter.act('kara').side).toBe('party');

    expect(encounter.act('finn', { spotlightToGm: true }).side).toBe('gm');
  });

  it('gives every living party member an unlimited budget', () => {
    const { encounter } = setup();
    encounter.start();
    expect(encounter.tokensFor('kara')).toBe(Infinity);
  });

  it('refuses an action from the wrong side or a fallen character', () => {
    const { state, encounter } = setup();
    encounter.start();
    expect(encounter.canAct('husk-a')).toBe(false);
    expect(encounter.canAct('nobody')).toBe(false);

    fell(state, 'kara');
    expect(encounter.canAct('kara')).toBe(false);

    encounter.passToGm();
    expect(encounter.canAct('finn')).toBe(false);
  });
});

describe('the GM turn', () => {
  it('spotlights the first adversary free and charges a Shadow for the next', () => {
    const { state, encounter } = setup({}, 2);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });

    expect(encounter.nextSpotlightCost).toBe(0);
    encounter.spotlight('husk-a');
    expect(state.bad.value).toBe(2);

    expect(encounter.nextSpotlightCost).toBe(1);
    encounter.spotlight('husk-b');
    expect(state.bad.value).toBe(1);
  });

  it('refuses a second adversary when the GM cannot pay', () => {
    const { state, encounter } = setup({}, 0);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    encounter.spotlight('husk-a');

    expect(encounter.canSpotlight('husk-b')).toBe(false);
    encounter.spotlight('husk-b');
    expect(encounter.log.filter((e) => e.kind === 'adversaryActed')).toHaveLength(1);
    expect(state.bad.value).toBe(0);
  });

  it('hands out a spotlight a feature already paid for, without billing again', () => {
    const { state, encounter } = setup({}, 1);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    encounter.spotlight('husk-a');

    // A feature's own cost buys the spotlights it hands out: the GM is down to
    // one Shadow, which a second ordinary spotlight would take.
    encounter.grantSpotlight('husk-b');
    expect(state.bad.value).toBe(1);
    expect(encounter.view().waiting).toEqual([]);
    expect(encounter.log.filter((e) => e.kind === 'adversaryActed')).toHaveLength(2);
  });

  it('grants nothing to the fallen, and nothing while the party has the spotlight', () => {
    const { state, encounter } = setup({}, 5);
    encounter.start();
    encounter.grantSpotlight('husk-a');
    expect(encounter.log.filter((e) => e.kind === 'adversaryActed')).toHaveLength(0);

    encounter.act('kara', { spotlightToGm: true });
    fell(state, 'husk-a');
    encounter.grantSpotlight('husk-a');
    expect(encounter.log.filter((e) => e.kind === 'adversaryActed')).toHaveLength(0);
  });

  it('will not spotlight the same adversary twice in one turn', () => {
    const { encounter } = setup({}, 5);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    encounter.spotlight('husk-a');
    expect(encounter.canSpotlight('husk-a')).toBe(false);
  });

  it('lets it act again after the turn comes round', () => {
    const { encounter } = setup({}, 5);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    encounter.spotlight('husk-a');
    encounter.endGmTurn();
    encounter.act('kara', { spotlightToGm: true });
    expect(encounter.canSpotlight('husk-a')).toBe(true);
    expect(encounter.nextSpotlightCost).toBe(0);
  });

  it('will not spotlight a fallen adversary', () => {
    const { state, encounter } = setup({}, 5);
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    fell(state, 'husk-a');
    expect(encounter.canSpotlight('husk-a')).toBe(false);
    expect(encounter.view().waiting).toEqual(['husk-b']);
  });

  it('hands the spotlight back and counts a round', () => {
    const { encounter } = setup();
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    const back = encounter.endGmTurn();
    expect(back.side).toBe('party');
    expect(back.round).toBe(2);
  });

  it('ignores endGmTurn while the party still has the spotlight', () => {
    const { encounter } = setup();
    encounter.start();
    expect(encounter.endGmTurn().round).toBe(1);
  });
});

describe('the tracker policy', () => {
  const trackerSetup = (tokens?: number) =>
    setup(tokens === undefined ? { policy: 'tracker' } : { policy: 'tracker', tokensPerCharacter: tokens });

  it('gives each character the SRD-recommended three tokens', () => {
    const { encounter } = trackerSetup();
    encounter.start();
    expect(DEFAULT_TOKENS_PER_CHARACTER).toBe(3);
    expect(encounter.tokensFor('kara')).toBe(3);
    expect(encounter.tokensFor('finn')).toBe(3);
  });

  it('spends a token per action and stops a character who runs out', () => {
    const { encounter } = trackerSetup(2);
    encounter.start();
    encounter.act('kara');
    expect(encounter.tokensFor('kara')).toBe(1);
    encounter.act('kara');
    expect(encounter.tokensFor('kara')).toBe(0);
    expect(encounter.canAct('kara')).toBe(false);
    // The spotlight swings to someone who still has one.
    expect(encounter.view().ready).toEqual(['finn']);
  });

  it('hands the turn to the GM once the party is spent', () => {
    const { encounter } = trackerSetup(1);
    encounter.start();
    encounter.act('kara');
    const view = encounter.act('finn');
    expect(view.side).toBe('gm');
  });

  it('refills everyone when the spotlight comes back', () => {
    const { encounter } = trackerSetup(1);
    encounter.start();
    encounter.act('kara');
    encounter.act('finn');
    encounter.endGmTurn();
    expect(encounter.tokensFor('kara')).toBe(1);
    expect(encounter.tokensFor('finn')).toBe(1);
    expect(encounter.log.some((e) => e.kind === 'tokensRefilled')).toBe(true);
  });

  it('does not refill while someone still has a token left', () => {
    const { encounter } = trackerSetup(2);
    encounter.start();
    encounter.act('kara');
    encounter.act('kara');
    encounter.passToGm();
    encounter.endGmTurn();
    // finn never acted, so the round is not over and nothing is refilled.
    expect(encounter.tokensFor('kara')).toBe(0);
    expect(encounter.tokensFor('finn')).toBe(2);
  });

  it('still passes the spotlight on a Shadow roll before the tokens run out', () => {
    const { encounter } = trackerSetup(3);
    encounter.start();
    expect(encounter.act('kara', { spotlightToGm: true }).side).toBe('gm');
    expect(encounter.tokensFor('kara')).toBe(2);
  });
});

describe('ending', () => {
  it('is a victory when the last adversary falls', () => {
    const { state, encounter } = setup();
    encounter.start();
    fell(state, 'husk-a');
    fell(state, 'husk-b');
    const view = encounter.act('kara');
    expect(view.outcome).toBe('victory');
    expect(state.encounter('group-1').ended).toBe(true);
    expect(encounter.log.at(-1)).toMatchObject({ kind: 'ended', outcome: 'victory' });
  });

  it('is a defeat when the last party member falls', () => {
    const { state, encounter } = setup();
    encounter.start();
    encounter.act('kara', { spotlightToGm: true });
    fell(state, 'kara');
    fell(state, 'finn');
    expect(encounter.spotlight('husk-a').outcome).toBe('defeat');
  });

  it('accepts an ending a script decides on', () => {
    const { state, encounter } = setup();
    encounter.start();
    expect(encounter.end('victory').outcome).toBe('victory');
    expect(state.encounter('group-1').ended).toBe(true);
  });

  it('stops accepting actions once it is over', () => {
    const { encounter } = setup();
    encounter.start();
    encounter.end();
    expect(encounter.canAct('kara')).toBe(false);
    expect(encounter.canSpotlight('husk-a')).toBe(false);
    expect(encounter.act('kara').outcome).toBe('victory');
  });

  it('settles only once', () => {
    const { encounter } = setup();
    encounter.start();
    encounter.end('victory');
    encounter.end('defeat');
    expect(encounter.outcome).toBe('victory');
    expect(encounter.log.filter((e) => e.kind === 'ended')).toHaveLength(1);
  });
});

describe('the event log', () => {
  it('records the shape of a full exchange', () => {
    const { encounter } = setup({}, 1);
    encounter.start();
    encounter.act('kara');
    encounter.act('finn', { spotlightToGm: true });
    encounter.spotlight('husk-a');
    encounter.spotlight('husk-b');
    encounter.endGmTurn();

    expect(encounter.log.map((e) => e.kind)).toEqual([
      'started',
      'spotlight',
      'acted',
      'acted',
      'spotlight',
      'adversaryActed',
      'adversaryActed',
      'spotlight',
    ]);
    const spent = encounter.log.filter((e) => e.kind === 'adversaryActed');
    expect(spent.map((e) => (e.kind === 'adversaryActed' ? e.badSpent : -1))).toEqual([0, 1]);
  });
});
