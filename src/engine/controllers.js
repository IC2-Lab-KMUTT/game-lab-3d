// Ready-made player controllers: input + movement + camera in one call, tuned to feel good.
// Import the one you need in your game:
//
//   import { thirdPerson, firstPerson, topDown, vehicle } from '../../engine/controllers.js';
//
//   const ctl = thirdPerson(engine, player, { colliders: [ground, ...platforms], animator: anim });
//   const ctl = thirdPerson(engine, player, { camera: 'side', floor: null })   // 2.5D platformer
//   const ctl = firstPerson(engine, { position: [0, 0, 5], colliders: walls }) // click to lock the mouse
//   const ctl = topDown(engine, player, { colliders: walls })                  // twin-stick: WASD + aim with mouse
//   const ctl = vehicle(engine, kart, { colliders: walls })                    // W/S throttle, A/D steer, Space drift
//
//   ctl.onJump(() => audio.sfx('jump'));     ctl.onLand(({ speed }) => fx.shake(speed * 0.02));
//   ctl.on('step' | 'fall' | 'bump' | 'fire' | 'driftStart' | 'driftEnd', fn)
//   ctl.velocity / ctl.grounded / ctl.state / ctl.speed     read them for HUD, sounds, animation
//   ctl.enabled = false                      ignore input (menus, cutscenes); gravity keeps working
//   ctl.spawn.set(x, y, z)                   where you respawn after falling below killY (checkpoints!)
//   ctl.teleport(position)                   ctl.destroy()  (before switching to another controller)
//
// "colliders" are meshes you can stand on and bump into (flat-ish faces are floor, steep ones are walls).
// "floor" is an endless invisible floor height (default 0); set floor: null when there are pits to fall into.
// Every number that affects feel is an option; the defaults are in THIRD_PERSON, FIRST_PERSON, TOP_DOWN, VEHICLE.
// Gamepads work automatically: left stick moves, right stick looks/aims, A jumps, LB sprints, RT fires / drives.
import * as THREE from 'three';
import { createEvents } from './events.js';
import { damp, dampAngle, orbitOffset, cameraClearance } from './camera.js';

// ─── Default feel settings (copy into your game's SETTINGS and tweak) ────────────────────────────

const MOVEMENT = {
  speed: 5, // walking/jogging speed (units per second)
  sprintSpeed: 8.5, // while Shift is held
  accel: 45, // how fast you reach full speed (higher = snappier)
  friction: 35, // how fast you stop when you let go
  airControl: 0.4, // 0 = no steering in the air, 1 = full
  gravity: 32, // stronger than real gravity: jumps feel less floaty
  jumpHeight: 1.8, // peak height of a full jump
  jumpCut: 0.45, // releasing Space early keeps this much upward speed (variable jump height)
  airJumps: 0, // 1 = double jump
  coyoteTime: 0.12, // seconds after walking off a ledge you can still jump
  jumpBuffer: 0.14, // seconds a too-early jump press is remembered before landing
  maxFall: 40, // terminal fall speed
  radius: 0.4, // body size for wall collisions
  height: 1.7,
  stepHeight: 0.35, // ledges lower than this are walked up
  floor: 0, // endless floor height, or null
  killY: -20, // fall below this → 'fall' event + respawn
  stepLength: 1.6, // distance between 'step' events (footstep sounds)
  gamepad: true,
};

export const THIRD_PERSON = {
  ...MOVEMENT,
  turnSpeed: 14, // how fast the character turns to face its movement
  facing: 0, // add Math.PI if your model faces -Z
  camera: 'orbit', // 'orbit' (mouse), 'follow' (fixed angle chase), 'side' (2.5D platformer), 'none'
  distance: 6,
  minDistance: 2.5,
  maxDistance: 14,
  pitch: 0.35, // camera angle above horizontal (radians)
  minPitch: -0.15,
  maxPitch: 1.25,
  targetHeight: 1.4, // the camera looks at this height above the feet
  sensitivity: 0.005, // mouse: radians per pixel
  padSensitivity: 3, // right stick: radians per second
  pointerLock: false, // true: click to hide the cursor; false: drag to orbit
  cameraSmooth: 14,
  followOffset: [0, 6, 8], // camera: 'follow'
  sideDistance: 12, // camera: 'side'
  sideHeight: 2.5,
};

export const FIRST_PERSON = {
  ...MOVEMENT,
  speed: 5.5,
  sprintSpeed: 9,
  crouchSpeed: 2.5,
  accel: 70,
  friction: 50,
  airControl: 0.3,
  jumpHeight: 1.3,
  eyeHeight: 1.6,
  crouchEyeHeight: 0.9,
  sensitivity: 0.0022,
  padSensitivity: 3,
  invertY: false,
  fov: 75,
  sprintFov: 8, // extra field of view while sprinting: sells the speed
  bob: 0.06, // head bob strength (0 = off)
  landDip: 0.04, // how far the view dips per unit of landing speed
  lockText: 'Click to play<br><small>Esc gives the mouse back</small>',
};

export const TOP_DOWN = {
  ...MOVEMENT,
  speed: 6,
  sprintSpeed: 9,
  accel: 60,
  friction: 50,
  jumpHeight: 0, // > 0 to allow jumping
  turnSpeed: 20,
  faceAim: true, // false: face where you walk
  cameraOffset: [0, 14, 7],
  lead: 0.25, // camera looks ahead by this many seconds of velocity
  aimLead: 0.2, // …and this fraction of the way towards the mouse
  cameraSmooth: 6,
  aimHeight: 1, // height of the plane the mouse aims on (above the feet)
};

export const VEHICLE = {
  maxSpeed: 22,
  reverseSpeed: 7,
  accel: 14,
  brake: 32,
  drag: 4, // slowdown when coasting
  turnRate: 2.4, // radians per second at full lock
  fullTurnAt: 6, // speed at which steering reaches full strength (no spinning on the spot)
  highSpeedTurn: 0.55, // fraction of steering left at top speed (stability)
  steerSmooth: 10,
  grip: 9, // how fast sideways sliding stops (lower = driftier)
  driftGrip: 1.5, // grip while the handbrake (Space) is held
  driftTurn: 1.4, // extra steering while drifting
  driftThreshold: 3, // sideways speed that counts as a drift
  bounce: 0.35, // speed kept after hitting a wall
  gravity: 30,
  maxFall: 40,
  radius: 1,
  height: 1,
  stepHeight: 0.45,
  floor: 0,
  killY: -20,
  // chase camera
  distance: 7,
  camHeight: 3,
  lookHeight: 1,
  lookAhead: 3,
  cameraSmooth: 6,
  fov: 60,
  speedFov: 20, // extra field of view at top speed
  gamepad: true,
};

// ─── Pure movement math (no Three.js scene needed; see tests/engine/controllers.test.js) ───────────

/** Move velocity (vx, vz) towards (wantX, wantZ) by at most rate·dt. Uses `accel` while steering, `decel` when letting go. */
export function accelerate(vx, vz, wantX, wantZ, accel, decel, dt) {
  const dx = wantX - vx;
  const dz = wantZ - vz;
  const dist = Math.hypot(dx, dz);
  const step = (wantX || wantZ ? accel : decel) * dt;
  if (dist <= step) return { x: wantX, z: wantZ };
  return { x: vx + (dx / dist) * step, z: vz + (dz / dist) * step };
}

/** Rotate a stick/WASD direction so "up" means "away from the camera". yaw = camera angle around Y (0 = looking along -Z). */
export function cameraRelative(x, z, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: x * c + z * s, z: -x * s + z * c };
}

/** Upward speed that reaches `height` under `gravity`. */
export const jumpSpeed = (height, gravity) => Math.sqrt(2 * gravity * Math.max(0, height));

/**
 * Coyote time + jump buffering + air jumps. Call update() every frame; it returns true on the frame a jump should start.
 * Makes jumping forgiving: pressing a bit before landing or a bit after leaving a ledge still works.
 */
export function createJumpTimer({ coyoteTime = 0.12, jumpBuffer = 0.14, airJumps = 0 } = {}) {
  let sinceGround = Infinity;
  let sincePress = Infinity;
  let airLeft = airJumps;
  return {
    update(dt, grounded, pressed) {
      sinceGround = grounded ? 0 : sinceGround + dt;
      sincePress = pressed ? 0 : sincePress + dt;
      if (grounded) airLeft = airJumps;
      if (sincePress <= jumpBuffer && sinceGround <= coyoteTime) {
        sincePress = sinceGround = Infinity; // used up: no second jump from the same ledge
        return true;
      }
      if (pressed && sinceGround > coyoteTime && airLeft > 0) {
        airLeft--;
        sincePress = Infinity;
        return true;
      }
      return false;
    },
    reset() {
      sinceGround = sincePress = Infinity;
      airLeft = airJumps;
    },
  };
}

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const toward = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

/**
 * One step of arcade car physics. state: { heading, vx, vz, steer }. controls: { throttle -1..1, steer -1..1 (+ = right), handbrake }.
 * Velocity lives in world space while the car turns, and grip pulls it back in line: that lag *is* the drift.
 */
export function stepVehicle(state, { throttle = 0, steer = 0, handbrake = false }, dt, o = VEHICLE) {
  const smoothSteer = damp(state.steer ?? 0, steer, o.steerSmooth, dt);
  let fx = Math.sin(state.heading);
  let fz = Math.cos(state.heading);
  const fwd0 = state.vx * fx + state.vz * fz;
  const speedK = clamp(Math.abs(fwd0) / o.fullTurnAt, 0, 1) * (1 - (1 - o.highSpeedTurn) * clamp(Math.abs(fwd0) / o.maxSpeed, 0, 1));
  const yawRate = -smoothSteer * o.turnRate * speedK * Math.sign(fwd0) * (handbrake ? o.driftTurn : 1);
  const heading = state.heading + yawRate * dt;

  // Split the (old) velocity along the new heading: forward part is driven, sideways part is grip.
  fx = Math.sin(heading);
  fz = Math.cos(heading);
  let fwd = state.vx * fx + state.vz * fz;
  let side = state.vx * fz - state.vz * fx;
  if (throttle > 0) fwd = fwd < -0.5 ? toward(fwd, 0, o.brake * dt) : toward(fwd, o.maxSpeed * throttle, (fwd > o.maxSpeed * throttle ? o.drag : o.accel) * dt);
  else if (throttle < 0) fwd = fwd > 0.5 ? toward(fwd, 0, o.brake * dt) : toward(fwd, -o.reverseSpeed * -throttle, o.accel * dt);
  else fwd = toward(fwd, 0, o.drag * dt);
  if (handbrake) fwd = toward(fwd, 0, o.drag * dt);
  side *= Math.exp(-(handbrake ? o.driftGrip : o.grip) * dt);

  return {
    heading,
    steer: smoothSteer,
    vx: fx * fwd + fz * side,
    vz: fz * fwd - fx * side,
    speed: fwd, // signed: negative when reversing
    slip: side, // sideways speed: big while drifting
  };
}

// ─── Shared building blocks ──────────────────────────────────────────────────────────────────────

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Kinematic body: moves `object` by `velocity` with gravity, slides along walls, walks up small steps
 * and snaps to the ground, all with raycasts against `o.colliders`. Or, with `o.body` (a cannon-es body
 * from physics.add(object, { fixedRotation: true })), steers that body and lets the physics engine move it.
 */
function createBody(object, o, events) {
  const ray = new THREE.Raycaster();
  const velocity = new THREE.Vector3();
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const self = { velocity, grounded: false, groundObject: null, groundNormal: new THREE.Vector3(0, 1, 0) };
  const colliders = () => o.colliders ?? [];

  const cast = (origin, direction, far) => {
    ray.set(origin, direction);
    ray.far = far;
    return colliders().length ? ray.intersectObjects(colliders(), true).find((h) => h.object.visible !== false) : null;
  };
  const worldNormal = (hit) => normal.copy(hit.face?.normal ?? UP).transformDirection(hit.object.matrixWorld);

  // Highest walkable ground under (x, z) between `top` and `top - depth`; checks a few points so ledges are forgiving.
  const OFFSETS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const groundBelow = (pos, top, depth) => {
    let best = null;
    for (const [ox, oz] of OFFSETS) {
      from.set(pos.x + ox * o.radius * 0.6, top, pos.z + oz * o.radius * 0.6);
      const hit = cast(from, DOWN, depth);
      if (hit && worldNormal(hit).y > 0.6 && (!best || hit.point.y > best.y)) best = { y: hit.point.y, object: hit.object, normal: normal.clone() };
      if (best && ox === 0 && oz === 0) break; // centre hit: good enough
    }
    if (o.floor !== null && o.floor !== undefined && o.floor <= top && o.floor >= top - depth && (!best || o.floor > best.y)) best = { y: o.floor, object: null };
    return best;
  };

  // Nearest wall in the direction of travel, probed at knee and chest height and at both shoulders.
  const wallAhead = (pos, dx, dz, dist) => {
    dir.set(dx, 0, dz);
    let best = null;
    for (const h of [o.stepHeight + 0.05, o.height * 0.75])
      for (const side of [0, 1, -1]) {
        from.set(pos.x - dz * side * o.radius * 0.7, pos.y + h, pos.z + dx * side * o.radius * 0.7);
        const hit = cast(from, dir, dist + o.radius);
        if (hit && worldNormal(hit).y < 0.6 && (!best || hit.distance < best.distance))
          best = { distance: hit.distance, nx: normal.x, nz: normal.z };
      }
    return best;
  };

  const moveHorizontal = (pos, dt) => {
    for (let i = 0; i < 2; i++) {
      const len = Math.hypot(velocity.x, velocity.z) * dt;
      if (len < 1e-6) return;
      const dx = (velocity.x * dt) / len;
      const dz = (velocity.z * dt) / len;
      const wall = wallAhead(pos, dx, dz, len);
      if (!wall) {
        pos.x += velocity.x * dt;
        pos.z += velocity.z * dt;
        return;
      }
      const n = Math.hypot(wall.nx, wall.nz) || 1;
      const nx = wall.nx / n;
      const nz = wall.nz / n;
      const move = Math.max(0, wall.distance - o.radius);
      pos.x += dx * move;
      pos.z += dz * move;
      // Slide: drop the part of the velocity that points into the wall.
      const into = velocity.x * nx + velocity.z * nz;
      if (into < 0) {
        if (-into > 2) events.emit('bump', { speed: -into, normal: new THREE.Vector3(nx, 0, nz) });
        velocity.x -= into * nx * (1 + (o.bounce ?? 0));
        velocity.z -= into * nz * (1 + (o.bounce ?? 0));
      }
      dt *= 1 - move / len;
    }
  };

  self.step = (dt) => {
    const pos = object.position;
    const wasGrounded = self.grounded;
    const fallSpeed = -velocity.y;

    if (o.body) {
      // Physics-driven: we only set the velocity; cannon-es moves the body and the engine copies it onto `object`.
      const b = o.body;
      b.wakeUp?.();
      b.velocity.x = velocity.x;
      b.velocity.z = velocity.z;
      if (velocity.y !== self.lastVy) b.velocity.y = velocity.y; // the walker jumped or cut the jump short
      // Top up the world's gravity to ours, so jumps feel the same with and without physics.
      if (!self.grounded) b.velocity.y -= Math.max(0, o.gravity + (b.world?.gravity.y ?? -o.gravity)) * dt;
      self.jumped = false;
      velocity.y = self.lastVy = b.velocity.y;
      const g = groundBelow(pos, pos.y + o.stepHeight, o.stepHeight + 0.12);
      self.grounded = velocity.y <= 0.5 && (g ? true : !colliders().length && o.floor == null && Math.abs(velocity.y) < 0.05);
      self.groundObject = g?.object ?? null;
      b.quaternion.setFromEuler(0, object.rotation.y, 0);
    } else {
      moveHorizontal(pos, dt);
      if (!self.grounded || velocity.y > 0) velocity.y = Math.max(-o.maxFall, velocity.y - o.gravity * dt);
      const nextY = pos.y + velocity.y * dt;
      self.grounded = false;
      self.groundObject = null;
      if (velocity.y > 0) {
        // Bonk your head on ceilings.
        from.set(pos.x, pos.y + o.height * 0.5, pos.z);
        if (cast(from, UP, o.height * 0.5 + velocity.y * dt)) velocity.y = 0;
        pos.y = nextY;
      } else {
        // Look for ground from step height above the feet down to where we'd be (plus a snap distance when walking).
        const top = pos.y + o.stepHeight;
        const g = groundBelow(pos, top, top - nextY + (wasGrounded ? o.stepHeight : 0.02));
        if (g) {
          pos.y = g.y;
          velocity.y = 0;
          self.grounded = true;
          self.groundObject = g.object;
          self.groundNormal.copy(g.normal ?? UP);
        } else pos.y = nextY;
      }
    }

    if (self.grounded && !wasGrounded) events.emit('land', { speed: Math.max(0, fallSpeed) });
    if (pos.y < o.killY) {
      events.emit('fall');
      self.teleport(self.spawn);
    }
  };

  self.spawn = object.position.clone();
  self.teleport = (p) => {
    object.position.copy(p);
    velocity.set(0, 0, 0);
    if (o.body) {
      o.body.position.set(p.x, p.y, p.z);
      o.body.velocity.set(0, 0, 0);
    }
  };
  return self;
}

/** Reads keyboard + gamepad into one simple shape. */
function readControls(engine, o) {
  const { input } = engine;
  const pad = o.gamepad ? input.pad() : null;
  let move = input.move();
  if (pad && !move.x && !move.z) move = pad.move;
  return {
    pad,
    move,
    look: pad?.look ?? { x: 0, y: 0 },
    sprint: input.isDown('ShiftLeft') || input.isDown('ShiftRight') || !!pad?.isDown('lb') || !!pad?.isDown('ls'),
    jumpPressed: input.wasPressed('Space') || !!pad?.wasPressed('a'),
    jumpHeld: input.isDown('Space') || !!pad?.isDown('a'),
  };
}

/** Walking on top of a body: acceleration, friction, jumping and footsteps. Shared by 3rd person, 1st person and top-down. */
function createWalker(object, o, events) {
  const body = createBody(object, o, events);
  const jump = createJumpTimer(o);
  let cut = false;
  let stride = 0;
  Object.defineProperty(body, 'state', {
    get() {
      if (!body.grounded) return body.velocity.y > 0 ? 'jump' : 'fall';
      const s = Math.hypot(body.velocity.x, body.velocity.z);
      return s < 0.2 ? 'idle' : s > o.speed + 0.5 ? 'run' : 'walk';
    },
  });
  return Object.assign(body, {
    move(dt, wishX, wishZ, { sprint = false, jumpPressed = false, jumpHeld = false, speed } = {}) {
      const v = body.velocity;
      const max = speed ?? (sprint ? o.sprintSpeed : o.speed);
      const k = body.grounded ? 1 : o.airControl;
      const h = accelerate(v.x, v.z, wishX * max, wishZ * max, o.accel * k, o.friction * k, dt);
      v.x = h.x;
      v.z = h.z;
      if (o.jumpHeight > 0 && jump.update(dt, body.grounded, jumpPressed)) {
        v.y = jumpSpeed(o.jumpHeight, o.gravity);
        body.grounded = false;
        body.jumped = true;
        cut = false;
        events.emit('jump');
      }
      if (!jumpHeld && !cut && v.y > 0) {
        v.y *= o.jumpCut; // let go early → shorter hop
        cut = true;
      }
      body.step(dt);
      if (body.grounded) {
        stride += Math.hypot(v.x, v.z) * dt;
        if (stride > o.stepLength) {
          stride = 0;
          events.emit('step');
        }
      }
    },
  });
}

/** Lets a controller drive an animator: locomotion by speed, a jump one-shot, and a fall loop if the model has one. */
function driveAnimator(getAnim, walker, events) {
  events.on('jump', () => getAnim()?.once('jump', { hold: true, fade: 0.08 }));
  events.on('land', () => getAnim()?.cancel('jump', { fade: 0.12 }));
  return (dt) => {
    const anim = getAnim();
    if (!anim) return;
    const v = walker.velocity;
    if (walker.grounded || !anim.has('fall')) anim.locomotion(Math.hypot(v.x, v.z));
    else if (anim.oneShot !== 'jump') anim.play('fall');
    if (!anim.auto) anim.update(dt);
  };
}

/** The common shell: events, enabled flag, update loop, destroy. */
function controller(engine, kind, o, walker, events, update, cleanup = () => {}) {
  engine.cameraRig.clear(); // stop orbit/follow rigs: this controller owns the camera now
  const ctl = {
    kind,
    options: o,
    enabled: true,
    on: (name, fn) => events.on(name, fn),
    onJump: (fn) => events.on('jump', fn),
    onLand: (fn) => events.on('land', fn),
    onStep: (fn) => events.on('step', fn),
    onFall: (fn) => events.on('fall', fn),
    get velocity() {
      return walker.velocity;
    },
    get speed() {
      return Math.hypot(walker.velocity.x, walker.velocity.z);
    },
    get grounded() {
      return walker.grounded;
    },
    get spawn() {
      return walker.spawn;
    },
    teleport: (p) => walker.teleport(Array.isArray(p) ? new THREE.Vector3(...p) : p),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      cleanup();
      events.clear();
    },
  };
  let destroyed = false;
  // Guard: a controller destroyed by another update this frame must not run (and e.g. re-set the camera) once more.
  const stop = engine.onUpdate((dt) => destroyed || update(dt, ctl));
  return ctl;
}

const vec = (a) => (Array.isArray(a) ? new THREE.Vector3(...a) : a.clone());

// ─── Third person ───────────────────────────────────────────────────────────────────────────────

/**
 * Third-person character. `model` should be a wrapper Group whose origin is at the feet
 * (a Group wrapping the model). Movement is camera-relative; the model turns to face where it goes.
 */
export function thirdPerson(engine, model, options = {}) {
  const o = { ...THIRD_PERSON, ...options };
  const { camera, input, renderer } = engine;
  const events = createEvents();
  const walker = createWalker(model, o, events);
  const ray = new THREE.Raycaster();
  const animate = driveAnimator(() => ctl.animator, walker, events);
  let yaw = model.rotation.y + o.facing + Math.PI; // start behind the character
  let pitch = o.pitch;
  let distance = o.distance;
  let camDistance = distance;
  const focus = model.position.clone().add(new THREE.Vector3(0, o.targetHeight, 0));
  const want = new THREE.Vector3();
  const lockZ = model.position.z;
  const followOff = vec(o.followOffset);
  if (o.camera === 'follow') yaw = Math.atan2(followOff.x, followOff.z);
  if (o.camera === 'side') yaw = 0;

  const lockOnClick = () => o.pointerLock && input.lockPointer();
  renderer.domElement.addEventListener('click', lockOnClick);

  const ctl = controller(engine, 'thirdPerson', o, walker, events, (dt) => {
    const c = ctl.enabled ? readControls(engine, o) : { move: { x: 0, z: 0 }, look: { x: 0, y: 0 } };

    // ---- camera input ----
    if (ctl.enabled && o.camera === 'orbit') {
      if (input.locked || (!o.pointerLock && input.pointer.down)) {
        yaw -= input.mouse.dx * o.sensitivity;
        pitch += input.mouse.dy * o.sensitivity;
      }
      yaw -= c.look.x * o.padSensitivity * dt;
      pitch += c.look.y * o.padSensitivity * dt;
      pitch = clamp(pitch, o.minPitch, o.maxPitch);
      distance = clamp(distance + input.mouse.wheel * 0.8, o.minDistance, o.maxDistance);
    }

    // ---- movement ----
    let wish;
    if (o.camera === 'side') {
      wish = { x: c.move.x, z: 0 };
      if (ctl.enabled) c.jumpPressed ||= input.wasPressed('KeyW') || input.wasPressed('ArrowUp');
      if (ctl.enabled) c.jumpHeld ||= input.isDown('KeyW') || input.isDown('ArrowUp');
    } else wish = cameraRelative(c.move.x, c.move.z, yaw);
    walker.move(dt, wish.x, wish.z, c);
    if (o.camera === 'side') {
      model.position.z = lockZ;
      walker.velocity.z = 0;
    }
    if (Math.hypot(wish.x, wish.z) > 0.1)
      model.rotation.y = dampAngle(model.rotation.y, Math.atan2(wish.x, wish.z) + o.facing, o.turnSpeed, dt);
    animate(dt);

    // ---- camera ----
    if (o.camera === 'none') return;
    focus.x = damp(focus.x, model.position.x, o.cameraSmooth * 2, dt);
    focus.z = damp(focus.z, model.position.z, o.cameraSmooth * 2, dt);
    focus.y = damp(focus.y, model.position.y + o.targetHeight, o.cameraSmooth * 0.6, dt); // softer vertically: jumps don't jolt
    if (o.camera === 'side') {
      camera.position.set(focus.x, focus.y + o.sideHeight, focus.z + o.sideDistance);
      camera.lookAt(focus.x, focus.y + o.sideHeight * 0.3, focus.z);
      return;
    }
    if (o.camera === 'follow') {
      want.copy(focus).add(followOff);
      camera.position.lerp(want, 1 - Math.exp(-o.cameraSmooth * dt));
      camera.lookAt(focus);
      return;
    }
    orbitOffset(yaw, pitch, distance, want).add(focus);
    const free = cameraClearance(ray, focus, want, o.cameraColliders ?? o.colliders);
    camDistance = free < camDistance ? free : damp(camDistance, free, 4, dt); // snap in, ease back out
    orbitOffset(yaw, pitch, camDistance, camera.position).add(focus);
    if (o.floor != null) camera.position.y = Math.max(camera.position.y, o.floor + 0.3);
    camera.lookAt(focus);
  }, () => renderer.domElement.removeEventListener('click', lockOnClick));

  ctl.animator = options.animator ?? null;
  ctl.object = model;
  Object.defineProperties(ctl, {
    state: { get: () => walker.state },
    yaw: { get: () => yaw, set: (v) => (yaw = v) },
    pitch: { get: () => pitch, set: (v) => (pitch = v) },
  });
  return ctl;
}

// ─── First person ───────────────────────────────────────────────────────────────────────────────

/** First-person: the camera is the player. ctl.object is an invisible Group at the player's feet. */
export function firstPerson(engine, options = {}) {
  const o = { ...FIRST_PERSON, ...options };
  const { camera, input, renderer, ui, scene } = engine;
  const events = createEvents();
  const object = options.object ?? new THREE.Group();
  if (!options.object) {
    object.position.copy(vec(options.position ?? [0, 0, 5]));
    scene.add(object);
  }
  const walker = createWalker(object, o, events);
  const oldFov = camera.fov;
  const oldOrder = camera.rotation.order;
  camera.rotation.order = 'YXZ'; // yaw first, then pitch: no roll creeping in
  let yaw = options.yaw ?? object.rotation.y;
  let pitch = 0;
  let eye = o.eyeHeight;
  let dip = 0;
  let bobPhase = 0;

  // "Click to play" overlay: browsers only allow pointer lock from a click.
  const overlay = o.lockText ? ui.text(o.lockText, 'center', { big: true }) : null;
  if (overlay) overlay.style.cursor = 'pointer';
  const lock = () => input.lockPointer();
  overlay?.addEventListener('click', lock);
  renderer.domElement.addEventListener('click', lock);
  events.on('land', ({ speed }) => (dip = Math.min(0.5, speed * o.landDip)));

  const ctl = controller(engine, 'firstPerson', o, walker, events, (dt) => {
    if (overlay) overlay.style.display = input.locked ? 'none' : '';
    const c = ctl.enabled ? readControls(engine, o) : { move: { x: 0, z: 0 }, look: { x: 0, y: 0 } };
    const crouch = ctl.enabled && (input.isDown('KeyC') || input.isDown('ControlLeft') || !!c.pad?.isDown('b'));

    if (ctl.enabled && (input.locked || input.pointer.down)) {
      // Dragging also works, for browsers/tests without pointer lock.
      yaw -= input.mouse.dx * o.sensitivity;
      pitch -= input.mouse.dy * o.sensitivity * (o.invertY ? -1 : 1);
    }
    yaw -= c.look.x * o.padSensitivity * dt;
    pitch -= c.look.y * o.padSensitivity * dt * (o.invertY ? -1 : 1);
    pitch = clamp(pitch, -1.5, 1.5);

    const wish = cameraRelative(c.move.x, c.move.z, yaw);
    const sprinting = c.sprint && !crouch && c.move.z < 0;
    walker.move(dt, wish.x, wish.z, { ...c, sprint: sprinting, speed: crouch ? o.crouchSpeed : undefined });
    object.rotation.y = yaw;

    // View: crouch height, head bob while walking, a dip when landing.
    eye = damp(eye, crouch ? o.crouchEyeHeight : o.eyeHeight, 12, dt);
    dip = damp(dip, 0, 8, dt);
    const speed = ctl.speed;
    if (walker.grounded && speed > 0.5) bobPhase += dt * speed * 1.4;
    else bobPhase = damp(bobPhase, Math.round(bobPhase), 6, dt);
    const bobK = Math.min(1, speed / o.speed) * o.bob;
    const side = cameraRelative(1, 0, yaw);
    const sway = Math.cos(bobPhase * Math.PI) * bobK * 0.5;
    camera.position.set(
      object.position.x + side.x * sway,
      object.position.y + eye - dip + Math.abs(Math.sin(bobPhase * Math.PI)) * bobK,
      object.position.z + side.z * sway,
    );
    camera.rotation.set(pitch, yaw, 0);
    const fov = o.fov + (sprinting && speed > o.speed ? o.sprintFov : 0);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = damp(camera.fov, fov, 6, dt);
      camera.updateProjectionMatrix();
    }
  }, () => {
    overlay?.remove();
    if (!options.object) scene.remove(object);
    renderer.domElement.removeEventListener('click', lock);
    input.unlockPointer();
    camera.fov = oldFov;
    camera.rotation.order = oldOrder;
    camera.updateProjectionMatrix();
  });

  ctl.object = object;
  Object.defineProperties(ctl, {
    state: { get: () => walker.state },
    yaw: { get: () => yaw, set: (v) => (yaw = v) },
    pitch: { get: () => pitch, set: (v) => (pitch = v) },
  });
  return ctl;
}

// ─── Top-down twin stick ────────────────────────────────────────────────────────────────────────

/** Top-down: WASD moves (screen-relative), the model aims at the mouse. Click / RT emits 'fire' { origin, direction }. */
export function topDown(engine, model, options = {}) {
  const o = { ...TOP_DOWN, ...options };
  const { camera, input } = engine;
  const events = createEvents();
  const walker = createWalker(model, o, events);
  const animate = driveAnimator(() => ctl.animator, walker, events);
  const offset = vec(o.cameraOffset);
  const yaw = Math.atan2(offset.x, offset.z);
  const aim = new THREE.Vector3(0, 0, 1);
  const aimPoint = model.position.clone();
  const focus = model.position.clone();
  camera.position.copy(focus).add(offset);

  const ctl = controller(engine, 'topDown', o, walker, events, (dt) => {
    const c = ctl.enabled ? readControls(engine, o) : { move: { x: 0, z: 0 }, look: { x: 0, y: 0 } };
    const wish = cameraRelative(c.move.x, c.move.z, yaw);
    walker.move(dt, wish.x, wish.z, c);

    // Aim: right stick if pushed, otherwise the mouse on a plane at aim height.
    if (Math.hypot(c.look.x, c.look.y) > 0.3) {
      const a = cameraRelative(c.look.x, c.look.y, yaw);
      aim.set(a.x, 0, a.z).normalize();
      aimPoint.copy(model.position).addScaledVector(aim, 5);
    } else {
      const p = input.pickGround(model.position.y + o.aimHeight);
      if (p) {
        aimPoint.copy(p);
        const d = p.clone().sub(model.position).setY(0);
        if (d.lengthSq() > 0.01) aim.copy(d.normalize());
      }
    }
    const faceX = o.faceAim ? aim.x : wish.x;
    const faceZ = o.faceAim ? aim.z : wish.z;
    if (Math.hypot(faceX, faceZ) > 0.1) model.rotation.y = dampAngle(model.rotation.y, Math.atan2(faceX, faceZ), o.turnSpeed, dt);
    animate(dt);

    ctl.firing = ctl.enabled && (input.isDown('Mouse0') || (c.pad?.value('rt') ?? 0) > 0.5);
    if (ctl.enabled && (input.wasPressed('Mouse0') || c.pad?.wasPressed('rt')))
      events.emit('fire', { origin: model.position.clone().setY(model.position.y + o.aimHeight), direction: aim.clone() });

    // Camera: fixed angle, looking a little ahead of where you move and aim.
    const toAim = aimPoint.clone().sub(model.position).setY(0);
    const tx = model.position.x + walker.velocity.x * o.lead + toAim.x * o.aimLead;
    const tz = model.position.z + walker.velocity.z * o.lead + toAim.z * o.aimLead;
    focus.set(damp(focus.x, tx, o.cameraSmooth, dt), damp(focus.y, model.position.y, o.cameraSmooth, dt), damp(focus.z, tz, o.cameraSmooth, dt));
    camera.position.copy(focus).add(offset);
    camera.lookAt(focus);
  });

  ctl.animator = options.animator ?? null;
  ctl.object = model;
  ctl.firing = false;
  ctl.aim = aim; // direction (unit vector)
  ctl.aimPoint = aimPoint;
  Object.defineProperty(ctl, 'state', { get: () => walker.state });
  return ctl;
}

// ─── Vehicle ────────────────────────────────────────────────────────────────────────────────────

/** Arcade car / kart. `model` faces +Z. W/S or RT/LT throttle & brake/reverse, A/D or stick steer, Space/A handbrake drift. */
export function vehicle(engine, model, options = {}) {
  const o = { ...VEHICLE, ...options };
  const { camera, input } = engine;
  const events = createEvents();
  const body = createBody(model, o, events);
  const ray = new THREE.Raycaster();
  let car = { heading: model.rotation.y, vx: 0, vz: 0, steer: 0, speed: 0, slip: 0 };
  let drifting = false;
  let camYaw = car.heading + Math.PI;
  const oldFov = camera.fov;
  const look = new THREE.Vector3();
  const want = new THREE.Vector3();
  camera.position.copy(model.position).add(orbitOffset(camYaw, 0.35, o.distance));

  const ctl = controller(engine, 'vehicle', o, body, events, (dt) => {
    let throttle = 0;
    let steer = 0;
    let handbrake = false;
    if (ctl.enabled) {
      const pad = o.gamepad ? input.pad() : null;
      throttle = input.axis('KeyS', 'KeyW') || input.axis('ArrowDown', 'ArrowUp') || (pad ? pad.value('rt') - pad.value('lt') : 0);
      steer = input.axis('KeyA', 'KeyD') || input.axis('ArrowLeft', 'ArrowRight') || (pad?.move.x ?? 0);
      handbrake = input.isDown('Space') || !!pad?.isDown('a');
    }
    if (!body.grounded) steer *= 0.3; // a little air steering for fun
    car = stepVehicle({ ...car, vx: body.velocity.x, vz: body.velocity.z }, { throttle, steer, handbrake }, dt, o);
    body.velocity.x = car.vx;
    body.velocity.z = car.vz;
    body.step(dt); // walls, ramps, gravity (and bounces off walls)
    // Pitch with the slope (ramps!), level out slowly in the air.
    const n = body.groundNormal;
    const slope = body.grounded ? Math.atan2(n.x * Math.sin(car.heading) + n.z * Math.cos(car.heading), n.y) : 0;
    model.rotation.order = 'YXZ';
    model.rotation.set(damp(model.rotation.x, slope, body.grounded ? 12 : 2, dt), car.heading, 0);

    const isDrifting = body.grounded && Math.abs(car.slip) > o.driftThreshold;
    if (isDrifting !== drifting) events.emit(isDrifting ? 'driftStart' : 'driftEnd');
    drifting = isDrifting;

    // Chase camera: swings behind the car, looks ahead, widens the view with speed.
    camYaw = dampAngle(camYaw, car.heading + Math.PI, 3.5, dt);
    const fwd = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
    look.copy(model.position).addScaledVector(fwd, o.lookAhead).setY(model.position.y + o.lookHeight);
    want.set(Math.sin(camYaw) * o.distance, o.camHeight, Math.cos(camYaw) * o.distance).add(model.position);
    const from = model.position.clone().setY(model.position.y + o.lookHeight);
    const free = cameraClearance(ray, from, want, o.cameraColliders ?? o.colliders);
    if (free < want.distanceTo(from)) want.sub(from).setLength(free).add(from);
    camera.position.set(damp(camera.position.x, want.x, o.cameraSmooth, dt), damp(camera.position.y, want.y, o.cameraSmooth, dt), damp(camera.position.z, want.z, o.cameraSmooth, dt));
    camera.lookAt(look);
    camera.fov = damp(camera.fov, o.fov + o.speedFov * clamp(Math.abs(car.speed) / o.maxSpeed, 0, 1), 4, dt);
    camera.updateProjectionMatrix();
  }, () => {
    camera.fov = oldFov;
    camera.updateProjectionMatrix();
  });

  ctl.object = model;
  Object.defineProperties(ctl, {
    state: { get: () => (!body.grounded ? 'air' : drifting ? 'drift' : Math.abs(car.speed) < 0.3 ? 'idle' : car.speed < 0 ? 'reverse' : 'drive') },
    speed: { get: () => car.speed },
    drifting: { get: () => drifting },
    steer: { get: () => car.steer },
    heading: { get: () => car.heading, set: (v) => (car.heading = v) },
  });
  return ctl;
}
