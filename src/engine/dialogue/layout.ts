/**
 * Where to draw a conversation that has never been drawn.
 *
 * A dialogue written by hand carries no positions, and a graph editor that
 * opened one as a heap in the corner would be useless. This lays a graph out by
 * how far each node is from the start: distance from `start` picks the column,
 * order of discovery picks the row, so a conversation reads left to right the
 * way it is played.
 *
 * It never writes the document. Positions are only stored when someone drags a
 * node, so opening a file and moving one thing is a one-node diff rather than a
 * whole-graph rewrite.
 *
 * DOM-free, and next to `danglingLinks` and `unreachableNodes` because it is the
 * same traversal over the same graph.
 */

import type { Dialogue, DialogueNode } from './schema';

export interface LayoutOptions {
  /** Distance between columns. */
  columnWidth?: number;
  /** Distance between rows. */
  rowHeight?: number;
}

export const DEFAULT_LAYOUT_OPTIONS = {
  columnWidth: 320,
  rowHeight: 200,
} as const;

/** Every node a node can lead to, in the order an author would read them. */
export function targetsOf(node: DialogueNode): string[] {
  const targets: string[] = [];
  if (node.goto !== undefined) targets.push(node.goto);
  for (const choice of node.choices ?? []) {
    if (choice.goto !== undefined) targets.push(choice.goto);
    if (choice.check?.gotoOnSuccess !== undefined) targets.push(choice.check.gotoOnSuccess);
    if (choice.check?.gotoOnFailure !== undefined) targets.push(choice.check.gotoOnFailure);
  }
  return targets;
}

/**
 * A position for every node in the dialogue.
 *
 * A node that already carries a `position` keeps it. The rest are placed by
 * breadth-first distance from the start; nodes nothing reaches go in a column of
 * their own past the end, where they are visible rather than lost — an author
 * part-way through writing a branch should be able to see it.
 */
export function layoutDialogue(
  dialogue: Dialogue,
  options: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const columnWidth = options.columnWidth ?? DEFAULT_LAYOUT_OPTIONS.columnWidth;
  const rowHeight = options.rowHeight ?? DEFAULT_LAYOUT_OPTIONS.rowHeight;

  const byId = new Map(dialogue.nodes.map((node) => [node.id, node] as const));
  const depth = new Map<string, number>();

  // Breadth-first, so a node's column is its shortest distance from the start
  // rather than whichever path happened to reach it last.
  const queue: string[] = byId.has(dialogue.start) ? [dialogue.start] : [];
  if (queue.length > 0) depth.set(dialogue.start, 0);
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head]!;
    const node = byId.get(id)!;
    for (const target of targetsOf(node)) {
      if (!byId.has(target) || depth.has(target)) continue;
      depth.set(target, depth.get(id)! + 1);
      queue.push(target);
    }
  }

  const deepest = depth.size === 0 ? -1 : Math.max(...depth.values());
  const orphanColumn = deepest + 1;

  // Rows are assigned per column in document order, which keeps the layout
  // stable: adding a node does not reshuffle the ones already placed above it.
  const rows = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();

  for (const node of dialogue.nodes) {
    if (node.position !== undefined) {
      positions.set(node.id, { ...node.position });
      continue;
    }
    const column = depth.get(node.id) ?? orphanColumn;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    positions.set(node.id, { x: column * columnWidth, y: row * rowHeight });
  }

  return positions;
}
