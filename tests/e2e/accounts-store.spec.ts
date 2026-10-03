import { test, expect, type Page } from './fixtures';
import { ON_SERVER } from './server-mode';

/**
 * Accounts and the store, played. The tests' own server keeps neither (`TACTICAL_BOOT=builtin`: every
 * route answers 404, and the menu plays as nobody, as the rest of the suite does), so here they are stood
 * in for: `/__accounts/*` and `/__store/*` answered by the test, what the page sends read back. The real
 * routes are the unit tests' (`tests/unit/accounts.test.ts`, `store.test.ts`) and were tried end to end
 * against the dev server.
 */

const BRAMBLE = { id: 'bramble', name: 'Bramble', admin: false };

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const GOLEM = {
  id: '0123456789abcdef', title: 'Stone Golem', description: 'A golem for a cave.', claim: 'human-made', mark: 'human-made', supported: true, forSale: false,
  how: 'Sculpted in Blender over a week, painted by hand.', proofCount: 2, kind: 'model', fileName: 'golem.glb', creator: 'ash', creatorName: 'Ash', created: 1,
  likes: 45, dislikes: 3, authenticity: 94, mine: null, own: false, inYours: false,
};

/** Bramble's own, published with nothing shown: marked AI until the work is. */
const SHRINE = {
  ...GOLEM, id: 'fedcba9876543210', title: 'Ember Shrine', description: '', claim: 'ai-assisted', mark: 'ai-generated', supported: false, how: '', proofCount: 0,
  kind: 'image', fileName: 'shrine.png', creator: 'bramble', creatorName: 'Bramble', likes: 0, dislikes: 0, authenticity: null, own: true,
};

/** The store's rules, as the stand-in answers them (`tools/store.ts` has the real ones). */
function shown(listing: Record<string, unknown>): Record<string, unknown> {
  const supported = String(listing['how']).trim() !== '' && Number(listing['proofCount']) > 0;
  return { ...listing, supported, mark: supported ? listing['claim'] : 'ai-generated' };
}
function saleRefused(listing: Record<string, unknown>): string | null {
  if (listing['forSale'] !== true) return null;
  if (listing['claim'] === 'ai-generated') return 'AI generated work is not for sale';
  return shown(listing)['supported'] === true ? null : 'to be for sale, show your work: How I Made It and at least one Process Proof';
}

/** Signed in as Bramble, or nobody until they sign in (`signedIn: false`). */
async function accounts(page: Page, signedIn: boolean): Promise<void> {
  let who: typeof BRAMBLE | null = signedIn ? BRAMBLE : null;
  await page.route('**/__accounts/me', (route) => route.fulfill(who === null ? { status: 401, json: { reason: 'nobody is signed in' } } : { json: who }));
  await page.route('**/__accounts/login', async (route) => {
    const sent = route.request().postDataJSON() as { name: string; password: string };
    if (sent.password !== 'hunter22') return route.fulfill({ status: 401, json: { reason: 'that name and password do not match' } });
    who = BRAMBLE;
    return route.fulfill({ json: BRAMBLE });
  });
  await page.route('**/__accounts/logout', (route) => {
    who = null;
    return route.fulfill({ json: {} });
  });
}

test('signing in shows your own games, not another player’s, and signing out asks again', async ({ page }) => {
  await accounts(page, false);
  // A game kept before there were accounts: admin's, under the keys as they always were.
  await page.addInitScript(() => {
    if (localStorage.getItem('tactical:games') === null) {
      localStorage.setItem('tactical:games', JSON.stringify([{ id: 'camp-old-1', name: "Old's camp", startedAt: 1 }]));
    }
  });
  await page.goto('/?menu');
  await expect(page.getByTestId('sign-in')).toBeVisible();
  await page.getByTestId('sign-in-name').fill('Bramble');
  await page.getByTestId('sign-in-password').fill('wrong');
  await page.getByTestId('sign-in-go').click();
  await expect(page.getByTestId('sign-in-refused')).toContainText('do not match');
  await page.getByTestId('sign-in-password').fill('hunter22');
  await page.getByTestId('sign-in-go').click();

  await expect(page.getByTestId('menu-account')).toContainText('Signed in as Bramble');
  expect(await page.evaluate(() => localStorage.getItem('tactical:current-user'))).toBe('bramble');
  await page.screenshot({ path: 'test-results/accounts-menu.png' });
  // Load Game: Bramble's own games only - the old camp is admin's.
  await page.getByTestId('menu-load').click();
  await expect(page.locator('[data-testid="menu-load-list"] .menu-game')).toHaveCount(1);
  await expect(page.locator('[data-testid="menu-load-list"]')).not.toContainText("Old's camp");
  await page.getByTestId('menu-back').click();

  await page.getByTestId('menu-sign-out').click();
  await expect(page.getByTestId('sign-in')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('tactical:current-user'))).toBeNull();
});

test('the store shows the mark, the authenticity, How I Made It and the proofs; a like counts, and a publish sends its work', async ({ page }) => {
  await accounts(page, true);
  let listings: Record<string, unknown>[] = [GOLEM];
  const votes: unknown[] = [];
  const published: Record<string, unknown>[] = [];
  await page.route('**/__store/list', (route) => route.fulfill({ json: listings }));
  await page.route('**/__store/file/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  const got: unknown[] = [];
  await page.route('**/__store/get', async (route) => {
    got.push(route.request().postDataJSON());
    listings = listings.map((entry) => (entry['id'] === GOLEM.id ? { ...entry, inYours: true } : entry));
    await route.fulfill({ json: { listing: listings.find((entry) => entry['id'] === GOLEM.id), model: { id: 'golem' } } });
  });
  await page.route('**/__store/vote', async (route) => {
    const sent = route.request().postDataJSON() as { id: string; vote: string | null };
    votes.push(sent);
    const liked = sent.vote === 'like';
    listings = [{ ...GOLEM, likes: liked ? 46 : 45, mine: liked ? 'like' : null }];
    await route.fulfill({ json: listings[0] });
  });
  await page.route('**/__store/publish', async (route) => {
    const sent = route.request().postDataJSON() as Record<string, unknown>;
    const made = shown({ ...SHRINE, title: String(sent['title']), claim: sent['claim'], forSale: sent['forSale'], how: String(sent['how']), proofCount: (sent['proofs'] as unknown[]).length });
    const refused = saleRefused(made);
    if (refused !== null) return route.fulfill({ status: 422, json: { reason: refused } });
    published.push(sent);
    listings = [made, ...listings];
    await route.fulfill({ json: made });
  });

  await page.goto('/?menu');
  await page.getByTestId('menu-store').click();
  const golem = page.locator('[data-testid="store-listing"][data-listing="0123456789abcdef"]');
  await expect(golem.getByTestId('store-mark')).toHaveText('Human made');
  await expect(golem.getByTestId('store-mark')).toHaveCSS('background-color', 'rgb(47, 138, 77)');
  await expect(golem.getByTestId('store-sale')).toHaveText('Free');
  await expect(golem.getByTestId('store-authenticity')).toHaveText('Human-Crafted Authenticity: 94% (45 Likes / 3 Dislikes)');
  await expect(golem.getByTestId('store-how')).toHaveText(GOLEM.how);
  await expect(golem.getByTestId('store-proof')).toHaveCount(2);
  await expect(golem.getByTestId('store-download')).toHaveAttribute('href', '/__store/file/0123456789abcdef/asset?download');
  await page.screenshot({ path: 'test-results/store.png' });

  // Get puts a model into your models, and the listing says so.
  await golem.getByTestId('store-get').click();
  await expect(golem.getByTestId('store-in-yours')).toHaveText('In your models');
  await expect(golem.getByTestId('store-get')).toHaveCount(0);
  expect(got).toEqual([{ id: '0123456789abcdef' }]);

  // Believing the proof: a like, and the line counts it; the same button again takes it back.
  await golem.getByTestId('store-like').click();
  await expect(golem.getByTestId('store-authenticity')).toHaveText('Human-Crafted Authenticity: 94% (46 Likes / 3 Dislikes)');
  await expect(golem.getByTestId('store-like')).toHaveClass(/is-on/);
  await golem.getByTestId('store-like').click();
  expect(votes).toEqual([{ id: '0123456789abcdef', vote: 'like' }, { id: '0123456789abcdef', vote: null }]);

  // Publishing for sale: refused until the work is shown, then sent with it.
  await page.getByTestId('store-open-publish').click();
  await page.getByTestId('publish-title').fill('Ember Shrine');
  await page.getByTestId('publish-asset').setInputFiles({ name: 'shrine.png', mimeType: 'image/png', buffer: PNG });
  await page.getByTestId('publish-claim').getByLabel('AI Assisted').check();
  await expect(page.getByTestId('publish-hint')).toContainText('marked AI Generated until you show your work');
  await page.getByTestId('publish-for-sale').check();
  await page.getByTestId('publish-go').click();
  await expect(page.getByTestId('publish-refused')).toContainText('show your work');
  await page.getByTestId('publish-how').fill('Drawn on paper, inked, scanned; the AI suggested the palette.');
  await page.getByTestId('publish-proof').setInputFiles([
    { name: 'desk.png', mimeType: 'image/png', buffer: PNG },
    { name: 'draft.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await expect(page.getByTestId('publish-hint')).toHaveText('With your work shown, it is marked AI Assisted.');
  await page.screenshot({ path: 'test-results/store-publish.png' });
  await page.getByTestId('publish-go').click();
  const made = page.locator('[data-testid="store-listing"][data-listing="fedcba9876543210"]');
  await expect(made).toBeVisible();
  await expect(made.getByTestId('store-mark')).toHaveText('AI Assisted');
  await expect(made.getByTestId('store-sale')).toHaveText('For sale \u00b7 payments open later');
  await expect(made.getByTestId('store-authenticity')).toHaveText('Human-Crafted Authenticity: no votes yet');
  // Nobody votes on their own; its creator can still get it.
  await expect(made.getByTestId('store-like')).toBeDisabled();
  await expect(made.getByTestId('store-get')).toHaveAttribute('href', /download/);
  expect(published).toHaveLength(1);
  expect(published[0]).toMatchObject({ title: 'Ember Shrine', claim: 'ai-assisted', forSale: true, asset: { name: 'shrine.png' }, proofs: [{ name: 'desk.png' }, { name: 'draft.png' }] });
  expect(String((published[0]!['proofs'] as { data: string }[])[0]!.data)).toMatch(/^data:image\/png;base64,/);
});

test('a listing with no work shown is marked AI and not judged, until its creator shows it; one for sale is not got', async ({ page }) => {
  await accounts(page, true);
  const forSale = { ...GOLEM, id: '1111111111111111', title: 'Iron Warden', forSale: true };
  let listings: Record<string, unknown>[] = [SHRINE, forSale];
  const updates: Record<string, unknown>[] = [];
  await page.route('**/__store/list', (route) => route.fulfill({ json: listings }));
  await page.route('**/__store/file/**', (route) => route.fulfill({ contentType: 'image/png', body: PNG }));
  await page.route('**/__store/update', async (route) => {
    const sent = route.request().postDataJSON() as Record<string, unknown>;
    updates.push(sent);
    const next = shown({ ...SHRINE, how: sent['how'], claim: sent['claim'], forSale: sent['forSale'], proofCount: (sent['addProofs'] as unknown[]).length });
    const refused = saleRefused(next);
    if (refused !== null) return route.fulfill({ status: 422, json: { reason: refused } });
    listings = [next, forSale];
    await route.fulfill({ json: next });
  });

  await page.goto('/?menu');
  await page.getByTestId('menu-store').click();
  const shrine = page.locator('[data-testid="store-listing"][data-listing="fedcba9876543210"]');
  await expect(shrine.getByTestId('store-mark')).toHaveText('AI Generated \u00b7 no work shown yet');
  await expect(shrine.getByTestId('store-mark')).toHaveCSS('background-color', 'rgb(215, 54, 44)');
  await expect(shrine.getByTestId('store-unshown')).toContainText('Marked AI until you show your work');
  await expect(shrine.getByTestId('store-unshown')).toContainText('You say it is AI Assisted.');
  await expect(shrine.getByTestId('store-authenticity')).toHaveCount(0);
  await expect(shrine.getByTestId('store-like')).toBeDisabled();

  // For sale, somebody else's: not to be got until payments open.
  const warden = page.locator('[data-testid="store-listing"][data-listing="1111111111111111"]');
  await expect(warden.getByTestId('store-sale')).toHaveText('For sale \u00b7 payments open later');
  await expect(warden.getByTestId('store-get')).toBeDisabled();
  await expect(warden.getByTestId('store-show-work')).toHaveCount(0);

  // Showing the work later: How I Made It and a picture, and the mark is the claim.
  await shrine.getByTestId('store-show-work').click();
  await shrine.getByTestId('work-for-sale').check();
  await shrine.getByTestId('work-save').click();
  await expect(shrine.getByTestId('work-refused')).toContainText('show your work');
  await shrine.getByTestId('work-how').fill('Painted in Krita; the AI upscaled the final.');
  await shrine.getByTestId('work-proofs').setInputFiles({ name: 'layers.png', mimeType: 'image/png', buffer: PNG });
  await page.screenshot({ path: 'test-results/store-show-work.png' });
  await shrine.getByTestId('work-save').click();
  await expect(shrine.getByTestId('store-work')).toHaveCount(0);
  await expect(shrine.getByTestId('store-mark')).toHaveText('AI Assisted');
  await expect(shrine.getByTestId('store-mark')).toHaveCSS('background-color', 'rgb(224, 174, 22)');
  await expect(shrine.getByTestId('store-sale')).toHaveText('For sale \u00b7 payments open later');
  await expect(shrine.getByTestId('store-unshown')).toHaveCount(0);
  await expect(shrine.getByTestId('store-proof')).toHaveCount(1);
  expect(updates.at(-1)).toMatchObject({ id: 'fedcba9876543210', how: 'Painted in Krita; the AI upscaled the final.', claim: 'ai-assisted', forSale: true, addProofs: [{ name: 'layers.png' }] });
});

test('with no accounts on the server, the menu is played as nobody, with no store', async ({ page }) => {
  test.skip(ON_SERVER, 'the games are played on a server that keeps accounts, and this test is signed in to one');
  await page.goto('/?menu');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('sign-in')).toHaveCount(0);
  await expect(page.getByTestId('menu-store')).toHaveCount(0);
  await expect(page.getByTestId('menu-account')).toHaveCount(0);
});
