import { describe, expect, it } from 'vitest';
import { blankScene } from '../engine/scene/grid-from-scene';
import { projectSchema, sceneSchema } from '../engine/scene/schema';
import { EditorSession } from './session';
import { lightFromText, newSceneId, setSceneLight } from './scene-edits';

/** The scene menu's edits (`scene-edits.ts`): a new room's id; a room's own light, read from what is typed, written, undone. */

const session = () => new EditorSession(projectSchema.parse({ id: 'p', scenes: [sceneSchema.parse(blankScene('room', 4, 4))], startScene: 'room' }));

describe("a new room's id", () => {
  it('is its name in kebab case, made unique against the rooms there, and a room of no name is a scene', () => {
    const rooms = { scenes: [{ id: 'the-pit' }, { id: 'the-pit-2' }, { id: 'scene' }] } as never;
    expect(newSceneId(rooms, 'The Crypt!')).toBe('the-crypt');
    expect(newSceneId(rooms, 'The Pit')).toBe('the-pit-3');
    expect(newSceneId(rooms, '  ***  ')).toBe('scene-2');
  });
});

describe("a room's light, set in the editor", () => {
  it('is read as a percentage of daylight - all of it, or nothing typed, being daylight - and nothing else', () => {
    expect(lightFromText('40')).toBe(0.4);
    expect(lightFromText(' 35 % ')).toBe(0.35);
    expect(lightFromText('10')).toBe(0.1);
    expect(lightFromText('100')).toBeUndefined();
    expect(lightFromText('')).toBeUndefined();
    for (const nonsense of ['9', '101', 'dark', '-5', 'NaN']) expect(lightFromText(nonsense), nonsense).toBeNull();
  });

  it('is written to the room, taken back to daylight, and each step undone; a change to nothing is no step', () => {
    const s = session();
    const room = () => s.project.scenes[0]!;
    expect(s.run(setSceneLight('room', 0.4))).toBe(true);
    expect(room().light).toBe(0.4);
    expect(projectSchema.parse(JSON.parse(JSON.stringify(s.project))).scenes[0]!.light).toBe(0.4);
    expect(s.run(setSceneLight('room', 0.4))).toBe(false);
    expect(s.run(setSceneLight('room', undefined))).toBe(true);
    expect('light' in room()).toBe(false);
    s.undo();
    expect(room().light).toBe(0.4);
    s.undo();
    expect('light' in room()).toBe(false);
    expect(s.run(setSceneLight('nowhere', 0.5))).toBe(false);
  });
});
