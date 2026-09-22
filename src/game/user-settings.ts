/**
 * The player's own settings: how they like the game to behave, kept in their browser.
 *
 * Not the project's and not the save's. A project says what the rules are and a save says
 * where a campaign stands; this is the person at the keyboard, and it follows them from one
 * campaign to the next on the same machine. One `localStorage` key holding one small object,
 * read through a schema so a setting added later, or a value mangled by hand, comes back as
 * its default rather than as a crash.
 *
 * Where there is no `localStorage` - a test, a private window that refuses it - the settings
 * live in memory for as long as the page does, which is all the game needs of them.
 */

import { z } from 'zod';

export const userSettingsSchema = z.object({
  /**
   * Throw the dice for a jump without stopping to ask. The roll is still made, shown and
   * logged, and still costs what it costs; only the prompt between the click and the dice goes.
   */
  autoRollJumps: z.boolean().default(false),
});

export type UserSettings = z.infer<typeof userSettingsSchema>;

/** The settings of one kind: the keys whose value is that type. */
type KeysOf<T> = { [K in keyof UserSettings]: UserSettings[K] extends T ? K : never }[keyof UserSettings];

/**
 * A setting as the page draws it: which value it is, under which heading, what it is called
 * and what it does - and what kind of control it wants.
 *
 * One kind today, a switch. The next kind is another member of this union and another case in
 * the form, and nothing else: the form is drawn from the list below, so a setting is added by
 * giving it a default in the schema and an entry here.
 */
export type UserSettingDef = {
  kind: 'toggle';
  key: KeysOf<boolean>;
  section: string;
  name: string;
  about: string;
};

/** Every setting there is, in the order the form shows them; a section is shown where it is first named. */
export const USER_SETTINGS: readonly UserSettingDef[] = [
  {
    kind: 'toggle',
    key: 'autoRollJumps',
    section: 'Dice',
    name: 'Roll jumps automatically',
    about: 'Throw the dice for a jump at once, without the prompt. The roll is still made and logged, and the jump is drawn at once.',
  },
];

/** The settings under their headings, headings in the order they first appear. */
export function userSettingSections(): { section: string; settings: UserSettingDef[] }[] {
  const sections: { section: string; settings: UserSettingDef[] }[] = [];
  for (const def of USER_SETTINGS) {
    const found = sections.find((entry) => entry.section === def.section);
    if (found === undefined) sections.push({ section: def.section, settings: [def] });
    else found.settings.push(def);
  }
  return sections;
}

export const USER_SETTINGS_KEY = 'tactical-engine:user-settings';

type Listener = (settings: UserSettings) => void;

const listeners = new Set<Listener>();
let current: UserSettings | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // A browser that throws on the very mention of it: no storage, and the game goes on.
    return null;
  }
}

/** Read what is kept, whatever state it is in: anything unreadable is the defaults. */
function load(): UserSettings {
  try {
    const raw = storage()?.getItem(USER_SETTINGS_KEY) ?? null;
    const parsed = userSettingsSchema.safeParse(raw === null ? {} : JSON.parse(raw));
    return parsed.success ? parsed.data : userSettingsSchema.parse({});
  } catch {
    return userSettingsSchema.parse({});
  }
}

/** The settings as they stand. */
export function userSettings(): UserSettings {
  current ??= load();
  return current;
}

/** Change one setting, keep it, and tell whoever is showing it. */
export function setUserSetting<K extends keyof UserSettings>(key: K, value: UserSettings[K]): void {
  current = { ...userSettings(), [key]: value };
  try {
    storage()?.setItem(USER_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    // Full, or refused: the setting holds for this page, which is better than not at all.
  }
  for (const listener of listeners) listener(current);
}

/** Hear about changes; the returned function stops it. */
export function onUserSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget what is in memory and read the browser again. For tests, and for a page that knows storage changed under it. */
export function reloadUserSettings(): UserSettings {
  current = load();
  for (const listener of listeners) listener(current);
  return current;
}
