/**
 * Making a built model into a ghost of itself.
 *
 * What a player cannot see while placing is what they are placing: a prop appears the moment it is
 * committed, so choosing where a six-tile boulder goes means clicking, looking, undoing, clicking
 * again. A ghost under the pointer answers that before the click.
 *
 * The whole of the difficulty is the materials. A model's materials come out of a cache shared by
 * everything drawn from that model, and a glTF clone shares the template's, so turning one
 * translucent turns every crate in the room translucent with it. Each one is therefore cloned
 * first and the copy faded, which is the only reason this is a module rather than three lines.
 *
 * Cloned materials are the caller's to dispose of; a ghost is meant to be built once per model and
 * kept, not rebuilt per frame.
 */

import type { Material, Mesh, Object3D } from 'three';
import type { BuiltModel } from './procedural/build';

/** How solid a thing that is not there yet looks. Half, as asked for. */
export const GHOST_OPACITY = 0.5;

/** Whether an object carries materials, without asking three what kind of object it is. */
function meshOf(object: Object3D): Mesh | null {
  const mesh = object as Mesh;
  return mesh.material === undefined || mesh.material === null ? null : mesh;
}

/**
 * Fade everything under an object to a ghost of itself, on copies of its materials.
 *
 * `depthWrite` goes off with the opacity: a translucent model that still writes depth hides its
 * own far side, and a boulder you can see through in patches reads worse than one you cannot see
 * through at all. Shadows go with it, since a thing that is not there should not darken the floor.
 */
export function fadeToGhost(root: Object3D, opacity = GHOST_OPACITY): Material[] {
  const cloned: Material[] = [];
  const fade = (material: Material): Material => {
    const copy = material.clone();
    copy.transparent = true;
    copy.opacity = opacity;
    copy.depthWrite = false;
    cloned.push(copy);
    return copy;
  };
  root.traverse((object) => {
    const mesh = meshOf(object);
    if (mesh === null) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(fade) : fade(mesh.material);
  });
  return cloned;
}

/**
 * The one ghost on the board, kept between frames.
 *
 * Built once per model rather than per frame: cloning a glTF scene sixty times a second costs
 * more than drawing the room does. Seating is the caller's - it owns the grid and the layout -
 * which is what keeps the ghost standing exactly where the real prop will.
 */
export class PropGhost {
  private showing: { id: string; model: BuiltModel } | null = null;

  constructor(
    private readonly root: Object3D,
    private readonly make: (id: string) => BuiltModel,
    private readonly forget: (of: Object3D) => void,
  ) {}

  /** Show the ghost of this model, seated by the caller. */
  show(id: string, seat: (model: BuiltModel) => void): void {
    if (this.showing?.id !== id) {
      this.hide();
      const model = this.make(id);
      fadeToGhost(model.group);
      this.showing = { id, model };
      this.root.add(model.group);
    }
    seat(this.showing.model);
    this.showing.model.group.visible = true;
  }

  /** Take it down: nothing is being placed, or the pointer has left the board. */
  hide(): void {
    if (this.showing === null) return;
    this.root.remove(this.showing.model.group);
    this.forget(this.showing.model.group);
    this.showing = null;
  }

  /** What is showing, and how many tiles across: how a test sees the preview. */
  get shown(): { id: string; span: number } | null {
    return this.showing === null ? null : { id: this.showing.id, span: this.showing.model.group.scale.x };
  }
}
