import { describe, it, expect } from 'vitest';
import { demoMap } from '../../legacy/js/data.js';
import { blankScene } from '../engine/scene/grid-from-scene';
import { importLegacyCampaign } from '../engine/scene/legacy-import';
import { projectSchema, sceneSchema, type ProjectDoc, type SceneDoc } from '../engine/scene/schema';
import { MODELS } from '../engine/render/procedural/registry';
import { errorsOnly, summarise, validateProject } from './validate';

const KNOWN_MODELS = new Set(MODELS.map((m) => m.id));

function build(scene: Partial<SceneDoc> = {}, width = 6, height = 4): ProjectDoc {
  return projectSchema.parse({
    id: 'demo',
    name: 'Demo',
    scenes: [sceneSchema.parse({ ...blankScene('room', width, height), ...scene })],
    startScene: 'room',
  });
}

const messages = (project: ProjectDoc, options = {}): string[] =>
  validateProject(project, options).map((p) => p.message);

describe('a clean project', () => {
  it('reports nothing', () => {
    expect(validateProject(build())).toEqual([]);
    expect(summarise([])).toBe('No problems');
  });
});

describe('schema failures come first', () => {
  it('reports them and stops, rather than checking a broken document', () => {
    const broken = { ...build(), scenes: [{ ...build().scenes[0]!, terrain: ['floor'] }] };
    const problems = validateProject(broken as ProjectDoc);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.severity === 'error')).toBe(true);
    expect(problems[0]!.message).toMatch(/terrain/);
  });
});

describe('terrain and placement', () => {
  it('catches a spawn inside a wall', () => {
    const project = build();
    const scene = project.scenes[0]!;
    scene.terrain[0] = 'wall';
    expect(messages(project)).toContain('Spawn 1 at (0, 0) is inside impassable terrain.');
  });

  it('catches an unknown terrain id', () => {
    const project = build();
    project.scenes[0]!.terrain[3] = 'lava';
    expect(messages(project).some((m) => m.includes('unknown terrain id "lava"'))).toBe(true);
  });

  it('catches an adversary standing in a wall', () => {
    const project = build();
    const scene = project.scenes[0]!;
    scene.terrain[10] = 'wall';
    scene.encounters.push({
      id: 'ambush',
      name: '',
      adversaries: [{ id: 'b1', adversary: 'tangle-bramble', position: { x: 4, y: 1 } }],
      triggerCells: [{ x: 1, y: 1 }],
      startsOnTrigger: true,
    });
    expect(messages(project)).toContain('"b1" stands in impassable terrain.');
  });
});

describe('encounters', () => {
  const withEncounter = (overrides: Partial<SceneDoc['encounters'][number]> = {}): ProjectDoc => {
    const project = build();
    project.scenes[0]!.encounters.push({
      id: 'ambush',
      name: '',
      adversaries: [{ id: 'b1', adversary: 'tangle-bramble', position: { x: 4, y: 1 } }],
      triggerCells: [{ x: 1, y: 1 }],
      startsOnTrigger: true,
      ...overrides,
    });
    return project;
  };

  it('warns about an encounter nothing can start', () => {
    expect(messages(withEncounter({ triggerCells: [] }))).toContain(
      'Encounter "ambush" starts on a trigger but has no trigger cells, so nothing can start it.',
    );
  });

  it('says nothing when it starts by script rather than by trigger', () => {
    const project = withEncounter({ triggerCells: [], startsOnTrigger: false });
    expect(messages(project).some((m) => m.includes('nothing can start it'))).toBe(false);
  });

  it('warns about an empty encounter', () => {
    expect(messages(withEncounter({ adversaries: [] }))).toContain(
      'Encounter "ambush" has no adversaries in it.',
    );
  });

  it('warns about a trigger cell inside a wall', () => {
    const project = withEncounter();
    project.scenes[0]!.terrain[7] = 'wall'; // (1, 1)
    expect(
      messages(project).some((m) => m.includes('at (1, 1) is impassable')),
    ).toBe(true);
  });

  it('warns about a trigger cell walled off from the spawn', () => {
    // Seal the top-right corner: (5,0) has only two neighbours, (4,0) and (5,1).
    const project = build({}, 6, 4);
    const scene = project.scenes[0]!;
    for (const tile of [4, 11]) scene.terrain[tile] = 'wall';
    scene.encounters.push({
      id: 'sealed',
      name: '',
      adversaries: [{ id: 'b1', adversary: 'x', position: { x: 0, y: 0 } }],
      triggerCells: [{ x: 5, y: 0 }],
      startsOnTrigger: true,
    });
    expect(messages(project).some((m) => m.includes('walled off from the spawn'))).toBe(true);
  });

  it('reports an adversary with no stat block when the ids are known', () => {
    const project = withEncounter();
    const problems = validateProject(project, {
      knownAdversaries: new Set(['hollow-husk']),
    });
    expect(problems.map((p) => p.message)).toContain(
      '"b1" uses adversary "tangle-bramble", which has no stat block.',
    );
    expect(errorsOnly(problems).length).toBeGreaterThan(0);
  });

  it('says nothing about adversaries when no id set is supplied', () => {
    expect(messages(withEncounter()).some((m) => m.includes('no stat block'))).toBe(false);
  });
});

describe('interactables', () => {
  const chest = {
    id: 'chest-1',
    kind: 'chest' as const,
    position: { x: 2, y: 1 },
    name: '',
    flavor: '',
    model: null,
    blocksMovement: true,
    repeatable: false,
    effects: [],
    lockedText: '',
    tags: [],
    data: {},
  };

  it('catches a travel node pointing at a scene that does not exist', () => {
    const project = build();
    project.scenes[0]!.interactables.push({ ...chest, kind: 'portal', goto: 'the-pit' });
    expect(messages(project)).toContain(
      '"chest-1" travels to scene "the-pit", which does not exist.',
    );
  });

  it('catches an effect starting an encounter that does not exist', () => {
    const project = build();
    project.scenes[0]!.interactables.push({
      ...chest,
      check: {
        trait: 'finesse',
        difficulty: 12,
        onFailureWithFear: [{ kind: 'startEncounter', encounter: 'ghosts' }],
      },
    });
    expect(messages(project)).toContain(
      '"chest-1" starts encounter "ghosts", which does not exist.',
    );
  });

  it('accepts an effect naming an encounter that does exist', () => {
    const project = build();
    project.scenes[0]!.encounters.push({
      id: 'ghosts',
      name: '',
      adversaries: [{ id: 'g1', adversary: 'x', position: { x: 3, y: 3 } }],
      triggerCells: [{ x: 3, y: 2 }],
      startsOnTrigger: true,
    });
    project.scenes[0]!.interactables.push({
      ...chest,
      check: {
        trait: 'finesse',
        difficulty: 12,
        onFailureWithFear: [{ kind: 'startEncounter', encounter: 'ghosts' }],
      },
    });
    expect(messages(project).some((m) => m.includes('which does not exist'))).toBe(false);
  });

  it('warns about two interactables on one tile', () => {
    const project = build();
    project.scenes[0]!.interactables.push({ ...chest }, { ...chest, id: 'chest-2' });
    expect(messages(project)).toContain('"chest-2" shares a tile with "chest-1".');
  });

  it('warns about an interactable nothing can walk up to', () => {
    // Sealed in the far corner behind walls.
    const project = build({}, 6, 4);
    const scene = project.scenes[0]!;
    for (const tile of [4, 11]) scene.terrain[tile] = 'wall';
    scene.interactables.push({ ...chest, position: { x: 5, y: 0 }, blocksMovement: false });
    expect(messages(project).some((m) => m.includes('cannot be reached from the spawn'))).toBe(true);
  });

  it('does not warn about a blocking interactable a party can stand beside', () => {
    const project = build();
    project.scenes[0]!.interactables.push({ ...chest });
    expect(messages(project).some((m) => m.includes('cannot be reached'))).toBe(false);
  });

  it('warns about a model the library does not have', () => {
    const project = build();
    project.scenes[0]!.interactables.push({ ...chest, model: 'nonesuch' });
    const problems = validateProject(project, { knownModels: KNOWN_MODELS });
    expect(problems.map((p) => p.message)).toContain(
      '"chest-1" uses model "nonesuch", which the library does not have.',
    );
  });

  it('warns once per missing deco model, not once per prop', () => {
    const project = build();
    project.scenes[0]!.decos.push(
      { model: 'nonesuch', position: { x: 0, y: 1 }, rotation: 0 },
      { model: 'nonesuch', position: { x: 1, y: 1 }, rotation: 0 },
      { model: 'crate', position: { x: 2, y: 1 }, rotation: 0 },
    );
    const problems = validateProject(project, { knownModels: KNOWN_MODELS });
    expect(problems.filter((p) => p.message.includes('nonesuch'))).toHaveLength(1);
    expect(problems.some((p) => p.message.includes('crate'))).toBe(false);
  });
});

describe('reporting', () => {
  it('separates errors from warnings and summarises them', () => {
    const project = build();
    project.scenes[0]!.terrain[0] = 'wall'; // spawn in a wall: an error
    project.scenes[0]!.encounters.push({
      id: 'ambush',
      name: '',
      adversaries: [],
      triggerCells: [],
      startsOnTrigger: true,
    }); // empty and untriggerable: two warnings

    const problems = validateProject(project);
    expect(errorsOnly(problems)).toHaveLength(1);
    expect(summarise(problems)).toBe('1 error, 2 warnings');
  });

  it('tags each problem with the scene and content it concerns', () => {
    const project = build();
    project.scenes[0]!.interactables.push({
      id: 'chest-1',
      kind: 'portal',
      position: { x: 2, y: 1 },
      name: '',
      flavor: '',
      model: null,
      blocksMovement: true,
      repeatable: false,
    effects: [],
      lockedText: '',
      goto: 'nowhere',
      tags: [],
      data: {},
    });
    const problem = validateProject(project)[0]!;
    expect(problem.scene).toBe('room');
    expect(problem.entity).toBe('chest-1');
  });
});

describe('against the real imported campaign', () => {
  it('finds nothing wrong with the demo vault beyond its missing stat blocks', () => {
    const { project } = importLegacyCampaign(demoMap());
    const problems = validateProject(project!, { knownModels: KNOWN_MODELS });

    // The map is sound: no spawn in a wall, no unreachable trigger, no bad link.
    expect(errorsOnly(problems)).toEqual([]);

    // With the SRD ids supplied, its homebrew Hollow Husks are correctly flagged.
    const withAdversaries = validateProject(project!, {
      knownAdversaries: new Set(['tangle-bramble']),
    });
    expect(
      errorsOnly(withAdversaries).every((p) => p.message.includes('hollow-husk')),
    ).toBe(true);
    expect(errorsOnly(withAdversaries).length).toBeGreaterThan(0);
  });
});

describe('conversations', () => {
  const chest = {
    id: 'chest-1',
    kind: 'chest' as const,
    position: { x: 2, y: 1 },
    name: '',
    flavor: '',
    model: null,
    blocksMovement: true,
    repeatable: false,
    effects: [],
    lockedText: '',
    tags: [],
    data: {},
  };

  const talking = (dialogue: Record<string, unknown>): ProjectDoc => {
    const project = build();
    (project as { dialogues: unknown[] }).dialogues = [dialogue];
    return project;
  };

  const straight = {
    id: 'hag',
    start: 'a',
    nodes: [
      { id: 'a', lines: [{ text: 'Hello.' }], choices: [{ text: 'Hello.', goto: 'b' }] },
      { id: 'b', lines: [{ text: 'Goodbye.' }] },
    ],
  };

  it('accepts a conversation whose links all land', () => {
    expect(messages(talking(straight)).some((m) => m.includes('hag'))).toBe(false);
  });

  it('reports a reply pointing at a node nobody wrote', () => {
    const broken = {
      ...straight,
      nodes: [
        { id: 'a', lines: [], choices: [{ text: 'Onward.', goto: 'nowhere' }] },
        { id: 'b', lines: [] },
      ],
    };
    expect(messages(talking(broken))).toContain(
      'Conversation "hag" goes to node "nowhere", which does not exist.',
    );
  });

  it('warns about a node no path reaches, rather than erroring', () => {
    const orphan = {
      ...straight,
      nodes: [...straight.nodes, { id: 'lost', lines: [{ text: 'Unheard.' }] }],
    };
    const problems = validateProject(talking(orphan));
    const stranded = problems.find((p) => p.message.includes('nothing reaches'));
    expect(stranded?.severity).toBe('warning');
    // An author mid-draft is not making a mistake.
    expect(errorsOnly(problems).some((p) => p.message.includes('nothing reaches'))).toBe(false);
  });

  it('follows a reply into a check outcome to find a bad reference', () => {
    const nested = {
      ...straight,
      nodes: [
        {
          id: 'a',
          lines: [],
          choices: [
            {
              text: 'Ask nicely.',
              check: {
                trait: 'presence',
                difficulty: 12,
                onSuccessWithHope: [
                  {
                    kind: 'branch',
                    when: { kind: 'flag', flag: 'x' },
                    then: [{ kind: 'goto', scene: 'no-such-scene' }],
                  },
                ],
              },
            },
          ],
        },
        { id: 'b', lines: [] },
      ],
    };
    // Two levels down: inside a check outcome, inside a branch.
    expect(messages(talking(nested))).toContain(
      'Conversation "hag" travels to scene "no-such-scene", which does not exist.',
    );
  });

  it('reports an object that opens a conversation nobody wrote', () => {
    const project = build();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'startDialogue', dialogue: 'the-ghost' }],
    });
    expect(messages(project)).toContain(
      '"chest-1" starts conversation "the-ghost", which does not exist.',
    );
  });

  it('accepts an object opening a conversation the project ships', () => {
    const project = talking(straight);
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'startDialogue', dialogue: 'hag' }],
    });
    expect(messages(project).some((m) => m.includes('which does not exist'))).toBe(false);
  });
});

describe('items and loot', () => {
  const chest = {
    id: 'chest-1',
    kind: 'chest' as const,
    position: { x: 2, y: 1 },
    name: '',
    flavor: '',
    model: null,
    blocksMovement: true,
    repeatable: false,
    effects: [],
    lockedText: '',
    tags: [],
    data: {},
  };

  it('catches a chest drawing from a table nobody wrote', () => {
    const project = build();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'loot', table: 'no-such-table' }],
    });
    expect(messages(project)).toContain(
      '"chest-1" draws from loot table "no-such-table", which does not exist.',
    );
  });

  it('catches a table that can drop something which is not an item', () => {
    const project = build();
    (project as { lootTables: unknown[] }).lootTables = [
      { id: 'hoard', rolls: 1, entries: [{ item: 'phantom', quantity: 1, weight: 1 }] },
    ];
    expect(messages(project)).toContain(
      'Loot table "hoard" can drop "phantom", which is not an item.',
    );
  });

  it('catches an effect handing over an item that does not exist', () => {
    const project = build();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'addItem', item: 'moonlight', quantity: 1 }],
    });
    expect(messages(project)).toContain(
      '"chest-1" refers to item "moonlight", which does not exist.',
    );
  });

  it('accepts a table and an effect that name real items', () => {
    const project = build();
    (project as { items: unknown[] }).items = [
      { id: 'gold', name: 'Gold', kind: 'trinket', description: '', stackable: true },
    ];
    (project as { lootTables: unknown[] }).lootTables = [
      { id: 'hoard', rolls: 1, entries: [{ item: 'gold', quantity: 1, weight: 1 }] },
    ];
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'loot', table: 'hoard' }],
    });
    expect(messages(project).some((m) => m.includes('does not exist'))).toBe(false);
  });
});

describe('quests', () => {
  const chest = {
    id: 'chest-1',
    kind: 'chest' as const,
    position: { x: 2, y: 1 },
    name: '',
    flavor: '',
    model: null,
    blocksMovement: true,
    repeatable: false,
    effects: [],
    lockedText: '',
    tags: [],
    data: {},
  };
  const quest = {
    id: 'word',
    name: 'The word',
    summary: '',
    objectives: [{ id: 'ask', text: 'Ask.' }],
  };
  const withQuest = (): ProjectDoc => {
    const project = build();
    (project as { quests: unknown[] }).quests = [quest];
    return project;
  };

  it('warns about a quest nothing starts and a step nothing ticks', () => {
    const problems = validateProject(withQuest());
    expect(problems.map((p) => p.message)).toEqual([
      'Quest "word" is never started by anything.',
      'Objective "ask" of quest "word" is never completed by anything.',
    ]);
    expect(problems.every((p) => p.severity === 'warning')).toBe(true);
  });

  it('is quiet once content drives the quest', () => {
    const project = withQuest();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'completeObjective', quest: 'word', objective: 'ask' }],
    });
    expect(messages(project)).toEqual([]);
  });

  it('catches an effect naming a quest nobody wrote', () => {
    const project = build();
    project.scenes[0]!.interactables.push({ ...chest, effects: [{ kind: 'startQuest', quest: 'ghost' }] });
    expect(messages(project)).toContain('"chest-1" refers to quest "ghost", which does not exist.');
  });

  it('catches an objective the quest does not have', () => {
    const project = withQuest();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [{ kind: 'completeObjective', quest: 'word', objective: 'fly' }],
    });
    expect(messages(project)).toContain(
      '"chest-1" refers to objective "fly" of quest "word", which does not exist.',
    );
  });

  it('reads the conditions too, not only the effects', () => {
    const project = withQuest();
    project.scenes[0]!.interactables.push({
      ...chest,
      effects: [
        {
          kind: 'branch',
          when: { kind: 'not', of: { kind: 'quest', quest: 'ghost', status: 'active' } },
          then: [{ kind: 'completeObjective', quest: 'word', objective: 'ask' }],
        },
      ],
    });
    expect(messages(project)).toContain('"chest-1" refers to quest "ghost", which does not exist.');
  });

  it('reports a condition two levels down inside a check outcome exactly once', () => {
    // `walkCheck` already descends into nested branches; walking conditions
    // from every visited effect as well would report the inner one twice.
    const project = withQuest();
    project.scenes[0]!.interactables.push({
      ...chest,
      check: {
        trait: 'finesse',
        difficulty: 10,
        onSuccessWithHope: [
          {
            kind: 'branch',
            when: { kind: 'always' },
            then: [
              {
                kind: 'branch',
                when: { kind: 'quest', quest: 'ghost', status: 'active' },
                then: [{ kind: 'completeObjective', quest: 'word', objective: 'ask' }],
              },
            ],
          },
        ],
      },
    });
    const ghosts = messages(project).filter((m) => m.includes('quest "ghost"'));
    expect(ghosts).toHaveLength(1);
  });

  it('reads a reply gated on a quest', () => {
    const project = withQuest();
    (project as { dialogues: unknown[] }).dialogues = [
      {
        id: 'hag',
        start: 'a',
        nodes: [
          {
            id: 'a',
            lines: [{ text: 'Hello.' }],
            onEnter: [{ kind: 'startQuest', quest: 'word' }],
            choices: [
              {
                text: 'Done it.',
                available: { kind: 'objectiveDone', quest: 'word', objective: 'nope' },
                effects: [{ kind: 'completeObjective', quest: 'word', objective: 'ask' }],
              },
            ],
          },
        ],
      },
    ];
    expect(messages(project)).toContain(
      '"hag" refers to objective "nope" of quest "word", which does not exist.',
    );
  });
});
