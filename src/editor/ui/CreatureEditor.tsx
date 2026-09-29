/**
 * The creature picked to place, in the Encounters side: what it is, and - for one of the project's
 * own - every number on its stat block, to change.
 *
 * Any creature can be copied as a new one (**Copy as new**, `copyOfAdversary`): the copy is the
 * project's, picked at once to place, and its fields are here to change. A creature the build ships
 * is only copied, never changed in place - a copy of it under its own id would stand in for it
 * everywhere, which is not what making another creature means. A change is made only when the
 * creature it leaves still parses as a stat block (`adversaryDefSchema`), so no field can be left in a
 * state that would not fight; one that would not is refused, with the reason.
 */

import { useState } from 'preact/hooks';
import type { AdversaryDef } from '../../engine/content/types';
import { adversaryDefSchema, adversaryRoleSchema } from '../../engine/content/pack/schema';
import { RANGE_BANDS, bandLabel } from '../../engine/rules/range';
import { addAdversaryDef, copyOfAdversary, removeAdversaryDef, updateAdversaryDef, type ProjectAdversary } from '../adversary-edits';
import type { EditorController } from '../controller';
import type { EditorSession } from '../session';

/** The dice a damage roll can use. */
const DIE_SIDES = [4, 6, 8, 10, 12, 20] as const;
const TIERS = [1, 2, 3, 4] as const;
const role = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);
/** The fields as the stat block names them, for saying which one a change was refused on. */
const FIELD_NAMES: Readonly<Record<string, string>> = {
  name: 'Name', difficulty: 'Difficulty', hitPoints: 'Hit Points', stress: 'Stress', thresholds: 'Thresholds',
  attackName: 'Attack', attackModifier: 'To hit', attackDamage: 'Damage', description: 'Description',
};

export function PickedCreature(props: {
  session: EditorSession;
  controller: EditorController;
  creatures: readonly AdversaryDef[];
  onChange: () => void;
}): preact.JSX.Element | null {
  const { session, controller } = props;
  const [refused, setRefused] = useState<string | null>(null);
  if (controller.state.tool !== 'adversary') return null;
  const picked = props.creatures.find((def) => def.id === controller.state.adversaryId);
  if (picked === undefined) return null;
  const own = session.project.adversaries.find((def) => def.id === picked.id);

  const copy = (): void => {
    const taken = new Set(props.creatures.map((def) => def.id));
    const made = copyOfAdversary(structuredClone(picked) as ProjectAdversary, taken);
    // Drawn as the original is: the model its type is pointed at, or the one named for its id.
    session.run(addAdversaryDef(made, session.project.adversaryModels[picked.id] ?? picked.id));
    controller.set('adversaryId', made.id);
    setRefused(null);
    props.onChange();
  };

  /** Change the creature, when what it leaves is still a whole stat block. */
  const change = (changes: Partial<Omit<ProjectAdversary, 'id'>>): void => {
    if (own === undefined) return;
    const checked = adversaryDefSchema.safeParse({ ...own, ...changes });
    if (!checked.success) {
      const issue = checked.error.issues[0];
      const field = FIELD_NAMES[String(issue?.path[0] ?? '')] ?? 'That';
      setRefused(`${field} ${issue?.code === 'too_small' ? 'is too small' : issue?.code === 'too_big' ? 'is too large' : 'is not a value a stat block can have'}`);
      return;
    }
    setRefused(null);
    session.run(updateAdversaryDef(own.id, changes));
    props.onChange();
  };
  const whole = (value: string): number => (value.trim() === '' ? Number.NaN : Math.trunc(Number(value)));

  return (
    <div data-testid="picked-creature">
      <div class="ph-heading">Creature to place</div>
      <div class="ph-hint" data-testid="picked-creature-name">
        {picked.name} · Tier {picked.tier} · {role(picked.role)}{own === undefined ? '' : ' · this project’s own'}
      </div>
      <button type="button" class="ph-button" data-testid="copy-creature" onClick={copy} title="Make a new creature of the project's own, starting from this one">
        Copy as new
      </button>
      {own === undefined ? (
        <div class="ph-hint">Copy it to make a creature of your own from it, and change its numbers.</div>
      ) : (
        <div data-testid="creature-editor">
          <label class="ph-heading">
            Name
            <input class="ph-input" data-testid="creature-name" value={own.name} onInput={(e) => change({ name: e.currentTarget.value })} />
          </label>
          <div class="ph-row">
            <label class="ph-heading">
              Tier
              <select class="ph-select" data-testid="creature-tier" value={own.tier} onChange={(e) => change({ tier: Number(e.currentTarget.value) as 1 | 2 | 3 | 4 })}>
                {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
              </select>
            </label>
            <label class="ph-heading">
              Role
              <select class="ph-select" data-testid="creature-role" value={own.role} onChange={(e) => change({ role: e.currentTarget.value as ProjectAdversary['role'] })}>
                {adversaryRoleSchema.options.map((id) => <option key={id} value={id}>{role(id)}</option>)}
              </select>
            </label>
          </div>
          <div class="ph-row">
            <label class="ph-heading">
              Difficulty
              <input class="ph-input" type="number" min={1} data-testid="creature-difficulty" value={own.difficulty} onChange={(e) => change({ difficulty: whole(e.currentTarget.value) })} />
            </label>
            <label class="ph-heading">
              Hit Points
              <input class="ph-input" type="number" min={1} data-testid="creature-hp" value={own.hitPoints} onChange={(e) => change({ hitPoints: whole(e.currentTarget.value) })} />
            </label>
            <label class="ph-heading">
              Stress
              <input class="ph-input" type="number" min={0} data-testid="creature-stress" value={own.stress} onChange={(e) => change({ stress: whole(e.currentTarget.value) })} />
            </label>
          </div>
          <div class="ph-row">
            <label class="ph-heading">
              Major
              <input class="ph-input" type="number" min={0} data-testid="creature-major" value={own.thresholds.major} onChange={(e) => change({ thresholds: { ...own.thresholds, major: whole(e.currentTarget.value) } })} />
            </label>
            <label class="ph-heading">
              Severe
              <input class="ph-input" type="number" min={0} data-testid="creature-severe" value={own.thresholds.severe} onChange={(e) => change({ thresholds: { ...own.thresholds, severe: whole(e.currentTarget.value) } })} />
            </label>
          </div>
          <label class="ph-heading">
            Attack
            <input class="ph-input" data-testid="creature-attack" value={own.attackName} onInput={(e) => change({ attackName: e.currentTarget.value })} />
          </label>
          <div class="ph-row">
            <label class="ph-heading">
              To hit
              <input class="ph-input" type="number" data-testid="creature-to-hit" value={own.attackModifier.modifier} onChange={(e) => change({ attackModifier: { count: 0, sides: 0, modifier: whole(e.currentTarget.value) } })} />
            </label>
            <label class="ph-heading">
              Range
              <select class="ph-select" data-testid="creature-range" value={own.attackRange} onChange={(e) => change({ attackRange: e.currentTarget.value as ProjectAdversary['attackRange'] })}>
                {RANGE_BANDS.filter((band) => band !== 'outOfRange').map((band) => <option key={band} value={band}>{bandLabel(band)}</option>)}
              </select>
            </label>
          </div>
          <div class="ph-row">
            <label class="ph-heading">
              Damage dice
              <input class="ph-input" type="number" min={0} data-testid="creature-damage-count" value={own.attackDamage.count} onChange={(e) => change({ attackDamage: { ...own.attackDamage, count: whole(e.currentTarget.value), sides: whole(e.currentTarget.value) === 0 ? 0 : own.attackDamage.sides || 6 } })} />
            </label>
            <label class="ph-heading" style={{ flex: '0 0 76px' }}>
              d
              <select class="ph-select" style={{ minWidth: '70px' }} data-testid="creature-damage-sides" value={own.attackDamage.sides} disabled={own.attackDamage.count === 0} onChange={(e) => change({ attackDamage: { ...own.attackDamage, sides: Number(e.currentTarget.value) } })}>
                {own.attackDamage.count === 0 ? <option value={0}>-</option> : null}
                {DIE_SIDES.map((sides) => <option key={sides} value={sides}>{sides}</option>)}
              </select>
            </label>
            <label class="ph-heading">
              +
              <input class="ph-input" type="number" data-testid="creature-damage-bonus" value={own.attackDamage.modifier} onChange={(e) => change({ attackDamage: { ...own.attackDamage, modifier: whole(e.currentTarget.value) } })} />
            </label>
          </div>
          <label class="ph-heading">
            Damage type
            <select class="ph-select" data-testid="creature-damage-type" value={own.attackDamage.types?.[0] ?? 'physical'} onChange={(e) => change({ attackDamage: { ...own.attackDamage, types: [e.currentTarget.value as 'physical' | 'magic'] } })}>
              <option value="physical">Physical</option>
              <option value="magic">Magic</option>
            </select>
          </label>
          <label class="ph-heading">
            Description
            <textarea class="ph-input" rows={3} data-testid="creature-description" value={own.description} onInput={(e) => change({ description: e.currentTarget.value })} />
          </label>
          {refused === null ? null : <div class="ph-note" role="alert" data-testid="creature-refused">Not changed - {refused}.</div>}
          <div class="ph-hint">Its features ({own.features.length}) come with the copy; place it from the strip below, where it is listed under its tier.</div>
          <button
            type="button"
            class="ph-button"
            data-testid="remove-creature"
            onClick={() => {
              if (!confirm(`Delete the creature "${own.name}"? Any already placed stay, with no stat block, until they are removed.`)) return;
              session.run(removeAdversaryDef(own.id));
              setRefused(null);
              props.onChange();
            }}
          >
            Delete creature
          </button>
        </div>
      )}
    </div>
  );
}
