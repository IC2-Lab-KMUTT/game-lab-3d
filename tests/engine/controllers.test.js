// Tests for the controller movement math (pure functions, no WebGL).
import { describe, expect, it } from 'vitest';
import { accelerate, cameraRelative, jumpSpeed, createJumpTimer, stepVehicle, VEHICLE } from '../../src/engine/controllers.js';
import { damp, angleDiff, dampAngle } from '../../src/engine/camera.js';
import { deadZone } from '../../src/engine/input.js';

const run = (frames, fn) => {
  for (let i = 0; i < frames; i++) fn(i);
};

describe('acceleration and friction', () => {
  it('reaches top speed after speed/accel seconds, never overshoots', () => {
    let v = { x: 0, z: 0 };
    run(5, () => (v = accelerate(v.x, v.z, 0, -6, 60, 40, 1 / 60)));
    expect(v.z).toBeCloseTo(-5);
    run(60, () => (v = accelerate(v.x, v.z, 0, -6, 60, 40, 1 / 60)));
    expect(v.z).toBe(-6);
  });
  it('uses friction (not accel) to stop', () => {
    const v = accelerate(0, 6, 0, 0, 60, 30, 0.1);
    expect(v.z).toBeCloseTo(3);
  });
});

describe('camera-relative movement', () => {
  it('W moves away from the camera, D to its right', () => {
    expect(cameraRelative(0, -1, 0)).toEqual({ x: 0, z: -1 });
    const turned = cameraRelative(0, -1, Math.PI / 2); // camera on +X looking towards -X
    expect(turned.x).toBeCloseTo(-1);
    expect(turned.z).toBeCloseTo(0);
    const right = cameraRelative(1, 0, Math.PI / 2);
    expect(right.z).toBeCloseTo(-1);
  });
});

describe('jumping', () => {
  it('jumpSpeed reaches the requested height', () => {
    const g = 32;
    const v = jumpSpeed(2, g);
    expect((v * v) / (2 * g)).toBeCloseTo(2);
  });

  it('coyote time: can still jump shortly after leaving the ground, not later', () => {
    const j = createJumpTimer({ coyoteTime: 0.1, jumpBuffer: 0.1 });
    j.update(0.016, true, false);
    j.update(0.05, false, false);
    expect(j.update(0.03, false, true)).toBe(true); // 0.08 s after the ledge
    const late = createJumpTimer({ coyoteTime: 0.1, jumpBuffer: 0.1 });
    late.update(0.016, true, false);
    late.update(0.2, false, false);
    expect(late.update(0.016, false, true)).toBe(false);
  });

  it('jump buffer: pressing just before landing jumps on landing', () => {
    const j = createJumpTimer({ coyoteTime: 0.1, jumpBuffer: 0.12 });
    j.update(0.5, false, false);
    expect(j.update(0.016, false, true)).toBe(false); // in the air
    expect(j.update(0.08, true, false)).toBe(true); // lands 0.08 s later
    expect(j.update(0.016, true, false)).toBe(false); // used up
  });

  it('air jumps (double jump) reset on landing', () => {
    const j = createJumpTimer({ airJumps: 1 });
    expect(j.update(0.016, true, true)).toBe(true);
    expect(j.update(0.3, false, true)).toBe(true);
    expect(j.update(0.1, false, true)).toBe(false);
    j.update(0.016, true, false);
    expect(j.update(0.3, false, true)).toBe(true);
  });
});

describe('vehicle', () => {
  const drive = (controls, seconds, s = { heading: 0, vx: 0, vz: 0, steer: 0 }) => {
    run(Math.round(seconds * 60), () => (s = stepVehicle(s, controls, 1 / 60, VEHICLE)));
    return s;
  };
  it('accelerates forward (+Z at heading 0) up to max speed', () => {
    const s = drive({ throttle: 1 }, 5);
    expect(s.vz).toBeCloseTo(VEHICLE.maxSpeed, 0);
    expect(Math.abs(s.vx)).toBeLessThan(1e-6);
  });
  it('does not turn while standing still; steering right turns right', () => {
    expect(drive({ steer: 1 }, 1).heading).toBe(0);
    const s = drive({ throttle: 1, steer: 1 }, 1, { heading: 0, vx: 0, vz: 10, steer: 0 });
    expect(s.heading).toBeLessThan(0); // facing +Z, right is towards -X
  });
  it('S brakes first, then reverses', () => {
    const braking = drive({ throttle: -1 }, 0.1, { heading: 0, vx: 0, vz: 10, steer: 0 });
    expect(braking.speed).toBeGreaterThan(0);
    expect(braking.speed).toBeLessThan(10);
    expect(drive({ throttle: -1 }, 3).speed).toBeCloseTo(-VEHICLE.reverseSpeed);
  });
  it('the handbrake keeps more sideways slide (drift) than normal grip', () => {
    const start = { heading: 0, vx: 0, vz: 18, steer: 0 };
    const grip = drive({ throttle: 1, steer: 1 }, 0.5, start);
    const drift = drive({ throttle: 1, steer: 1, handbrake: true }, 0.5, start);
    expect(Math.abs(drift.slip)).toBeGreaterThan(Math.abs(grip.slip));
  });
});

describe('camera and input helpers', () => {
  it('damp is frame-rate independent', () => {
    let a = 0;
    run(60, () => (a = damp(a, 10, 5, 1 / 60)));
    let b = 0;
    run(30, () => (b = damp(b, 10, 5, 1 / 30)));
    expect(a).toBeCloseTo(b);
  });
  it('angles take the short way round', () => {
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(dampAngle(3, -3, 1000, 1)).toBeCloseTo(-3 + 2 * Math.PI);
  });
  it('gamepad dead zone ignores drift and rescales', () => {
    expect(deadZone(0.1, 0.05)).toEqual({ x: 0, y: 0 });
    expect(deadZone(1, 0).x).toBeCloseTo(1);
    expect(deadZone(0.575, 0).x).toBeCloseTo(0.5);
  });
});
