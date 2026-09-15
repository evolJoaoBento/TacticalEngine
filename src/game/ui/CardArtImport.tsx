import { useRef, useState } from 'preact/hooks';
import { artFor, cardArtImports } from './card-art';
import { ACCEPTED, pictureFromFile } from './card-art-import';

export interface CardArtImportProps {
  cardId: string;
  /** The picture this browser keeps for the card changed; every face of it should redraw. */
  onChanged: () => void;
}

/**
 * "Use your own art…" and "Remove": the picture this browser holds for one card, wherever a card
 * is looked at closely -- the deck browser's reader, and the Cards panel's preview. The picture
 * lives in the browser, not in the project; `card-art.ts` says how it is kept.
 */
export function CardArtImport(props: CardArtImportProps): preact.JSX.Element {
  const picker = useRef<HTMLInputElement>(null);
  const [issue, setIssue] = useState<string | null>(null);
  const imported = cardArtImports()?.get(props.cardId) ?? null;
  return <div className="card-art-import">
    <div>
      <button className="deck-close" data-testid="import-art" onClick={() => picker.current?.click()}>Use your own art…</button>
      {imported !== null
        ? <button className="deck-close" data-testid="clear-art" onClick={() => { cardArtImports()?.remove(props.cardId); setIssue(null); props.onChanged(); }}>Remove</button>
        : null}
    </div>
    {issue === null
      ? <p>{imported !== null
          ? 'Your own picture, kept in this browser.'
          : artFor(props.cardId).kind === 'image'
            ? 'Local development artwork.'
            : 'Drawn from the card itself. Import a picture to replace it.'}</p>
      : <p role="alert" data-testid="art-issue">{issue}</p>}
    <input ref={picker} type="file" accept={ACCEPTED} data-testid="art-file" style={{ display: 'none' }}
      onChange={async e => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = '';
        if (file === undefined) return;
        try {
          const picture = await pictureFromFile(file);
          const imports = cardArtImports();
          // `set` answers `null` when it worked, so this cannot be `??`.
          setIssue(imports === null
            ? 'There is nowhere to keep imported art in this browser.'
            : imports.set(props.cardId, picture));
        } catch (error) {
          setIssue(error instanceof Error ? error.message : 'That file could not be read as a picture.');
        }
        props.onChanged();
      }} />
  </div>;
}
