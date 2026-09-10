import type { LoadoutCard } from '../demo-abilities';
import { artFor } from './card-art';
import { SIGIL_HEIGHT, SIGIL_WIDTH, sigilOf, type Sigil } from './card-sigil';

/** The ink the emblem is drawn in, over the domain-coloured ground. */
const INK = '#fff2d4';

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
          ? { fill: INK, 'fill-opacity': shape.opacity }
          : { fill: 'none', stroke: INK, 'stroke-opacity': shape.opacity, 'stroke-width': shape.width };
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
    ? <img className={className} src={art.src} alt="" aria-hidden="true" />
    : <CardSigil card={card} className={className} />;
}

/** A domain card, drawn from the SRD text and whatever art it has. */
export function CardFace({ card, expanded = false }: { card: LoadoutCard; expanded?: boolean }): preact.JSX.Element {
  return <div className={`dh-card ${expanded ? 'dh-card-expanded' : ''}`} style={{ '--domain-color': sigilOf(card).color }}>
    <div className="dh-art"><CardArtwork card={card} />
      <span className="dh-level"><b>{card.level}</b><small>LEVEL</small></span><span className="dh-recall" title="Recall Cost">{card.recallCost}<small>RECALL</small></span>
      <span className="dh-domain">{card.domain}</span></div>
    <div className="dh-title"><h3>{card.name}</h3><span>{card.type}</span></div>
    <div className="dh-rules">{card.text.split('\n').filter(Boolean).map((text, i) => <p key={i}>{text}</p>)}</div>
    <div className="dh-card-footer">DAGGERHEART <span>◆</span> {card.domain}</div>
  </div>;
}
