/**
 * The project's jump rules, as a form: what a step is, who jumps how far, what the roll is,
 * what a fall costs and what a bad landing leaves.
 *
 * Lives in the Tiles workspace because that is where height is made - a kind of tile is a
 * block or a floor or a flight of stairs, and this is what the game makes of how high they
 * stand. Every field writes through `setJumpRule`, so each is one undo step however it is
 * typed, and a project that never opens this says nothing and plays by the defaults.
 */

import { traitSchema } from '../../engine/scene/primitives';
import { DEFAULT_JUMP_RULES, jumpRange, jumpReach, jumpRulesSchema, safeDrop, type JumpRules } from '../../engine/rules/jump';
import { jumpRulesOf, resetJumpRules, setJumpRule } from '../jump-edits';
import type { EditorSession } from '../session';

const FIELD: Record<string, string | number> = { flex: 1, display: 'block', minWidth: 0 };
const CONTROL: Record<string, string | number> = { width: '100%', boxSizing: 'border-box' };

const TRAITS = traitSchema.options;

const title = (word: string): string => `${word[0]!.toUpperCase()}${word.slice(1)}`;

export function JumpRulesEditor(props: { session: EditorSession; onChange: () => void }): preact.JSX.Element {
  const { session } = props;
  const rules = jumpRulesOf(session.project);

  const set = <K extends keyof JumpRules>(key: K, value: JumpRules[K]): void => {
    // Through the schema first, so a number the rules would refuse never reaches the document.
    if (!jumpRulesSchema.shape[key].safeParse(value).success) return;
    session.run(setJumpRule(key, value));
    props.onChange();
  };

  const number = (key: 'stepHeight' | 'reachBase' | 'reachPerPoint' | 'rangeBase' | 'rangePerPoint' | 'difficulty' | 'dropBase' | 'dropPerPoint' | 'harderEvery' | 'fallDie', label: string, step: number): preact.JSX.Element => (
    <label class="ph-heading" style={FIELD}>
      {label}
      <input
        class="ph-input"
        style={CONTROL}
        type="number"
        step={step}
        min={0}
        data-testid={`jump-${key}`}
        value={rules[key]}
        onChange={(e) => {
          const typed = Number(e.currentTarget.value);
          if (e.currentTarget.value.trim() !== '' && Number.isFinite(typed)) set(key, typed);
        }}
      />
    </label>
  );

  const trait = (key: 'reachTrait' | 'rollTrait' | 'dropTrait', label: string): preact.JSX.Element => (
    <label class="ph-heading" style={FIELD}>
      {label}
      <select class="ph-input" style={CONTROL} data-testid={`jump-${key}`} value={rules[key]} onChange={(e) => set(key, e.currentTarget.value as JumpRules[typeof key])}>
        {TRAITS.map((id) => (
          <option key={id} value={id}>{title(id)}</option>
        ))}
      </select>
    </label>
  );

  // What the numbers come to, read back in the terms a table would use.
  const at = (points: number): Record<string, number> => Object.fromEntries(TRAITS.map((id) => [id, points]));
  const reach = [0, 1, 2].map((points) => jumpReach(rules, at(points) as never));
  const drop = [0, 1, 2].map((points) => safeDrop(rules, at(points) as never));
  const range = [0, 1, 2].map((points) => jumpRange(rules, at(points) as never));
  const conditions = session.project.conditionDefs;

  return (
    <div class="ph-workspace-body" data-testid="jump-rules">
      <div class="ph-row">
        <div class="ph-heading" style={{ flex: 1 }}>Height and jumping</div>
        <button class="ph-mini" data-testid="jump-reset" disabled={session.project.jump === undefined} onClick={() => { session.run(resetJumpRules()); props.onChange(); }}>
          Back to the defaults
        </button>
      </div>

      <label class="ph-row">
        <input type="checkbox" data-testid="jump-enabled" checked={rules.enabled} onChange={(e) => set('enabled', e.currentTarget.checked)} />
        <span>Characters can jump. Off, ground too high to step onto is simply out of reach.</span>
      </label>

      <div class="ph-row">{number('stepHeight', 'A step, in blocks', 0.01)}</div>
      <div class="ph-note">
        The most a walk climbs or drops in one step. A floor tile is a quarter of a block, stairs
        stand you at five eighths, a block is one. {DEFAULT_JUMP_RULES.stepHeight} takes half a block and not
        three quarters, which is a block stood beside a floor tile. Takes hold when play is next entered.
      </div>

      <div class="ph-row">
        {trait('reachTrait', 'Jumping up is')}
        {number('reachBase', 'Blocks at 0 or less', 0.25)}
        {number('reachPerPoint', 'More per point', 0.25)}
      </div>
      <div class="ph-note" data-testid="jump-reach-readout">
        {title(rules.reachTrait)} 0 jumps {reach[0]}, +1 jumps {reach[1]}, +2 jumps {reach[2]}.
      </div>

      <div class="ph-row">
        {number('rangeBase', 'Tiles across at 0 or less', 0.5)}
        {number('rangePerPoint', 'More per point', 0.5)}
      </div>
      <div class="ph-note" data-testid="jump-range-readout">
        A jump is aimed from where they stand, along an arc, to anywhere this near - level ground
        included. {title(rules.reachTrait)} 0 carries {range[0]} tiles, +1 carries {range[1]}, +2 carries {range[2]}. What
        stands higher than the arc is in its way; people are not.
      </div>

      <div class="ph-row">
        {trait('rollTrait', 'The roll is')}
        {number('difficulty', 'Difficulty', 1)}
      </div>
      <label class="ph-row">
        <input type="checkbox" data-testid="jump-flatRoll" checked={rules.flatRoll} onChange={(e) => set('flatRoll', e.currentTarget.checked)} />
        <span>A jump across level ground is rolled for too. Off, only a climb or a fall past safe is.</span>
      </label>

      <div class="ph-row">
        {trait('dropTrait', 'Dropping is')}
        {number('dropBase', 'Safe blocks at 0 or less', 0.25)}
        {number('dropPerPoint', 'More per point', 0.25)}
      </div>
      <div class="ph-note" data-testid="jump-drop-readout">
        {title(rules.dropTrait)} 0 drops {drop[0]} unhurt, +1 drops {drop[1]}, +2 drops {drop[2]}. Past that the fall is rolled for.
      </div>

      <div class="ph-row">
        {number('harderEvery', 'Difficulty +1 every (blocks past safe; 0 never)', 0.5)}
        {number('fallDie', 'Die per block past safe (0 none)', 1)}
      </div>
      <label class="ph-row">
        <input type="checkbox" data-testid="jump-halfOnSuccess" checked={rules.halfOnSuccess} onChange={(e) => set('halfOnSuccess', e.currentTarget.checked)} />
        <span>A success halves the fall.</span>
      </label>

      <div class="ph-row">
        <label class="ph-heading" style={FIELD}>
          A failure lands them
          <select class="ph-input" style={CONTROL} data-testid="jump-failCondition" value={rules.failCondition} onChange={(e) => set('failCondition', e.currentTarget.value)}>
            <option value="">on their feet</option>
            {/* One the project no longer has is still shown, or the select would quietly say something else. */}
            {rules.failCondition !== '' && !conditions.some((def) => def.id === rules.failCondition) && <option value={rules.failCondition}>{rules.failCondition} (missing)</option>}
            {conditions.map((def) => (
              <option key={def.id} value={def.id}>{def.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div class="ph-note">They land either way. The roll decides how.</div>
    </div>
  );
}
