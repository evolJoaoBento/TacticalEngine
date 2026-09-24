/**
 * One character's sheet, written: the form the Party panel shows for whoever is picked in its list,
 * and the Inspector shows for whoever a party start on the board belongs to. One component, so the
 * two are the same form and cannot drift apart.
 *
 * Nothing mechanical is typed here - Evasion, Hit Points, thresholds and Armor Slots all come off
 * what the sheet names, and are shown as they are derived, so an author sees the consequence of a
 * choice as they make it. Ids are picked from the content rather than typed, and the lists narrow
 * the way the rules do: subclasses to the class, cards to the character's domains and level.
 */

import type { EditorSession, PartySheet } from '../session';
import { updateSheet } from '../session';
import { deriveCharacter, type DerivedCharacter } from '../../engine/character/sheet';
import { domainsOf, heldCards } from '../../engine/character/progression';
import { LOADOUT_LIMIT } from '../../engine/content/abilities';
import { isDomainCard, type ContentPack } from '../../engine/content/pack/import';
import type { Trait } from '../../engine/scene/schema';

const TRAITS: readonly Trait[] = ['agility', 'strength', 'finesse', 'instinct', 'presence', 'knowledge'];

const field: Record<string, string | number> = {
  padding: '3px 5px',
  background: 'var(--ph-field)',
  color: 'inherit',
  border: '1px solid var(--ph-line)',
  borderRadius: '3px',
  font: 'inherit',
  boxSizing: 'border-box',
};

export const button = (active: boolean): Record<string, string | number> => ({
  padding: '3px 8px',
  border: `1px solid ${active ? 'var(--ph-accent)' : 'var(--ph-line)'}`,
  borderRadius: '3px',
  background: active ? 'var(--ph-accent-bg)' : 'transparent',
  color: 'inherit',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
});

const labelled = (text: string, control: preact.JSX.Element): preact.JSX.Element => (
  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--ph-muted)' }}>
    {text}
    {control}
  </label>
);

/** Sorted `id → name` pairs, so a dropdown reads as words and writes an id. */
export function options(map: ReadonlyMap<string, { id: string; name: string }>): { id: string; name: string }[] {
  return [...map.values()].map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export interface SheetEditorProps {
  session: EditorSession;
  /** The content every dropdown is drawn from. */
  content: ContentPack;
  /** Every model a character can be drawn with. */
  models: readonly string[];
  /** Whose sheet. Nothing is drawn for an id the party does not have. */
  sheetId: string;
  onChange: () => void;
}

export function SheetEditor(props: SheetEditorProps): preact.JSX.Element | null {
  const { session, content } = props;
  const open = session.project.party.find((s) => s.id === props.sheetId) ?? null;
  if (open === null) return null;

  const edit = (changes: Partial<PartySheet>): void => {
    session.run(updateSheet(open.id, changes));
    props.onChange();
  };

  // Derived live, so the numbers under the form are the numbers at the table.
  const result = deriveCharacter(open, content, session.project.abilities);
  const derived: DerivedCharacter | null = result.character;
  const issues = result.issues.map((issue) => `${issue.field}: ${issue.message}`);

  const pick = (
    value: string,
    list: readonly { id: string; name: string }[],
    set: (id: string) => void,
    testId: string,
    empty?: string,
  ): preact.JSX.Element => (
    <select
      style={{ ...field, width: '150px' }}
      data-testid={testId}
      value={value}
      onChange={(e) => set((e.target as HTMLSelectElement).value)}
    >
      {empty === undefined ? null : <option value="">{empty}</option>}
      {list.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );

  const subclasses = options(content.subclasses).filter((s) => content.subclasses.get(s.id)?.classId === open.classId);
  const domains = domainsOf(open, content);
  const cards = options(content.cards).filter((c) => {
    const def = content.cards.get(c.id)!;
    return isDomainCard(def) && domains.includes(def.domain) && def.level <= open.level;
  });
  const held = heldCards(open);
  const active = open.loadout ?? held.slice(0, LOADOUT_LIMIT);

  return (
    <>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <input
          style={{ ...field, flex: 1 }}
          value={open.name}
          placeholder="name"
          data-testid="character-name"
          onInput={(e) => edit({ name: (e.target as HTMLInputElement).value })}
        />
        <span style={{ color: 'var(--ph-muted)' }}>
          {open.id} · level {open.level}
        </span>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {labelled(
          'class',
          pick(
            open.classId,
            options(content.classes),
            // A new class is a new character: the subclass belongs to
            // nobody now, and the cards are from domains they no longer
            // have. Undo puts all of it back.
            (classId) => edit({ classId, subclassId: undefined, domainCards: [], loadout: [] }),
            'character-class',
          ),
        )}
        {labelled(
          'subclass',
          pick(open.subclassId ?? '', subclasses, (subclassId) => edit({ subclassId: subclassId === '' ? undefined : subclassId }), 'character-subclass', '— none —'),
        )}
        {labelled(
          'drawn with',
          // Empty means the class decides, which is what every character did before
          // this: `DEMO_MODELS` maps a class to a body, and a class with no entry
          // stands as the library's magenta placeholder.
          pick(
            open.model ?? '',
            props.models.map((id) => ({ id, name: id })),
            (id) => edit({ model: id === '' ? undefined : id }),
            'character-model',
            '— whatever the class uses —',
          ),
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {labelled(
          'ancestry',
          pick(open.ancestryId ?? '', options(content.ancestries), (id) => edit({ ancestryId: id === '' ? undefined : id }), 'character-ancestry', '— none —'),
        )}
        {labelled(
          'community',
          pick(open.communityId ?? '', options(content.communities), (id) => edit({ communityId: id === '' ? undefined : id }), 'character-community', '— none —'),
        )}
      </div>

      <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>Traits</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }} data-testid="character-traits">
        {TRAITS.map((trait) =>
          labelled(
            trait,
            <input
              type="number"
              style={{ ...field, width: '52px' }}
              data-trait={trait}
              value={open.traits[trait]}
              onInput={(e) =>
                edit({ traits: { ...open.traits, [trait]: Math.trunc(Number((e.target as HTMLInputElement).value) || 0) } })
              }
            />,
          ),
        )}
      </div>

      <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>Carried</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {labelled(
          'armor',
          pick(open.armorId ?? '', options(content.armors), (id) => edit({ armorId: id === '' ? undefined : id }), 'character-armor', '— none —'),
        )}
        {labelled(
          'primary',
          pick(open.primaryWeaponId ?? '', options(content.weapons), (id) => edit({ primaryWeaponId: id === '' ? undefined : id }), 'character-primary', '— none —'),
        )}
        {labelled(
          'secondary',
          pick(open.secondaryWeaponId ?? '', options(content.weapons), (id) => edit({ secondaryWeaponId: id === '' ? undefined : id }), 'character-secondary', '— none —'),
        )}
      </div>

      <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>
        Domain cards{domains.length === 0 ? '' : ` (${domains.join(', ')})`}
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }} data-testid="character-cards">
        {cards.length === 0 ? (
          <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Choose a class first.</span>
        ) : null}
        {cards.map((entry) => {
          const has = held.includes(entry.id);
          const inLoadout = active.includes(entry.id);
          return (
            <span key={entry.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
              <button
                style={button(has)}
                data-card={entry.id}
                title={has ? 'Held' : 'Not held'}
                onClick={() => {
                  const next = has
                    ? (open.domainCards ?? []).filter((id) => id !== entry.id)
                    : [...(open.domainCards ?? []), entry.id];
                  // Dropping a card drops it from the loadout too, or the
                  // loadout would name something nobody holds.
                  edit({
                    domainCards: next,
                    ...(has ? { loadout: (open.loadout ?? []).filter((id) => id !== entry.id) } : {}),
                  });
                }}
              >
                {entry.name}
              </button>
              {has ? (
                <input
                  type="checkbox"
                  data-loadout={entry.id}
                  title="In the loadout"
                  checked={inLoadout}
                  onChange={(e) => {
                    const on = (e.target as HTMLInputElement).checked;
                    const next = on
                      ? [...active, entry.id].slice(0, LOADOUT_LIMIT)
                      : active.filter((id) => id !== entry.id);
                    edit({ loadout: next });
                  }}
                />
              ) : null}
            </span>
          );
        })}
      </div>

      <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>Experiences</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }} data-testid="character-experiences">
        {(open.experiences ?? []).map((experience, i) => (
          <div key={i} style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              style={{ ...field, flex: 1 }}
              value={experience.name}
              placeholder='"Held the line"'
              onInput={(e) =>
                edit({
                  experiences: (open.experiences ?? []).map((x, j) =>
                    j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x,
                  ),
                })
              }
            />
            <input
              type="number"
              style={{ ...field, width: '52px' }}
              value={experience.modifier}
              onInput={(e) =>
                edit({
                  experiences: (open.experiences ?? []).map((x, j) =>
                    j === i ? { ...x, modifier: Math.trunc(Number((e.target as HTMLInputElement).value) || 0) } : x,
                  ),
                })
              }
            />
            <button
              style={button(false)}
              title="Remove this Experience"
              onClick={() => edit({ experiences: (open.experiences ?? []).filter((_, j) => j !== i) })}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={{ ...button(false), alignSelf: 'flex-start' }}
          data-testid="add-experience"
          onClick={() => edit({ experiences: [...(open.experiences ?? []), { name: 'Something they know', modifier: 2 }] })}
        >
          + Experience
        </button>
      </div>

      {(open.levels ?? []).length > 0 ? (
        <>
          <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>Levels taken</div>
          <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }} data-testid="character-levels">
            {(open.levels ?? []).map((record) => (
              <div key={record.level}>
                {record.level}: {record.advancements.map((a) => a.kind).join(', ')} · {record.domainCard}
              </div>
            ))}
            Taken at the table; this is the record, not a form.
          </div>
        </>
      ) : null}

      <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>What that comes to</div>
      <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }} data-testid="character-derived">
        {derived === null ? null : (
          <>
            Evasion {derived.evasion} · Armor Score {derived.armorScore} · {derived.hitPoints} Hit Points ·{' '}
            {derived.stress} Stress · thresholds {derived.thresholds.major}/{derived.thresholds.severe} ·
            Proficiency {derived.proficiency}
            {derived.spellcastTrait === undefined ? '' : ` · casts with ${derived.spellcastTrait}`}
          </>
        )}
      </div>
      {issues.length > 0 ? (
        <div style={{ color: 'var(--ph-bad)', fontSize: '11px' }} data-testid="character-issues">
          {issues.join('; ')}
        </div>
      ) : null}
    </>
  );
}
