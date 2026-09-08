/**
 * Choosing who an effect lands on.
 *
 * Every combat effect takes the same `TargetSelector`, so it is one row here
 * rather than a different set of fields on each effect. The kinds that read as
 * a phrase — "the chosen target", "everyone the roll beat" — say so, and the
 * ones that need a detail (a range band, whether the chosen target is left out)
 * grow the fields for it and nothing more.
 *
 * A selector left unset is not the same as `target`: each effect has its own
 * default (damage falls to `hit`, healing to the actor), so "— default —" is
 * an option and the field is deleted rather than filled in.
 */

import type { TargetSelector } from '../../engine/script/schema';
import { RANGE_BANDS, type RangeBand } from '../../engine/rules/range';

/** The bands an author can pick: `outOfRange` is a reading, not a target. */
const BANDS = RANGE_BANDS.filter((band) => band !== 'outOfRange');

export interface TargetEditorProps {
  selector: TargetSelector | undefined;
  onChange: (selector: TargetSelector | undefined) => void;
  /** What the default reads as when nothing is chosen: "hit", "the actor". */
  fallback: string;
  testId?: string;
}

/** The kinds, in the order an author reaches for them. */
const KINDS = [
  ['target', 'the chosen target'],
  ['hit', 'everyone the roll beat'],
  ['actor', 'the one acting'],
  ['party', 'the whole party'],
  ['allies', 'allies in range'],
  ['adversaries', 'adversaries in range'],
  ['inPath', 'everything the run went through'],
  ['entity', 'one named creature'],
  ['entities', 'named creatures'],
] as const;

const field: Record<string, string | number> = {
  minWidth: 0,
  padding: '2px 4px',
  background: '#1b1f28',
  color: 'inherit',
  border: '1px solid #39404d',
  borderRadius: '3px',
  font: 'inherit',
  fontSize: '11px',
};

/** A starting value for each kind, so switching never produces an invalid one. */
function blank(kind: TargetSelector['kind']): TargetSelector {
  switch (kind) {
    case 'entity':
      return { kind, id: '' };
    case 'entities':
      return { kind, ids: [] };
    case 'adversaries':
      return { kind, range: 'veryClose' };
    case 'inPath':
      return { kind, side: 'adversaries' };
    default:
      return { kind } as TargetSelector;
  }
}

export function TargetEditor(props: TargetEditorProps): preact.JSX.Element {
  const { selector, onChange } = props;

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }} data-testid={props.testId}>
      <select
        style={field}
        data-role="target-kind"
        value={selector?.kind ?? ''}
        onChange={(e) => {
          const kind = (e.target as HTMLSelectElement).value;
          onChange(kind === '' ? undefined : blank(kind as TargetSelector['kind']));
        }}
      >
        <option value="">— {props.fallback} —</option>
        {KINDS.map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>

      {selector?.kind === 'adversaries' || selector?.kind === 'allies' ? (
        <select
          style={field}
          data-role="target-range"
          value={selector.range ?? ''}
          onChange={(e) => {
            const range = (e.target as HTMLSelectElement).value;
            // Adversaries always need a band; allies without one means everywhere.
            if (range === '' && selector.kind === 'allies') {
              const { range: _dropped, ...rest } = selector;
              onChange(rest);
            } else if (range !== '') {
              onChange({ ...selector, range: range as RangeBand });
            }
          }}
        >
          {selector.kind === 'allies' ? <option value="">anywhere</option> : null}
          {BANDS.map((band) => (
            <option key={band} value={band}>
              {band}
            </option>
          ))}
        </select>
      ) : null}

      {selector?.kind === 'adversaries' ? (
        <>
          <select
            style={field}
            data-role="target-around"
            title="Measured from the one acting, from the chosen target, or from the tile that was aimed at"
            value={selector.around ?? 'actor'}
            onChange={(e) => {
              const around = (e.target as HTMLSelectElement).value as 'actor' | 'target' | 'point';
              onChange(around === 'actor' ? { ...selector, around: undefined } : { ...selector, around });
            }}
          >
            <option value="actor">around the actor</option>
            <option value="target">around the target</option>
            <option value="point">around the spot aimed at</option>
          </select>
          {/* A creature is within Melee of itself, so "another one of these"
              has to say whom it is leaving out. */}
          <select
            style={field}
            data-role="target-except"
            title="Leave somebody out: the chosen target, or the one acting"
            value={selector.except ?? ''}
            onChange={(e) => {
              const except = (e.target as HTMLSelectElement).value;
              onChange({ ...selector, except: except === '' ? undefined : (except as 'target' | 'actor') });
            }}
          >
            <option value="">everyone in the band</option>
            <option value="target">all other than the target</option>
            <option value="actor">all other than the one acting</option>
          </select>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: '#8ea3b0' }}>
            <input
              type="checkbox"
              data-role="target-same-kind"
              checked={selector.sameKind === true}
              onChange={(e) =>
                onChange({ ...selector, sameKind: (e.target as HTMLInputElement).checked ? true : undefined })
              }
            />
            off the same stat block
          </label>
        </>
      ) : null}

      {selector?.kind === 'inPath' ? (
        <>
          <select
            style={field}
            data-role="path-side"
            title="Which side the run catches"
            value={selector.side ?? ''}
            onChange={(e) => {
              const side = (e.target as HTMLSelectElement).value;
              onChange({ ...selector, side: side === '' ? undefined : (side as 'adversaries' | 'allies') });
            }}
          >
            <option value="">everybody it passes</option>
            <option value="adversaries">adversaries it passes</option>
            <option value="allies">allies it passes</option>
          </select>
          <select
            style={field}
            data-role="path-reach"
            title="How far off the line it reaches. The line starts a tile along: what stands beside the one charging is behind them, not in the way."
            value={selector.reach === 'weapon' ? 'weapon' : (selector.range ?? '')}
            onChange={(e) => {
              const picked = (e.target as HTMLSelectElement).value;
              if (picked === 'weapon') onChange({ ...selector, reach: 'weapon', range: undefined });
              else onChange({ ...selector, reach: undefined, range: picked === '' ? undefined : (picked as RangeBand) });
            }}
          >
            <option value="">the line and its edges</option>
            {BANDS.map((band) => (
              <option key={band} value={band}>
                within {band} of the line
              </option>
            ))}
            <option value="weapon">within the weapon's reach</option>
          </select>
        </>
      ) : null}

      {selector?.kind === 'allies' ? (
        <select
          style={field}
          data-role="allies-around"
          title="Measured from the one acting, or from the tile that was aimed at"
          value={selector.around ?? 'actor'}
          onChange={(e) => {
            const around = (e.target as HTMLSelectElement).value as 'actor' | 'point';
            onChange(around === 'actor' ? { ...selector, around: undefined } : { ...selector, around });
          }}
        >
          <option value="actor">around the actor</option>
          <option value="point">around the spot aimed at</option>
        </select>
      ) : null}

      {selector?.kind === 'allies' ? (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', fontSize: '11px', color: '#8ea3b0' }}>
          <input
            type="checkbox"
            data-role="target-self"
            checked={selector.includeSelf === true}
            onChange={(e) =>
              onChange({ ...selector, includeSelf: (e.target as HTMLInputElement).checked ? true : undefined })
            }
          />
          and themselves
        </label>
      ) : null}

      {selector?.kind === 'hit' ? (
        <input
          style={{ ...field, width: '90px' }}
          data-role="target-having"
          placeholder="…who are (condition)"
          value={selector.having ?? ''}
          onInput={(e) => {
            const having = (e.target as HTMLInputElement).value;
            onChange(having === '' ? { kind: 'hit' } : { kind: 'hit', having });
          }}
        />
      ) : null}

      {selector?.kind === 'entity' ? (
        <input
          style={{ ...field, width: '110px' }}
          data-role="target-id"
          placeholder="creature id"
          value={selector.id}
          onInput={(e) => onChange({ kind: 'entity', id: (e.target as HTMLInputElement).value })}
        />
      ) : null}

      {selector?.kind === 'entities' ? (
        <input
          style={{ ...field, width: '140px' }}
          data-role="target-ids"
          placeholder="creature ids, comma separated"
          value={selector.ids.join(', ')}
          onInput={(e) =>
            onChange({
              kind: 'entities',
              ids: (e.target as HTMLInputElement).value
                .split(',')
                .map((id) => id.trim())
                .filter((id) => id !== ''),
            })
          }
        />
      ) : null}
    </span>
  );
}
