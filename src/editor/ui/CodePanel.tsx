/**
 * The Code panel: logic a project carries in its own file.
 *
 * Everything else in the editor writes data — effects, conditions, checks —
 * and that covers what the SRD's cards do. This is the door for the rest: a
 * JavaScript function body run against a hook context, named by a `run`
 * effect or a `hook` condition.
 *
 * It compiles as you type, so a syntax error is visible here rather than at
 * the table, and it lists which cards run each piece so deleting one is not a
 * guess. The cheat sheet is on the panel because a designer writing a hook
 * should not have to keep the manual open beside it.
 */

import { useState } from 'preact/hooks';
import type { EditorSession } from '../session';
import { addCode, removeCode, updateCode } from '../session';
import { codeSchema, type CodeDef } from '../../engine/scene/schema';
import { compileHooks } from '../../engine/script/hooks';
import { walkEffects } from '../../engine/script/schema';

export interface CodePanelProps {
  session: EditorSession;
  /** Redraw after an edit. */
  onChange: () => void;
  onClose: () => void;
}

const field: Record<string, string | number> = {
  width: '100%',
  padding: '3px 5px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
  boxSizing: 'border-box',
};

const button = (active: boolean): Record<string, string | number> => ({
  padding: '3px 8px',
  border: `1px solid ${active ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
  borderRadius: '3px',
  background: active ? 'var(--ph-accent-bg)' : 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
});

/** Which abilities run a hook, so the panel can say who would break. */
function usedBy(session: EditorSession, hookId: string): string[] {
  const owners: string[] = [];
  for (const ability of session.project.abilities) {
    let found = false;
    walkEffects(ability.effects, (effect) => {
      if (effect.kind === 'run' && effect.hook === hookId) found = true;
    });
    if (found) owners.push(ability.id);
  }
  return owners;
}

export function CodePanel(props: CodePanelProps): preact.JSX.Element {
  const { session } = props;
  const [openId, setOpenId] = useState<string | null>(session.project.code[0]?.id ?? null);
  const open = session.project.code.find((c) => c.id === openId) ?? null;

  const edit = (changes: Partial<Pick<CodeDef, 'name' | 'notes' | 'source'>>): void => {
    if (open === null) return;
    session.run(updateCode(open.id, changes));
    props.onChange();
  };

  const errors = open === null ? [] : compileHooks([open]).issues;

  return (
    <div
      data-testid="code-panel"
      style={{
        position: 'absolute',
        inset: '0',
        // The panel floats over the map, which is a canvas that would otherwise
        // swallow the clicks: the overlay it lives in lets them through by default.
        pointerEvents: 'auto',
        zIndex: 2,
        background: 'var(--ph-surface)',
        border: '1px solid var(--ph-line)',
        borderRadius: '0',
        padding: '10px',
        display: 'flex',
        gap: '10px',
        overflow: 'hidden',
        color: 'var(--ph-text)',
        font: '12px/1.5 system-ui, sans-serif',
      }}
    >
      <div style={{ width: '180px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, marginBottom: '2px' }}>Code</div>
        {session.project.code.map((entry) => (
          <div key={entry.id} style={{ display: 'flex', gap: '4px' }}>
            <button
              style={{ ...button(entry.id === openId), flex: 1, textAlign: 'left' }}
              data-code={entry.id}
              onClick={() => setOpenId(entry.id)}
            >
              {entry.id}
            </button>
            <button
              style={button(false)}
              title="Delete this code"
              onClick={() => {
                const owners = usedBy(session, entry.id);
                const warning = owners.length === 0 ? '' : `\n\nStill run by: ${owners.join(', ')}`;
                if (!confirm(`Delete "${entry.id}"?${warning}`)) return;
                session.run(removeCode(entry.id));
                if (openId === entry.id) setOpenId(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={button(false)}
          data-testid="add-code"
          onClick={() => {
            const name = prompt('Code id', 'my-logic');
            if (name === null || name === '') return;
            const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.code.some((c) => c.id === id)) return;
            session.run(addCode(codeSchema.parse({ id, name: id, source: '// ctx.queue([...]) to make something happen\n' })));
            setOpenId(id);
            props.onChange();
          }}
        >
          + Code
        </button>
        <div style={{ marginTop: 'auto' }}>
          <button style={button(false)} data-testid="close-code" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
        {open === null ? (
          <div style={{ color: 'var(--ph-muted)' }}>
            Nothing selected. Code is a JavaScript function body; a card runs it with a <code>run</code> effect naming
            its id.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                style={{ ...field, flex: 1 }}
                value={open.name}
                placeholder="name"
                data-testid="code-name"
                onInput={(e) => edit({ name: (e.target as HTMLInputElement).value })}
              />
              <span style={{ color: 'var(--ph-muted)', alignSelf: 'center' }}>
                run by: {usedBy(session, open.id).join(', ') || 'nothing yet'}
              </span>
            </div>
            <input
              style={field}
              value={open.notes}
              placeholder="what it is for"
              onInput={(e) => edit({ notes: (e.target as HTMLInputElement).value })}
            />
            <textarea
              style={{ ...field, flex: 1, font: '12px/1.45 ui-monospace, Consolas, monospace', resize: 'none' }}
              value={open.source}
              spellcheck={false}
              data-testid="code-source"
              onInput={(e) => edit({ source: (e.target as HTMLTextAreaElement).value })}
            />
            <div
              data-testid="code-errors"
              style={{ minHeight: '16px', color: errors.length === 0 ? 'var(--ph-good)' : 'var(--ph-bad)' }}
            >
              {errors.length === 0 ? 'Compiles.' : errors.map((issue) => issue.message).join('; ')}
            </div>
          </>
        )}
        <details style={{ color: 'var(--ph-muted)' }}>
          <summary style={{ cursor: 'pointer' }}>What a hook can do</summary>
          <div style={{ marginTop: '4px' }}>
            <p style={{ margin: '0 0 4px' }}>
              Reads: <code>ctx.actor</code>, <code>ctx.targets</code>, <code>ctx.hit</code>, <code>ctx.args</code>,{' '}
              <code>ctx.inCombat</code>, <code>ctx.lastRoll</code>, <code>ctx.pool(id, pool, measure)</code>,{' '}
              <code>ctx.hasCondition(id, name)</code>, <code>ctx.bandTo(a, b)</code>, <code>ctx.difficultyOf(id)</code>,{' '}
              <code>ctx.select(selector)</code>, <code>ctx.flag(name)</code>, <code>ctx.variable(name)</code>,{' '}
              <code>ctx.countAlive(faction)</code>, <code>ctx.tokens(id, card)</code>.
            </p>
            <p style={{ margin: '0 0 4px' }}>
              Writes: <code>ctx.queue([effects])</code> and <code>ctx.log(text, tone)</code> only, so everything shows
              in the log. Dice: <code>ctx.rng</code> — <code>Math.random</code> is refused, or a replay would drift.
            </p>
            <p style={{ margin: 0 }}>
              A <code>hook</code> condition gets the reads and nothing else; return <code>true</code> for yes. The
              engine ships no code of its own: every hook is the project's, or came in with a pack.
            </p>
          </div>
        </details>
      </div>
    </div>
  );
}
