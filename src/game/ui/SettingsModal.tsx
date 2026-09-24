/**
 * The player's own settings, as a sheet over the table: what `user-settings.ts` keeps in the
 * browser, drawn from its list of what settings there are.
 *
 * Escape opens it, and nothing else does - there is no button for it on the board. But Escape
 * already means "put that down" all over the game: it closes the loadout, cancels a card being
 * aimed, calls off a roll. So this listens first, in the capture phase, and looks at the page
 * before anything has reacted: if something Escape would close is on it, the key is that
 * thing's and this stays shut. Only an Escape with nothing to put down opens the settings, and
 * while they are open Escape is theirs alone.
 *
 * Headings and rows come off `userSettingSections()`, and a row is drawn by its `kind`, so a
 * setting added to that list appears here under its heading with nothing written in this file -
 * and a new kind of control is one more case in `Row`.
 *
 * Saving and loading live here too, above the settings, because this is the menu a player reaches
 * for when they step out of the game - and because the board wants its edges for the board. They
 * are handed in rather than built here: what a save is belongs to the game, and the sheet only
 * gives it a place to stand. Whatever is handed in is given a way to shut the sheet, since loading
 * a game means wanting to look at it.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { onUserSettings, setUserSetting, userSettingSections, userSettings, type UserSettingDef, type UserSettings } from '../user-settings';

/**
 * What Escape already closes when it is on the page. While any of these is, the key is not ours:
 * the loadout binder, a rest being chosen, a card or a jump being aimed, the facts about a
 * creature, a roll being asked for or read, a level being taken, a conversation, a shop.
 */
export const ESCAPE_IS_TAKEN = [
  '[data-testid="loadout-backdrop"]',
  '[data-testid="rest"]',
  '[data-testid="cancel-targeting"]',
  '[data-testid="inspect"]',
  '.roll-backdrop',
  '[data-testid="level-up"]',
  '[data-testid="dialogue"]',
  '[data-testid="shop-backdrop"]',
].join(',');

/** Whether an Escape pressed now belongs to something else on the page. */
export function escapeIsTaken(root: ParentNode = document): boolean {
  return root.querySelector(ESCAPE_IS_TAKEN) !== null;
}

function Row(props: { def: UserSettingDef; settings: UserSettings }): preact.JSX.Element {
  const { def, settings } = props;
  switch (def.kind) {
    case 'toggle':
      return (
        <label className="settings-row" data-setting={def.key}>
          <input
            type="checkbox"
            role="switch"
            className="settings-switch"
            data-testid={`setting-${def.key}`}
            checked={settings[def.key]}
            onChange={(e) => setUserSetting(def.key, e.currentTarget.checked)}
          />
          <span>
            <b>{def.name}</b>
            <small>{def.about}</small>
          </span>
        </label>
      );
  }
}

export interface SettingsModalProps {
  /** A section for the top of the sheet - the game's own saving and loading - drawn with a way to shut it. */
  games?: (close: () => void) => preact.JSX.Element;
}

export function SettingsModal(props: SettingsModalProps = {}): preact.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<UserSettings>(userSettings());
  const sheet = useRef<HTMLDivElement>(null);
  const isOpen = useRef(false);
  isOpen.current = open;

  useEffect(() => onUserSettings(setSettings), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (isOpen.current) {
        // Ours: nothing behind the sheet should hear it.
        event.stopPropagation();
        event.preventDefault();
        setOpen(false);
      } else if (!escapeIsTaken()) {
        event.stopPropagation();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  // The sheet takes the keyboard while it is up, so Tab walks its switches and not the party.
  useEffect(() => {
    if (open) sheet.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <div className="settings-backdrop" data-testid="settings-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div
        ref={sheet}
        className="play-box settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        tabIndex={-1}
        data-testid="user-settings"
        onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
      >
        <div className="settings-head">
          <h2>Settings</h2>
          <button type="button" className="play-btn is-ghost" data-testid="close-settings" onClick={() => setOpen(false)}>
            Close (Esc)
          </button>
        </div>
        {props.games === undefined ? null : (
          <section className="settings-section" data-section="Game">
            <div className="play-eyebrow">Game</div>
            {props.games(() => setOpen(false))}
          </section>
        )}
        {userSettingSections().map(({ section, settings: defs }) => (
          <section key={section} className="settings-section" data-section={section}>
            <div className="play-eyebrow">{section}</div>
            {defs.map((def) => (
              <Row key={def.key} def={def} settings={settings} />
            ))}
          </section>
        ))}
        <p className="settings-foot">Kept in this browser, for every campaign played in it.</p>
      </div>
    </div>
  );
}
