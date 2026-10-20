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
 * Under the party are the companions (`project.companions`): sheets written the
 * same way, waiting to be asked along by a "Join the party" effect - the company
 * round a New Game's camp fire. They reach the table when one joins, not on Play.
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
import { addSheet, removeSheet, setFixedParty, type SheetList } from '../party-edits';
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

/** What each list is called where the panel asks or says something of one of its sheets. */
const LISTS: Record<SheetList, { remove: string; add: string; testId: string; row: string }> = {
  party: { remove: 'from the party', add: '+ Character', testId: 'add-character', row: 'data-character' },
  companions: { remove: 'from the companions', add: '+ Companion', testId: 'add-companion', row: 'data-companion' },
};

export function PartyPanel(props: PartyPanelProps): preact.JSX.Element {
  const { session, content } = props;
  // A list as well as an id: a companion who has joined is in both, under one id.
  const first = session.project.party[0] ?? null;
  const [opened, setOpened] = useState<{ list: SheetList; id: string } | null>(first === null ? null : { list: 'party', id: first.id });
  const open = opened === null ? null : (session.project[opened.list].find((s) => s.id === opened.id) ?? null);

  const sheets = (list: SheetList): preact.JSX.Element => (
    <>
      {session.project[list].map((sheet) => (
        <div key={sheet.id} style={{ display: 'flex', gap: '4px' }}>
          <button
            style={{ ...button(opened?.list === list && sheet.id === opened.id), flex: 1, textAlign: 'left' }}
            {...{ [LISTS[list].row]: sheet.id }}
            onClick={() => setOpened({ list, id: sheet.id })}
          >
            {sheet.name || sheet.id}
          </button>
          <button
            style={button(false)}
            title={`Remove ${LISTS[list].remove}`}
            onClick={() => {
              if (!confirm(`Remove ${sheet.name || sheet.id} ${LISTS[list].remove}?`)) return;
              session.run(removeSheet(sheet.id, list));
              if (opened?.list === list && opened.id === sheet.id) setOpened(null);
              props.onChange();
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        style={button(false)}
        data-testid={LISTS[list].testId}
        onClick={() => {
          const typed = prompt('Character name', 'Newcomer');
          if (typed === null || typed === '') return;
          const id = typed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          if (id === '' || session.project[list].some((s) => s.id === id)) return;
          const firstClass = options(content.classes)[0]?.id ?? 'guardian';
          session.run(addSheet(characterSheetSchema.parse(blankSheet(id, firstClass, { name: typed })), list));
          setOpened({ list, id });
          props.onChange();
        }}
      >
        {LISTS[list].add}
      </button>
    </>
  );

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
        {sheets('party')}
        <div style={{ marginTop: '8px', color: 'var(--ph-muted)', fontSize: '11px' }}>
          A party edited here reaches the table when you press Play.
        </div>
        <label style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginTop: '8px', fontSize: '11px' }} title="Begun at a camp's portal, this party plays it, with whoever leads the party there - four at most - and the companions wait at the camp">
          <input
            type="checkbox"
            data-testid="fixed-party"
            checked={session.project.fixedParty === true}
            onChange={(e) => {
              session.run(setFixedParty((e.target as HTMLInputElement).checked));
              props.onChange();
            }}
          />
          <span>Keep this party: begun at a camp's portal, they play it with whoever leads the party there.</span>
        </label>
        <div style={{ fontWeight: 600, marginTop: '12px' }} data-testid="party-companions">
          Companions
        </div>
        {sheets('companions')}
        <div style={{ marginTop: '8px', color: 'var(--ph-muted)', fontSize: '11px' }}>
          A companion waits to be asked along: they reach the table when a "Join the party" effect names them.
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, overflow: 'auto' }}>
        {open === null ? (
          <div style={{ color: 'var(--ph-muted)' }}>
            Nothing selected. A sheet names a class, an ancestry, what they carry and what they know; every
            number comes off those.
          </div>
        ) : (
          <SheetEditor key={`${opened!.list}:${open.id}`} session={session} content={content} models={props.models} sheetId={open.id} list={opened!.list} onChange={props.onChange} />
        )}
      </div>
    </div>
  );
}
