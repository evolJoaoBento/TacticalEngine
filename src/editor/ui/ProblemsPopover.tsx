/**
 * What Check found: errors first, then warnings, in the validator's own words.
 */

import { summarise, type Problem } from '../validate';
import { Icon } from './icons';

export function ProblemsPopover(props: { problems: readonly Problem[]; onClose: () => void }): preact.JSX.Element {
  const sorted = [...props.problems].sort(
    (a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  );
  return (
    <div class="ph-popover ph-panel" data-testid="problems">
      <div class="ph-popover-head">
        <strong>{summarise(props.problems)}</strong>
        <button class="ph-mini" aria-label="Close" onClick={props.onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <ul>
        {sorted.slice(0, 30).map((problem, i) => (
          <li key={i} class={problem.severity === 'error' ? 'ph-bad' : 'ph-warm'}>
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
