import { describe, expect, it } from 'vitest';
import { ESCAPE_IS_TAKEN, escapeIsTaken, typingIn } from './SettingsModal';

/** A page with these things on it, as far as `querySelector` over a list of selectors can tell. */
const pageWith = (...present: string[]): ParentNode =>
  ({ querySelector: (selectors: string) => (selectors.split(',').some((selector) => present.includes(selector)) ? {} : null) }) as unknown as ParentNode;

describe('whose Escape it is', () => {
  it('is the settings\u2019 when nothing on the page would be put down by it', () => {
    expect(escapeIsTaken(pageWith())).toBe(false);
    expect(escapeIsTaken(pageWith('[data-testid="save-row"]'))).toBe(false);
  });

  it('belongs to whatever Escape already closes, while that is up', () => {
    for (const open of ['[data-testid="loadout-backdrop"]', '[data-testid="rest"]', '[data-testid="cancel-targeting"]', '[data-testid="inspect"]', '.roll-backdrop', '[data-testid="level-up"]', '[data-testid="friends-sheet"]']) {
      expect(ESCAPE_IS_TAKEN.split(',')).toContain(open);
      expect(escapeIsTaken(pageWith(open))).toBe(true);
    }
  });

  it('is the settings’ in a conversation, and over a shop: Escape closes neither', () => {
    expect(escapeIsTaken(pageWith('[data-testid="dialogue"]', '[data-testid="shop-backdrop"]', '[data-testid="container"]'))).toBe(false);
  });

  it('is a field’s while something is typed in it, and the settings’ on a switch or a button', () => {
    for (const typed of [{ tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'DIV', isContentEditable: true }]) {
      expect(typingIn(typed as unknown as EventTarget)).toBe(true);
    }
    for (const untyped of [{ tagName: 'INPUT', type: 'checkbox' }, { tagName: 'INPUT', type: 'range' }, { tagName: 'BUTTON' }, { tagName: 'DIV', isContentEditable: false }, {}, null]) {
      expect(typingIn(untyped as unknown as EventTarget)).toBe(false);
    }
  });
});
