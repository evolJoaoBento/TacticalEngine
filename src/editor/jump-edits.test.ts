import { describe, it, expect } from 'vitest';
import { DEFAULT_JUMP_RULES, jumpRulesSchema } from '../engine/rules/jump';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, type ProjectDoc } from '../engine/scene/schema';
import { jumpRulesOf, resetJumpRules, setJumpRule } from './jump-edits';
import { EditorSession } from './session';
import { validateProject } from './validate';

/**
 * A project's jump rules, edited.
 *
 * The awkward case is the one `terrain-edits` has: a project that has said nothing plays by
 * the defaults, so the first change has to write the whole set down - and undoing it has to
 * leave a document that says nothing again, not one carrying defaults nobody asked for.
 */

const project = (jump?: unknown): ProjectDoc =>
  projectSchema.parse({ id: 'p', name: 'P', scenes: [blankScene('room', 3, 3)], startScene: 'room', ...(jump === undefined ? {} : { jump }) });

describe('a project that has said nothing about jumping', () => {
  it('plays by the defaults, and does not write them down', () => {
    const doc = project();
    expect(doc.jump).toBeUndefined();
    expect(jumpRulesOf(doc)).toEqual(DEFAULT_JUMP_RULES);
    expect(JSON.stringify(doc)).not.toContain('reachTrait');
  });

  it('writes the whole set down on the first change, and says nothing again when it is undone', () => {
    const doc = project();
    const edit = setJumpRule('difficulty', 15);
    edit.apply(doc);
    expect(doc.jump).toEqual({ ...DEFAULT_JUMP_RULES, difficulty: 15 });
    edit.undo(doc);
    expect(doc.jump).toBeUndefined();
  });

  it('is not an undo step when the value is the one it already had', () => {
    const doc = project();
    const edit = setJumpRule('difficulty', DEFAULT_JUMP_RULES.difficulty);
    edit.apply(doc);
    expect(edit.isNoop?.()).toBe(true);
    expect(doc.jump).toBeUndefined();
  });
});

describe('a project with rules of its own', () => {
  it('changes one and keeps the rest, and undo puts that one back', () => {
    const doc = project({ reachTrait: 'finesse', difficulty: 14 });
    const edit = setJumpRule('reachTrait', 'instinct');
    edit.apply(doc);
    expect(doc.jump).toMatchObject({ reachTrait: 'instinct', difficulty: 14 });
    edit.undo(doc);
    expect(doc.jump).toMatchObject({ reachTrait: 'finesse', difficulty: 14 });
  });

  it('makes typing into one field one undo step, and another field another', () => {
    const session = new EditorSession(project());
    session.run(setJumpRule('difficulty', 1));
    session.run(setJumpRule('difficulty', 13));
    session.run(setJumpRule('fallDie', 8));
    expect(session.project.jump).toMatchObject({ difficulty: 13, fallDie: 8 });
    session.undo();
    expect(session.project.jump).toMatchObject({ difficulty: 13, fallDie: 6 });
    session.undo();
    expect(session.project.jump).toBeUndefined();
  });

  it('goes back to the defaults by saying nothing, and undo brings its own rules back', () => {
    const doc = project({ difficulty: 18 });
    const edit = resetJumpRules();
    edit.apply(doc);
    expect(doc.jump).toBeUndefined();
    edit.undo(doc);
    expect(doc.jump).toMatchObject({ difficulty: 18 });
  });

  it('survives the file: what is saved is what is loaded', () => {
    const doc = project({ rollTrait: 'presence', stepHeight: 1 });
    const back = projectSchema.parse(JSON.parse(JSON.stringify(doc)));
    expect(back.jump).toEqual(jumpRulesSchema.parse({ rollTrait: 'presence', stepHeight: 1 }));
  });
});

describe('Check, for jump rules', () => {
  const about = (doc: ProjectDoc): string[] => validateProject(doc).map((p) => p.message).filter((m) => m.startsWith('Jump rules'));

  it('has nothing to say about the defaults, or about a project that says nothing', () => {
    expect(about(project())).toEqual([]);
    expect(about(project({}))).toEqual([]);
  });

  it('names a landing condition the project does not have', () => {
    expect(about(project({ failCondition: 'winded' }))).toEqual([expect.stringContaining('"winded"')]);
    expect(about(project({ failCondition: '' }))).toEqual([]);
    expect(about(project({ failCondition: 'restrained' }))).toEqual([]);
  });

  it('says so when nobody without the trait could jump, or when every drop is a fall', () => {
    expect(about(project({ reachBase: 0.5 }))).toEqual([expect.stringContaining('nobody without the trait can jump')]);
    expect(about(project({ dropBase: 0.5 }))).toEqual([expect.stringContaining('every drop past a step')]);
    expect(about(project({ dropBase: 0.5, fallDie: 0 }))).toEqual([]);
    expect(about(project({ rangeBase: 0.5 }))).toEqual([expect.stringContaining('nobody without the trait can jump anywhere')]);
    // Jumping switched off is nobody's problem.
    expect(about(project({ enabled: false, reachBase: 0, failCondition: 'winded' }))).toEqual([]);
  });
});
