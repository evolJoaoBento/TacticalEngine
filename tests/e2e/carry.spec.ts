import { test, expect, type Page } from '@playwright/test';

/**
 * The Inspector's Select carries anything placed in a room - a prop, an object, a creature, a party
 * start - with the mouse: a press lifts it and the cursor grips, the drag carries it, letting go
 * drops it on the tile under the pointer, and one undo each puts them all back.
 */

type Pos = { x: number; y: number; z?: number };
type Room = {
  width: number;
  height: number;
  heights: number[];
  decos: { position: Pos }[];
  interactables: { position: Pos }[];
  spawns: Pos[];
  encounters: { adversaries: { position: Pos }[] }[];
};
type Kind = 'prop' | 'object' | 'creature' | 'spawn';

async function room(page: Page): Promise<Room> {
  return (JSON.parse(await page.evaluate(() => window.__engine!.exportProject())) as { scenes: Room[] }).scenes[0]!;
}

function placed(scene: Room): Record<Kind, Pos[]> {
  return {
    prop: scene.decos.map((d) => d.position),
    object: scene.interactables.map((i) => i.position),
    creature: scene.encounters.flatMap((e) => e.adversaries.map((a) => a.position)),
    spawn: scene.spawns,
  };
}

const cursor = (page: Page) => page.evaluate(() => getComputedStyle(document.getElementById('gl')!).cursor);

test('carries a prop, an object, a creature and a party start in the Inspector, and undo puts each back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-inspect').click();

  const scene = await room(page);
  const before = placed(scene);
  const key = (p: Pos) => `${p.x},${p.y}`;
  const index = (p: Pos) => p.y * scene.width + p.x;
  const inside = (p: Pos) => p.x >= 0 && p.y >= 0 && p.x < scene.width && p.y < scene.height;
  const everything = Object.values(before).flat();
  const count = new Map<string, number>();
  for (const p of everything) count.set(key(p), (count.get(key(p)) ?? 0) + 1);
  // Each thing is picked where it stands alone, and set down on bare ground at the same height,
  // so nothing else on either tile decides what a press takes or hides the tile from the camera.
  const taken = new Set(everything.map(key));
  // Nothing taller in the rows between it and the camera, which looks from the +Y side: a door in a
  // wall is behind the wall from here, and a press there takes the wall.
  const open = (p: Pos) =>
    [1, 2, 3].every((d) => p.y + d >= scene.height || scene.heights[index({ x: p.x, y: p.y + d })]! <= scene.heights[index(p)]!);
  // Where a tile is on screen, if the board is what is there rather than a panel over it.
  const onCanvas = (p: Pos) =>
    page.evaluate((i) => {
      const s = window.__engine!.screenOf(i);
      return document.elementFromPoint(s.x, s.y)?.id === 'gl' ? s : null;
    }, index(p));
  const target = async (from: Pos): Promise<{ to: Pos; b: { x: number; y: number } } | null> => {
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, -2]]) {
      const to = { x: from.x + dx!, y: from.y + dy! };
      if (!inside(to) || !open(to) || taken.has(key(to)) || scene.heights[index(to)] !== scene.heights[index(from)]) continue;
      const b = await onCanvas(to);
      if (b === null) continue;
      taken.add(key(to));
      return { to, b };
    }
    return null;
  };

  const kinds: Kind[] = ['prop', 'object', 'creature', 'spawn'];
  const moves = new Map<Kind, { at: number; to: Pos }>();
  for (const kind of kinds) {
    let pick: { at: number; from: Pos; to: Pos; a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
    for (const [at, from] of before[kind].entries()) {
      if (!inside(from) || !open(from) || from.z !== undefined || count.get(key(from)) !== 1) continue;
      const a = await onCanvas(from);
      const landing = a === null ? null : await target(from);
      if (a === null || landing === null) continue;
      pick = { at, from, a, ...landing };
      break;
    }
    expect(pick, `a ${kind} standing alone in view, with bare ground in view beside it`).not.toBeNull();
    const { at, from, to, a, b } = pick!;
    moves.set(kind, { at, to });

    await page.mouse.move(a!.x, a!.y);
    await page.mouse.down();
    expect(await cursor(page), `a press on the ${kind} at ${key(from)} takes hold of it`).toBe('grabbing');
    await page.mouse.move((a!.x + b!.x) / 2, (a!.y + b!.y) / 2, { steps: 6 });
    if (kind === 'creature') await page.screenshot({ path: 'test-results/carry-mid.png' });
    // Nothing moves in the document until the pointer lets go.
    expect(placed(await room(page))[kind][at]).toEqual(from);
    await page.mouse.move(b!.x, b!.y, { steps: 6 });
    await page.mouse.up();
    expect(await cursor(page)).not.toBe('grabbing');
  }

  const after = placed(await room(page));
  for (const [kind, { at, to }] of moves) expect(after[kind][at], kind).toEqual(to);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/carry-after.png' });

  for (let i = 0; i < kinds.length; i++) await page.keyboard.press('Control+z');
  expect(placed(await room(page))).toEqual(before);
  expect(errors).toEqual([]);
});

test('Terrain has the same selector, so a room is laid out and nudged without leaving the mode', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.waitForFunction(() => (window.__engine?.frames ?? 0) > 5);
  await page.evaluate(() => window.__engine!.setMode('edit'));
  await page.getByTestId('mode-terrain').click();

  // It is on the rail rather than only in the tool state: a tool that can be held and never
  // seen is what `modes.test.ts` forbids, and the rail is where a person finds this one.
  await page.locator('[data-testid="tool-rail"] [data-tool="select"]').click();
  expect(await page.evaluate(() => window.__engine!.editorTool())).toBe('select');
  // Picking it leaves the strip where it was - it belongs to every tab, so it moves none.
  expect(await page.evaluate(() => window.__engine!.editorTerrainTab())).toBe('tiles');
  expect(await page.evaluate(() => window.__engine!.editorMode())).toBe('terrain');

  const scene = await room(page);
  const index = (p: Pos) => p.y * scene.width + p.x;
  const onCanvas = (p: Pos) =>
    page.evaluate((i) => {
      const s = window.__engine!.screenOf(i);
      return document.elementFromPoint(s.x, s.y)?.id === 'gl' ? s : null;
    }, index(p));

  // The same drag the Inspector does, on the same kind of thing, in Terrain.
  const before = placed(scene);
  const taken = new Set(Object.values(before).flat().map((p) => `${p.x},${p.y}`));
  const open = (p: Pos) =>
    [1, 2, 3].every((d) => p.y + d >= scene.height || scene.heights[index({ x: p.x, y: p.y + d })]! <= scene.heights[index(p)]!);
  let move: { at: number; from: Pos; to: Pos; a: { x: number; y: number }; b: { x: number; y: number } } | null = null;
  for (const [at, from] of before.prop.entries()) {
    if (from.z !== undefined || !open(from)) continue;
    const a = await onCanvas(from);
    if (a === null) continue;
    for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [3, 0], [-3, 0]]) {
      const to = { x: from.x + dx!, y: from.y + dy! };
      if (to.x < 0 || to.y < 0 || to.x >= scene.width || to.y >= scene.height) continue;
      if (taken.has(`${to.x},${to.y}`) || !open(to)) continue;
      if (scene.heights[index(to)] !== scene.heights[index(from)]) continue;
      const b = await onCanvas(to);
      if (b === null) continue;
      move = { at, from, to, a, b };
      break;
    }
    if (move !== null) break;
  }
  expect(move, 'a prop standing in view with bare ground in view beside it').not.toBeNull();

  const { at, from, to, a, b } = move!;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  expect(await cursor(page), 'a press in Terrain takes hold of the prop').toBe('grabbing');
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 });
  // Nothing moves in the document until the pointer lets go, exactly as in the Inspector.
  expect(placed(await room(page)).prop[at]).toEqual(from);
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  expect(await cursor(page)).not.toBe('grabbing');
  expect(placed(await room(page)).prop[at]).toEqual(to);

  // One undo puts it back, and the mode never changed underfoot.
  await page.keyboard.press('Control+z');
  expect(placed(await room(page)).prop[at]).toEqual(from);
  expect(await page.evaluate(() => window.__engine!.editorMode())).toBe('terrain');
  await page.screenshot({ path: 'test-results/carry-terrain.png' });
  expect(errors).toEqual([]);
});
