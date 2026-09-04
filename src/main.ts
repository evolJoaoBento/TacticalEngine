import * as THREE from 'three';
import { render, h } from 'preact';
import { SpikeHud, frameCount } from './spike/SpikeHud';

declare global {
  interface Window {
    __spike?: { webgl2: boolean; frames: number; samples: number[][]; errors: string[] };
  }
}

const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
const gl = renderer.getContext();
const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f14);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 3, 5);
camera.lookAt(0, 0, 0);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(4, 8, 3);
scene.add(sun);
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshStandardMaterial({ color: 0xf6c453, flatShading: true }),
);
scene.add(cube);

window.__spike = { webgl2, frames: 0, samples: [], errors };
render(h(SpikeHud, null), document.getElementById('app')!);

const px = new Uint8Array(4);
function sample(x: number, y: number): number[] {
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return Array.from(px);
}

function frame() {
  cube.rotation.y += 0.02;
  cube.rotation.x += 0.01;
  renderer.render(scene, camera);
  const s = window.__spike!;
  s.frames++;
  frameCount.value = s.frames;
  if (s.frames <= 5) {
    const w = canvas.width;
    const hgt = canvas.height;
    s.samples.push(sample(2, 2), sample(w >> 1, hgt >> 1), sample(w - 3, hgt - 3));
  }
  requestAnimationFrame(frame);
}
frame();
