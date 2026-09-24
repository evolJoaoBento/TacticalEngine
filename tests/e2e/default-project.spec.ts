import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * The project the page opens on is a file, and saving writes it back.
 *
 * Every other test runs on the demo built from code, because this server is started with
 * `TACTICAL_BOOT=builtin`: a suite that assumes the vault's walls cannot pass on a room where they
 * were moved. These ask for the file with `?boot=file`, and serve it themselves through a route,
 * so what is on disk in `projects/default.json` is never read here and never written.
 */

// Less the models an author imported into it: those are kept in the file as data URLs, one of them
// thirty megabytes, and handing the browser eighty of them through a route overruns the devtools
// pipe (100 MB) and closes the page. Nothing here is about them, and nothing points at a model the
// file does not also list, so a model left out is only a model not drawn.
const shipped = ((project: { assets?: { url: string }[] }) =>
  JSON.stringify({ ...project, assets: (project.assets ?? []).filter((asset) => !asset.url.startsWith('data:')) }))(
  JSON.parse(readFileSync('projects/default.json', 'utf8')),
);

/** Serve the default project from the test instead of the disk. */
async function serveProject(page: Page, status: number, body = ''): Promise<void> {
  await page.route('**/projects/default.json', (route) => route.fulfill({ status, contentType: 'application/json', body }));
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
}

test('a test server opens the demo built from code, and never asks for the file', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/projects/default.json')) asked.push(request.url()); });
  await open(page, '/');
  expect(asked).toEqual([]);
  await expect(page.locator('.hud-card[data-member="kara"]')).toContainText('Quim');
});

test('opened on the file, the page is whatever the file says', async ({ page }) => {
  // A visible difference from the demo built from code, so it is plain which of the two opened.
  const project = JSON.parse(shipped);
  project.party[0].name = 'Probe';
  await serveProject(page, 200, JSON.stringify(project));
  await open(page, '/?boot=file');
  await expect(page.locator('.hud-card[data-member="kara"]')).toContainText('Probe');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('with no file yet, the demo opens and nothing is reported wrong', async ({ page }) => {
  await serveProject(page, 404);
  await open(page, '/?boot=file');
  await expect(page.locator('.hud-card[data-member="kara"]')).toContainText('Quim');
  expect(await page.evaluate(() => window.__engine!.errors)).toEqual([]);
});

test('a file that will not load opens the demo instead, and says so rather than hiding it', async ({ page }) => {
  await serveProject(page, 200, '{"id":"broken"}');
  await open(page, '/?boot=file');
  await expect(page.locator('.hud-card[data-member="kara"]')).toContainText('Quim');
  const errors = await page.evaluate(() => window.__engine!.errors);
  expect(errors.some((line) => line.includes('saved project would not load') && line.includes('left as it is'))).toBe(true);
});

test('this server can never write the default project, whatever a test does', async ({ page }) => {
  // Opened on the file and saved: on a server started for tests the save goes nowhere near the
  // route that writes to disk, and the route itself refuses if anything reaches it directly.
  await serveProject(page, 200, shipped);
  // Where an ordinary save would ask for a file, it is told the dialog was closed: a native
  // picker in a headless browser is a test that hangs, not one that passes.
  let asked = 0;
  await page.exposeFunction('pickerAsked', () => { asked++; });
  await page.addInitScript(() => {
    (window as unknown as { showSaveFilePicker: () => Promise<never> }).showSaveFilePicker = () => {
      (window as unknown as { pickerAsked: () => void }).pickerAsked();
      return Promise.reject(new DOMException('closed', 'AbortError'));
    };
  });
  const writes: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/__project/save')) writes.push(request.method()); });
  await open(page, '/?boot=file');
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.keyboard.press('Control+s');
  // The ordinary save ran - it asked where to put the file - and the route to the disk was not used.
  await expect.poll(() => asked, { timeout: 10_000 }).toBe(1);
  expect(writes).toEqual([]);

  const refused = await page.evaluate(async () => {
    const response = await fetch('/__project/save', { method: 'POST', headers: { 'x-tactical-save': '1' }, body: '{"id":"x","scenes":[1]}' });
    return { status: response.status, text: await response.text() };
  });
  expect(refused.status).toBe(403);
  expect(refused.text).toContain('does not save');
});

test('a save leaves out an embedded model nothing names, and keeps one something does', async ({ page }) => {
  // Two tiny embedded models: one a creature type is drawn with, one nothing names - the shape of the
  // four imported Meshy models a save once wrote back into this file, 80 MB of them.
  const tiny = 'data:application/octet-stream;base64,AAAA';
  const project = JSON.parse(shipped) as { assets: { id: string; url: string }[]; adversaryModels: Record<string, string> };
  project.assets.push({ id: 'named-import', url: tiny }, { id: 'forgotten-import', url: tiny });
  project.adversaryModels = { ...project.adversaryModels, 'nobody-placed': 'named-import' };
  await serveProject(page, 200, JSON.stringify(project));
  // The file picker answers with a file that keeps what is written to it, where the test can read it.
  await page.addInitScript(() => {
    const kept = window as unknown as { written?: string; showSaveFilePicker: () => Promise<unknown> };
    kept.showSaveFilePicker = () => Promise.resolve({
      createWritable: () => Promise.resolve({ write: (text: string) => { kept.written = text; return Promise.resolve(); }, close: () => Promise.resolve() }),
    });
  });
  await open(page, '/?boot=file');
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.keyboard.press('Control+s');
  await expect.poll(() => page.evaluate(() => (window as unknown as { written?: string }).written !== undefined), { timeout: 10_000 }).toBe(true);
  const saved = JSON.parse(await page.evaluate(() => (window as unknown as { written: string }).written)) as { assets: { id: string }[] };
  const ids = saved.assets.map((asset) => asset.id);
  expect(ids).toContain('named-import');
  expect(ids).not.toContain('forgotten-import');
  // The project being edited still declares it: the editor goes on offering what the file left out.
  const declared = await page.evaluate(() => (JSON.parse(window.__engine!.exportProject()) as { assets: { id: string }[] }).assets.map((a) => a.id));
  expect(declared).toContain('forgotten-import');
});
