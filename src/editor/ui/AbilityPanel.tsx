/**
 * The Cards panel: what a character can do, as a project can write it.
 *
 * A card is a name, its printed text, what it costs, who it can be aimed at,
 * and a script — and the script is the same effect list every other panel
 * edits, so this panel is mostly the fields around it.
 *
 * "+ Card" writes a card of the project's own and the ability on it, `given` to
 * nobody yet. "granted by" says how else that card gets into play -- a loadout,
 * with the domain, type, level and recall cost a chosen card carries; a class; a
 * subclass stage; an ancestry; a community; or the stat blocks that print it --
 * and ✕ takes card and ability back together. A card the pack prints is shown
 * as the pack has it, and "Edit a copy" lays a copy into the project: a
 * project's card lays over the pack's by id, whole, so the pack is never written.
 *
 * A card no ability sits on -- one of the pack's text-only cards, or one an
 * imported pack brings without a script -- is listed under "Text only" and
 * opened on its own: its name and its text, how it gets into play, and "+ Script",
 * which writes the first ability on it and moves it into the list above.
 */

import { useState } from 'preact/hooks';
import type { EditorSession } from '../session';
import { addAbility, addCard, addCardWithAbility, removeCard, removeCardWithAbility, updateAbility, updateCard, updateCardWords } from '../card-edits';
import { scriptIdFor, unscriptedCards } from '../card-list';
import { abilitySchema, cardOf, type AbilityDef } from '../../engine/content/abilities';
import { cardDefSchema } from '../../engine/content/pack/schema';
import type { CardDef, ContentPack } from '../../engine/content/pack/import';
import { MAX_LEVEL } from '../../engine/character/progression';
import type { QuestDef } from '../../engine/content/quests';
import { RANGE_BANDS, type RangeBand } from '../../engine/rules/range';
import { EffectList } from './EffectList';
import { ConditionEditor } from './ConditionEditor';

/** What a card's token count can be: a number, a trait, or the Spellcast trait. */
type TokenAmount = NonNullable<AbilityDef['tokens']>['amount'];

export interface AbilityPanelProps {
  session: EditorSession;
  onChange: () => void;
  onClose: () => void;
  /** The cards the engine ships, shown for reference. */
  libraryAbilities: readonly AbilityDef[];
  /** What a `run` inside a card's script can name. */
  hookIds: readonly string[];
  /** What a `summon` inside a card's script can name. */
  adversaryIds: readonly string[];
  /** What a card's grant can name: the classes, subclasses, ancestries and communities there are. */
  content: ContentPack;
  /** The pack the app ships, before the project is laid over it: which of the project's cards are copies. */
  pack: ContentPack;
  sceneIds: readonly string[];
  dialogueIds: readonly string[];
  encounterIds: readonly string[];
  quests: readonly QuestDef[];
}

const field: Record<string, string | number> = {
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

const label = (text: string, control: preact.JSX.Element): preact.JSX.Element => (
  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--ph-muted)' }}>
    {text}
    {control}
  </label>
);

const BANDS = RANGE_BANDS.filter((band) => band !== 'outOfRange');

type ProjectCard = EditorSession['project']['cards'][number];
type Grant = ProjectCard['grant'];
type CardType = NonNullable<ProjectCard['type']>;

const GRANT_KINDS: readonly { kind: Grant['kind']; words: string }[] = [
  { kind: 'chosen', words: 'a loadout' },
  { kind: 'given', words: 'named characters' },
  { kind: 'condition', words: 'a condition on them' },
  { kind: 'class', words: 'a class' },
  { kind: 'subclass', words: 'a subclass stage' },
  { kind: 'ancestry', words: 'an ancestry' },
  { kind: 'community', words: 'a community' },
  { kind: 'adversary', words: 'stat blocks' },
];

const STAGES = ['foundation', 'specialization', 'mastery'] as const;
const CARD_TYPES: readonly CardType[] = ['ability', 'spell', 'grimoire'];

/** Sorted `id -> name` pairs, so a dropdown reads as words and writes an id. */
function choices(map: ReadonlyMap<string, { id: string; name: string }>): { id: string; name: string }[] {
  return [...map.values()].map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every domain a class or a subclass opens: what a chosen card can be in for somebody to take it. */
function openedDomains(content: ContentPack): string[] {
  const domains = new Set([...content.classes.values(), ...content.subclasses.values()].flatMap((def) => def.domains));
  return [...domains].sort((a, b) => a.localeCompare(b));
}

/**
 * What to write to grant a card this way: the grant, naming the first thing of that kind there is,
 * and -- for a loadout -- the four numbers a chosen card cannot load without, the card's own where it
 * has them. Null when there is nothing to name. Leaving a loadout keeps the numbers: a granted card
 * may carry them, and switching back loses nothing.
 */
function regrant(kind: Grant['kind'], card: ProjectCard, content: ContentPack): Partial<ProjectCard> | null {
  switch (kind) {
    case 'chosen': {
      const domain = card.domain ?? openedDomains(content)[0];
      if (domain === undefined) return null;
      return { grant: { kind }, domain, type: card.type ?? 'ability', level: card.level ?? 1, recallCost: card.recallCost ?? 0 };
    }
    case 'given':
      return { grant: { kind, characters: [] } };
    case 'adversary':
      return { grant: { kind, adversaries: [] } };
    case 'condition':
      return { grant: { kind, conditions: [] } };
    case 'class': {
      const id = choices(content.classes)[0]?.id;
      return id === undefined ? null : { grant: { kind, classId: id } };
    }
    case 'subclass': {
      const id = choices(content.subclasses)[0]?.id;
      return id === undefined ? null : { grant: { kind, subclassId: id, stage: 'foundation' } };
    }
    case 'ancestry': {
      const id = choices(content.ancestries)[0]?.id;
      return id === undefined ? null : { grant: { kind, ancestryId: id } };
    }
    case 'community': {
      const id = choices(content.communities)[0]?.id;
      return id === undefined ? null : { grant: { kind, communityId: id } };
    }
  }
}

/** Comma-separated ids, as typed. */
const idList = (text: string): string[] =>
  text
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');

/**
 * How the card an ability sits on gets into play, and -- for a chosen card -- the four numbers a
 * loadout reads. The project's own card is edited where it stands. A pack's card is shown as the pack
 * has it, beside a button that lays a copy into the project, which is then the card played; a copy
 * carries a button that takes it back out, and the pack's is played again.
 */
function GrantFields(props: {
  session: EditorSession;
  cardId: string;
  content: ContentPack;
  pack: ContentPack;
  onChange: () => void;
}): preact.JSX.Element {
  const card = props.session.project.cards.find((c) => c.id === props.cardId);
  if (card === undefined) {
    const packed = props.content.cards.get(props.cardId);
    return (
      <>
        {label(
          'granted by',
          <span data-testid="card-grant-kind" style={{ color: 'var(--ph-muted)' }}>
            {packed === undefined ? 'no card' : "the pack's card"}
          </span>,
        )}
        {packed === undefined ? null : (
          <button
            style={button(false)}
            data-testid="card-copy-pack"
            title="Lay a copy of this card into the project, and edit that"
            onClick={() => {
              props.session.run(addCard(cardDefSchema.parse(packed)));
              props.onChange();
            }}
          >
            Edit a copy
          </button>
        )}
      </>
    );
  }
  const grant = card.grant;
  const write = (changes: Partial<ProjectCard>): void => {
    props.session.run(updateCard(card.id, changes));
    props.onChange();
  };
  const set = (next: Grant): void => write({ grant: next });
  const pick = (
    value: string,
    list: readonly { id: string; name: string }[],
    onPick: (id: string) => void,
    testId: string,
  ): preact.JSX.Element => (
    <select style={{ ...field, width: '140px' }} data-testid={testId} value={value} onChange={(e) => onPick((e.target as HTMLSelectElement).value)}>
      {/* A grant naming what the content lacks still shows what it names, so Check's warning has something to point at. */}
      {list.some((entry) => entry.id === value) ? null : <option value={value}>{value} (not defined)</option>}
      {list.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.name}
        </option>
      ))}
    </select>
  );
  return (
    <>
      {label(
        'granted by',
        <select
          style={{ ...field, width: '140px' }}
          data-testid="card-grant-kind"
          value={grant.kind}
          onChange={(e) => {
            const next = regrant((e.target as HTMLSelectElement).value as Grant['kind'], card, props.content);
            if (next !== null) write(next);
          }}
        >
          {GRANT_KINDS.map(({ kind, words }) => (
            <option key={kind} value={kind} disabled={kind !== grant.kind && regrant(kind, card, props.content) === null}>
              {words}
            </option>
          ))}
        </select>,
      )}
      {grant.kind === 'chosen' ? (
        <>
          {label(
            'domain',
            pick(card.domain ?? '', openedDomains(props.content).map((domain) => ({ id: domain, name: domain })), (domain) => write({ domain }), 'card-domain'),
          )}
          {label(
            'type',
            <select
              style={field}
              data-testid="card-type"
              value={card.type ?? 'ability'}
              onChange={(e) => write({ type: (e.target as HTMLSelectElement).value as CardType })}
            >
              {CARD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>,
          )}
          {label(
            'level',
            <input
              type="number"
              min={1}
              max={MAX_LEVEL}
              style={{ ...field, width: '50px' }}
              data-testid="card-level"
              value={card.level ?? 1}
              onInput={(e) => write({ level: Math.min(MAX_LEVEL, Math.max(1, Math.floor(Number((e.target as HTMLInputElement).value)) || 1)) })}
            />,
          )}
          {label(
            'recall',
            <input
              type="number"
              min={0}
              style={{ ...field, width: '50px' }}
              data-testid="card-recall"
              value={card.recallCost ?? 0}
              onInput={(e) => write({ recallCost: Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value)) || 0) })}
            />,
          )}
        </>
      ) : null}
      {grant.kind === 'given'
        ? label(
            'held by',
            <input
              style={{ ...field, width: '150px' }}
              data-testid="ability-characters"
              placeholder="character ids, comma separated"
              value={grant.characters.join(', ')}
              onInput={(e) => set({ kind: 'given', characters: idList((e.target as HTMLInputElement).value) })}
            />,
          )
        : null}
      {grant.kind === 'adversary'
        ? label(
            'printed on',
            <input
              style={{ ...field, width: '150px' }}
              data-testid="card-grant-adversaries"
              placeholder="stat block ids, comma separated"
              value={grant.adversaries.join(', ')}
              onInput={(e) => set({ kind: 'adversary', adversaries: idList((e.target as HTMLInputElement).value) })}
            />,
          )
        : null}
      {grant.kind === 'condition'
        ? label(
            'lent by',
            <input
              style={{ ...field, width: '150px' }}
              data-testid="card-grant-conditions"
              placeholder="condition ids, comma separated"
              value={grant.conditions.join(', ')}
              onInput={(e) => set({ kind: 'condition', conditions: idList((e.target as HTMLInputElement).value) })}
            />,
          )
        : null}
      {grant.kind === 'class' ? pick(grant.classId, choices(props.content.classes), (classId) => set({ kind: 'class', classId }), 'card-grant-class') : null}
      {grant.kind === 'subclass' ? (
        <>
          {pick(grant.subclassId, choices(props.content.subclasses), (subclassId) => set({ ...grant, subclassId }), 'card-grant-subclass')}
          <select
            style={field}
            data-testid="card-grant-stage"
            value={grant.stage}
            onChange={(e) => set({ ...grant, stage: (e.target as HTMLSelectElement).value as (typeof STAGES)[number] })}
          >
            {STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
              </option>
            ))}
          </select>
        </>
      ) : null}
      {grant.kind === 'ancestry'
        ? pick(grant.ancestryId, choices(props.content.ancestries), (ancestryId) => set({ kind: 'ancestry', ancestryId }), 'card-grant-ancestry')
        : null}
      {grant.kind === 'community'
        ? pick(grant.communityId, choices(props.content.communities), (communityId) => set({ kind: 'community', communityId }), 'card-grant-community')
        : null}
      {props.pack.cards.has(card.id) ? (
        <button
          style={button(false)}
          data-testid="card-remove-copy"
          title="Take the project's copy out, and play the pack's card again"
          onClick={() => {
            props.session.run(removeCard(card.id));
            props.onChange();
          }}
        >
          Remove copy
        </button>
      ) : null}
    </>
  );
}

/**
 * A card no ability sits on: its own name and text, how it gets into play, and a button that writes
 * the first ability on it. The project's own card is edited where it stands, and one the pack does
 * not print can be deleted; a pack's is read-only until "Edit a copy" lays one into the project.
 */
function CardDetail(props: {
  session: EditorSession;
  card: CardDef;
  content: ContentPack;
  pack: ContentPack;
  onChange: () => void;
  onScript: (abilityId: string) => void;
}): preact.JSX.Element {
  const own = props.session.project.cards.some((c) => c.id === props.card.id);
  const write = (changes: Partial<ProjectCard>): void => {
    props.session.run(updateCard(props.card.id, changes));
    props.onChange();
  };
  return (
    <>
      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          style={{ ...field, flex: 1 }}
          value={props.card.name}
          placeholder="name"
          data-testid="card-name"
          readOnly={!own}
          onInput={(e) => write({ name: (e.target as HTMLInputElement).value })}
        />
        <span style={{ color: 'var(--ph-muted)', alignSelf: 'center' }}>{props.card.id}</span>
      </div>
      <textarea
        style={{ ...field, width: '100%', minHeight: '46px', resize: 'vertical' }}
        value={props.card.text}
        placeholder="The card's text, as printed"
        data-testid="card-text"
        readOnly={!own}
        onInput={(e) => write({ text: (e.target as HTMLTextAreaElement).value })}
      />
      {props.card.features.length === 0 ? null : (
        <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>
          And {props.card.features.length} named feature{props.card.features.length === 1 ? '' : 's'}, shown on the card and
          not edited here.
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
        <GrantFields session={props.session} cardId={props.card.id} content={props.content} pack={props.pack} onChange={props.onChange} />
      </div>
      <div style={{ color: 'var(--ph-muted)' }}>
        No ability sits on this card, so there is nothing for the engine to run: its holder reads it and the
        table decides. <b>+ Script</b> writes the first ability on it.
      </div>
      <div>
        <button
          style={button(false)}
          data-testid="card-add-script"
          onClick={() => {
            const id = scriptIdFor(props.card.id, props.session.project.abilities);
            props.session.run(addAbility(abilitySchema.parse({ id, name: props.card.name, source: { card: props.card.id } })));
            props.onChange();
            props.onScript(id);
          }}
        >
          + Script
        </button>
        {own && !props.pack.cards.has(props.card.id) ? (
          <button
            style={{ ...button(false), marginLeft: '8px' }}
            data-testid="card-delete"
            title="Take this card out of the project"
            onClick={() => {
              props.session.run(removeCard(props.card.id));
              props.onChange();
            }}
          >
            Delete card
          </button>
        ) : null}
      </div>
    </>
  );
}

export function AbilityPanel(props: AbilityPanelProps): preact.JSX.Element {
  const { session } = props;
  const [openId, setOpenId] = useState<string | null>(session.project.abilities[0]?.id ?? null);
  const open = session.project.abilities.find((a) => a.id === openId) ?? null;
  // A card no ability sits on is listed on its own, and opened on its own.
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const unscripted = unscriptedCards(props.content, session.project);
  const openCard = unscripted.find((card) => card.id === openCardId) ?? null;
  const pickAbility = (id: string | null): void => {
    setOpenId(id);
    setOpenCardId(null);
  };

  const edit = (changes: Partial<AbilityDef>): void => {
    if (open === null) return;
    session.run(updateAbility(open.id, changes));
    props.onChange();
  };
  // The name and the text are the card's as much as the ability's: one edit writes both.
  const reword = (words: { name?: string; text?: string }): void => {
    if (open === null) return;
    session.run(updateCardWords(cardOf(open), open.id, words));
    props.onChange();
  };

  type Defenses = NonNullable<AbilityDef['defenses']>;
  /**
   * Write one part of what a passive does to damage without disturbing the
   * others: the resisted types and the number taken off share one field.
   */
  const setDefenses = (next: Partial<Defenses>): void => {
    const merged = { ...(open?.defenses ?? {}), ...next };
    const resistances = merged.resistances ?? [];
    const immunities = merged.immunities ?? [];
    const reduce = merged.reduce ?? [];
    edit({
      defenses:
        resistances.length === 0 && immunities.length === 0 && reduce.length === 0
          ? undefined
          : {
              ...(resistances.length === 0 ? {} : { resistances }),
              ...(immunities.length === 0 ? {} : { immunities }),
              ...(reduce.length === 0 ? {} : { reduce }),
            },
    });
  };
  const reduction = open?.defenses?.reduce?.[0];

  // A card can put tokens on any card, and name any character's; the SRD's
  // library is part of that list because a project card may spend from one.
  const abilityIds = [
    ...session.project.abilities.map((a) => a.id),
    ...props.libraryAbilities.map((a) => a.id),
  ];

  return (
    <div
      data-testid="ability-panel"
      style={{
        position: 'absolute',
        inset: '24px',
        // Over the map, which is a canvas that would otherwise swallow clicks.
        pointerEvents: 'auto',
        zIndex: 2,
        background: 'var(--ph-surface)',
        border: '1px solid var(--ph-line)',
        borderRadius: '4px',
        padding: '10px',
        display: 'flex',
        gap: '10px',
        overflow: 'hidden',
        color: 'var(--ph-text)',
        font: '12px/1.5 system-ui, sans-serif',
      }}
    >
      <div style={{ width: '190px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'auto' }}>
        <div style={{ fontWeight: 600, marginBottom: '2px' }}>Cards</div>
        {session.project.abilities.map((ability) => (
          <div key={ability.id} style={{ display: 'flex', gap: '4px' }}>
            <button
              style={{ ...button(openCard === null && ability.id === openId), flex: 1, textAlign: 'left' }}
              data-ability={ability.id}
              onClick={() => pickAbility(ability.id)}
            >
              {ability.name}
            </button>
            <button
              style={button(false)}
              title="Delete this card"
              onClick={() => {
                if (!confirm(`Delete "${ability.name}"?`)) return;
                session.run(removeCardWithAbility(ability.id));
                if (openId === ability.id) setOpenId(null);
                props.onChange();
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          style={button(false)}
          data-testid="add-ability"
          onClick={() => {
            const typed = prompt('Card name', 'My Card');
            if (typed === null || typed === '') return;
            const id = typed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (id === '' || session.project.abilities.some((a) => a.id === id) || session.project.cards.some((c) => c.id === id)) return;
            session.run(
              addCardWithAbility(
                cardDefSchema.parse({ id, name: typed, grant: { kind: 'given', characters: [] } }),
                abilitySchema.parse({ id, name: typed, source: { card: id } }),
              ),
            );
            pickAbility(id);
            props.onChange();
          }}
        >
          + Card
        </button>

        {unscripted.length === 0 ? null : (
          <>
            <div style={{ marginTop: '8px', fontWeight: 600 }} data-testid="text-only-cards">
              Text only
            </div>
            {unscripted.map((card) => (
              <button
                key={card.id}
                style={{ ...button(card.id === openCardId), textAlign: 'left' }}
                data-card={card.id}
                onClick={() => setOpenCardId(card.id)}
              >
                {card.name}
              </button>
            ))}
          </>
        )}

        <div style={{ marginTop: '8px', color: 'var(--ph-muted)', fontSize: '11px' }}>
          The pack the app ships has {props.libraryAbilities.length} more, written in code rather than here.
        </div>
        <div style={{ marginTop: 'auto' }}>
          <button style={button(false)} data-testid="close-abilities" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, overflow: 'auto' }}>
        {openCard !== null ? (
          <CardDetail session={session} card={openCard} content={props.content} pack={props.pack} onChange={props.onChange} onScript={pickAbility} />
        ) : open === null ? (
          <div style={{ color: 'var(--ph-muted)' }}>
            Nothing selected. A card is its text plus a script; a card with no script is still a card — its
            holder reads it and the table decides.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                style={{ ...field, flex: 1 }}
                value={open.name}
                placeholder="name"
                data-testid="ability-name"
                onInput={(e) => reword({ name: (e.target as HTMLInputElement).value })}
              />
              <span style={{ color: 'var(--ph-muted)', alignSelf: 'center' }}>{open.id}</span>
            </div>

            <textarea
              style={{ ...field, width: '100%', minHeight: '46px', resize: 'vertical' }}
              value={open.text}
              placeholder="The card's text, as printed"
              data-testid="ability-text"
              onInput={(e) => reword({ text: (e.target as HTMLTextAreaElement).value })}
            />

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <GrantFields session={session} cardId={cardOf(open)} content={props.content} pack={props.pack} onChange={props.onChange} />
              {label(
                'is a',
                <select
                  style={{ ...field, width: '92px' }}
                  data-testid="ability-kind"
                  value={open.kind}
                  onChange={(e) => edit({ kind: (e.target as HTMLSelectElement).value as AbilityDef['kind'] })}
                >
                  <option value="action">action</option>
                  <option value="reaction">reaction</option>
                  <option value="passive">passive</option>
                </select>,
              )}
              {open.kind === 'reaction'
                ? label(
                    'when',
                    <select
                      style={{ ...field, width: '120px' }}
                      data-testid="ability-trigger"
                      value={open.trigger ?? 'incomingDamage'}
                      onChange={(e) => edit({ trigger: (e.target as HTMLSelectElement).value as AbilityDef['trigger'] })}
                    >
                      <option value="incomingDamage">damage comes in</option>
                      <option value="attackHit">an attack hits</option>
                      <option value="attackMissed">an attack misses</option>
                      {/* The same blow read three ways, all with whoever
                          dealt it bound as the target. */}
                      <option value="tookDamage">it takes damage</option>
                      <option value="tookHitPoints">it marks a Hit Point</option>
                      <option value="tookSevere">Severe damage lands</option>
                      <option value="allyTookDamage">someone on its side takes damage</option>
                      <option value="nearbyTookDamage">anyone else takes damage</option>
                      <option value="attacked">it is attacked, hit or miss</option>
                      <option value="partyRolled">a PC makes a roll</option>
                      <option value="spotlighted">it takes the spotlight</option>
                      {/* The other side of the table: what its own swing did. */}
                      <option value="dealtHit">its attack hits</option>
                      <option value="dealtDamage">its attack marks a Hit Point</option>
                      <option value="dealtMiss">its attack misses</option>
                      {/* Between the hit and the counting: what the room adds
                          to a blow before the defence reads it. */}
                      <option value="rollingDamage">its own damage is being counted</option>
                      <option value="allyRollingDamage">an ally's damage is being counted</option>
                    </select>,
                  )
                : null}
            </div>

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {label(
                'costs',
                <input
                  type="number"
                  min={0}
                  style={{ ...field, width: '50px' }}
                  data-testid="ability-good"
                  value={open.cost.good ?? 0}
                  onInput={(e) =>
                    edit({ cost: { ...open.cost, good: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
                  }
                />,
              )}
              <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Light</span>
              <input
                type="number"
                min={0}
                style={{ ...field, width: '50px' }}
                data-testid="ability-stress"
                value={open.cost.stress ?? 0}
                onInput={(e) =>
                  edit({ cost: { ...open.cost, stress: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
                }
              />
              <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Stress</span>
              <input
                type="number"
                min={0}
                style={{ ...field, width: '50px' }}
                data-testid="ability-bad"
                value={open.cost.bad ?? 0}
                onInput={(e) =>
                  edit({ cost: { ...open.cost, bad: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
                }
              />
              {/* The GM's pool: a stat block spends it, a card never can. */}
              <span style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>Shadow</span>
              {label(
                'aimed at',
                <select
                  style={{ ...field, width: '92px' }}
                  data-testid="ability-target-kind"
                  value={open.target.kind}
                  onChange={(e) =>
                    edit({ target: { ...open.target, kind: (e.target as HTMLSelectElement).value as AbilityDef['target']['kind'] } })
                  }
                >
                  <option value="none">nobody</option>
                  <option value="self">themselves</option>
                  <option value="adversary">an adversary</option>
                  <option value="ally">an ally</option>
                  <option value="creature">any creature</option>
                  <option value="group">a group</option>
                  <option value="point">a spot on the board</option>
                </select>,
              )}
              {label(
                'within',
                <select
                  style={{ ...field, width: '86px' }}
                  data-testid="ability-target-range"
                  value={open.target.range}
                  onChange={(e) => edit({ target: { ...open.target, range: (e.target as HTMLSelectElement).value as RangeBand } })}
                >
                  {BANDS.map((band) => (
                    <option key={band} value={band}>
                      {band}
                    </option>
                  ))}
                </select>,
              )}
            </div>

            {/* "A target with 3 or more bramble tokens": what makes a creature
                worth aiming at, asked of each of them in turn. */}
            {open.target.kind === 'none' || open.target.kind === 'self' ? null : (
              <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--ph-muted)', fontSize: '11px', paddingTop: '3px' }}>worth aiming at if</span>
                {open.target.when === undefined ? (
                  <button
                    style={{ ...field, fontSize: '11px', cursor: 'pointer' }}
                    data-testid="ability-target-gate"
                    onClick={() => edit({ target: { ...open.target, when: { kind: 'always' } } })}
                  >
                    anyone…
                  </button>
                ) : (
                  <>
                    <ConditionEditor
                      condition={open.target.when}
                      quests={props.quests}
                      encounterIds={props.encounterIds}
                      hookIds={props.hookIds}
                      onChange={(when) => edit({ target: { ...open.target, when } })}
                    />
                    <button
                      style={{ ...field, fontSize: '11px', cursor: 'pointer' }}
                      title="Aim at anyone in range"
                      onClick={() => {
                        const { when: _dropped, ...rest } = open.target;
                        edit({ target: rest });
                      }}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                <input
                  type="checkbox"
                  data-testid="ability-action"
                  checked={open.action}
                  onChange={(e) => edit({ action: (e.target as HTMLInputElement).checked })}
                />
                using it is their action
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                <input
                  type="checkbox"
                  data-testid="ability-in-combat"
                  checked={open.inCombatOnly}
                  onChange={(e) => edit({ inCombatOnly: (e.target as HTMLInputElement).checked })}
                />
                only in a fight
              </label>
              {/*
                What holding it does to damage coming in. Halving rounds up, and
                a creature that resists only one of two damage types resists
                neither, so both boxes are worth having.
              */}
              {(['physical', 'magic'] as const).map((type) => (
                <label
                  key={type}
                  style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}
                >
                  <input
                    type="checkbox"
                    data-testid={`ability-resist-${type}`}
                    checked={open.defenses?.resistances?.includes(type) === true}
                    onChange={(e) => {
                      const on = (e.target as HTMLInputElement).checked;
                      const kept = (open.defenses?.resistances ?? []).filter((t) => t !== type);
                      setDefenses({ resistances: on ? [...kept, type] : kept });
                    }}
                  />
                  resists {type}
                </label>
              ))}
              {/*
                And what it takes off the total before the thresholds are read:
                "reduce it by 3" or "reduce it by 1d10", which is one number
                either way. Empty means it reduces nothing.
              */}
              {label(
                'reduces by',
                <input
                  style={{ ...field, width: '64px' }}
                  data-testid="ability-reduce"
                  placeholder="3, 1d10"
                  value={reduction?.dice ?? ''}
                  onInput={(e) => {
                    const dice = (e.target as HTMLInputElement).value.trim();
                    setDefenses({
                      reduce:
                        dice === ''
                          ? []
                          : [{ dice, ...(reduction?.only === undefined ? {} : { only: reduction.only }) }],
                    });
                  }}
                />,
              )}
              {reduction === undefined
                ? null
                : label(
                    'of',
                    <select
                      style={{ ...field, width: '92px' }}
                      data-testid="ability-reduce-type"
                      value={reduction.only ?? 'any'}
                      onChange={(e) => {
                        const picked = (e.target as HTMLSelectElement).value;
                        setDefenses({
                          reduce: [
                            { dice: reduction.dice, ...(picked === 'any' ? {} : { only: picked as 'physical' | 'magic' }) },
                          ],
                        });
                      }}
                    >
                      <option value="any">any damage</option>
                      <option value="physical">physical</option>
                      <option value="magic">magic</option>
                    </select>,
                  )}
              {/* The swing a stat block prints, which no card has. */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                <input
                  type="checkbox"
                  data-testid="ability-direct-attack"
                  checked={open.standardAttack?.direct === true}
                  onChange={(e) =>
                    edit({
                      standardAttack: (e.target as HTMLInputElement).checked ? { direct: true } : undefined,
                    })
                  }
                />
                its attacks are direct
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: 'var(--ph-muted)' }}>
                <input
                  type="checkbox"
                  data-testid="ability-tokens"
                  checked={open.tokens !== undefined}
                  onChange={(e) =>
                    edit({
                      tokens: (e.target as HTMLInputElement).checked
                        ? { amount: 1, minimum: 0, refill: 'longRest' }
                        : undefined,
                    })
                  }
                />
                holds tokens
              </label>
              {open.tokens !== undefined ? (
                <>
                  <input
                    style={{ ...field, width: '84px' }}
                    data-testid="ability-token-amount"
                    title="A number, a trait, or spellcast"
                    value={String(open.tokens.amount)}
                    onInput={(e) => {
                      // A number or the name of a trait: "equal to your Spellcast trait".
                      const raw = (e.target as HTMLInputElement).value;
                      const asNumber = Number(raw);
                      const amount: TokenAmount =
                        raw !== '' && !Number.isNaN(asNumber) ? asNumber : (raw as TokenAmount);
                      edit({ tokens: { ...open.tokens!, amount } });
                    }}
                  />
                  <select
                    style={{ ...field, width: '96px' }}
                    data-testid="ability-token-refill"
                    value={open.tokens.refill}
                    onChange={(e) =>
                      edit({
                        tokens: { ...open.tokens!, refill: (e.target as HTMLSelectElement).value as 'session' },
                      })
                    }
                  >
                    <option value="session">each session</option>
                    <option value="longRest">each long rest</option>
                    <option value="rest">each rest</option>
                    <option value="scene">each scene</option>
                    <option value="never">never again</option>
                  </select>
                </>
              ) : null}
            </div>

            <div style={{ color: 'var(--ph-label)', fontSize: '11px' }}>What it does</div>
            <EffectList
              testId="ability-effects"
              effects={open.effects}
              onChange={(effects) => edit({ effects })}
              sceneIds={props.sceneIds}
              dialogueIds={props.dialogueIds}
              encounterIds={props.encounterIds}
              quests={props.quests}
              hookIds={props.hookIds}
              abilityIds={abilityIds}
              adversaryIds={props.adversaryIds}
            />
            {open.effects.length === 0 ? (
              <div style={{ color: 'var(--ph-muted)', fontSize: '11px' }}>
                No script: the card is shown as text and the table decides what it does.
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
