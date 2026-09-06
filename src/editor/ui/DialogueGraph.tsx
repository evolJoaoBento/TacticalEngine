/**
 * The dialogue graph: a conversation as a tree you can see.
 *
 * Nodes are absolutely-positioned cards on a pannable surface, with the links
 * between them drawn underneath as curves — a reply's line runs from that reply's
 * own row to the top-left of the node it leads to, so which reply goes where is
 * readable without clicking anything.
 *
 * Every change is a session edit, so the whole graph is undoable: a drag is one
 * step, typing a line is one step, rewiring a reply is one step.
 *
 * Text only. A conversation editor is exactly where a "read it aloud" button
 * would feel natural, and CONTEXT.md rules that out.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { QuestDef } from '../../engine/content/quests';
import { ConditionEditor } from './ConditionEditor';
import { CheckEditor } from './CheckEditor';
import { layoutDialogue } from '../../engine/dialogue/layout';
import type { Dialogue, DialogueNode } from '../../engine/dialogue/schema';
import type { Effect } from '../../engine/script/schema';
import {
  EditorSession,
  addChoice,
  addNode,
  moveNode,
  removeChoice,
  removeNode,
  setDialogueStart,
  updateChoice,
  updateNode,
} from '../session';
import { EffectList } from './EffectList';

export interface DialogueGraphProps {
  session: EditorSession;
  dialogue: Dialogue;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
  onClose: () => void;
  /** Bump the panel's version counter. */
  onChange: () => void;
}

const NODE_WIDTH = 260;
const TRAITS = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'] as const;

const surface: Record<string, string | number> = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: 'rgba(10,12,16,0.97)',
  color: '#e8e6df',
  font: '12px/1.4 system-ui, sans-serif',
  pointerEvents: 'auto',
};

const bar: Record<string, string | number> = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  background: 'rgba(16,18,24,0.95)',
  borderBottom: '1px solid #39404d',
  zIndex: 2,
};

const card: Record<string, string | number> = {
  position: 'absolute',
  width: `${NODE_WIDTH}px`,
  boxSizing: 'border-box',
  padding: '8px',
  background: '#1b1f28',
  border: '1px solid #39404d',
  borderRadius: '6px',
};

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 5px',
  marginBottom: '4px',
  background: '#12161d',
  color: 'inherit',
  border: '1px solid #39404d',
  borderRadius: '3px',
  font: 'inherit',
};

const small: Record<string, string | number> = {
  padding: '2px 6px',
  border: '1px solid #39404d',
  borderRadius: '3px',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

/** Stop a click inside a form control from starting a node drag. */
const holdPointer = (event: Event): void => event.stopPropagation();

interface Link {
  from: string;
  to: string;
  /** Which row of the card the link leaves from. */
  row: number;
  kind: 'goto' | 'reply' | 'success' | 'failure';
  dangling: boolean;
}

const LINK_COLOR: Readonly<Record<Link['kind'], string>> = {
  goto: '#5d6b7a',
  reply: '#69d2ff',
  success: '#9ae08a',
  failure: '#ff8f7a',
};

function linksOf(dialogue: Dialogue): Link[] {
  const known = new Set(dialogue.nodes.map((n) => n.id));
  const links: Link[] = [];
  for (const node of dialogue.nodes) {
    if (node.goto !== undefined) {
      links.push({ from: node.id, to: node.goto, row: 0, kind: 'goto', dangling: !known.has(node.goto) });
    }
    (node.choices ?? []).forEach((choice, i) => {
      const add = (to: string | undefined, kind: Link['kind']): void => {
        if (to === undefined) return;
        links.push({ from: node.id, to, row: i, kind, dangling: !known.has(to) });
      };
      add(choice.goto, 'reply');
      add(choice.check?.gotoOnSuccess, 'success');
      add(choice.check?.gotoOnFailure, 'failure');
    });
  }
  return links;
}

export function DialogueGraph(props: DialogueGraphProps): preact.JSX.Element {
  const { session, dialogue } = props;
  const [pan, setPan] = useState({ x: 40, y: 60 });
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ node: string | null; startX: number; startY: number; panX: number; panY: number; nodeX: number; nodeY: number } | null>(null);

  // Positions are the document's where a node has been dragged, and computed
  // where it has not — so opening a hand-written conversation shows a tree.
  const positions = layoutDialogue(dialogue);
  const links = linksOf(dialogue);

  useEffect(() => {
    // A node deleted underneath the panel should not stay selected.
    if (selected !== null && !dialogue.nodes.some((n) => n.id === selected)) setSelected(null);
  }, [dialogue, selected]);

  const run = (edit: Parameters<EditorSession['run']>[0]): void => {
    session.run(edit);
    props.onChange();
  };

  const onPointerDown = (event: PointerEvent, nodeId: string | null): void => {
    // Without this a drag selects the text inside the card it started on.
    event.preventDefault();
    // A card sits inside the panning surface, so its pointerdown bubbles there
    // too — and the surface would replace this node drag with a pan of the whole
    // canvas, leaving the node exactly where it was.
    if (nodeId !== null) event.stopPropagation();
    const at = nodeId === null ? { x: 0, y: 0 } : (positions.get(nodeId) ?? { x: 0, y: 0 });
    drag.current = {
      node: nodeId,
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
      nodeX: at.x,
      nodeY: at.y,
    };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const state = drag.current;
    if (state === null) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (state.node === null) setPan({ x: state.panX + dx, y: state.panY + dy });
    else run(moveNode(dialogue.id, state.node, { x: state.nodeX + dx, y: state.nodeY + dy }));
  };

  const onPointerUp = (): void => {
    if (drag.current?.node !== null && drag.current !== null) {
      // Close the undo step, so the next drag is its own.
      session.endGroup();
    }
    drag.current = null;
  };

  const newNode = (): void => {
    const taken = new Set(dialogue.nodes.map((n) => n.id));
    let n = dialogue.nodes.length + 1;
    while (taken.has(`node-${n}`)) n++;
    const id = `node-${n}`;
    run(
      addNode(dialogue.id, {
        id,
        lines: [{ text: '' }],
        position: { x: -pan.x + 420, y: -pan.y + 120 },
      }),
    );
    setSelected(id);
  };

  return (
    <div style={surface} data-testid="dialogue-graph">
      <div style={bar}>
        <strong>{dialogue.id}</strong>
        <span style={{ color: '#8ea3b0' }}>
          {dialogue.nodes.length} nodes · opens on {dialogue.start}
        </span>
        <button style={small} onClick={newNode}>
          + Node
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#8ea3b0', fontSize: '11px' }}>Drag the background to pan</span>
        <button style={small} onClick={props.onClose}>
          Close
        </button>
      </div>

      <div
        style={{ position: 'absolute', inset: '37px 0 0 0', overflow: 'hidden', cursor: 'grab' }}
        onPointerDown={(e) => onPointerDown(e as unknown as PointerEvent, null)}
        onPointerMove={(e) => onPointerMove(e as unknown as PointerEvent)}
        onPointerUp={onPointerUp}
      >
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          {links.map((link, i) => {
            const from = positions.get(link.from);
            if (from === undefined) return null;
            const x1 = from.x + pan.x + NODE_WIDTH;
            const y1 = from.y + pan.y + 40 + link.row * 22;
            const to = positions.get(link.to);
            // A link to nothing is drawn as a stub, so the validator's error is
            // visible in the place it was made.
            const x2 = to === undefined ? x1 + 40 : to.x + pan.x;
            const y2 = to === undefined ? y1 : to.y + pan.y + 20;
            const mid = (x1 + x2) / 2;
            return (
              <g key={i}>
                <path
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={link.dangling ? '#ff8f7a' : LINK_COLOR[link.kind]}
                  strokeWidth={link.dangling ? 2 : 1.5}
                  strokeDasharray={link.dangling ? '4 3' : undefined}
                />
                {link.dangling ? (
                  <text x={x2 + 4} y={y2 + 4} fill="#ff8f7a" style={{ font: '10px system-ui' }}>
                    {link.to}?
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {dialogue.nodes.map((node) => {
          const at = positions.get(node.id)!;
          return (
            <NodeCard
              key={node.id}
              node={node}
              dialogue={dialogue}
              left={at.x + pan.x}
              top={at.y + pan.y}
              open={selected === node.id}
              onSelect={() => setSelected(selected === node.id ? null : node.id)}
              onPointerDown={(e) => onPointerDown(e, node.id)}
              onRun={run}
              sceneIds={props.sceneIds}
              dialogueIds={props.dialogueIds}
              encounterIds={props.encounterIds}
              quests={props.quests}
            />
          );
        })}
      </div>
    </div>
  );
}

interface NodeCardProps {
  node: DialogueNode;
  dialogue: Dialogue;
  left: number;
  top: number;
  open: boolean;
  onSelect: () => void;
  onPointerDown: (event: PointerEvent) => void;
  onRun: (edit: Parameters<EditorSession['run']>[0]) => void;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

function NodeCard(props: NodeCardProps): preact.JSX.Element {
  const { node, dialogue, onRun } = props;
  const isStart = dialogue.start === node.id;
  const nodeIds = dialogue.nodes.map((n) => n.id);
  const choices = node.choices ?? [];

  return (
    <div
      style={{
        ...card,
        left: `${props.left}px`,
        top: `${props.top}px`,
        borderColor: props.open ? '#69d2ff' : isStart ? '#f6c453' : '#39404d',
        cursor: 'grab',
      }}
      data-node={node.id}
      onPointerDown={(e) => props.onPointerDown(e as unknown as PointerEvent)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
        <strong style={{ flex: 1 }}>
          {node.id}
          {isStart ? <span style={{ color: '#f6c453' }}> ▸</span> : null}
        </strong>
        <button
          style={small}
          title={props.open ? 'Collapse' : 'Edit this node'}
          onPointerDown={holdPointer}
          onClick={props.onSelect}
        >
          {props.open ? '▾' : '▸'}
        </button>
      </div>

      {node.lines.map((line, i) => (
        <div key={i} style={{ color: '#d8d4c8', marginBottom: '2px' }}>
          {line.speaker !== undefined && line.speaker !== '' ? (
            <span style={{ color: '#c8b88a' }}>{line.speaker}: </span>
          ) : null}
          {props.open ? (
            <input
              style={field}
              value={line.text}
              placeholder="What is said"
              onPointerDown={holdPointer}
              onInput={(e) => {
                const lines = node.lines.map((l, j) =>
                  j === i ? { ...l, text: (e.target as HTMLInputElement).value } : l,
                );
                onRun(updateNode(dialogue.id, node.id, { lines }));
              }}
            />
          ) : (
            <span>{line.text || <em style={{ color: '#5d6b7a' }}>empty</em>}</span>
          )}
        </div>
      ))}

      {choices.map((choice, i) => (
        <div
          key={i}
          style={{
            borderTop: '1px solid #2a303a',
            paddingTop: '3px',
            marginTop: '3px',
            color: '#69d2ff',
          }}
        >
          {props.open ? (
            <>
              <input
                style={field}
                value={choice.text}
                placeholder="What the player says"
                onPointerDown={holdPointer}
                onInput={(e) =>
                  onRun(
                    updateChoice(dialogue.id, node.id, i, {
                      text: (e.target as HTMLInputElement).value,
                    }),
                  )
                }
              />
              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                <select
                  style={{ ...field, marginBottom: 0 }}
                  data-goto={i}
                  value={choice.goto ?? ''}
                  onPointerDown={holdPointer}
                  onChange={(e) => {
                    const value = (e.target as HTMLSelectElement).value;
                    onRun(
                      updateChoice(dialogue.id, node.id, i, {
                        goto: value === '' ? undefined : value,
                      }),
                    );
                  }}
                >
                  <option value="">— ends the conversation —</option>
                  {nodeIds.map((id) => (
                    <option key={id} value={id}>
                      → {id}
                    </option>
                  ))}
                </select>
                {(['available', 'enabled'] as const).map((gate) =>
                  choice[gate] === undefined ? (
                    <button
                      key={gate}
                      style={small}
                      title={gate === 'available' ? 'Hide this reply unless a condition holds' : 'Show this reply greyed unless a condition holds'}
                      data-gate={gate}
                      onPointerDown={holdPointer}
                      onClick={() =>
                        onRun(updateChoice(dialogue.id, node.id, i, { [gate]: { kind: 'flag', flag: 'a-flag' } }))
                      }
                    >
                      {gate === 'available' ? 'if…' : 'only if…'}
                    </button>
                  ) : null,
                )}
                <button
                  style={small}
                  title="Delete this reply"
                  onPointerDown={holdPointer}
                  onClick={() => onRun(removeChoice(dialogue.id, node.id, i))}
                >
                  ✕
                </button>
              </div>
              {(['available', 'enabled'] as const).map((gate) =>
                choice[gate] !== undefined ? (
                  <div key={gate} style={{ display: 'flex', gap: '3px', alignItems: 'flex-start', marginTop: '2px' }} data-gate-editor={gate} onPointerDown={holdPointer}>
                    <span style={{ color: '#8ea3b0', fontSize: '11px', whiteSpace: 'nowrap', paddingTop: '3px' }}>
                      {gate === 'available' ? 'shown if' : 'enabled if'}
                    </span>
                    <ConditionEditor
                      condition={choice[gate]!}
                      quests={props.quests}
                      encounterIds={props.encounterIds}
                      onChange={(condition) => onRun(updateChoice(dialogue.id, node.id, i, { [gate]: condition }))}
                    />
                    <button style={small} title="Remove this gate" onClick={() => onRun(updateChoice(dialogue.id, node.id, i, { [gate]: undefined }))}>
                      ✕
                    </button>
                  </div>
                ) : null,
              )}
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '3px 0', color: '#8ea3b0' }}
                onPointerDown={holdPointer}
              >
                <input
                  type="checkbox"
                  checked={choice.check !== undefined}
                  onChange={(e) =>
                    onRun(
                      updateChoice(dialogue.id, node.id, i, {
                        check: (e.target as HTMLInputElement).checked
                          ? { trait: 'presence', difficulty: 12 }
                          : undefined,
                      }),
                    )
                  }
                />
                Costs a roll
              </label>
              {choice.check !== undefined ? (
                <div style={{ display: 'flex', gap: '3px' }}>
                  <select
                    style={{ ...field, marginBottom: 0 }}
                    value={choice.check.trait}
                    onPointerDown={holdPointer}
                    onChange={(e) =>
                      onRun(
                        updateChoice(dialogue.id, node.id, i, {
                          check: {
                            ...choice.check!,
                            trait: (e.target as HTMLSelectElement).value as (typeof TRAITS)[number],
                          },
                        }),
                      )
                    }
                  >
                    {TRAITS.map((trait) => (
                      <option key={trait} value={trait}>
                        {trait}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    style={{ ...field, marginBottom: 0, width: '60px' }}
                    value={choice.check.difficulty}
                    onPointerDown={holdPointer}
                    onInput={(e) =>
                      onRun(
                        updateChoice(dialogue.id, node.id, i, {
                          check: {
                            ...choice.check!,
                            difficulty: Math.max(
                              1,
                              Number((e.target as HTMLInputElement).value) || 1,
                            ),
                          },
                        }),
                      )
                    }
                  />
                </div>
              ) : null}
              {choice.check !== undefined ? (
                <div style={{ marginTop: '3px' }} onPointerDown={holdPointer} data-reply-check={i}>
                  <CheckEditor
                    check={choice.check}
                    showHeader={false}
                    nodeIds={nodeIds}
                    onChange={(check) => onRun(updateChoice(dialogue.id, node.id, i, { check }))}
                    sceneIds={props.sceneIds}
                    dialogueIds={props.dialogueIds}
                    encounterIds={props.encounterIds}
                    quests={props.quests}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <div>
              {choice.text || <em style={{ color: '#5d6b7a' }}>empty reply</em>}
              {choice.check !== undefined ? (
                <span style={{ color: '#c8b88a' }}>
                  {' '}
                  ({choice.check.trait} {choice.check.difficulty})
                </span>
              ) : null}
            </div>
          )}
        </div>
      ))}

      {props.open ? (
        <div style={{ marginTop: '6px' }} onPointerDown={holdPointer}>
          <button
            style={small}
            onClick={() =>
              onRun(updateNode(dialogue.id, node.id, { lines: [...node.lines, { text: '' }] }))
            }
          >
            + Line
          </button>{' '}
          <button
            style={small}
            onClick={() => onRun(addChoice(dialogue.id, node.id, { text: 'A new reply' }))}
          >
            + Reply
          </button>{' '}
          {!isStart ? (
            <>
              <button
                style={small}
                title="Open the conversation on this node"
                onClick={() => onRun(setDialogueStart(dialogue.id, node.id))}
              >
                Open here
              </button>{' '}
              <button
                style={{ ...small, color: '#ff8f7a' }}
                onClick={() => onRun(removeNode(dialogue.id, node.id))}
              >
                Delete
              </button>
            </>
          ) : null}

          <div style={{ color: '#8ea3b0', fontSize: '11px', margin: '6px 0 2px' }}>
            On entering this node
          </div>
          <EffectList
            effects={node.onEnter ?? []}
            onChange={(effects: Effect[]) =>
              onRun(
                updateNode(dialogue.id, node.id, {
                  onEnter: effects.length === 0 ? undefined : effects,
                }),
              )
            }
            sceneIds={props.sceneIds}
            dialogueIds={props.dialogueIds}
            encounterIds={props.encounterIds}
            quests={props.quests}
          />
        </div>
      ) : null}
    </div>
  );
}
