import { useState } from 'preact/hooks';
import type { GrantedCard, LoadoutCard } from '../demo-abilities';
import { artFor } from './card-art';
import { SIGIL_HEIGHT, SIGIL_WIDTH, sigilOf, type Sigil } from './card-sigil';

/** The ink the emblem is drawn in, over the card's cream stock (`cards.css`, `.face-art`). */
const INK = '#4a3623';

/**
 * How hard that ink lands. `card-sigil.ts` mixes its opacities for a pale ink laid over a saturated
 * ground, where a 0.13 backdrop still reads; the same wash on cream is barely a smudge. The shapes
 * are the drawing and stay as they are -- this is the painter deciding how dark to print them.
 */
const onPaper = (opacity: number): number => Math.min(1, opacity * 1.85);

/**
 * The generated emblem for a card, as SVG.
 *
 * Drawn from the card's id and domain — no image files, so this works on a
 * fresh clone with nothing downloaded. `aria-hidden`, because the card's name
 * and rules are already read out beside it and the emblem says nothing extra.
 */
export function CardSigil({ card, className }: { card: { id: string; domain: string }; className?: string }): preact.JSX.Element {
  const sigil: Sigil = sigilOf(card);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${SIGIL_WIDTH} ${SIGIL_HEIGHT}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      {sigil.shapes.map((shape, i) => {
        const paint = shape.fill
          ? { fill: INK, 'fill-opacity': onPaper(shape.opacity) }
          : { fill: 'none', stroke: INK, 'stroke-opacity': onPaper(shape.opacity), 'stroke-width': shape.width };
        if (shape.kind === 'circle') {
          return <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />;
        }
        const points = shape.points.join(' ');
        // An unfilled run of points is an open arc, not a closed shape.
        return shape.fill
          ? <polygon key={i} points={points} {...paint} />
          : <polyline key={i} points={points} strokeLinecap="round" {...paint} />;
      })}
    </svg>
  );
}

/**
 * Whatever this card should show: imported art, a file from `public/cards/`, or
 * the emblem it draws for itself. `card-art.ts` decides; this paints it.
 */
export function CardArtwork({ card, className }: { card: { id: string; domain: string }; className?: string }): preact.JSX.Element {
  const art = artFor(card.id);
  return art.kind === 'image'
    ? <ImageArtwork key={`${card.id}:${art.src}`} card={card} className={className} src={art.src} />
    : <CardSigil card={card} className={className} />;
}

/** A failed source falls back locally; choosing a different image starts a fresh attempt. */
function ImageArtwork({ card, className, src }: { card: { id: string; domain: string }; className?: string; src: string }): preact.JSX.Element {
  const [failed, setFailed] = useState(false);
  return failed
    ? <CardSigil card={card} className={className} />
    : <img className={className} src={src} alt="" aria-hidden="true" onError={() => setFailed(true)} />;
}

/** A domain card, drawn from the SRD text and whatever art it has. */
export function CardFace({ card, expanded = false }: { card: LoadoutCard; expanded?: boolean }): preact.JSX.Element {
  return <div className={`face ${expanded ? 'face-expanded' : ''}`} style={{ '--domain-color': sigilOf(card).color }}>
    <div className="face-art"><CardArtwork card={card} />
      <span className="face-level"><b>{card.level}</b><small>LEVEL</small></span><span className="face-recall" title="Recall Cost">{card.recallCost}<small>RECALL</small></span>
      <span className="face-domain">{card.domain}</span></div>
    <div className="face-title"><h3>{card.name}</h3><span>{card.type}</span></div>
    <div className="face-rules">{card.text.split('\n').filter(Boolean).map((text, i) => <p key={i}>{text}</p>)}</div>
    <div className="face-footer"><span>{card.domain}</span><span>{card.type}</span></div>
  </div>;
}

/**
 * A card in play because of what its holder is. No level and no Recall Cost -- it was never chosen
 * and is never vaulted -- and where a domain card names its domain, this names what granted it.
 */
export function GrantedFace({ card, expanded = false }: { card: GrantedCard; expanded?: boolean }): preact.JSX.Element {
  // A granted card has no domain; it wears one colour of its own rather than borrowing a domain's.
  const drawn = { id: card.id, domain: 'granted' };
  return <div className={`face face-granted ${expanded ? 'face-expanded' : ''}`} style={{ '--domain-color': sigilOf(drawn).color }}>
    <div className="face-art"><CardArtwork card={drawn} /><span className="face-domain">{card.from}</span></div>
    <div className="face-title"><h3>{card.name}</h3><span>always in play</span></div>
    <div className="face-rules">{card.text.split('\n').filter(Boolean).map((text, i) => <p key={i}>{text}</p>)}</div>
    <div className="face-footer"><span>{card.from}</span><span>granted</span></div>
  </div>;
}
