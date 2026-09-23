import { describe, it, expect } from 'vitest';
import { interactableSchema, projectSchema } from '../engine/scene/schema';
import { hollowVaultMap } from './demo-map';
import { buildDemoScene } from './demo-scene';
import { openProject, withShippedModels } from './project-open';

/** The demo's project, as a file of it would be once saved: through the schema, so a copy. */
function saved() {
  return projectSchema.parse(JSON.parse(JSON.stringify(buildDemoScene(hollowVaultMap()).project)));
}

describe('opening a project', () => {
  it('adds a model dropped into the folder after the project was saved', () => {
    const project = saved();
    const shipped = [{ id: 'door-prop', url: '/models/door-prop.glb', scale: 1 }];
    project.assets = project.assets.filter((asset) => asset.id !== 'door-prop');
    expect(withShippedModels(project, shipped)).toEqual(['door-prop']);
    // With the defaults a declared model has, as if it had been listed all along.
    expect(project.assets.find((asset) => asset.id === 'door-prop')).toEqual({
      id: 'door-prop', kind: 'gltf', url: '/models/door-prop.glb', scale: 1, groundOffset: 0, rotationY: 0, offsetX: 0, offsetY: 0,
    });
  });

  it('leaves a model the project already lists as the author set it, and adds nothing twice', () => {
    const project = saved();
    project.assets = [{ id: 'crate-prop', kind: 'gltf', url: '/models/mine.glb', scale: 3, groundOffset: 0.2, rotationY: 1, offsetX: 0, offsetY: 0 }];
    const shipped = [{ id: 'crate-prop', url: '/models/crate-prop.glb', scale: 1 }, { id: 'rock', url: '/models/rock.glb', scale: 1 }, { id: 'rock', url: '/models/rock.glb', scale: 1 }];
    expect(withShippedModels(project, shipped)).toEqual(['rock']);
    expect(project.assets.map((asset) => [asset.id, asset.url, asset.scale])).toEqual([['crate-prop', '/models/mine.glb', 3], ['rock', '/models/rock.glb', 1]]);
    expect(withShippedModels(project, shipped)).toEqual([]);
  });

  it('turns objects with a body into props that do something', () => {
    const project = saved();
    const vault = project.scenes[0]!;
    vault.interactables.push(interactableSchema.parse({ id: 'late-chest', kind: 'chest', position: { x: 1, y: 1 }, name: 'A late chest' }));
    openProject(project);
    expect(vault.interactables.some((object) => object.id === 'late-chest')).toBe(false);
    expect(vault.decos.find((deco) => deco.id === 'late-chest')?.function?.kind).toBe('script');
  });
});
