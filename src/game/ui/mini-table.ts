/**
 * New Game's Model step, as miniatures on the table: the figures stand on the wood, seen from above,
 * and are picked up, carried and put down anywhere, or taken up close and turned over in the hand.
 *
 * The table is the page's own wood (`table.css`); over it lies one transparent WebGL canvas looking
 * straight down on the table top. The figures are built as the board builds them (`figureOf`) and
 * stand on an invisible ground that takes only their shadows, so each casts one on the wood. They come
 * onto the table from off its left edge, one after another, into a line - everything that enters the
 * table enters from the left. A press on one and a drag picks it up - it lifts and leans the way it is
 * carried - and letting go puts it down where it is. A double-click on the bare table walks them all
 * back into their line.
 *
 * A press that never moves is a click, handed to `onSelect`, and the one clicked is **inspected**
 * (`inspect`): it rises off the table to the middle of the view, facing the player, the rest dimmed
 * under a veil. Dragging left and right anywhere turns it about its own upright axis (`spun`), so it
 * can be seen from every side, always standing upright; dragging up and down does nothing. A click away
 * from it puts it back (`onSelect(null)`), and so does Escape.
 *
 * Each figure's name plate is the page's, not the canvas's: `NewGame.tsx` renders them, one per figure
 * under `[data-choice]`, and every frame this puts each under its figure's feet. A plate says
 * `data-ready` while its figure stands on the table, to be picked up. The canvas says which figure is inspected
 * (`data-inspecting`) and how far it has been turned from facing the player (`data-turned`, degrees).
 */

import { AmbientLight, Box3, DirectionalLight, Group, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Plane, PlaneGeometry, Quaternion, Ray, Raycaster, Scene, ShadowMaterial, Vector2, Vector3, WebGLRenderer, type Object3D } from 'three';
import type { AssetLibrary } from '../../engine/render/assets';
import { figureOf, type Figure } from './mini-portraits';
import { hoverArt } from '../art-provenance';

/** The camera's vertical field of view, in degrees. It looks straight down. */
const FOV = 30;
/** How far apart the figures stand in their line at least, in tiles; wider ones stand wider. */
const SPACING = 1.3;
/** How many figures' line the camera always has room for: fewer stand in the middle of it, as small. */
const TABLE_SEATS = 6;
/** How far a press travels before it is a drag and not a click, in pixels. */
const DRAG_START = 5;
/** How long a figure takes to come on from the left, and how long after the one before it. */
const ENTER_S = 0.6;
const ENTER_STAGGER_S = 0.07;
/** How high a figure is held, as a part of its height. */
const HELD_AT = 0.22;
/** How long the veil takes to go once the table is being swept away, in seconds: gone before its edge can be seen moving. */
const VEIL_OUT_S = 0.1;
/** How long the line takes to re-form, in step with the cards' gather in `table.css`. */
const GATHER_S = 0.46;
/** How much of the view's height an inspected figure fills, whichever way it is turned. */
const INSPECT_FILL = 0.5;
/** How far an inspected figure turns for a pixel dragged left or right, in radians. */
const SPIN = 0.011;
/** How far down the view an inspected figure is held, as a part of its height: a little below the middle, clear of the title. */
const INSPECT_AT = 0.53;
/** How much of the view round where it is held is the inspected figure's, as parts of its height: a click there is not a put-back. */
const INSPECT_HALF = { across: 0.23, down: 0.32 };

/** Where a figure stands on the table: across it, and into it (away from the player is negative). */
export interface Spot {
  x: number;
  z: number;
}

/** How far apart a line stands, for figures reaching this far at the widest: none of them touching. */
export function spacingFor(widest: number): number {
  return Math.max(SPACING, widest * 1.7);
}

/** How far out a figure's base goes: its reach, but never more than a base that size would be. */
export function baseOf(figure: Pick<Figure, 'height' | 'reach'>): number {
  return Math.min(figure.reach, figure.height * 0.3);
}

/** A line of `count` figures, centred on the table. */
export function lineUp(count: number, spacing = SPACING): Spot[] {
  return Array.from({ length: count }, (_, i) => ({ x: (i - (count - 1) / 2) * spacing, z: 0 }));
}

/** How high over the table the camera hangs to see a line `span` wide, whole, on a view of this shape. */
export function fitDistance(span: number, aspect: number): number {
  const half = Math.tan(((FOV / 2) * Math.PI) / 180);
  return Math.max(4, (span * 0.55) / (half * aspect));
}

/** How far across the table the left edge of the view is, from its middle, seen from this high. */
export function leftEdge(distance: number, aspect: number): number {
  return -distance * Math.tan(((FOV / 2) * Math.PI) / 180) * aspect;
}

/**
 * Where a figure coming onto the table is across it, `t` seconds after it set off from `from` (off the
 * left edge) for `home`: waiting off the table before it sets off, and slowing as it arrives.
 */
export function enterX(t: number, from: number, home: number): number {
  if (t <= 0) return from;
  if (t >= ENTER_S) return home;
  const p = t / ENTER_S;
  return from + (home - from) * (1 - (1 - p) ** 3);
}

/** How far from the camera an inspected figure is held, to fill as much of the view as it should. */
export function inspectDistance(figure: Pick<Figure, 'height' | 'reach'>): number {
  const radius = Math.hypot(figure.height / 2, figure.reach);
  return radius / (INSPECT_FILL * Math.tan(((FOV / 2) * Math.PI) / 180));
}

/** A figure turned to face a camera looking straight down: its head to the top of the view. */
export function facingUp(): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
}

/**
 * An inspected figure turned by a drag `dx` pixels to the right: about its own upright axis only - which,
 * held up to a camera looking straight down, lies along the view's up and down - so the side nearest the
 * player goes the way the pointer went, and it never tips over.
 */
export function spun(turn: Quaternion, dx: number): Quaternion {
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), dx * SPIN).multiply(turn);
}

/** How far a figure has been turned from facing the player, in degrees. */
export function turnedBy(turn: Quaternion): number {
  return (turn.angleTo(facingUp()) * 180) / Math.PI;
}

/** What a figure is, to be hit by a pointer: where it stands, how high it is held, how tall and wide. */
export interface Standing {
  id: string;
  x: number;
  z: number;
  y: number;
  height: number;
  reach: number;
}

/** The figure a ray from the camera meets first, if it meets one: each is taken as the box it stands in. */
export function miniUnder(ray: Ray, minis: readonly Standing[]): string | null {
  let best: { id: string; distance: number } | null = null;
  const box = new Box3();
  const hit = new Vector3();
  for (const mini of minis) {
    const r = Math.max(Math.min(mini.reach * 0.75, mini.height * 0.3), 0.12);
    box.min.set(mini.x - r, mini.y, mini.z - r);
    box.max.set(mini.x + r, mini.y + mini.height, mini.z + r);
    if (ray.intersectBox(box, hit) === null) continue;
    const distance = hit.distanceTo(ray.origin);
    if (best === null || distance < best.distance) best = { id: mini.id, distance };
  }
  return best?.id ?? null;
}

interface Mini {
  id: string;
  figure: Figure | null;
  /** What is moved and turned: the figure hangs in it by its middle, so it turns about its middle. */
  holder: Group | null;
  x: number;
  z: number;
  /** How high it is lifted now; it eases to what it should be. */
  lift: number;
  /** Seconds since it might set off onto the table, below zero while it waits its turn. */
  enter: number;
  held: boolean;
  /** Put down somewhere by hand: it stays there until the line is formed again. */
  placed: boolean;
  lean: { x: number; z: number };
  facing: number;
  home: Spot;
  going: { from: Spot; t: number } | null;
  /** How far it is off the table and up for inspecting, 0 to 1, and how it is turned up there. */
  up: number;
  turn: Quaternion;
  /** Its meshes: they cast shadows on the table while it stands there, and none while it is up close. */
  meshes: Object3D[];
}

type Press =
  | { kind: 'carry'; id: string; sx: number; sy: number; moved: boolean; grab: Spot; last: Spot }
  | { kind: 'turn'; sx: number; sy: number; lx: number; ly: number; moved: boolean };

export class MiniTable {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.05, 400);
  private readonly veil: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly minis: Mini[];
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private readonly raycaster = new Raycaster();
  private distance = 0;
  private spacing = SPACING;
  private inspected: string | null = null;
  /** How much of the veil is left: all of it, until the table is swept away (`leave`). */
  private veilLeft = 1;
  private leaving = false;
  private pressed: Press | null = null;
  private frame = 0;
  private last = performance.now();
  private readonly still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly assets: AssetLibrary,
    private readonly plates: HTMLElement,
    ids: readonly string[],
    private readonly onSelect: (id: string | null) => void,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;

    this.scene.add(new HemisphereLight(0xfff1dc, 0x4a2e18, 1.3));
    this.scene.add(new AmbientLight(0xffffff, 0.3));
    // The lamp over the table: warm, high and a little to the left, casting the figures' shadows.
    const lamp = new DirectionalLight(0xfff0d8, 2.4);
    lamp.position.set(-4, 12, 3);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    Object.assign(lamp.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 0.5, far: 60 });
    lamp.shadow.camera.updateProjectionMatrix();
    lamp.shadow.radius = 4;
    this.scene.add(lamp);
    const table = new Mesh(new PlaneGeometry(80, 80), new ShadowMaterial({ opacity: 0.38 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
    // Drawn between the table and a figure being inspected, dimming the rest.
    this.veil = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthWrite: false }));
    this.veil.rotation.x = -Math.PI / 2;
    this.scene.add(this.veil);

    const spots = lineUp(ids.length);
    this.minis = ids.map((id, i) => ({
      id, figure: null, holder: null, x: spots[i]!.x, z: spots[i]!.z, lift: 0, enter: this.still ? ENTER_S : -i * ENTER_STAGGER_S,
      held: false, placed: false, lean: { x: 0, z: 0 }, facing: (Math.random() - 0.5) * 0.5, home: spots[i]!, going: null,
      up: 0, turn: facingUp(), meshes: [],
    }));

    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    canvas.addEventListener('pointercancel', this.up);
    canvas.addEventListener('dblclick', this.twice);
    canvas.addEventListener('pointerleave', this.left);
    window.addEventListener('keydown', this.key);
    this.frame = requestAnimationFrame(this.draw);
  }

  /** The one taken up to be looked at, facing the player; or none, and it goes back where it stood. */
  inspect(id: string | null): void {
    if (id === this.inspected) return;
    this.inspected = id;
    const mini = this.minis.find((entry) => entry.id === id);
    if (mini !== undefined) {
      mini.turn = facingUp();
      mini.held = false;
    }
    delete this.canvas.dataset.turned;
    if (id === null) delete this.canvas.dataset.inspecting;
    else this.canvas.dataset.inspecting = id;
    this.plates.classList.toggle('is-inspecting', id !== null);
  }

  /** The table is being swept away: the veil goes at once, so its edge is never seen crossing the page. */
  leave(): void {
    this.leaving = true;
  }

  /** Every figure back in its line. */
  gather(): void {
    for (const mini of this.minis) {
      mini.placed = false;
      mini.going = { from: { x: mini.x, z: mini.z }, t: 0 };
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.up);
    this.canvas.removeEventListener('dblclick', this.twice);
    this.canvas.removeEventListener('pointerleave', this.left);
    window.removeEventListener('keydown', this.key);
    hoverArt(null);
    this.renderer.forceContextLoss();
    this.renderer.dispose();
  }

  // ---- The pointer.

  private rayAt(clientX: number, clientY: number): Ray {
    const box = this.canvas.getBoundingClientRect();
    const point = new Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    this.raycaster.setFromCamera(point, this.camera);
    return this.raycaster.ray;
  }

  private standing(): Standing[] {
    return this.minis.flatMap((mini) => (mini.figure === null || mini.enter < ENTER_S || mini.up > 0.01 ? [] : [{ id: mini.id, x: mini.x, z: mini.z, y: mini.lift, height: mini.figure.height, reach: mini.figure.reach }]));
  }

  private groundAt(clientX: number, clientY: number): Spot | null {
    const point = this.rayAt(clientX, clientY).intersectPlane(this.ground, new Vector3());
    return point === null ? null : { x: point.x, z: point.z };
  }

  /** Whether a point on the page is on the figure being inspected, held in the middle of the view. */
  private onInspected(clientX: number, clientY: number): boolean {
    const box = this.canvas.getBoundingClientRect();
    return Math.abs(clientX - (box.left + box.width / 2)) < box.height * INSPECT_HALF.across && Math.abs(clientY - (box.top + box.height * INSPECT_AT)) < box.height * INSPECT_HALF.down;
  }

  private readonly down = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    if (this.inspected !== null) {
      this.pressed = { kind: 'turn', sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const id = miniUnder(this.rayAt(e.clientX, e.clientY), this.standing());
    if (id === null) return;
    const mini = this.minis.find((entry) => entry.id === id)!;
    const at = this.groundAt(e.clientX, e.clientY) ?? { x: mini.x, z: mini.z };
    this.pressed = { kind: 'carry', id, sx: e.clientX, sy: e.clientY, moved: false, grab: { x: at.x - mini.x, z: at.z - mini.z }, last: { x: mini.x, z: mini.z } };
    this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private readonly move = (e: PointerEvent): void => {
    const press = this.pressed;
    if (press === null) {
      const under = this.inspected !== null ? (this.onInspected(e.clientX, e.clientY) ? this.inspected : null) : miniUnder(this.rayAt(e.clientX, e.clientY), this.standing());
      this.canvas.style.cursor = under !== null ? 'grab' : '';
      // How the mini under the pointer was made, in the corner (`ui/AiNote.tsx`).
      hoverArt(under === null ? null : `model:${under}`);
      return;
    }
    if (!press.moved && Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < DRAG_START) return;
    if (press.kind === 'turn') {
      press.moved = true;
      this.canvas.style.cursor = 'grabbing';
      const mini = this.minis.find((entry) => entry.id === this.inspected);
      if (mini !== undefined) {
        mini.turn = spun(mini.turn, e.clientX - press.lx);
        this.canvas.dataset.turned = turnedBy(mini.turn).toFixed(0);
      }
      press.lx = e.clientX;
      press.ly = e.clientY;
      return;
    }
    const mini = this.minis.find((entry) => entry.id === press.id)!;
    if (!press.moved) {
      press.moved = true;
      mini.held = true;
      mini.placed = true;
      mini.going = null;
      this.canvas.style.cursor = 'grabbing';
    }
    const at = this.groundAt(e.clientX, e.clientY);
    if (at === null) return;
    mini.x = at.x - press.grab.x;
    mini.z = at.z - press.grab.z;
    // It leans the way it is carried, a little, and straightens as it slows.
    mini.lean.x += (mini.x - press.last.x) * 0.9;
    mini.lean.z += (mini.z - press.last.z) * 0.9;
    press.last = { x: mini.x, z: mini.z };
  };

  private readonly up = (e: PointerEvent): void => {
    const press = this.pressed;
    this.pressed = null;
    if (press === null) return;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grab';
    if (press.kind === 'turn') {
      // A click away from the figure in the hand puts it back.
      if (!press.moved && !this.onInspected(e.clientX, e.clientY)) this.onSelect(null);
      return;
    }
    const mini = this.minis.find((entry) => entry.id === press.id)!;
    mini.held = false;
    // A press that never went anywhere is a click: take it up to look at.
    if (!press.moved) this.onSelect(press.id);
  };

  private readonly twice = (e: MouseEvent): void => {
    if (this.inspected !== null) return;
    if (miniUnder(this.rayAt(e.clientX, e.clientY), this.standing()) !== null) return;
    this.gather();
  };

  /** The pointer has left the table: no mini is under it. */
  private readonly left = (): void => {
    hoverArt(null);
  };

  private readonly key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && this.inspected !== null) this.onSelect(null);
  };

  // ---- A frame.

  private readonly draw = (): void => {
    this.frame = requestAnimationFrame(this.draw);
    const now = performance.now();
    const delta = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;

    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const density = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    if (this.canvas.width !== Math.round(width * density) || this.canvas.height !== Math.round(height * density)) {
      this.renderer.setPixelRatio(density);
      this.renderer.setSize(width, height, false);
    }

    let widest = 0;
    for (const mini of this.minis) {
      if (mini.figure === null) this.stand(mini);
      if (mini.figure !== null) widest = Math.max(widest, mini.figure.reach);
    }
    // A wider figure arriving spreads the line; one put down by hand stays put.
    const spacing = spacingFor(widest);
    if (Math.abs(spacing - this.spacing) > 1e-6) {
      this.spacing = spacing;
      const spots = lineUp(this.minis.length, spacing);
      this.minis.forEach((mini, i) => {
        mini.home = spots[i]!;
        if (!mini.placed && !mini.held && mini.going === null && mini.enter >= ENTER_S) mini.going = { from: { x: mini.x, z: mini.z }, t: 0 };
      });
    }

    // Straight above the table, high enough for a full line however few stand there, so a figure is
    // the same size on every table; the line a little below the middle, clear of the title.
    const aspect = width / height;
    const span = this.spacing * Math.max(this.minis.length - 1, TABLE_SEATS - 1) + widest * 2 + SPACING;
    const wanted = fitDistance(span, aspect);
    this.distance = this.distance === 0 ? wanted : this.distance + (wanted - this.distance) * Math.min(1, delta * 4);
    this.camera.aspect = aspect;
    this.camera.up.set(0, 0, -1);
    this.camera.position.set(0, this.distance, 0);
    this.camera.lookAt(0, 0, 0);
    this.camera.setViewOffset(width, height, 0, -height * 0.06, width, height);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    const offLeft = leftEdge(this.distance, aspect) - widest - SPACING;
    this.raycaster.setFromCamera(new Vector2(0, 1 - 2 * INSPECT_AT), this.camera);
    const sight = this.raycaster.ray.clone();

    let veil = 0;
    let veilAt = 0;
    for (const mini of this.minis) {
      const figure = mini.figure;
      const holder = mini.holder;
      if (figure === null || holder === null) continue;
      mini.enter += delta;
      if (mini.enter < ENTER_S) {
        mini.x = enterX(mini.enter, offLeft, mini.home.x);
        mini.z = mini.home.z;
      }
      if (mini.going !== null) {
        mini.going.t = Math.min(1, mini.going.t + delta / GATHER_S);
        const ease = 1 - (1 - mini.going.t) ** 3;
        mini.x = mini.going.from.x + (mini.home.x - mini.going.from.x) * ease;
        mini.z = mini.going.from.z + (mini.home.z - mini.going.from.z) * ease;
        if (mini.going.t >= 1) mini.going = null;
      }
      const lift = mini.held ? figure.height * HELD_AT : 0;
      mini.lift += (lift - mini.lift) * Math.min(1, delta * 14);
      mini.lean.x *= Math.max(0, 1 - delta * 7);
      mini.lean.z *= Math.max(0, 1 - delta * 7);
      const inspected = mini.id === this.inspected;
      mini.up = this.still ? (inspected ? 1 : 0) : mini.up + ((inspected ? 1 : 0) - mini.up) * Math.min(1, delta * 9);
      figure.mixer?.update(delta);
      const shadows = mini.up < 0.3;
      if (mini.meshes[0] !== undefined && mini.meshes[0].castShadow !== shadows) for (const mesh of mini.meshes) mesh.castShadow = shadows;

      // On the table: standing where it is, leaning as it is carried. Up for inspecting: in the middle
      // of the view, turned as the player has turned it. And anywhere between, on its way.
      const onTable = new Vector3(mini.x, mini.lift + figure.height / 2, mini.z);
      const tilt = (v: number) => Math.max(-0.35, Math.min(0.35, v));
      const standing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), mini.facing)
        .premultiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt(mini.lean.z)))
        .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -tilt(mini.lean.x)));
      const held = sight.at(inspectDistance(figure), new Vector3());
      const ease = mini.up * mini.up * (3 - 2 * mini.up);
      holder.position.lerpVectors(onTable, held, ease);
      holder.quaternion.slerpQuaternions(standing, mini.turn, ease);
      if (mini.up > veil) {
        veil = mini.up;
        veilAt = Math.max(0.05, held.y - Math.hypot(figure.height / 2, figure.reach) * 1.2);
      }
    }
    if (this.leaving) this.veilLeft = this.still ? 0 : Math.max(0, this.veilLeft - delta / VEIL_OUT_S);
    this.veil.material.opacity = 0.55 * veil * this.veilLeft;
    this.veil.visible = this.veil.material.opacity > 0.005;
    this.veil.position.y = veilAt;

    this.renderer.render(this.scene, this.camera);
    this.placePlates(width, height);
  };

  /** A figure stood on the table, once its file has loaded. */
  private stand(mini: Mini): void {
    const template = this.assets.template(mini.id);
    const spec = this.assets.spec(mini.id);
    if (template === undefined || spec === undefined) {
      this.assets.request(mini.id);
      return;
    }
    const figure = figureOf(template, spec);
    figure.root.traverse((child: Object3D) => {
      if ((child as Mesh).isMesh) mini.meshes.push(child);
    });
    // Hung by its middle, so that turning it in the hand turns it about its middle.
    figure.root.position.y = -figure.height / 2;
    const holder = new Group();
    holder.add(figure.root);
    this.scene.add(holder);
    mini.figure = figure;
    mini.holder = holder;
    // One that loads late comes on as it arrives, not all at once with the rest long in place.
    if (mini.enter > 0 && !this.still) mini.enter = 0;
  }

  /** Each name plate under its figure's feet. */
  private placePlates(width: number, height: number): void {
    const point = new Vector3();
    for (const mini of this.minis) {
      const plate = this.plates.querySelector<HTMLElement>(`[data-choice="${CSS.escape(mini.id)}"]`);
      if (plate === null) continue;
      point.set(mini.x, 0, mini.z + (mini.figure === null ? 0.3 : baseOf(mini.figure))).project(this.camera);
      const x = ((point.x + 1) / 2) * width;
      const y = ((1 - point.y) / 2) * height;
      plate.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, 6px)`;
      // Ready once it is on the table and standing there: not coming on, and not up close or on its way down.
      const ready = mini.figure !== null && mini.enter >= ENTER_S && mini.up < 0.01;
      if (ready) plate.dataset.ready = '1';
      else delete plate.dataset.ready;
      plate.classList.toggle('is-held', mini.held || mini.up > 0.05);
    }
  }
}
