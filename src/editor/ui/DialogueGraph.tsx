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
import { Icon } from './icons';

export interface DialogueGraphProps {
  session: EditorSession;
  dialogue: Dialogue;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
  /** What a consequence's "Run code" can name: the engine's hooks and the project's code. */
  hookIds?: readonly string[];
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
  background: 'var(--ph-backdrop)',
  color: 'var(--ph-text)',
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
  background: 'var(--ph-panel)',
  borderBottom: '1px solid var(--ph-line)',
  zIndex: 2,
};

const card: Record<string, string | number> = {
  position: 'absolute',
  width: `${NODE_WIDTH}px`,
  boxSizing: 'border-box',
  padding: '8px',
  background: 'var(--ph-field)',
  border: '1px solid var(--ph-line)',
  borderRadius: '6px',
};

const field: Record<string, string | number> = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '3px 5px',
  marginBottom: '4px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
};

const small: Record<string, string | number> = {
  padding: '2px 6px',
  border: '1px solid var(--ph-line)',
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
  goto: 'var(--ph-faint)',
  reply: 'var(--ph-accent)',
  success: 'var(--ph-good)',
  failure: 'var(--ph-bad)',
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

  // A consequence says nothing - it does - so it starts with no line to fill in.
  const newNode = (consequence = false): void => {
    const stem = consequence ? 'consequence' : 'node';
    const taken = new Set(dialogue.nodes.map((n) => n.id));
    let n = dialogue.nodes.length + 1;
    while (taken.has(`${stem}-${n}`)) n++;
    const id = `${stem}-${n}`;
    run(
      addNode(dialogue.id, {
        id,
        ...(consequence ? { kind: 'consequence' as const } : {}),
        lines: consequence ? [] : [{ text: '' }],
        position: { x: -pan.x + 420, y: -pan.y + 120 },
      }),
    );
    setSelected(id);
  };

  return (
    <div style={surface} data-testid="dialogue-graph">
      <div style={bar}>
        <button style={small} onClick={props.onClose} aria-label="Back" title="Back to the conversations">
          <Icon name="back" size={16} />
        </button>
        <strong>{dialogue.id}</strong>
        <span style={{ color: 'var(--ph-muted)' }}>
          {dialogue.nodes.length} nodes · opens on {dialogue.start}
        </span>
        <button style={small} onClick={() => newNode()}>
          + Node
        </button>
        <button style={small} data-testid="add-consequence" title="A node that does rather than says: runs code or effects, then goes on" onClick={() => newNode(true)}>
          + Consequence
        </button>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Drag the background to pan</span>
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
                  style={{ stroke: link.dangling ? 'var(--ph-bad)' : LINK_COLOR[link.kind] }}
                  strokeWidth={link.dangling ? 2 : 1.5}
                  strokeDasharray={link.dangling ? '4 3' : undefined}
                />
                {link.dangling ? (
                  <text x={x2 + 4} y={y2 + 4} style={{ font: '10px system-ui', fill: 'var(--ph-bad)' }}>
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
              {...(props.hookIds === undefined ? {} : { hookIds: props.hookIds })}
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
  hookIds?: readonly string[];
}

function NodeCard(props: NodeCardProps): preact.JSX.Element {
  if (props.node.kind === 'consequence') return <ConsequenceCard {...props} />;
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
        borderColor: props.open ? 'var(--ph-accent)' : isStart ? 'var(--ph-warm)' : 'var(--ph-line)',
        cursor: 'grab',
      }}
      data-node={node.id}
      onPointerDown={(e) => props.onPointerDown(e as unknown as PointerEvent)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
        <strong style={{ flex: 1 }}>
          {node.id}
          {isStart ? <span style={{ color: 'var(--ph-warm)' }}> ▸</span> : null}
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
        <div key={i} style={{ color: 'var(--ph-text)', marginBottom: '2px' }}>
          {line.speaker !== undefined && line.speaker !== '' ? (
            <span style={{ color: 'var(--ph-label)' }}>{line.speaker}: </span>
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
            <span>{line.text || <em style={{ color: 'var(--ph-faint)' }}>empty</em>}</span>
          )}
        </div>
      ))}

      {choices.map((choice, i) => (
        <div
          key={i}
          style={{
            borderTop: '1px solid var(--ph-line-soft)',
            paddingTop: '3px',
            marginTop: '3px',
            color: 'var(--ph-accent)',
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
                    <span style={{ color: 'var(--ph-muted)', fontSize: '11px', whiteSpace: 'nowrap', paddingTop: '3px' }}>
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
                style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '3px 0', color: 'var(--ph-muted)' }}
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
              {choice.text || <em style={{ color: 'var(--ph-faint)' }}>empty reply</em>}
              {choice.check !== undefined ? (
                <span style={{ color: 'var(--ph-label)' }}>
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
                style={{ ...small, color: 'var(--ph-bad)' }}
                onClick={() => onRun(removeNode(dialogue.id, node.id))}
              >
                Delete
              </button>
            </>
          ) : null}

          <div style={{ color: 'var(--ph-muted)', fontSize: '11px', margin: '6px 0 2px' }}>
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
            {...(props.hookIds === undefined ? {} : { hookIds: props.hookIds })}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * A node that does rather than says: its effects - code to run, a creature turned friendly or
 * hostile, a flag, a fight - and where the conversation goes after, or the end of it. Nothing on
 * it is shown to the player; the conversation walks straight through.
 */
function ConsequenceCard(props: NodeCardProps): preact.JSX.Element {
  const { node, dialogue, onRun } = props;
  const effects = node.onEnter ?? [];
  const isStart = dialogue.start === node.id;
  return (
    <div
      style={{ ...card, left: `${props.left}px`, top: `${props.top}px`, borderColor: props.open ? 'var(--ph-accent)' : 'var(--ph-warm)', borderStyle: 'dashed', cursor: 'grab' }}
      data-node={node.id}
      data-consequence
      onPointerDown={(e) => props.onPointerDown(e as unknown as PointerEvent)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--ph-warm)', fontSize: '11px' }}>Consequence</span>
        <strong style={{ flex: 1 }}>
          {node.id}
          {isStart ? <span style={{ color: 'var(--ph-warm)' }}> ▸</span> : null}
        </strong>
        <button style={small} title={props.open ? 'Collapse' : 'Edit this consequence'} onPointerDown={holdPointer} onClick={props.onSelect}>
          {props.open ? '▾' : '▸'}
        </button>
      </div>
      {props.open ? (
        <div onPointerDown={holdPointer}>
          <EffectList
            testId={`consequence-effects-${node.id}`}
            effects={effects}
            onChange={(next: Effect[]) => onRun(updateNode(dialogue.id, node.id, { onEnter: next.length === 0 ? undefined : next }))}
            sceneIds={props.sceneIds}
            dialogueIds={props.dialogueIds}
            encounterIds={props.encounterIds}
            quests={props.quests}
            {...(props.hookIds === undefined ? {} : { hookIds: props.hookIds })}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--ph-muted)', fontSize: '11px' }}>
            then
            <select
              style={{ ...field, marginBottom: 0 }}
              data-consequence-goto={node.id}
              value={node.goto ?? ''}
              onChange={(e) => {
                const value = (e.target as HTMLSelectElement).value;
                onRun(updateNode(dialogue.id, node.id, { goto: value === '' ? undefined : value }));
              }}
            >
              <option value="">— the conversation ends —</option>
              {dialogue.nodes.filter((n) => n.id !== node.id).map((n) => (
                <option key={n.id} value={n.id}>
                  → {n.id}
                </option>
              ))}
            </select>
          </label>
          {!isStart ? (
            <button style={{ ...small, color: 'var(--ph-bad)', marginTop: '4px' }} onClick={() => onRun(removeNode(dialogue.id, node.id))}>
              Delete
            </button>
          ) : null}
        </div>
      ) : (
        <div style={{ color: effects.length === 0 ? 'var(--ph-faint)' : 'var(--ph-text)' }}>
          {effects.length === 0 ? <em>does nothing yet</em> : effects.map((effect) => effect.kind).join(', ')}
          {node.goto === undefined ? <div style={{ color: 'var(--ph-muted)' }}>then ends</div> : null}
        </div>
      )}
    </div>
  );
}
