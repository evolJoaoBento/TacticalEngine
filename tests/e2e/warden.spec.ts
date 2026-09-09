import { test, expect, type Page } from '@playwright/test';

/**
 * The conversation with the Warden, in a browser.
 *
 * The dialogue panel was the last player-facing surface no spec had ever
 * driven, and the demo's own quest starts inside this conversation - so this is
 * also the only way to see the journal with something in it.
 */

/** Every panel that puts engine strings in front of a player. */
const PANELS = ['log', 'hud', 'dialogue', 'journal', 'pack', 'choice-prompt', 'check-prompt'] as const;

async function readAll(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const panel of PANELS) {
    const at = page.locator(`[data-testid="${panel}"]`);
    out[panel] = (await at.count()) > 0 ? await at.first().innerText() : '';
  }
  return out;
}

async function ready(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__polyheart !== undefined && window.__polyheart.frames > 2, null, {
    timeout: 30_000,
  });
  await page.evaluate(() => window.__polyheart!.setDiceSpeed(0));
  return errors;
}

test('the Warden talks, the quest starts, and the journal fills', async ({ page }) => {
  const errors = await ready(page);

  // The pillar is the thing with a conversation in it.
  const opened = await page.evaluate(() => {
    const a = window.__polyheart!;
    for (const id of a.objects()) {
      a.standBeside(id);
      const status = a.use(id);
      if (a.hasDialogue()) return { id, status, options: a.dialogueOptions() };
      // Not this one; answer anything it asked and move on.
      while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    }
    return null;
  });
  console.log('OPENED:', JSON.stringify(opened));
  expect(opened, 'something in the room has a conversation in it').not.toBeNull();
  expect(opened!.options.length).toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/warden-open.png' });

  // The quest starts on the first node, before a word is chosen.
  const started = await page.evaluate(() => window.__polyheart!.journal());
  console.log('JOURNAL:', JSON.stringify(started));
  expect(started.length, 'the conversation started the demo quest').toBeGreaterThan(0);

  // Talk it through: take the first reply each time until it runs out.
  const said = await page.evaluate(() => {
    const a = window.__polyheart!;
    const lines: string[][] = [];
    for (let i = 0; i < 12 && a.hasDialogue(); i++) {
      const options = a.dialogueOptions();
      lines.push(options);
      if (options.length === 0) {
        a.answer({ kind: 'continue' });
        continue;
      }
      a.answer({ kind: 'choose', index: 0 });
      // A reply that asks for a roll gets one.
      while (a.pendingKind() === 'check') a.answer({ kind: 'roll' });
    }
    return { lines, journal: a.journal(), log: a.log().slice(-6).map((l) => l.text) };
  });
  console.log('SAID:', JSON.stringify(said, null, 1));

  await page.screenshot({ path: 'test-results/warden-journal.png' });

  // The conversation actually went somewhere, and left the log talking.
  expect(said.lines.length).toBeGreaterThan(1);
  expect(said.log.join(' ').length).toBeGreaterThan(0);

  // And the readout rule this suite exists for: no content id on screen.
  const shown = await readAll(page);
  console.log('PANELS:', JSON.stringify(shown, null, 1));
  const ids = [
    ...said.journal.map((q) => q.id),
    ...said.journal.flatMap((q) => q.done),
    ...(await page.evaluate(() => [...window.__polyheart!.party(), ...window.__polyheart!.objects()])),
  ];
  const leaks: string[] = [];
  for (const [where, text] of Object.entries(shown)) {
    for (const id of ids) if (id !== '' && text.includes(id)) leaks.push(`${where}: ${id}`);
  }
  expect(leaks, 'ids leaking into what a player reads').toEqual([]);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('the word opens the strongbox in the pit, and the quest closes', async ({ page }) => {
  const errors = await ready(page);

  // Talk the Warden round first: the strongbox asks for what he gives up.
  const word = await page.evaluate(() => {
    const a = window.__polyheart!;
    for (const id of a.objects()) {
      a.standBeside(id);
      a.use(id);
      if (!a.hasDialogue()) {
        while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
        continue;
      }
      for (let i = 0; i < 12 && a.hasDialogue(); i++) {
        if (a.dialogueOptions().length === 0) {
          a.answer({ kind: 'continue' });
          continue;
        }
        a.answer({ kind: 'choose', index: 0 });
        while (a.pendingKind() === 'check') a.answer({ kind: 'roll' });
      }
      break;
    }
    return { carried: a.carried().map((i) => i.name), journal: a.journal() };
  });
  console.log('WORD:', JSON.stringify(word));
  expect(word.carried.join(' '), 'the Warden gave up his word').toMatch(/word/i);

  // Down to the pit: a second room, and the travel between them.
  const arrived = await page.evaluate(() => {
    const a = window.__polyheart!;
    const pit = a.scenes().find((s) => s !== a.sceneId());
    const went = pit === undefined ? false : a.travelTo(pit);
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return { went, scene: a.sceneId(), objects: a.objects(), party: a.party(), carried: a.carried().map((i) => i.name) };
  });
  console.log('ARRIVED:', JSON.stringify(arrived));
  expect(arrived.went, 'the party travelled').toBe(true);
  expect(arrived.objects, 'the strongbox is here').toContain('strongbox');
  // What they were carrying came with them, which is what a pack surviving a
  // doorway means.
  expect(arrived.carried.join(' ')).toMatch(/word/i);

  await page.screenshot({ path: 'test-results/pit-arrived.png' });

  // And open it.
  const opened = await page.evaluate(() => {
    const a = window.__polyheart!;
    a.standBeside('strongbox');
    const status = a.use('strongbox');
    while (a.pendingKind() !== null) a.answer({ kind: 'choose', index: 0 });
    return {
      status,
      state: a.objectState('strongbox'),
      journal: a.journal(),
      carried: a.carried().map((i) => i.name),
      log: a.log().slice(-8).map((l) => l.text),
    };
  });
  console.log('OPENED:', JSON.stringify(opened, null, 1));

  await page.screenshot({ path: 'test-results/pit-opened.png' });

  // A chest that paid out is *used*, not *open*: `open` is what makes a door
  // passable and what the inspect card says about one, and a looted strongbox
  // is neither of those things.
  expect(opened.state.used, 'the word did the work').toBe(true);
  // The quest closes: both objectives ticked, the whole thing finished.
  const quest = opened.journal.find((q) => q.id === 'the-wardens-word');
  expect(quest?.status).toBe('completed');
  expect(quest?.done).toContain('open-the-strongbox');
  // And it paid out.
  expect(opened.carried.length).toBeGreaterThan(word.carried.length);

  // Nothing a player reads is a content id, here as anywhere.
  const shown = await readAll(page);
  console.log('PANELS:', JSON.stringify(shown, null, 1));
  // Only the ids that are unmistakably keys. "strongbox" is an id here and
  // also an ordinary noun the objective's own words use - a sweep that flagged
  // it would be reading English and calling it a leak.
  const ids = ['the-wardens-word', 'open-the-strongbox', 'win-the-word', ...arrived.party].filter((id) =>
    id.includes('-'),
  );
  const leaks: string[] = [];
  for (const [where, text] of Object.entries(shown)) {
    for (const id of ids) if (text.includes(id)) leaks.push(`${where}: ${id}`);
  }
  expect(leaks, 'ids leaking into what a player reads').toEqual([]);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});
