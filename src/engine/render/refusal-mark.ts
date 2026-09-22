/**
 * The X a jump's landing wears when the jump cannot be made: too far, too high, something in
 * the way of the arc, or nowhere to put a body down.
 *
 * Two flat bars crossed, lying on the ground inside the landing ring, so it reads at any
 * camera angle the ring does. `TrajectoryLine` owns it and says when it shows.
 */

import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';

export interface RefusalMark {
  readonly group: Group;
  dispose(): void;
}

export function buildRefusalMark(tileSize: number): RefusalMark {
  const geometry = new PlaneGeometry(tileSize * 0.7, tileSize * 0.12);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({ color: new Color('#d8402c'), transparent: true, opacity: 0.9, depthWrite: false });
  const group = new Group();
  group.name = 'cursor:refused';
  for (const turn of [Math.PI / 4, -Math.PI / 4]) {
    const bar = new Mesh(geometry, material);
    bar.rotation.y = turn;
    bar.position.y = 0.01;
    bar.renderOrder = 7;
    group.add(bar);
  }
  group.visible = false;
  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
