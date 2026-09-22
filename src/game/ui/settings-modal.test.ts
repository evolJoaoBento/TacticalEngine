import { describe, expect, it } from 'vitest';
import { ESCAPE_IS_TAKEN, escapeIsTaken } from './SettingsModal';

/** A page with these things on it, as far as `querySelector` over a list of selectors can tell. */
const pageWith = (...present: string[]): ParentNode =>
  ({ querySelector: (selectors: string) => (selectors.split(',').some((selector) => present.includes(selector)) ? {} : null) }) as unknown as ParentNode;

describe('whose Escape it is', () => {
  it('is the settings\u2019 when nothing on the page would be put down by it', () => {
    expect(escapeIsTaken(pageWith())).toBe(false);
    expect(escapeIsTaken(pageWith('[data-testid="save-row"]'))).toBe(false);
  });

  it('belongs to whatever Escape already closes, while that is up', () => {
    for (const open of ['[data-testid="loadout-backdrop"]', '[data-testid="rest"]', '[data-testid="cancel-targeting"]', '[data-testid="inspect"]', '.roll-backdrop', '[data-testid="level-up"]', '[data-testid="dialogue"]']) {
      expect(ESCAPE_IS_TAKEN.split(',')).toContain(open);
      expect(escapeIsTaken(pageWith(open))).toBe(true);
    }
  });
});
