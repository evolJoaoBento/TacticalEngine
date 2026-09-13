import { useEffect, useRef, useState } from 'preact/hooks';
import type { LoadoutCard, LoadoutView } from '../demo-abilities';
import { CardFace } from './CardFace';
import { artFor, cardArtImports } from './card-art';
import { ACCEPTED, pictureFromFile } from './card-art-import';
import './cards.css';

export interface LoadoutPanelProps {
  name: string;
  view: LoadoutView;
  resting: boolean;
  issue: string | null;
  onSwap: (cardIn: string, cardOut: string | undefined) => void;
  onClose: () => void;
}

export function LoadoutPanel(props: LoadoutPanelProps): preact.JSX.Element {
  const { view } = props;
  const full = view.loadout.length >= view.limit;
  const [out, setOut] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('all');
  const [inspect, setInspect] = useState<LoadoutCard | null>(null);
  // Bumped when imported art changes, so every face of that card redraws.
  const [artVersion, setArtVersion] = useState(0);
  const [artIssue, setArtIssue] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  /** The picture this browser is holding for a card, if any. */
  const importedFor = (id: string): string | null => cardArtImports()?.get(id) ?? null;
  const root = useRef<HTMLDivElement>(null);
  const inspectTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    if (inspect) root.current?.querySelector<HTMLButtonElement>('.card-lightbox button')?.focus();
    else inspectTrigger.current?.focus();
  }, [inspect]);
  const chosen = view.loadout.some(c => c.id === out) ? out : null;
  const domains = [...new Set([...view.loadout, ...view.vault].map(c => c.domain))].sort();
  const matches = (c: LoadoutCard) => (domain === 'all' || c.domain === domain)
    && `${c.name} ${c.text} ${c.type}`.toLowerCase().includes(query.toLowerCase());
  const renderCard = (card: LoadoutCard, active: boolean) => (
    <article key={card.id} className={`deck-slot ${chosen === card.id ? 'is-selected' : ''}`} data-card={card.id}>
      <button className="card-inspect" aria-label={`Inspect ${card.name}`} onClick={e => { inspectTrigger.current = e.currentTarget; setInspect(card); }}><CardFace card={card} /></button>
      {active ? (full ? <label className="deck-select">
        <input type="radio" name="vault-out" checked={chosen === card.id} onChange={() => setOut(card.id)} data-testid="pick-out" />
        {chosen === card.id ? 'Selected to vault' : 'Make room'}
      </label> : <span className="deck-ready">In your hand</span>) : (
        <button className="deck-recall" data-testid="recall" disabled={full && chosen === null}
          title={full && chosen === null ? 'Choose an active card to make room' : 'Bring this card into your active loadout'}
          onClick={() => { props.onSwap(card.id, full ? chosen ?? undefined : undefined); setOut(null); }}>
          Recall{!props.resting && card.recallCost > 0 ? ` (${card.recallCost} Stress)` : ' · Free'}
        </button>
      )}
    </article>
  );
  return <div className="deck-backdrop" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <div ref={root} tabIndex={-1} className="deck-browser" role="dialog" aria-modal="true" aria-label={`${props.name} loadout`} data-testid="loadout"
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); if (inspect) setInspect(null); else props.onClose(); }
        if (e.key === 'Tab') {
          const nodes = [...(root.current?.querySelectorAll<HTMLElement>(inspect ? '.card-lightbox button' : 'button:not(:disabled), input, select') ?? [])].filter(n => n.offsetParent !== null);
          const first = nodes[0], last = nodes[nodes.length - 1];
          if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { e.preventDefault(); last?.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { e.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="deck-header"><div><div className="deck-eyebrow">DOMAIN COLLECTION</div><h1>{props.name} <span>/ Loadout</span></h1></div>
        <button className="deck-close" onClick={props.onClose} data-testid="close-loadout">Close <kbd>Esc</kbd></button></header>
      <div className="deck-toolbar"><label className="deck-search">Search cards<input aria-label="Search cards" placeholder="Name, effect, or card type…" value={query} onInput={e => setQuery(e.currentTarget.value)} /></label>
        <label>Domain<select aria-label="Domain" value={domain} onChange={e => setDomain(e.currentTarget.value)}><option value="all">All domains</option>{domains.map(d => <option key={d} value={d}>{d}</option>)}</select></label>
        <p>Inspect a card to read it.<br />{props.resting ? 'Resting · recall is free.' : 'Recall costs the card’s Recall Cost in Stress.'}</p></div>
      <div className="deck-scroll">
        <section><div className="deck-section-title"><h2>Active hand</h2><span>{view.loadout.length} / {view.limit}</span><p>{full ? 'Choose a card to make room for a recall.' : 'These cards are ready for your adventure.'}</p></div>
          <div className="deck-grid">{view.loadout.filter(matches).map(c => renderCard(c, true))}</div>
          {!view.loadout.some(matches) && <p className="deck-empty">{view.loadout.length ? 'No active cards match your filters.' : 'Nothing active.'}</p>}</section>
        <section><div className="deck-section-title"><h2>The vault</h2><span>{view.vault.length} {view.vault.length === 1 ? 'card' : 'cards'}</span><p>Your reserve. Recall a card to change your hand.</p></div>
          <div className="deck-grid">{view.vault.filter(matches).map(c => renderCard(c, false))}</div>
          {!view.vault.some(matches) && <p className="deck-empty">{view.vault.length ? 'No vaulted cards match your filters.' : 'The vault is empty. New cards beyond your active hand wait here.'}</p>}</section>
      </div>
      <footer className="deck-footer">{props.issue ? <span role="alert" data-testid="loadout-issue">{props.issue}</span> : <span>{view.loadout.length + view.vault.length} cards collected · Click any card to inspect</span>}<span>TACTICAL <small>ENGINE</small></span></footer>
      {inspect && <div className="card-lightbox" role="dialog" aria-label={inspect.name} onClick={() => setInspect(null)}>
        <div className="card-detail" onClick={e => e.stopPropagation()}>
          <CardFace key={`${inspect.id}:${artVersion}`} card={inspect} expanded />
          <button autoFocus className="deck-close" onClick={() => setInspect(null)}>Back to collection</button>
          <div className="card-art-import">
            <div>
              <button className="deck-close" data-testid="import-art" onClick={() => picker.current?.click()}>Use your own art…</button>
              {importedFor(inspect.id) !== null
                ? <button className="deck-close" data-testid="clear-art" onClick={() => { cardArtImports()?.remove(inspect.id); setArtIssue(null); setArtVersion(v => v + 1); }}>Remove</button>
                : null}
            </div>
            {artIssue === null
              ? <p>{importedFor(inspect.id) !== null
                  ? 'Your own picture, kept in this browser.'
                  : artFor(inspect.id).kind === 'image'
                    ? 'Local development artwork.'
                    : 'Drawn from the card itself. Import a picture to replace it.'}</p>
              : <p role="alert" data-testid="art-issue">{artIssue}</p>}
          </div>
          <input ref={picker} type="file" accept={ACCEPTED} data-testid="art-file" style={{ display: 'none' }}
            onChange={async e => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file === undefined) return;
              try {
                const picture = await pictureFromFile(file);
                const imports = cardArtImports();
                // `set` answers `null` when it worked, so this cannot be `??`.
                setArtIssue(imports === null
                  ? 'There is nowhere to keep imported art in this browser.'
                  : imports.set(inspect.id, picture));
              } catch (error) {
                setArtIssue(error instanceof Error ? error.message : 'That file could not be read as a picture.');
              }
              setArtVersion(v => v + 1);
            }} /></div>
      </div>}
    </div>
  </div>;
}
