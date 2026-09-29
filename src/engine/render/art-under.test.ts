import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { artUnder, modelOf, named } from './art-under';

/**
 * Which model the thing under the pointer is made of (`art-under.ts`), for the note that says how its
 * art was made. What matters: the answer survives the view's own renames, a creature's rim - hung
 * beside its model, not inside it - still answers for the creature, and ground in front answers nothing.
 */

const box = (): Mesh => new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());

function built(modelId: string): { group: Group; body: Mesh } {
  const group = new Group();
  const body = box();
  group.add(body);
  named({ group } as never, modelId);
  return { group, body };
}

describe('the model a drawn thing is made of', () => {
  it('is kept on the group it was built as, and a later rename does not lose it', () => {
    const { group, body } = built('quim');
    expect(group.name).toBe('model:quim');
    group.name = 'token:kara';
    const root = new Group();
    root.add(group);
    expect(modelOf(body, root)).toBe('quim');
  });

  it('is found beside a rim that hangs outside the model, in the same top-level group', () => {
    const root = new Group();
    const token = new Group();
    token.name = 'token:kara';
    const { group } = built('violet');
    const rim = box();
    token.add(group, rim);
    root.add(token);
    expect(modelOf(rim, root)).toBe('violet');
  });

  it('is a tile model group’s, which says it on its data', () => {
    const root = new Group();
    const tiles = new Group();
    tiles.name = 'tiles:grass';
    tiles.userData['model'] = 'grass-ground';
    const instance = box();
    tiles.add(instance);
    root.add(tiles);
    expect(modelOf(instance, root)).toBe('grass-ground');
  });
});

describe('the model under a ray', () => {
  const down = (x: number): Raycaster => new Raycaster(new Vector3(x, 10, 0), new Vector3(0, -1, 0));

  it('is the nearest thing drawn, unless the ground is in front of it', () => {
    const root = new Group();
    const { group } = built('barrel-prop');
    group.position.set(0, 0.5, 0);
    const ground = box();
    ground.position.set(0, -1, 0);
    root.add(group, ground);
    root.updateMatrixWorld(true);
    expect(artUnder(down(0), [group], [ground], root)).toBe('barrel-prop');
    // Nothing drawn there: nothing.
    expect(artUnder(down(5), [group], [ground], root)).toBeNull();
    // The ground above it now: the ground is nearer, and ground is no model.
    ground.position.set(0, 3, 0);
    root.updateMatrixWorld(true);
    expect(artUnder(down(0), [group], [ground], root)).toBeNull();
  });
});
