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

describe('what only a stat block has', () => {
  it('warns when a card asks for Fear or changes a standard attack', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'greedy',
          name: 'Greedy',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'self' },
          cost: { fear: 1 },
          effects: [],
        },
        {
          id: 'sharp',
          name: 'Sharp',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          kind: 'passive',
          standardAttack: { direct: true },
          effects: [],
        },
        {
          id: 'rider',
          name: 'Rider',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'dealtDamage',
          effects: [{ kind: 'log', text: 'A rider on the swing.' }],
        },
        {
          id: 'on-a-block',
          name: 'On A Block',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'passive',
          standardAttack: { direct: true },
          defenses: { reduce: [{ dice: '1d10' }] },
          effects: [],
        },
        {
          id: 'thick-hide',
          name: 'Thick Hide',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'passive',
          defenses: { reduce: [{ dice: 'three' }] },
          effects: [],
        },
        {
          id: 'backwards-hide',
          name: 'Backwards Hide',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'passive',
          defenses: { reduce: [{ dice: '1d10-2' }] },
          effects: [],
        },
      ],
    });
    const said = messages(project);
    expect(said).toContain(
      '"greedy" costs Fear, which only the GM spends: nobody holding it can use it.',
    );
    expect(said).toContain('"sharp" changes a standard attack, which only a stat block has.');
    // A card that rides its holder's own swing is no longer a mistake: the
    // party's attacks report `dealtHit` and `dealtDamage` the way a stat
    // block's do, and Healing Strike is written on exactly that.
    expect(said.some((m) => m.includes('"rider"'))).toBe(false);
    // A reduction nothing can read reduces nothing, silently.
    expect(said).toContain('"thick-hide" reduces damage by "three", which is not dice.');
    // And one that reads backwards would hand the attacker damage back.
    expect(said).toContain('"backwards-hide" reduces damage by "1d10-2", which adds damage.');
    // The same passives on a stat block are exactly where they belong.
    expect(said.some((m) => m.includes('on-a-block'))).toBe(false);
  });

  it('warns when something adds to a blow nobody is throwing', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'out-of-nowhere',
          name: 'Out Of Nowhere',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'boostDamage', amount: 5 }],
        },
        {
          id: 'wrong-moment',
          name: 'Wrong Moment',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'dealtDamage',
          effects: [{ kind: 'boostDamage', amount: 5 }],
        },
        {
          id: 'mid-swing',
          name: 'Mid Swing',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'boostDamage', amount: 5 }],
        },
        {
          id: 'somebody-elses',
          name: "Somebody Else's",
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'allyRollingDamage',
          effects: [{ kind: 'boostDamage', dice: 'weapon' }],
        },
      ],
    });
    const said = messages(project);
    // A blow already counted is as useless as no blow at all.
    expect(said.some((m) => m.includes('"out-of-nowhere" adds to a blow'))).toBe(true);
    expect(said.some((m) => m.includes('"wrong-moment" adds to a blow'))).toBe(true);
    expect(said.some((m) => m.includes('mid-swing'))).toBe(false);
    expect(said.some((m) => m.includes('somebody-elses'))).toBe(false);
  });

  it('warns when a blow is forced somewhere nothing obeys it', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'forced-late',
          name: 'Forced Late',
          source: { kind: 'domainCard', card: 'battle-monster' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'dealtDamage',
          effects: [{ kind: 'forceHitPoints', amount: 3 }],
        },
        {
          id: 'forced-well',
          name: 'Forced Well',
          source: { kind: 'domainCard', card: 'battle-monster' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'forceHitPoints', amount: 3 }],
        },
        {
          id: 'forced-by-a-block',
          name: 'Forced By A Block',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'forceHitPoints', amount: 3 }],
        },
        {
          id: 'card-takes-a-turn',
          name: 'Card Takes A Turn',
          source: { kind: 'domainCard', card: 'battle-cry' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'spotlightAgain' }],
        },
        {
          id: 'thorns-out-of-nowhere',
          name: 'Thorns Out Of Nowhere',
          source: { kind: 'domainCard', card: 'thorn-skin' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'tookDamage',
          effects: [{ kind: 'softenBlow', dice: '1d6' }],
        },
        {
          id: 'thorns-in-time',
          name: 'Thorns In Time',
          source: { kind: 'domainCard', card: 'thorn-skin' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'incomingDamage',
          effects: [{ kind: 'avoidBlow' }],
        },
        {
          id: 'band-out-of-nowhere',
          name: 'Band Out Of Nowhere',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'dealtHit',
          effects: [{ kind: 'forceSeverity', severity: 'severe' }],
        },
        {
          id: 'band-mid-swing',
          name: 'Band Mid Swing',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'forceSeverity', severity: 'severe' }],
        },
        {
          id: 'block-hears-its-friends',
          name: 'Block Hears Its Friends',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'allyTookDamage',
          effects: [{ kind: 'gainFear', amount: 1 }],
        },
        {
          id: 'block-vaults-itself',
          name: 'Block Vaults Itself',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'vaultCard' }],
        },
        {
          id: 'card-vaults-itself',
          name: 'Card Vaults Itself',
          source: { kind: 'domainCard', card: 'battle-cry' },
          target: { kind: 'none' },
          effects: [{ kind: 'vaultCard' }],
        },
        {
          id: 'maxed-out-of-nowhere',
          name: 'Maxed Out Of Nowhere',
          source: { kind: 'domainCard', card: 'battle-cry' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'tookDamage',
          effects: [{ kind: 'maxOneDie' }],
        },
        {
          id: 'maxed-mid-swing',
          name: 'Maxed Mid Swing',
          source: { kind: 'domainCard', card: 'battle-cry' },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'rollingDamage',
          effects: [{ kind: 'maxOneDie' }],
        },
      ],
    });
    const said = messages(project);
    expect(said.some((m) => m.includes('"forced-late" forces the Hit Points marked'))).toBe(true);
    expect(said.some((m) => m.includes('"band-out-of-nowhere" names the band a blow lands in'))).toBe(true);
    // A blow is answered while it is arriving, and `tookDamage` is after.
    expect(said.some((m) => m.includes('"thorns-out-of-nowhere" answers a blow arriving'))).toBe(true);
    // A card has no queue to go back to the head of.
    expect(said.some((m) => m.includes('"card-takes-a-turn" takes the spotlight again'))).toBe(true);
    // And a stat block has no vault to put itself in.
    expect(said.some((m) => m.includes('"block-vaults-itself" places itself in the vault'))).toBe(true);
    expect(said.some((m) => m.includes('card-vaults-itself'))).toBe(false);
    // A die is only there to be lifted while the blow is being held.
    expect(said.some((m) => m.includes('"maxed-out-of-nowhere" takes a damage die at its highest'))).toBe(true);
    expect(said.some((m) => m.includes('maxed-mid-swing'))).toBe(false);
    expect(said.some((m) => m.includes('thorns-in-time'))).toBe(false);
    expect(said.some((m) => m.includes('band-mid-swing'))).toBe(false);
    expect(said.some((m) => m.includes('forced-well'))).toBe(false);
    // The right moment, the wrong side of the table: only the party's swing
    // stops to be told what it marks.
    expect(said).toContain(
      '"forced-by-a-block" forces the Hit Points marked, which only the party\'s own swing obeys.',
    );
    expect(said).toContain(
      '"block-hears-its-friends" answers somebody on its own side being hurt, which only a card is asked about.',
    );
  });

  it('warns when something reads an answer nobody asked for', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'stray-answer',
          name: 'Stray Answer',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'damage', amount: 'spent', target: { kind: 'target' } }],
        },
        {
          id: 'stray-braces',
          name: 'Stray Braces',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'damage', dice: '{n}d6', target: { kind: 'target' } }],
        },
        {
          id: 'a-question',
          name: 'A Question',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [
            {
              kind: 'howMany',
              most: { pool: 'stress', measure: 'available' },
              each: [
                { kind: 'markStress', amount: 'spent' },
                // Nested inside the question, which is still inside it.
                { kind: 'branch', when: { kind: 'always' }, then: [{ kind: 'damage', dice: '{n}d6', target: { kind: 'target' } }] },
              ],
            },
          ],
        },
      ],
    });
    const said = messages(project);
    expect(said.some((m) => m.includes('"stray-answer" reads an answer nobody asked for'))).toBe(true);
    expect(said.some((m) => m.includes('"stray-braces" reads an answer nobody asked for'))).toBe(true);
    expect(said.some((m) => m.includes('a-question'))).toBe(false);
  });

  it('warns when an amount reads a pool off a crowd', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'whose-hope',
          name: 'Whose Hope',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [
            { kind: 'gainFear', amount: { pool: 'hope', of: { kind: 'party' }, measure: 'available' } },
          ],
        },
        {
          id: 'the-nearest-one',
          name: 'The Nearest One',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [
            {
              kind: 'gainFear',
              amount: { pool: 'hope', of: { kind: 'allies', range: 'close', nearest: 1 }, measure: 'available' },
            },
          ],
        },
        {
          id: 'its-own',
          name: 'Its Own',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'gainFear', amount: { pool: 'hitPoints', measure: 'marked' } }],
        },
      ],
    });
    const said = messages(project);
    expect(said).toContain('"whose-hope" reads a pool off party, which is more than one creature.');
    // One of them by name, or the actor's own, is a number with an answer.
    expect(said.some((m) => m.includes('the-nearest-one'))).toBe(false);
    expect(said.some((m) => m.includes('its-own'))).toBe(false);
  });

  it("warns when a card waits for a moment only the GM's turn reaches", () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'card-mid-swing',
          name: 'Card Mid Swing',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'allyRollingDamage',
          effects: [{ kind: 'log', text: 'Nobody asks.' }],
        },
        {
          id: 'card-in-the-light',
          name: 'Card In The Light',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'spotlighted',
          effects: [{ kind: 'log', text: 'Nobody asks this either.' }],
        },
      ],
    });
    const said = messages(project);
    expect(said).toContain(
      '"card-mid-swing" answers somebody else\'s blow being counted, which only a stat block is asked about.',
    );
    expect(said).toContain('"card-in-the-light" answers a spotlight, which only a stat block is asked about.');
  });

  it('warns when a gate on the target has no target to narrow', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'aimed-at-nobody',
          name: 'Aimed At Nobody',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none', when: { kind: 'always' } },
          effects: [{ kind: 'log', text: 'Nothing to pick.' }],
        },
        {
          id: 'aimed-at-someone',
          name: 'Aimed At Someone',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'creature', range: 'melee', when: { kind: 'always' } },
          effects: [{ kind: 'log', text: 'Somebody to pick.' }],
        },
      ],
    });
    const said = messages(project);
    expect(said).toContain('"aimed-at-nobody" says what is worth aiming at, but it is aimed at nobody.');
    expect(said.some((m) => m.includes('aimed-at-someone'))).toBe(false);
  });

  it('warns when anything but a spotlight tries to end one', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'card-stops-a-turn',
          name: 'Card Stops A Turn',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          effects: [{ kind: 'endSpotlight' }],
        },
        {
          id: 'wrong-trigger',
          name: 'Wrong Trigger',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'dealtDamage',
          effects: [{ kind: 'endSpotlight' }],
        },
        {
          id: 'winding-up',
          name: 'Winding Up',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          kind: 'reaction',
          trigger: 'spotlighted',
          effects: [{ kind: 'endSpotlight' }],
        },
      ],
    });
    const said = messages(project);
    // A card has no spotlight of its own to spend, and a reaction to a blow is
    // running in somebody else's turn.
    expect(said.some((m) => m.includes('"card-stops-a-turn" ends a spotlight'))).toBe(true);
    expect(said.some((m) => m.includes('"wrong-trigger" ends a spotlight'))).toBe(true);
    expect(said.some((m) => m.includes('winding-up'))).toBe(false);
  });
});

describe('a replacement nothing ships', () => {
  it('catches a stat block that does not exist, and a count that is not dice', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'phase',
          name: 'Phase',
          source: { kind: 'adversary', adversaries: ['husk'] },
          kind: 'reaction',
          trigger: 'defeated',
          target: { kind: 'none' },
          effects: [{ kind: 'replace', adversary: 'second-form', spotlight: true }],
        },
        {
          id: 'split',
          name: 'Split',
          source: { kind: 'adversary', adversaries: ['husk'] },
          kind: 'reaction',
          trigger: 'tookHitPoints',
          target: { kind: 'none' },
          effects: [{ kind: 'replace', adversary: 'husk', count: 'a couple' }],
        },
      ],
    });
    const said = messages(project, { knownAdversaries: new Set(['husk']) });
    expect(said).toContain('"phase" replaces them with "second-form", which is not an adversary.');
    expect(said).toContain('"split" replaces them with "a couple" of them, which is not dice.');
  });
});

describe('a spotlight in the wrong hands', () => {
  it('warns when a card hands out the GM turn, and catches a count that is not dice', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'rally',
          name: 'Rally',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' } }],
        },
        {
          id: 'a-few',
          name: 'A Few',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'far' }, count: 'a few' }],
        },
        {
          id: 'proper',
          name: 'Proper',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'spotlight', targets: { kind: 'adversaries', range: 'close' }, count: '1d4+1', halfDamage: true }],
        },
      ],
    });
    const said = messages(project, { knownAdversaries: new Set(['husk']) });
    expect(said).toContain('"rally" spotlights allies, which only the GM does.');
    expect(said).toContain('"a-few" spotlights "a few" of them, which is not dice.');
    expect(said.some((m) => m.includes('"proper"'))).toBe(false);
  });
});

describe('a countdown nobody can read', () => {
  it('catches a length that is not dice, a clock already run out, and one counting towards nothing', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'soon',
          name: 'Soon',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'countdown', countdown: 'soon', name: 'Soon', start: 'soon', effects: [{ kind: 'log', text: 'now' }] }],
        },
        {
          id: 'already',
          name: 'Already',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'countdown', countdown: 'already', name: 'Already', start: '0', effects: [{ kind: 'log', text: 'now' }] }],
        },
        {
          id: 'pointless',
          name: 'Pointless',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [{ kind: 'countdown', countdown: 'pointless', name: 'Pointless', start: '4', effects: [] }],
        },
        {
          id: 'in-a-hand',
          name: 'In A Hand',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'none' },
          effects: [
            {
              kind: 'countdown',
              countdown: 'in-a-hand',
              name: 'In A Hand',
              start: '6',
              advance: 'hpMarked',
              effects: [{ kind: 'log', text: 'now' }],
            },
          ],
        },
        {
          id: 'fine',
          name: 'Fine',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [
            {
              kind: 'countdown',
              countdown: 'fine',
              name: 'Fine',
              start: '1d6',
              loop: 'reset',
              effects: [{ kind: 'summon', adversary: 'husk', range: 'close' }],
            },
          ],
        },
      ],
    });
    const said = messages(project, { knownAdversaries: new Set(['husk']) });
    expect(said).toContain('"soon" starts a countdown at "soon", which is not dice.');
    expect(said).toContain('"already" starts a countdown at "0", which has already run out.');
    expect(said).toContain('"pointless" starts a countdown that does nothing when it triggers.');
    expect(said).toContain('"in-a-hand" counts the Hit Points its owner marks, which only a stat block has.');
    // A clock that reads, loops and does something is exactly what it should be.
    expect(said.some((m) => m.includes('"fine"'))).toBe(false);
  });

  it('reads what a countdown will do, so a summons hidden inside one is still checked', () => {
    const project = projectSchema.parse({
      ...build(),
      abilities: [
        {
          id: 'ritual',
          name: 'Ritual',
          source: { kind: 'adversary', adversaries: ['husk'] },
          target: { kind: 'none' },
          effects: [
            {
              kind: 'countdown',
              countdown: 'ritual',
              name: 'Ritual',
              start: '6',
              effects: [{ kind: 'summon', adversary: 'nothing-like-it', range: 'close' }],
            },
          ],
        },
      ],
    });
    expect(messages(project, { knownAdversaries: new Set(['husk']) })).toContain(
      '"ritual" summons "nothing-like-it", which is not an adversary.',
    );
  });
});

describe('logic in code', () => {
  it('reports a hook nobody defines, code that will not compile, and code nothing runs', () => {
    const project = projectSchema.parse({
      ...build(),
      code: [
        { id: 'good', name: 'Good', source: 'return true;' },
        { id: 'broken', name: 'Broken', source: 'return (;' },
        { id: 'lonely', name: 'Lonely', source: 'return 1;' },
      ],
      abilities: [
        {
          id: 'a-card',
          name: 'A Card',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'self' },
          available: { kind: 'hook', hook: 'good' },
          effects: [{ kind: 'run', hook: 'nowhere' }],
        },
        {
          id: 'native-card',
          name: 'Native',
          source: { kind: 'granted', characters: ['kara'] },
          target: { kind: 'self' },
          effects: [{ kind: 'run', hook: 'arcane-barrage' }],
        },
      ],
    });
    const problems = validateProject(project, { knownHooks: new Set(['arcane-barrage']) });
    const messages = problems.map((p) => p.message);
    expect(messages).toContain('"a-card" runs hook "nowhere", which nothing defines.');
    expect(messages.some((m) => m.startsWith('Code "broken" does not compile'))).toBe(true);
    expect(messages).toContain('Code "lonely" is never run by anything.');
    // A hook the engine registers is fine, and so is a condition naming project code.
    expect(messages.some((m) => m.includes('arcane-barrage'))).toBe(false);
    expect(messages.some((m) => m.includes('asks hook "good"'))).toBe(false);
  });
});
