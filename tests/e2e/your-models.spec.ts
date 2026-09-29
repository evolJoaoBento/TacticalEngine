import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Your models, played (`game/your-models.ts`, `tools/your-models.ts`): the signed-in player's own
 * models laid under the project the editor opens, and listed on the Models page; and a project opened
 * with models it carries - an embedded file, one in another player's folder - bringing them into the
 * player's folder on the fly. The tests' own server keeps no accounts, so the routes are stood in for
 * here and what the page sends is read back; the real routes are `tests/unit/your-models.test.ts`'s
 * and were tried end to end against the dev server.
 */

const FOX = 'tests/fixtures/models/Fox.glb';

async function signedInEditing(page: Page, sent: Record<string, unknown>[]): Promise<void> {
  // Bramble's browser: the menu signed them in before, and remembers whose games to show.
  await page.addInitScript(() => localStorage.setItem('tactical:current-user', 'bramble'));
  await page.route('**/__models/mine', (route) =>
    route.fulfill({ json: [{ id: 'fox-mine', file: 'fox-mine.glb', url: '/__models/u/bramble/imported/fox-mine.glb', hash: 'f0', listing: '0123456789abcdef', added: 1 }] }),
  );
  await page.route('**/__models/u/**', (route) => route.fulfill({ path: FOX, contentType: 'model/gltf-binary' }));
  await page.route('**/__models/import', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    sent.push(body);
    await route.fulfill({ json: { model: { id: 'x', file: 'x.glb', url: '/__models/u/bramble/imported/x.glb', hash: String(sent.length), added: 1 }, fresh: true } });
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__engine !== undefined && window.__engine.frames > 2, null, { timeout: 30_000 });
  await page.evaluate(() => {
    window.__engine!.setDiceSpeed(0);
    window.__engine!.setMode('edit');
  });
}

test('your models are under the project the editor opens, and listed on the Models page as yours', async ({ page }) => {
  await signedInEditing(page, []);
  await page.locator('[data-testid="open-content"]').click();
  await page.locator('[data-testid="open-models"]').click();
  await expect(page.getByTestId('models-panel')).toBeVisible();
  const yours = page.locator('[data-testid="your-model"][data-model="fox-mine"]');
  await expect(yours).toContainText('from the Store');
  await expect(yours).toContainText('in this project');
  // Declared in the project, from the player's own folder, as any other model is.
  await expect(page.locator('[data-asset="fox-mine"]')).toBeVisible();
  await expect(page.locator('[data-asset="fox-mine"]')).toContainText('your models · fox-mine.glb');
  // Laid under the project, not a change to it: nothing to save.
  await expect(page.locator('.ph-dirty')).toHaveCount(0);
  expect(await page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as { assets: { id: string; url: string }[] }).assets.find((asset) => asset.id === 'fox-mine')?.url)).toBe('/__models/u/bramble/imported/fox-mine.glb');
  await page.screenshot({ path: 'test-results/your-models.png' });
});

test('a project opened with models it carries brings them into your models on the fly', async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  await signedInEditing(page, sent);
  const fox = `data:model/gltf-binary;base64,${readFileSync(FOX).toString('base64')}`;
  const loaded = await page.evaluate((fox) => {
    const project = JSON.parse(window.__engine!.exportProject()) as { assets: { id: string; url: string }[] };
    project.assets.push({ id: 'carried-fox', url: fox }, { id: 'violets-fox', url: '/__models/u/violet/imported/violets-fox.glb' }, { id: 'my-fox', url: '/__models/u/bramble/imported/my-fox.glb' });
    return window.__engine!.loadProjectText(JSON.stringify(project));
  }, fox);
  expect(loaded).toBe('');
  // The embedded file, sent as it is; another player's, by where it is; the player's own, not at all.
  await expect.poll(() => sent.length).toBe(2);
  expect(sent[0]).toEqual({ name: 'carried-fox.glb', data: fox });
  expect(sent[1]).toEqual({ url: '/__models/u/violet/imported/violets-fox.glb' });
});
