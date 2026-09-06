import { describe, it, expect } from 'vitest';
import { dialogueSchema, type Dialogue } from './schema';
import { DEFAULT_LAYOUT_OPTIONS, layoutDialogue, targetsOf } from './layout';

const { columnWidth, rowHeight } = DEFAULT_LAYOUT_OPTIONS;

const graph = (nodes: unknown[], start = 'a'): Dialogue =>
  dialogueSchema.parse({ id: 'talk', start, nodes });

const column = (x: number): number => x / columnWidth;

describe('laying out a conversation', () => {
  it('puts the start in the first column', () => {
    const positions = layoutDialogue(graph([{ id: 'a', lines: [] }]));
    expect(positions.get('a')).toEqual({ x: 0, y: 0 });
  });

  it('puts a node reached by a reply in the next column along', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], choices: [{ text: 'On.', goto: 'b' }] },
        { id: 'b', lines: [] },
      ]),
    );
    expect(column(positions.get('b')!.x)).toBe(1);
  });

  it('follows a plain goto as well as a reply', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], goto: 'b' },
        { id: 'b', lines: [], goto: 'c' },
        { id: 'c', lines: [] },
      ]),
    );
    expect(column(positions.get('c')!.x)).toBe(2);
  });

  it('follows both sides of a check', () => {
    const positions = layoutDialogue(
      graph([
        {
          id: 'a',
          lines: [],
          choices: [
            {
              text: 'Try.',
              check: {
                trait: 'presence',
                difficulty: 12,
                gotoOnSuccess: 'won',
                gotoOnFailure: 'lost',
              },
            },
          ],
        },
        { id: 'won', lines: [] },
        { id: 'lost', lines: [] },
      ]),
    );
    expect(column(positions.get('won')!.x)).toBe(1);
    expect(column(positions.get('lost')!.x)).toBe(1);
    // Two nodes in one column stack rather than overlap.
    expect(positions.get('won')!.y).not.toBe(positions.get('lost')!.y);
    expect(positions.get('lost')!.y).toBe(rowHeight);
  });

  it('uses the shortest way to a node, not the last one found', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], choices: [{ text: 'Long.', goto: 'b' }, { text: 'Short.', goto: 'd' }] },
        { id: 'b', lines: [], goto: 'c' },
        { id: 'c', lines: [], goto: 'd' },
        { id: 'd', lines: [] },
      ]),
    );
    // Reachable in one step and in three; it belongs in column 1.
    expect(column(positions.get('d')!.x)).toBe(1);
  });

  it('parks a node nothing reaches past the end, where it can still be seen', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], choices: [{ text: 'On.', goto: 'b' }] },
        { id: 'b', lines: [] },
        { id: 'orphan', lines: [] },
      ]),
    );
    expect(column(positions.get('orphan')!.x)).toBe(2);
  });

  it('survives a cycle', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], goto: 'b' },
        { id: 'b', lines: [], goto: 'a' },
      ]),
    );
    expect(positions.size).toBe(2);
  });

  it('ignores a link to a node that does not exist', () => {
    const positions = layoutDialogue(
      graph([{ id: 'a', lines: [], choices: [{ text: 'On.', goto: 'nowhere' }] }]),
    );
    expect(positions.size).toBe(1);
    expect(positions.has('nowhere')).toBe(false);
  });

  it('leaves a node that has been dragged exactly where it was put', () => {
    const positions = layoutDialogue(
      graph([
        { id: 'a', lines: [], position: { x: -40.5, y: 900 }, choices: [{ text: 'On.', goto: 'b' }] },
        { id: 'b', lines: [] },
      ]),
    );
    // Authored positions win, including ones off to the left of the origin.
    expect(positions.get('a')).toEqual({ x: -40.5, y: 900 });
    // And the rest are still laid out around it.
    expect(column(positions.get('b')!.x)).toBe(1);
  });

  it('places every node even when the start names nothing', () => {
    const positions = layoutDialogue(
      dialogueSchema.parse({
        id: 'talk',
        start: 'a',
        nodes: [{ id: 'a', lines: [] }, { id: 'b', lines: [] }],
      }),
    );
    expect(positions.size).toBe(2);
  });

  it('keeps positions through a JSON round trip', () => {
    const dialogue = graph([
      { id: 'a', lines: [], position: { x: 12.5, y: -3 } },
    ]);
    const back = dialogueSchema.parse(JSON.parse(JSON.stringify(dialogue)));
    expect(back.nodes[0]!.position).toEqual({ x: 12.5, y: -3 });
  });
});

describe('what a node leads to', () => {
  it('reads a goto, every reply, and both sides of a check', () => {
    const dialogue = graph([
      {
        id: 'a',
        lines: [],
        goto: 'plain',
        choices: [
          { text: 'One.', goto: 'one' },
          {
            text: 'Two.',
            check: {
              trait: 'presence',
              difficulty: 10,
              gotoOnSuccess: 'won',
              gotoOnFailure: 'lost',
            },
          },
        ],
      },
    ]);
    expect(targetsOf(dialogue.nodes[0]!)).toEqual(['plain', 'one', 'won', 'lost']);
  });

  it('reads nothing from a node that ends the conversation', () => {
    expect(targetsOf(graph([{ id: 'a', lines: [] }]).nodes[0]!)).toEqual([]);
  });
});
