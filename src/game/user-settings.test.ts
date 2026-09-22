import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_SETTINGS, USER_SETTINGS_KEY, onUserSettings, reloadUserSettings, setUserSetting, userSettingSections, userSettings, userSettingsSchema } from './user-settings';

/** A `localStorage` that is a Map, which is all the settings ask of one. */
function fakeStorage(seed: Record<string, string> = {}): Storage {
  const kept = new Map(Object.entries(seed));
  return {
    get length() {
      return kept.size;
    },
    clear: () => kept.clear(),
    getItem: (key: string) => kept.get(key) ?? null,
    key: (index: number) => [...kept.keys()][index] ?? null,
    removeItem: (key: string) => void kept.delete(key),
    setItem: (key: string, value: string) => void kept.set(key, value),
  };
}

describe('the settings a player keeps in their browser', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    reloadUserSettings();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    reloadUserSettings();
  });

  it('start as the defaults: jumps are asked about, not rolled for them', () => {
    expect(userSettings()).toEqual({ autoRollJumps: false });
    expect(userSettingsSchema.parse({})).toEqual(userSettings());
  });

  it('are kept when changed, and are there when the page comes back', () => {
    setUserSetting('autoRollJumps', true);
    expect(userSettings().autoRollJumps).toBe(true);
    expect(JSON.parse(localStorage.getItem(USER_SETTINGS_KEY)!)).toEqual({ autoRollJumps: true });
    // The page again: nothing in memory, everything in the browser.
    expect(reloadUserSettings()).toEqual({ autoRollJumps: true });
  });

  it('tell whoever is showing them, until they stop listening', () => {
    const heard: boolean[] = [];
    const stop = onUserSettings((settings) => heard.push(settings.autoRollJumps));
    setUserSetting('autoRollJumps', true);
    stop();
    setUserSetting('autoRollJumps', false);
    expect(heard).toEqual([true]);
  });

  it('come back as the defaults from anything unreadable, and keep what is readable of the rest', () => {
    for (const kept of ['not json', '[]', '{"autoRollJumps":"yes"}', 'null']) {
      vi.stubGlobal('localStorage', fakeStorage({ [USER_SETTINGS_KEY]: kept }));
      expect(reloadUserSettings()).toEqual({ autoRollJumps: false });
    }
    vi.stubGlobal('localStorage', fakeStorage({ [USER_SETTINGS_KEY]: '{"autoRollJumps":true,"somethingOlder":3}' }));
    expect(reloadUserSettings()).toEqual({ autoRollJumps: true });
  });

  it('hold for the page when the browser will not keep them', () => {
    vi.stubGlobal('localStorage', { ...fakeStorage(), setItem: () => { throw new Error('quota'); } });
    reloadUserSettings();
    expect(() => setUserSetting('autoRollJumps', true)).not.toThrow();
    expect(userSettings().autoRollJumps).toBe(true);
    vi.stubGlobal('localStorage', undefined);
    expect(reloadUserSettings()).toEqual({ autoRollJumps: false });
  });

  it('describe every setting the schema has, once, so the form can draw it', () => {
    expect(USER_SETTINGS.map((def) => def.key).sort()).toEqual(Object.keys(userSettingsSchema.shape).sort());
    for (const def of USER_SETTINGS) {
      expect(def.name).not.toBe('');
      expect(def.about).not.toBe('');
      // A switch is a switch over a yes or a no.
      if (def.kind === 'toggle') expect(typeof userSettingsSchema.parse({})[def.key]).toBe('boolean');
    }
  });

  it('group them under headings, in the order the headings first appear', () => {
    const sections = userSettingSections();
    expect(sections.map((entry) => entry.section)).toEqual([...new Set(USER_SETTINGS.map((def) => def.section))]);
    expect(sections.flatMap((entry) => entry.settings)).toHaveLength(USER_SETTINGS.length);
    expect(sections[0]).toMatchObject({ section: 'Dice', settings: [{ key: 'autoRollJumps' }] });
  });
});
