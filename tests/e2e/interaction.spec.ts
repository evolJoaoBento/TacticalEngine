import { test, expect, type Page } from '@playwright/test';

/**
 * Interactions, authored and played: a creature given a threshold in the Combat panel stops the
 * fight to talk when a blow leaves it low enough; a conversation gets a consequence node that
 * changes a creature's side or runs code; a prop is given the Interaction function.
 */

async function editing(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => {
    window.__engine!.setDiceSpeed(0);
    window.__engine!.setMode('edit');
  });
  return errors;
}

type Placed = { id: string; interaction?: { kind: string; dialogue: string; percent?: number }; position: { x: number; y: number } };

test('a creature given a threshold stops the fight to talk when a blow leaves it low enough', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await editing(page);
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').first().click();
  // A tile whose surface is on screen, so the select below is a real click on the board.
  const spot = await page.evaluate(() => {
    const api = window.__engine!;
    for (let y = 3; y <= 6; y += 1) {
      for (let x = 3; x <= 6; x += 1) {
        const at = api.buildScreenAt(x, y);
        if (document.elementFromPoint(at.x, at.y)?.id === 'gl') return { x, y, at };
      }
    }
    return null;
  });
  expect(spot).not.toBeNull();
  await page.evaluate(({ x, y }) => window.__engine!.buildAt(x, y), spot!);
  await page.evaluate(() => window.__engine!.setTool('select'));
  await page.mouse.click(spot!.at.x, spot!.at.y);
  await expect(page.getByTestId('selected-creature')).toBeVisible();

  // None until something else is chosen; then a conversation and a share of its Hit Points.
  const kind = page.getByTestId('creature-interaction');
  await expect(kind).toHaveValue('');
  await kind.selectOption('threshold');
  await page.getByTestId('creature-dialogue').selectOption('the-listening-pillar');
  await page.getByTestId('creature-threshold').fill('90');
  await page.getByTestId('creature-threshold').blur();
  const placed = await page.evaluate(({ x, y }) => {
    const api = window.__engine!;
    const project = JSON.parse(api.exportProject()) as { scenes: { id: string; encounters: { adversaries: Placed[] }[] }[] };
    const scene = project.scenes.find((s) => s.id === api.editScene())!;
    return scene.encounters.flatMap((e) => e.adversaries).find((a) => a.position.x === x && a.position.y === y)!;
  }, spot!);
  expect(placed.interaction).toEqual({ kind: 'threshold', dialogue: 'the-listening-pillar', percent: 90 });

  // Played, in a fight: it is one of the adversaries until a blow takes a tenth of it, and then it talks.
  await page.evaluate(() => window.__engine!.playAt(null));
  expect(await page.evaluate(() => window.__engine!.startFight())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.inCombat())).toBe(true);
  expect(await page.evaluate((id) => window.__engine!.adversaries().includes(id), placed.id)).toBe(true);
  const talked = await page.evaluate((id) => {
    const api = window.__engine!;
    for (let i = 0; i < 40; i++) {
      api.attack(id);
      if (api.hasDialogue()) return true;
      while (api.pendingKind() !== null && !api.hasDialogue()) api.answer({ kind: 'choose', index: 0 });
      if (api.hasDialogue()) return true;
      if (api.inCombat()) api.endGmTurn();
    }
    return false;
  }, placed.id);
  expect(talked).toBe(true);
  // Talked round: no longer among the adversaries, and the fight is holding - not won - for the conversation.
  expect(await page.evaluate((id) => window.__engine!.adversaries().includes(id), placed.id)).toBe(false);
  expect(await page.evaluate(() => window.__engine!.inCombat())).toBe(true);
  expect(await page.evaluate(() => window.__engine!.dialogueOptions().length)).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/threshold-talk.png' });

  // Played out to its end, whatever it asks.
  await page.evaluate(() => {
    const api = window.__engine!;
    for (let i = 0; i < 30 && api.pendingKind() !== null; i++) {
      const kind = api.pendingKind();
      if (kind === 'dialogue') api.answer(api.dialogueOptions().length > 0 ? { kind: 'choose', index: 0 } : { kind: 'continue' });
      else if (kind === 'check') api.answer({ kind: 'roll' });
      else api.answer({ kind: 'choose', index: 0 });
    }
  });
  expect(await page.evaluate(() => window.__engine!.pendingKind())).toBeNull();
  expect(errors).toEqual([]);
});

test('a conversation gets a consequence that changes sides or runs code, and a prop opens a conversation', async ({ page }) => {
  const errors = await editing(page);
  await page.getByTestId('mode-interaction').click();
  await page.getByTestId('interaction-side').getByRole('button', { name: /the-listening-pillar/ }).click();
  const graph = page.getByTestId('dialogue-graph');
  await expect(graph).toBeVisible();

  await graph.getByTestId('add-consequence').click();
  const consequence = graph.locator('[data-consequence]');
  await expect(consequence).toHaveCount(1);
  const effects = consequence.locator('[data-testid^="consequence-effects-"]');
  const add = effects.locator('[data-role="add-effect"]');
  // The code a project writes is one of the things it can do.
  await expect(add.locator('option[value="run"]')).toHaveCount(1);
  await add.selectOption('setAttitude');
  await expect(effects.locator('[data-role="attitude"]')).toHaveValue('hostile');
  await effects.locator('[data-role="attitude"]').selectOption('friendly');
  await page.screenshot({ path: 'test-results/consequence-node.png' });

  const node = await page.evaluate(() => {
    const project = JSON.parse(window.__engine!.exportProject()) as { dialogues: { id: string; nodes: { id: string; kind?: string; onEnter?: unknown[] }[] }[] };
    return project.dialogues.find((d) => d.id === 'the-listening-pillar')!.nodes.find((n) => n.kind === 'consequence')!;
  });
  expect(node.onEnter).toEqual([{ kind: 'setAttitude', attitude: 'friendly' }]);

  // And a prop that opens a conversation, picked like any other function.
  await graph.getByRole('button', { name: 'Back' }).click();
  await page.evaluate(() => window.__engine!.setTool('prop'));
  expect(await page.evaluate(() => window.__engine!.editAt(9 * 44 + 3))).toBe(true);
  await page.getByTestId('function').selectOption('interaction');
  await page.getByTestId('interaction-dialogue').selectOption('the-listening-pillar');
  const fn = await page.evaluate(() => {
    const api = window.__engine!;
    const project = JSON.parse(api.exportProject()) as { scenes: { id: string; decos: { position: { x: number; y: number }; function?: unknown }[] }[] };
    return project.scenes.find((s) => s.id === api.editScene())!.decos.find((d) => d.position.x === 3 && d.position.y === 9)?.function;
  });
  expect(fn).toEqual({ kind: 'interaction', dialogue: 'the-listening-pillar' });
  expect(errors).toEqual([]);
});

test('a creature is given a shop beside its conversation, and a prop the Shop function', async ({ page }) => {
  const errors = await editing(page);
  await page.getByTestId('mode-combat').click();
  const strip = page.getByTestId('combat-library');
  await strip.getByTestId('library-search').fill('hound');
  await strip.locator('[data-item]').first().click();
  const spot = await page.evaluate(() => {
    const api = window.__engine!;
    for (let y = 3; y <= 6; y += 1) {
      for (let x = 3; x <= 6; x += 1) {
        const at = api.buildScreenAt(x, y);
        if (document.elementFromPoint(at.x, at.y)?.id === 'gl') return { x, y, at };
      }
    }
    return null;
  });
  await page.evaluate(({ x, y }) => window.__engine!.buildAt(x, y), spot!);
  await page.evaluate(() => window.__engine!.setTool('select'));
  await page.mouse.click(spot!.at.x, spot!.at.y);
  await page.getByTestId('creature-interaction').selectOption('friendly');
  await page.getByTestId('creature-shop').check();
  // Sold in gold to start, and what it sells added a line at a time with a price and, if it runs out, a count.
  await expect(page.getByTestId('creature-shop-currency')).toHaveValue('gold');
  await page.getByTestId('creature-shop-pick').selectOption('healing-draught');
  await page.getByTestId('creature-shop-add').click();
  await page.getByTestId('creature-shop-price').fill('7');
  await page.getByTestId('creature-shop-price').blur();
  await page.getByTestId('creature-shop-count').fill('2');
  await page.getByTestId('creature-shop-count').blur();
  const creature = await page.evaluate(({ x, y }) => {
    const api = window.__engine!;
    const project = JSON.parse(api.exportProject()) as { scenes: { id: string; encounters: { adversaries: { position: { x: number; y: number }; interaction?: { shop?: unknown } }[] }[] }[] };
    return project.scenes.find((s) => s.id === api.editScene())!.encounters.flatMap((e) => e.adversaries).find((a) => a.position.x === x && a.position.y === y)!.interaction?.shop;
  }, spot!);
  expect(creature).toEqual({ currency: 'gold', stock: [{ item: 'healing-draught', price: 7, count: 2 }] });

  // A prop sells through the same control.
  await page.evaluate(() => window.__engine!.setTool('prop'));
  expect(await page.evaluate(() => window.__engine!.editAt(9 * 44 + 3))).toBe(true);
  await page.getByTestId('function').selectOption('shop');
  await page.getByTestId('shop-pick').selectOption('round-shield');
  await page.getByTestId('shop-add').click();
  const stall = await page.evaluate(() => {
    const api = window.__engine!;
    const project = JSON.parse(api.exportProject()) as { scenes: { id: string; decos: { position: { x: number; y: number }; function?: unknown }[] }[] };
    return project.scenes.find((s) => s.id === api.editScene())!.decos.find((d) => d.position.x === 3 && d.position.y === 9)?.function;
  });
  expect(stall).toEqual({ kind: 'shop', shop: { currency: 'gold', stock: [{ item: 'round-shield', price: 1 }] } });
  await page.screenshot({ path: 'test-results/shop-editor.png' });
  expect(errors).toEqual([]);
});
