import { useState } from 'preact/hooks';
import type { CardDef, ContentPack } from '../../engine/content/pack/import';
import { grantedCardOf, loadoutCardOf } from '../demo-abilities';
import { CardFace, GrantedFace } from './CardFace';
import { CardArtImport } from './CardArtImport';
import './cards.css';

export interface CardPreviewProps {
  card: CardDef;
  /** What the grant names, so a class card says its class's name and not its id. */
  content: ContentPack;
}

/**
 * A card as the player will see it, beside the form that writes it: a chosen card with its level,
 * recall and domain, any other with what grants it, both with the art this browser holds. The
 * editor cannot import the game, so `main.ts` hands this to the Cards panel as a render prop.
 */
export function CardPreview(props: CardPreviewProps): preact.JSX.Element {
  // Bumped when imported art changes, so the face redraws with it.
  const [artVersion, setArtVersion] = useState(0);
  const key = `${props.card.id}:${artVersion}`;
  const granted = grantedCardOf(props.card, props.content);
  return <div className="card-preview" data-testid="card-preview">
    {props.card.grant.kind === 'chosen'
      ? <CardFace key={key} card={loadoutCardOf(props.card)} />
      : <GrantedFace key={key} card={props.card.grant.kind === 'adversary' ? { ...granted, from: 'Stat block' } : granted} />}
    {/* Keyed by card, so a failed import's alert under one card is not read under the next. */}
    <CardArtImport key={props.card.id} cardId={props.card.id} onChanged={() => setArtVersion(v => v + 1)} />
  </div>;
}
