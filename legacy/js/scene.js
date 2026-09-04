// ============ SCENE MANAGER ============
// Three.js renderer, camera, lights, raycasting, tween loop.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class SceneManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#181b26');
    this.scene.fog = new THREE.Fog('#181b26', 28, 60);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.camera.position.set(0, 13, 12);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0, 0);
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 34;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // Lights
    const hemi = new THREE.HemisphereLight('#bcc7ff', '#2a2418', 0.75);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
    sun.position.set(10, 18, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -16; sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 16; sun.shadow.camera.bottom = -16;
    sun.shadow.camera.far = 50;
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    // Ground catch plane (below everything, catches shadows + dice)
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: '#11131c' })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tweens = [];
    this.frameHooks = [];
    this.clock = new THREE.Clock();

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent.clientWidth, h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Tween: calls fn(progress 0..1, dt) each frame for dur seconds. Returns promise.
  tween(dur, fn) {
    return new Promise(resolve => {
      this.tweens.push({ t: 0, dur, fn, resolve });
    });
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.controls.update();
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const p = Math.min(tw.t / tw.dur, 1);
      tw.fn(p, dt);
      if (p >= 1) { this.tweens.splice(i, 1); tw.resolve(); }
    }
    for (const hook of this.frameHooks) hook(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // Raycast against object list; ev = pointer event. Returns first intersection or null.
  pick(ev, objects) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits[0] || null;
  }

  // Project pointer onto horizontal plane at given y. Returns Vector3 or null.
  pickPlane(ev, y = 0) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? pt : null;
  }

  focusMap(w, h) {
    this.controls.target.set(0, 0, 0);
    const d = Math.max(w, h);
    this.camera.position.set(0, d * 0.95, d * 0.9);
  }
}
