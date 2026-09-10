import { useState } from 'preact/hooks';
import type { LoadoutCard } from '../demo-abilities';

const colors: Record<string, string> = {
  arcana: '#695cac', blade: '#973f45', bone: '#a99a78', codex: '#426baa',
  grace: '#b75d90', midnight: '#414a87', sage: '#507b4b', splendor: '#be993c', valor: '#b76b38',
};

/** Original illustration with a responsive, selectable SRD rules face. */
export function CardFace({ card, expanded = false }: { card: LoadoutCard; expanded?: boolean }): preact.JSX.Element {
  const [failed, setFailed] = useState(false);
  return <div className={`dh-card ${expanded ? 'dh-card-expanded' : ''}`} style={{ '--domain-color': colors[card.domain.toLowerCase()] ?? '#695cac' }}>
    <div className="dh-art">{!failed && <img src={`/cards/${card.id}.jpg`} alt={`${card.name} illustration`} loading="lazy" onError={() => setFailed(true)} />}
      <span className="dh-level"><b>{card.level}</b><small>LEVEL</small></span><span className="dh-recall" title="Recall Cost">{card.recallCost}<small>RECALL</small></span>
      <span className="dh-domain">{card.domain}</span></div>
    <div className="dh-title"><h3>{card.name}</h3><span>{card.type}</span></div>
    <div className="dh-rules">{card.text.split('\n').filter(Boolean).map((text, i) => <p key={i}>{text}</p>)}</div>
    <div className="dh-card-footer">DAGGERHEART <span>◆</span> {card.domain}</div>
  </div>;
}
