// Keyboard + mouse/touch input.
//
// Keyboard uses KeyboardEvent.code names: 'KeyW', 'ArrowUp', 'Space', 'ShiftLeft', 'Digit1' …
//   input.isDown('Space')        held right now
//   input.wasPressed('KeyE')     went down this frame (one-shot actions)
//   input.axis('KeyA', 'KeyD')   -1 / 0 / +1
//   input.move()                 { x, z } from WASD + arrow keys, length ≤ 1
//   input.move('wasd') / ('arrows')  — one player each, for local 2-player games
//
// Pointer:
//   input.pointer               { x, y } in normalised device coords (-1..1), plus .down
//   input.onClick(fn)           fn(event) on a click that wasn't a camera drag
//   input.pick(objects, event?) nearest intersection { object, point, … } or null
//   input.pickGround(y, event?) point where the pointer ray hits the plane at height y
//   input.isDown('Mouse0')      mouse buttons work like keys: Mouse0 left, Mouse1 middle, Mouse2 right
//
// Mouse look (first-person / orbit cameras):
//   input.mouse                 { dx, dy, wheel } movement this frame (pixels), reset every frame
//   input.lockPointer()         hide the cursor and get endless mouse movement (call from a click)
//   input.locked                true while the pointer is locked; input.unlockPointer() / Esc to leave
//
// Gamepad (any standard controller, no setup):
//   const pad = input.pad()     null if none connected, else:
//   pad.move                    { x, z } left stick (same shape as input.move())
//   pad.look                    { x, y } right stick
//   pad.isDown('a') / pad.wasPressed('start')   a b x y lb rb lt rt back start ls rs up down left right
import * as THREE from 'three';

const SETS = {
  wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  arrows: { up: ['ArrowUp'], down: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'] },
  both: { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] },
};

const PAD_BUTTONS = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right'];

/** Radial dead zone: small stick drift reads as 0, and the rest is rescaled to 0..1. */
export function deadZone(x, y, zone = 0.15) {
  const len = Math.hypot(x, y);
  if (len < zone) return { x: 0, y: 0 };
  const k = Math.min(1, (len - zone) / (1 - zone)) / len;
  return { x: x * k, y: y * k };
}

const isTyping = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target?.tagName);

export function createInput(canvas, camera) {
  const down = new Set();
  const pressed = new Set();
  const released = new Set();
  const clickHandlers = new Set();
  const pointer = { x: 0, y: 0, down: false, event: null };
  const raycaster = new THREE.Raycaster();
  const mouse = { dx: 0, dy: 0, wheel: 0 };
  const padPrev = new Map(); // gamepad index → buttons held last frame (for wasPressed)
  let downAt = null;

  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    if (!down.has(e.code)) pressed.add(e.code);
    down.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    down.delete(e.code);
    released.add(e.code);
  });
  window.addEventListener('blur', () => down.clear());

  // Mouse movement is tracked on window so it keeps working while the pointer is locked.
  window.addEventListener('mousemove', (e) => {
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  });
  canvas.addEventListener('wheel', (e) => (mouse.wheel += Math.sign(e.deltaY)), { passive: true });
  window.addEventListener('pointerup', (e) => down.delete(`Mouse${e.button}`));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-drag shouldn't open a menu

  const updatePointer = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    pointer.event = e;
  };
  canvas.addEventListener('pointermove', updatePointer);
  canvas.addEventListener('pointerdown', (e) => {
    updatePointer(e);
    pointer.down = true;
    if (!down.has(`Mouse${e.button}`)) pressed.add(`Mouse${e.button}`);
    down.add(`Mouse${e.button}`);
    downAt = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    updatePointer(e);
    pointer.down = false;
    // A drag (e.g. orbiting the camera) is not a click.
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 6) for (const fn of clickHandlers) fn(e);
    downAt = null;
  });

  const rayFrom = (event) => {
    if (event) updatePointer(event);
    raycaster.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera);
    return raycaster;
  };

  const readPad = (index) => {
    const gp = navigator.getGamepads?.()[index];
    if (!gp?.connected) return null;
    const held = PAD_BUTTONS.map((_, i) => (gp.buttons[i]?.value ?? 0) > 0.5);
    const prev = padPrev.get(index) ?? held.map(() => false);
    if (!padPrev.has(index)) padPrev.set(index, prev);
    const left = deadZone(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
    const right = deadZone(gp.axes[2] ?? 0, gp.axes[3] ?? 0);
    const at = (name) => PAD_BUTTONS.indexOf(name);
    return {
      id: gp.id,
      move: { x: left.x, z: left.y },
      look: { x: right.x, y: right.y },
      isDown: (name) => held[at(name)] ?? false,
      wasPressed: (name) => (held[at(name)] && !prev[at(name)]) ?? false,
      value: (name) => gp.buttons[at(name)]?.value ?? 0, // analogue triggers: 0..1
      raw: gp,
    };
  };

  return {
    pointer,
    raycaster,
    mouse,
    get locked() {
      return document.pointerLockElement === canvas;
    },
    lockPointer() {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.()?.catch?.(() => {});
    },
    unlockPointer() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    pad: (index = 0) => readPad(index),
    isDown: (code) => down.has(code),
    wasPressed: (code) => pressed.has(code),
    wasReleased: (code) => released.has(code),
    axis: (neg, pos) => (down.has(pos) ? 1 : 0) - (down.has(neg) ? 1 : 0),
    move(set = 'both') {
      const keys = SETS[set];
      const any = (codes) => codes.some((c) => down.has(c));
      const x = (any(keys.right) ? 1 : 0) - (any(keys.left) ? 1 : 0);
      const z = (any(keys.down) ? 1 : 0) - (any(keys.up) ? 1 : 0);
      const len = Math.hypot(x, z) || 1;
      return { x: x / len, z: z / len };
    },
    onClick(fn) {
      clickHandlers.add(fn);
      return () => clickHandlers.delete(fn);
    },
    pick(objects, event) {
      return rayFrom(event).intersectObjects(objects, true)[0] ?? null;
    },
    pickGround(y = 0, event) {
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
      return rayFrom(event).ray.intersectPlane(plane, new THREE.Vector3());
    },
    /** Called by the engine at the end of each frame. */
    endFrame() {
      pressed.clear();
      released.clear();
      mouse.dx = mouse.dy = mouse.wheel = 0;
      // Remember which gamepad buttons were held, so wasPressed fires once per press.
      for (const index of padPrev.keys()) {
        const gp = navigator.getGamepads?.()[index];
        padPrev.set(index, PAD_BUTTONS.map((_, i) => (gp?.buttons[i]?.value ?? 0) > 0.5));
      }
    },
  };
}
