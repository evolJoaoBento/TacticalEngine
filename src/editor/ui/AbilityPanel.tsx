/**
 * The Cards panel: what a character can do, as a project can write it.
 *
 * A card is a name, its printed text, what it costs, who it can be aimed at,
 * and a script — and the script is the same effect list every other panel
 * edits, so this panel is mostly the fields around it. The engine's own SRD
 * cards are listed beside the project's, greyed, so an author can see what a
 * card looks like without a JSON file open; they are not editable here,
 * because the SRD library is code the engine ships.
 *
 * A card written here is `granted`: it names the characters who hold it,
 * rather than a domain the deck deals from.
 */

import { useState } from 'preact/hooks';
import type { EditorSession } from '../session';
import { addAbility, removeAbility, updateAbility } from '../session';
import { abilitySchema, type AbilityDef } from '../../engine/content/abilities';
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

export function AbilityPanel(props: AbilityPanelProps): preact.JSX.Element {
  const { session } = props;
  const [openId, setOpenId] = useState<string | null>(session.project.abilities[0]?.id ?? null);
  const open = session.project.abilities.find((a) => a.id === openId) ?? null;

  const edit = (changes: Partial<AbilityDef>): void => {
    if (open === null) return;
    session.run(updateAbility(open.id, changes));
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
              style={{ ...button(ability.id === openId), flex: 1, textAlign: 'left' }}
              data-ability={ability.id}
              onClick={() => setOpenId(ability.id)}
            >
              {ability.name}
            </button>
            <button
              style={button(false)}
              title="Delete this card"
              onClick={() => {
                if (!confirm(`Delete "${ability.name}"?`)) return;
                session.run(removeAbility(ability.id));
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
            if (id === '' || session.project.abilities.some((a) => a.id === id)) return;
            session.run(
              addAbility(
                abilitySchema.parse({ id, name: typed, source: { kind: 'granted', characters: [] } }),
              ),
            );
            setOpenId(id);
            props.onChange();
          }}
        >
          + Card
        </button>

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
        {open === null ? (
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
                onInput={(e) => edit({ name: (e.target as HTMLInputElement).value })}
              />
              <span style={{ color: 'var(--ph-muted)', alignSelf: 'center' }}>{open.id}</span>
            </div>

            <textarea
              style={{ ...field, width: '100%', minHeight: '46px', resize: 'vertical' }}
              value={open.text}
              placeholder="The card's text, as printed"
              data-testid="ability-text"
              onInput={(e) => edit({ text: (e.target as HTMLTextAreaElement).value })}
            />

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              {label(
                'held by',
                <input
                  style={{ ...field, width: '150px' }}
                  data-testid="ability-characters"
                  placeholder="character ids, comma separated"
                  value={open.source.kind === 'granted' ? open.source.characters.join(', ') : ''}
                  disabled={open.source.kind !== 'granted'}
                  onInput={(e) =>
                    edit({
                      source: {
                        kind: 'granted',
                        characters: (e.target as HTMLInputElement).value
                          .split(',')
                          .map((id) => id.trim())
                          .filter((id) => id !== ''),
                      },
                    })
                  }
                />,
              )}
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
                  data-testid="ability-hope"
                  value={open.cost.hope ?? 0}
                  onInput={(e) =>
                    edit({ cost: { ...open.cost, hope: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
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
                data-testid="ability-fear"
                value={open.cost.fear ?? 0}
                onInput={(e) =>
                  edit({ cost: { ...open.cost, fear: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) } })
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
