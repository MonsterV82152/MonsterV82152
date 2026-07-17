/* =====================================================================
   wireframe.js — Three.js robot wireframe background
   ---------------------------------------------------------------------
   - Loads a pre-extracted robot edge list (assets/robot-edges.bin):
      little-endian float32, layout [x0,y0,z0, x1,y1,z1] per segment.
   - Renders two LineSegments layers for depth:
       main  (sage --accent)         opacity ~0.45
       glow  (sage --accent-bright)  opacity ~0.10, additive
     both inside a THREE.Group named `robot`.
   - Slow continuous spin + eased mouse parallax + scroll-coupled
     rotation/scale so the robot rotates & grows subtly as you scroll.
   - Respects prefers-reduced-motion: one static frame, no loop.
   Loaded as an ES module; imports Three.js via the importmap.
   ===================================================================== */

import * as THREE from 'three';

(async function init() {
  const canvas = document.getElementById('wireframe-canvas');
  if (!canvas) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* --- Sage palette (mirror the CSS variables) -------------------- */
  const ACCENT = 0x5cc88a;
  const ACCENT_BRIGHT = 0x9af0bd;
  const BG = 0x0b130d;

  /* --- Load the robot edge binary ---------------------------------- *
   * The blob is a flat f32 stream: every 6 floats = one segment's two
   * endpoints (p0, p1). That matches THREE.LineSegments semantics
   * exactly, so we feed it straight into a position attribute.
   */
  let geometry;
  try {
    const res = await fetch('assets/robot-edges.bin');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buffer = await res.arrayBuffer();
    const positions = new Float32Array(buffer);
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  } catch (err) {
    // Fail soft: never break the rest of the page.
    console.warn('[wireframe] could not load robot edges', err);
    return;
  }

  /* --- Scene & camera --------------------------------------------- */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(BG, 0.04); // calm depth fade for edges

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );

  /* Elevated base pose: we look slightly DOWN at the front-top of the
     robot (low, wide, Y-up, front facing +Z). This reveals the top face
     while still showing the front. The mouse parallax orbits the CAMERA
     around this base position; it never tilts the robot (which would
     break the clean vertical spin). */
  const BASE_X = 0;
  const BASE_Y = 3.5;
  const BASE_Z = 11;
  camera.position.set(BASE_X, BASE_Y, BASE_Z); // robot is large (~6.5 extent); pull back + up
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap at 2
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0); // transparent so CSS bg shows

  /* --- Two-layer robot wireframe (main + faint additive glow) ----- */
  const robot = new THREE.Group();
  robot.name = 'robot';
  scene.add(robot);

  const mainMat = new THREE.LineBasicMaterial({
    color: ACCENT,
    transparent: true,
    opacity: 0.45,
  });
  robot.add(new THREE.LineSegments(geometry, mainMat));

  const glowMat = new THREE.LineBasicMaterial({
    color: ACCENT_BRIGHT,
    transparent: true,
    opacity: 0.10,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  robot.add(new THREE.LineSegments(geometry, glowMat)); // share geometry

  /* --- Initial pose ------------------------------------------------ *
   * The asset is already Y-up with the front facing +Z, standing low
   * and wide, so NO tilt is applied on X or Z. The spin axis is purely
   * vertical (world Y): a positive Y rotation sweeps the front (+Z)
   * toward the camera's right (+X) — i.e. front → right → back → left.
   */
  robot.rotation.x = 0;
  robot.rotation.z = 0;

  /* --- Eased pointer + scroll targets ----------------------------- */
  const ptr = { tx: 0, ty: 0, x: 0, y: 0 };  // target (tx,ty) / current (x,y)
  const scr = { t: 0, v: 0 };                 // target / current (0..1)

  window.addEventListener(
    'pointermove',
    function (e) {
      ptr.tx = (e.clientX / window.innerWidth) * 2 - 1;   // -1..1
      ptr.ty = (e.clientY / window.innerHeight) * 2 - 1;  // -1..1
    },
    { passive: true }
  );

  function readScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    scr.t = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
  }
  window.addEventListener('scroll', readScroll, { passive: true });
  readScroll(); // seed

  /* --- Resize ------------------------------------------------------ */
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  /* --- Animation loop --------------------------------------------- */
  const clock = new THREE.Clock();

  function animate() {
    const t = clock.getElapsedTime();

    // ease pointer + scroll toward their targets (gentle, calm)
    ptr.x += (ptr.tx - ptr.x) * 0.05;
    ptr.y += (ptr.ty - ptr.y) * 0.05;
    scr.v += (scr.t - scr.v) * 0.08;
    const p = scr.v;

    // SPIN purely on Y (upright axis): front(+Z) → right(+X) → back → left.
    // Keep the scroll GROW; never tilt on X/Z so the vertical spin stays clean.
    robot.rotation.x = 0;
    robot.rotation.z = 0;
    robot.rotation.y = t * 0.06 + p * 1.4;
    robot.scale.setScalar(1 + p * 0.12);

    // Mouse parallax orbits the CAMERA around its elevated base position
    // (subtle). Tilting the robot would break the vertical spin.
    camera.position.x = BASE_X + ptr.x * 0.8;
    camera.position.y = BASE_Y + (-ptr.y) * 0.5;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  }

  if (reduceMotion) {
    // single static frame — no loop, no scroll coupling
    renderer.render(scene, camera);
  } else {
    animate();
  }
})();
