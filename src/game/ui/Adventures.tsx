/**
 * The main menu's Adventures (`MainMenu.tsx`): what a camp's portal offers (`adventure-portal.ts`) - the ones this build
 * writes, and the ones brought in from a project file (`adventure-library.ts`), each of those removable. Importing
 * checks the file as a project opened by hand is checked, and says why when it will not take it.
 */

import { useState } from 'preact/hooks';
import { AdventureLibrary, importAdventure } from '../adventure-library';
import { BUILT_IN, adventureChoices } from '../adventure-portal';
import { browserStore } from '../save-slots';

export function Adventures(props: { onBack: () => void; library?: AdventureLibrary }): preact.JSX.Element {
  const [library] = useState(() => props.library ?? new AdventureLibrary(browserStore()));
  const [choices, setChoices] = useState(() => adventureChoices(library));
  // What the last import or removal came to.
  const [said, setSaid] = useState<{ text: string; refused: boolean } | null>(null);
  const relist = (): void => setChoices(adventureChoices(library));

  const bring = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    const result = importAdventure(library, await file.text(), BUILT_IN);
    if ('refused' in result) setSaid({ text: result.refused, refused: true });
    else setSaid({ text: `${result.imported} is in: every camp's portal offers it now.`, refused: false });
    relist();
  };

  return (
    <div className="menu-load" data-testid="menu-adventures-list">
      <p className="menu-sub">Every camp has a portal: use it, and it offers these. The party goes through as it stands.</p>
      {choices.map((adventure) => (
        <section key={adventure.id} className="menu-game" data-adventure={adventure.id}>
          <header>
            <h2>{adventure.name}</h2>
            {adventure.imported === true ? (
              <button
                type="button"
                className="menu-back"
                data-testid="menu-adventure-remove"
                onClick={() => {
                  const removed = library.remove(adventure.id);
                  setSaid(removed ? { text: `${adventure.name} is gone. Games begun from it are kept.`, refused: false } : { text: `${adventure.name} could not be removed.`, refused: true });
                  relist();
                }}
              >
                Remove
              </button>
            ) : (
              <span className="menu-waiting-line">Built in</span>
            )}
          </header>
          <p className="menu-waiting-line">{adventure.blurb}</p>
        </section>
      ))}
      <label className="menu-go menu-import">
        Import from a file
        <input
          type="file"
          accept=".json,application/json"
          data-testid="menu-adventure-import"
          hidden
          onChange={(e) => {
            const input = e.currentTarget;
            void bring(input.files?.[0]).then(() => {
              // The same file again is a change too.
              input.value = '';
            });
          }}
        />
      </label>
      {said === null ? null : (
        <p className={said.refused ? 'menu-join-refused' : 'menu-waiting-line'} data-testid="menu-adventure-said">
          {said.text}
        </p>
      )}
      <button type="button" className="menu-back" data-testid="menu-back" onClick={props.onBack}>
        Back
      </button>
    </div>
  );
}
