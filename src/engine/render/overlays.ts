/**
 * The four transparent layers drawn over the ground: lit tiles, a zone, and the border of each.
 *
 * Allocated once at the biggest room the view has seen, and written into by the painters that use
 * them - the instanced layers set a count, the edge geometries a draw range - so moving between
 * rooms never allocates unless the new room is larger than any before it.
 *
 * Their draw order is decided here rather than by whichever happens to be nearer the camera: they
 * are all transparent and none writes depth, so without an order they would flicker against each
 * other as the camera turned.
 *
 * Lifted out of `SceneView`, which is at its readability ceiling. It is construction and nothing
 * else: no state, no frame, and everything it needs is handed to it.
 */

import { BufferAttribute, BufferGeometry, InstancedMesh, LineSegments } from 'three';
import type { BufferGeometry as Geometry, Material, Object3D } from 'three';

/** What the layers are made of. The view owns these; they outlive any one room. */
export interface OverlayParts {
  highlightGeometry: Geometry;
  highlightMaterial: Material;
  zoneMaterial: Material;
  zoneEdgeMaterial: Material;
  highlightEdgeMaterial: Material;
}

export interface Overlays {
  highlight: InstancedMesh;
  highlightEdges: LineSegments;
  highlightEdgeGeometry: BufferGeometry;
  zoneLayer: InstancedMesh;
  zoneEdges: LineSegments;
  zoneEdgeGeometry: BufferGeometry;
}

export function buildOverlays(root: Object3D, capacity: number, parts: OverlayParts): Overlays {
    const room = Math.max(1, capacity);
    const highlight = new InstancedMesh(parts.highlightGeometry, parts.highlightMaterial, room);
    highlight.name = 'highlights';
    highlight.count = 0;
    highlight.frustumCulled = false;

    const zoneLayer = new InstancedMesh(parts.highlightGeometry, parts.zoneMaterial, room);
    zoneLayer.name = 'zones';
    zoneLayer.count = 0;
    zoneLayer.frustumCulled = false;

    // Room for four edges on every tile, allocated once; the painters write
    // into it and set the draw range, the way the instanced layers do.
    const edgeGeometry = (): BufferGeometry => {
      const edgeCapacity = room * 4 * 2;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(edgeCapacity * 3), 3));
      geometry.setDrawRange(0, 0);
      return geometry;
    };
    const zoneEdgeGeometry = edgeGeometry();
    const zoneEdges = new LineSegments(zoneEdgeGeometry, parts.zoneEdgeMaterial);
    zoneEdges.name = 'zone-edges';
    zoneEdges.frustumCulled = false;
    const highlightEdgeGeometry = edgeGeometry();
    const highlightEdges = new LineSegments(highlightEdgeGeometry, parts.highlightEdgeMaterial);
    highlightEdges.name = 'highlight-edges';
    highlightEdges.frustumCulled = false;

    // The overlays are all transparent and none writes depth, so their order
    // is decided here rather than by whichever happens to be nearer the
    // camera: ground first, the edge over it, then the walk and its edge,
    // the pointer, and the ring round the selected on top of everything.
    zoneLayer.renderOrder = 1;
    zoneEdges.renderOrder = 2;
    highlight.renderOrder = 3;
    highlightEdges.renderOrder = 4;
    root.add(zoneLayer, zoneEdges, highlight, highlightEdges);
    return { highlight, highlightEdges, highlightEdgeGeometry, zoneLayer, zoneEdges, zoneEdgeGeometry };
  }
