/**
 * The Party panel: who the campaign is about.
 *
 * A character sheet is the last thing in this engine that was a TypeScript
 * literal. It is a project document now, and this is where it is written: a
 * class, an ancestry and a community, six traits, what they carry, the cards
 * they know, and the Experiences they can spend a Light on. Nothing mechanical
 * is typed here — Evasion, Hit Points, thresholds and Armor Slots all come off
 * what the sheet *names*, and the panel shows them as it derives them, so an
 * author sees the consequence of a choice as they make it.
 *
 * Ids are picked from the vendored SRD content rather than typed, and the
 * lists narrow the way the rules do: subclasses to the class, cards to the
 * character's domains and level. The form itself is `SheetEditor`, which the
 * Inspector shows too, for whoever a party start on the board belongs to.
 *
 * What is not here is a level-up form. Levels are taken at the table, where
 * `progression.ts` records what was ticked; this shows that history and does
 * not rewrite it.
 */

import { useState } from 'preact/hooks';
import type { EditorSession } from '../session';
import { addSheet, removeSheet } from '../session';
import { blankSheet } from '../../engine/character/sheet';
import { characterSheetSchema } from '../../engine/character/sheet-schema';
import type { ContentPack } from '../../engine/content/pack/import';
import { SheetEditor, button, options } from './SheetEditor';
import { Icon } from './icons';

export interface PartyPanelProps {
  session: EditorSession;
  onChange: () => void;
  onClose: () => void;
  /** The vendored SRD content every dropdown here is drawn from. */
  content: ContentPack;
  /** Every model a character can be drawn with: the same list the Tiles workspace offers. */
  models: readonly string[];
}

export function PartyPanel(props: PartyPanelProps): preact.JSX.Element {
  const { session, content } = props;
  const [openId, setOpenId] = useState<string | null>(session.project.party[0]?.id ?? null);
  const open = session.project.party.find((s) => s.id === openId) ?? null;

  return (
    <div
      data-testid="party-panel"
      style={{
        position: 'absolute',
        inset: '0',
        // Over the map, which is a canvas that would otherwise swallow clicks.
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
      <div style={{ width: '170px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
          <button style={button(false)} data-testid="close-party" onClick={props.onClose} aria-label="Back" title="Back to the board">
            <Icon name="back" size={16} />
          </button>
          <span style={{ fontWeight: 600 }}>Party</span>
        </div>
        {session.project.party.map((sheet) => (
          <div key={sheet.id} style={{ display: 'flex', gap: '4px' }}>
            <button
              style={{ ...button(sheet.id === openId), flex: 1, textAlign: 'left' }}
              data-character={sheet.id}
              onClick={() => setOpenId(sheet.id)}
            >
              {sheet.name || sheet.id}
            </button>
            <button
              style={button(false)}
              title="Remove from the party"
              onClick={() => {
                if (!confirm(`Remove ${sheet.name || sheet.id} from the party?`)) return;
                session.run(removeSheet(sheet.id));
                if (openId === sheet.id) setOpenId(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={button(false)}
          data-testid="add-character"
          onClick={() => {
            const typed = prompt('Character name', 'Newcomer');
            if (typed === null || typed === '') return;
            const id = typed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.party.some((s) => s.id === id)) return;
            const firstClass = options(content.classes)[0]?.id ?? 'guardian';
            session.run(addSheet(characterSheetSchema.parse(blankSheet(id, firstClass, { name: typed }))));
            setOpenId(id);
            props.onChange();
          }}
        >
          + Character
        </button>
        <div style={{ marginTop: '8px', color: 'var(--ph-muted)', fontSize: '11px' }}>
          A party edited here reaches the table when you press Play.
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, overflow: 'auto' }}>
        {open === null ? (
          <div style={{ color: 'var(--ph-muted)' }}>
            Nothing selected. A sheet names a class, an ancestry, what they carry and what they know; every
            number comes off those.
          </div>
        ) : (
          <SheetEditor session={session} content={content} models={props.models} sheetId={open.id} onChange={props.onChange} />
        )}
      </div>
    </div>
  );
}
