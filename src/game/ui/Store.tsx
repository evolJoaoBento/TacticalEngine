/**
 * The store, from the main menu (`MainMenu.tsx`), for whoever is signed in: art creators publish - a model
 * or a picture - and **show their work**, and everybody else says whether they believe it.
 *
 * Every listing wears its mark (`MarkTag`): how it was made, as its creator claims - Human made, AI
 * Assisted, AI Generated - once it shows its work, and **AI Generated** until it does. Its work is **How I
 * Made It** and the **Process Proof** pictures. With the work shown, the **Human-Crafted Authenticity**
 * line (`authenticityLine`) counts the votes: believing the proof, a player **Likes** it; seeing signs of
 * AI, or no real evidence, they **Dislike** it - one vote, clicked again to take it back, never on their
 * own. Without it there is nothing to judge, and the listing says so.
 *
 * A listing is **free** or **for sale**, which needs its work shown and is never AI generated; payments are
 * not open yet, so one for sale can be got only by its creator. **Get** puts a model into the player's own
 * models (`your-models.ts`), which the editor offers under every project they open - every model the
 * engine has is listed, by *The engine* - and downloads a picture; a model can be downloaded too. Its creator can
 * **Show your work** at any time - How I Made It, more pictures, the claim, free or for sale - and, with
 * admin, **Take down** a listing. **Publish** opens the form for a new one.
 */

import { useEffect, useState } from 'preact/hooks';
import type { SignedIn } from '../accounts';
import {
  CLAIM_LABEL,
  assetUrl,
  authenticityLine,
  getListing,
  listListings,
  proofUrl,
  publishListing,
  readAsDataUrl,
  removeListing,
  updateListing,
  voteOn,
  type Claim,
  type ListingView,
  type ProofUpload,
  type Vote,
} from '../store';
import './store.css';

/** How many pictures of the work a listing may show; the store says so too (`tools/store.ts`). */
const MOST_PROOFS = 6;
const CLAIMS: readonly Claim[] = ['human-made', 'ai-assisted', 'ai-generated'];

/** Pictures picked from a file field, as the store carries them. */
async function uploads(files: FileList | null): Promise<ProofUpload[]> {
  return Promise.all([...(files ?? [])].map(async (file) => ({ name: file.name, data: await readAsDataUrl(file) })));
}

/** How the store marks a listing, in the AI marks' colours: red, yellow, green. */
function MarkTag(props: { listing: ListingView }): preact.JSX.Element {
  const { mark, supported } = props.listing;
  return (
    <span className={`store-mark is-${mark}`} data-testid="store-mark" data-mark={mark}>
      {CLAIM_LABEL[mark]}{supported ? '' : ' · no work shown yet'}
    </span>
  );
}

/** How it was made, one of three, as a row of choices. */
function ClaimChoice(props: { value: Claim; onChange: (claim: Claim) => void; testId: string }): preact.JSX.Element {
  return (
    <fieldset className="store-claims" data-testid={props.testId}>
      <legend>How it was made</legend>
      {CLAIMS.map((claim) => (
        <label key={claim} className={`store-claim is-${claim}`}>
          <input type="radio" name={props.testId} value={claim} checked={props.value === claim} onChange={() => props.onChange(claim)} />
          {CLAIM_LABEL[claim]}
        </label>
      ))}
    </fieldset>
  );
}

/** Showing a listing's work, later, by its creator: How I Made It, more pictures, its claim, free or for sale. */
function ShowYourWork(props: { listing: ListingView; onDone: (listing: ListingView | null) => void }): preact.JSX.Element {
  const { listing } = props;
  const [how, setHow] = useState(listing.how);
  const [claim, setClaim] = useState<Claim>(listing.claim);
  const [forSale, setForSale] = useState(listing.forSale);
  const [files, setFiles] = useState<FileList | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  // A refusal is for the form as it was sent; changed, it is answered again on Save.
  useEffect(() => setRefused(null), [how, claim, forSale, files]);
  const room = MOST_PROOFS - listing.proofCount;
  const save = async (): Promise<void> => {
    const answer = await updateListing(listing.id, { how, claim, forSale, addProofs: await uploads(files) });
    if ('refused' in answer) setRefused(answer.refused);
    else props.onDone(answer);
  };
  return (
    <form className="store-work" data-testid="store-work" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h4>Show your work</h4>
      <ClaimChoice value={claim} onChange={setClaim} testId="work-claim" />
      <label className="menu-field">How I Made It<small>A quick paragraph about your process{claim === 'ai-assisted' ? ' - and how the AI was used' : ''}</small>
        <textarea data-testid="work-how" rows={4} maxLength={2000} value={how} onInput={(e) => setHow(e.currentTarget.value)} />
      </label>
      <label className="menu-field">More Process Proof<small>{room > 0 ? `Up to ${room} more pictures of the work` : 'This listing shows as many pictures as it can'}</small>
        <input data-testid="work-proofs" type="file" multiple disabled={room <= 0} accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles(e.currentTarget.files)} />
      </label>
      <label className="store-sale"><input type="checkbox" data-testid="work-for-sale" checked={forSale} onChange={(e) => setForSale(e.currentTarget.checked)} /> For sale - needs the work shown, never AI generated; payments open later</label>
      {refused === null ? null : <p className="menu-refused" role="alert" data-testid="work-refused">{refused}</p>}
      <div className="store-actions">
        <button type="submit" className="menu-go" data-testid="work-save">Save</button>
        <button type="button" className="menu-back" onClick={() => props.onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

function Listing(props: { listing: ListingView; account: SignedIn; onChanged: (listing: ListingView | null) => void }): preact.JSX.Element {
  const { listing, account } = props;
  const [refused, setRefused] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const vote = async (wanted: Vote): Promise<void> => {
    const answer = await voteOn(listing.id, listing.mine === wanted ? null : wanted);
    if ('refused' in answer) setRefused(answer.refused);
    else {
      setRefused(null);
      props.onChanged(answer);
    }
  };
  const cover = listing.kind === 'image' ? assetUrl(listing.id) : listing.proofCount > 0 ? proofUrl(listing.id, 0) : null;
  const judged = listing.own ? 'Your own listing is not yours to vote on' : !listing.supported ? 'Nothing to judge until the work is shown' : null;
  const gettable = !listing.forSale || listing.own;
  const get = async (): Promise<void> => {
    const answer = await getListing(listing.id);
    if ('refused' in answer) setRefused(answer.refused);
    else {
      setRefused(null);
      props.onChanged(answer);
    }
  };
  return (
    <article className="store-listing" data-testid="store-listing" data-listing={listing.id}>
      <div className="store-cover">
        {cover === null ? <span className="store-glyph">3D model</span> : <img src={cover} alt="" />}
        <span className="store-kind">{listing.engine ? 'Engine model' : listing.kind === 'model' ? 'Model' : 'Picture'}</span>
      </div>
      <div className="store-body">
        <h3 className="store-title">{listing.title}</h3>
        <p className="store-by">by <b>{listing.creatorName}</b> · {listing.fileName}</p>
        <p className="store-tags">
          <MarkTag listing={listing} />
          <span className="store-sale-tag" data-testid="store-sale">{listing.forSale ? 'For sale · payments open later' : 'Free'}</span>
        </p>
        {listing.description === '' ? null : <p className="store-description">{listing.description}</p>}
        {listing.supported ? (
          <p className="store-authenticity" data-testid="store-authenticity">{authenticityLine(listing)}</p>
        ) : (
          <p className="store-unshown" data-testid="store-unshown">
            Marked AI until {listing.own ? 'you show your' : `${listing.creatorName} shows their`} work - How I Made It and a Process Proof.
            {listing.claim === 'ai-generated' ? '' : ` ${listing.own ? 'You say' : 'They say'} it is ${CLAIM_LABEL[listing.claim]}.`}
          </p>
        )}
        <section className="store-proof">
          <h4>How I Made It</h4>
          <p data-testid="store-how">{listing.how === '' ? <i>Nothing said yet.</i> : listing.how}</p>
          <h4>Process Proof</h4>
          {listing.proofCount === 0 ? (
            <p><i>No pictures of the work yet.</i></p>
          ) : (
            <div className="store-proofs">
              {Array.from({ length: listing.proofCount }, (_, n) => (
                <a key={n} href={proofUrl(listing.id, n)} target="_blank" rel="noreferrer">
                  <img className="store-proof-image" data-testid="store-proof" src={proofUrl(listing.id, n)} alt={`Process proof ${n + 1}`} />
                </a>
              ))}
            </div>
          )}
        </section>
        {working ? <ShowYourWork listing={listing} onDone={(changed) => { setWorking(false); if (changed !== null) props.onChanged(changed); }} /> : null}
        <div className="store-actions">
          <button type="button" className={`menu-go store-vote${listing.mine === 'like' ? ' is-on' : ''}`} data-testid="store-like" disabled={judged !== null} title={judged ?? 'I believe the proof'} onClick={() => void vote('like')}>
            Like · {listing.likes}
          </button>
          <button type="button" className={`menu-back store-vote${listing.mine === 'dislike' ? ' is-on' : ''}`} data-testid="store-dislike" disabled={judged !== null} title={judged ?? 'I see signs of AI, or no real evidence'} onClick={() => void vote('dislike')}>
            Dislike · {listing.dislikes}
          </button>
          {!gettable ? null : listing.kind === 'image' ? (
            <a className="menu-go" data-testid="store-get" href={assetUrl(listing.id, true)} download={listing.fileName}>Get</a>
          ) : listing.inYours ? (
            <span className="store-in-yours" data-testid="store-in-yours" title="In the editor, under every project you open">In your models</span>
          ) : (
            <button type="button" className="menu-go" data-testid="store-get" title="Into your models: the editor offers it under every project you open" onClick={() => void get()}>Get</button>
          )}
          {gettable && listing.kind === 'model' ? (
            <a className="menu-back" data-testid="store-download" href={assetUrl(listing.id, true)} download={listing.fileName}>Download</a>
          ) : null}
          {gettable ? null : (
            <button type="button" className="menu-go" data-testid="store-get" disabled title="Payments are not open yet">Payments open later</button>
          )}
          {listing.own && !working ? (
            <button type="button" className="menu-go" data-testid="store-show-work" onClick={() => setWorking(true)}>Show your work</button>
          ) : null}
          {!listing.engine && (listing.own || account.admin) ? (
            <button
              type="button"
              className="menu-back"
              data-testid="store-remove"
              onClick={() => {
                if (!confirm(`Take down "${listing.title}"?`)) return;
                void removeListing(listing.id).then((not) => (not === null ? props.onChanged(null) : setRefused(not)));
              }}
            >
              Take down
            </button>
          ) : null}
        </div>
        {refused === null ? null : <p className="menu-refused" role="alert" data-testid="store-refused">{refused}</p>}
      </div>
    </article>
  );
}

function Publish(props: { onDone: (listing: ListingView | null) => void }): preact.JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [claim, setClaim] = useState<Claim>('human-made');
  const [forSale, setForSale] = useState(false);
  const [how, setHow] = useState('');
  const [asset, setAsset] = useState<File | null>(null);
  const [proofs, setProofs] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(() => setRefused(null), [claim, forSale, how, proofs, asset]);
  const shown = how.trim() !== '' && (proofs?.length ?? 0) > 0;
  const publish = async (): Promise<void> => {
    if (asset === null || busy) return;
    setBusy(true);
    setRefused(null);
    const answer = await publishListing({
      title,
      description,
      claim,
      forSale,
      how,
      asset: { name: asset.name, data: await readAsDataUrl(asset) },
      proofs: await uploads(proofs),
    });
    setBusy(false);
    if ('refused' in answer) setRefused(answer.refused);
    else props.onDone(answer);
  };
  return (
    <form className="store-publish" data-testid="store-publish" onSubmit={(e) => { e.preventDefault(); void publish(); }}>
      <h2>Publish</h2>
      <label className="menu-field">Title<input data-testid="publish-title" value={title} maxLength={80} onInput={(e) => setTitle(e.currentTarget.value)} /></label>
      <label className="menu-field">Description<textarea data-testid="publish-description" rows={3} maxLength={2000} value={description} onInput={(e) => setDescription(e.currentTarget.value)} /></label>
      <label className="menu-field">The asset - a .glb model, or a PNG, JPEG or WebP picture
        <input data-testid="publish-asset" type="file" accept=".glb,model/gltf-binary,image/png,image/jpeg,image/webp" onChange={(e) => setAsset(e.currentTarget.files?.[0] ?? null)} />
      </label>
      <ClaimChoice value={claim} onChange={setClaim} testId="publish-claim" />
      <div className="store-publish-proof">
        <label className="menu-field">How I Made It<small>A quick paragraph about your process{claim === 'ai-assisted' ? ' - and how the AI was used' : ''}</small>
          <textarea data-testid="publish-how" rows={4} maxLength={2000} value={how} onInput={(e) => setHow(e.currentTarget.value)} />
        </label>
        <label className="menu-field">Process Proof<small>Pictures of your workspace, or drafts - up to {MOST_PROOFS}</small>
          <input data-testid="publish-proof" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setProofs(e.currentTarget.files)} />
        </label>
      </div>
      <p className="store-hint" data-testid="publish-hint">
        {shown ? `With your work shown, it is marked ${CLAIM_LABEL[claim]}.` : 'Without How I Made It and a Process Proof it is marked AI Generated until you show your work - you can add it later.'}
      </p>
      <fieldset className="store-claims">
        <legend>Free, or for sale</legend>
        <label className="store-claim"><input type="radio" name="publish-sale" data-testid="publish-free" checked={!forSale} onChange={() => setForSale(false)} /> Free</label>
        <label className="store-claim"><input type="radio" name="publish-sale" data-testid="publish-for-sale" checked={forSale} onChange={() => setForSale(true)} /> For sale - needs the work shown, never AI generated; payments open later</label>
      </fieldset>
      {refused === null ? null : <p className="menu-refused" role="alert" data-testid="publish-refused">{refused}</p>}
      <div className="store-actions">
        <button type="submit" className="menu-go is-big" data-testid="publish-go" disabled={busy || title.trim() === '' || asset === null}>{busy ? 'Publishing…' : 'Publish'}</button>
        <button type="button" className="menu-back" data-testid="publish-cancel" onClick={() => props.onDone(null)}>Cancel</button>
      </div>
    </form>
  );
}

export function Store(props: { account: SignedIn; onBack: () => void }): preact.JSX.Element {
  const [listings, setListings] = useState<ListingView[] | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const load = (): void => {
    void listListings().then((answer) => {
      if (Array.isArray(answer)) {
        setListings(answer);
        setRefused(null);
      } else setRefused(answer.refused);
    });
  };
  useEffect(load, []);
  return (
    <div className="menu-card store" data-testid="store">
      <header className="store-head">
        <h1 className="menu-title">The Store</h1>
        <div className="store-actions">
          {publishing ? null : <button type="button" className="menu-go" data-testid="store-open-publish" onClick={() => setPublishing(true)}>Publish</button>}
          <button type="button" className="menu-back" data-testid="store-back" onClick={props.onBack}>Back</button>
        </div>
      </header>
      {publishing ? <Publish onDone={(made) => { setPublishing(false); if (made !== null) load(); }} /> : null}
      {refused === null ? null : <p className="menu-refused" role="alert">{refused}</p>}
      {listings === null ? null : listings.length === 0 ? (
        <p className="menu-sub" data-testid="store-empty">Nothing has been published yet.</p>
      ) : (
        <div className="store-list">
          {listings.map((listing) => (
            <Listing
              key={listing.id}
              listing={listing}
              account={props.account}
              onChanged={(changed) => setListings((was) => (was ?? []).flatMap((entry) => (entry.id !== listing.id ? [entry] : changed === null ? [] : [changed])))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
