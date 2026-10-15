// Tests for the animation state machine's pure parts (clip matching, blending, one-shot logic).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { matchClip, normalizeClipName, locomotionWeights, createAnimState, approach, animator } from '../../src/engine/animator.js';

const ROBOT = ['Dance', 'Death', 'Idle', 'Jump', 'No', 'Punch', 'Running', 'Sitting', 'Standing', 'ThumbsUp', 'Walking', 'WalkJump', 'Wave', 'Yes'];
const QUATERNIUS = ['CharacterArmature|Idle', 'CharacterArmature|Run', 'CharacterArmature|Walk', 'CharacterArmature|Jump_Idle', 'CharacterArmature|Sword_Slash'];

describe('clip name matching', () => {
  it('normalizes armature prefixes, case and punctuation', () => {
    expect(normalizeClipName('CharacterArmature|Run_Fast')).toBe('runfast');
    expect(normalizeClipName('mixamo.com')).toBe('mixamocom');
  });
  it('finds clips by state name and synonyms', () => {
    expect(matchClip(ROBOT, 'idle')).toBe('Idle');
    expect(matchClip(ROBOT, 'run')).toBe('Running');
    expect(matchClip(ROBOT, 'walk')).toBe('Walking'); // not 'WalkJump': shortest match wins
    expect(matchClip(ROBOT, 'attack')).toBe('Punch');
    expect(matchClip(ROBOT, 'sit')).toBe('Sitting');
    expect(matchClip(ROBOT, 'Running')).toBe('Running');
    expect(matchClip(ROBOT, 'fall')).toBeNull();
  });
  it('handles armature-prefixed names', () => {
    expect(matchClip(QUATERNIUS, 'run')).toBe('CharacterArmature|Run');
    expect(matchClip(QUATERNIUS, 'running')).toBe('CharacterArmature|Run');
    expect(matchClip(QUATERNIUS, 'Idle')).toBe('CharacterArmature|Idle');
    expect(matchClip(QUATERNIUS, 'fall')).toBe('CharacterArmature|Jump_Idle');
    expect(matchClip(QUATERNIUS, 'attack')).toBe('CharacterArmature|Sword_Slash');
  });
});

describe('locomotion blending', () => {
  it('is all idle when standing, all walk at walk speed, all run at run speed', () => {
    expect(locomotionWeights(0)).toMatchObject({ idle: 1, walk: 0, run: 0 });
    expect(locomotionWeights(2, { walkSpeed: 2, runSpeed: 5 })).toMatchObject({ idle: 0, walk: 1, run: 0 });
    expect(locomotionWeights(5, { walkSpeed: 2, runSpeed: 5 })).toMatchObject({ idle: 0, walk: 0, run: 1 });
  });
  it('weights always add up to 1 and run clips speed up with speed', () => {
    for (const s of [0, 0.4, 1, 2.5, 3.5, 7]) {
      const w = locomotionWeights(s);
      expect(w.idle + w.walk + w.run).toBeCloseTo(1);
    }
    expect(locomotionWeights(7).runScale).toBeGreaterThan(locomotionWeights(5).runScale);
  });
  it('approach never overshoots', () => {
    expect(approach(0, 1, 0.3)).toBeCloseTo(0.3);
    expect(approach(0.9, 1, 0.3)).toBe(1);
    expect(approach(1, 0, 2)).toBe(0);
  });
});

describe('state machine', () => {
  it('one-shots cover the base state and return to it', () => {
    const sm = createAnimState('idle');
    sm.setBase('run');
    sm.startShot('attack');
    expect(sm.current).toBe('attack');
    sm.setBase('walk'); // locomotion keeps updating underneath
    sm.finishShot('attack');
    expect(sm.current).toBe('walk');
  });
  it('held one-shots stay until cancelled; cancel can target a state', () => {
    const sm = createAnimState('idle');
    sm.startShot('jump', true);
    sm.finishShot('jump');
    expect(sm.current).toBe('jump');
    expect(sm.cancel('attack')).toBe(false);
    expect(sm.cancel('jump')).toBe(true);
    expect(sm.current).toBe('idle');
  });
});

describe('animator with real clips (no WebGL needed)', () => {
  const track = (name) => new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1])]);
  const make = () => animator(new THREE.Object3D(), ROBOT.map(track), { fade: 0.1 });

  it('cross-fades between looping states', () => {
    const anim = make();
    anim.play('idle');
    anim.update(0.2);
    anim.play('run');
    expect(anim.state).toBe('run');
    anim.update(0.05);
    const run = anim.mixer.existingAction(anim.mixer._actions.find((a) => a.getClip().name === 'Running').getClip());
    expect(run.getEffectiveWeight()).toBeCloseTo(0.5);
    anim.update(0.1);
    expect(run.getEffectiveWeight()).toBe(1);
  });

  it('once() resolves when the clip ends and returns to the previous state', async () => {
    const anim = make();
    anim.play('idle');
    const done = anim.once('attack');
    expect(anim.state).toBe('attack');
    for (let i = 0; i < 15; i++) anim.update(0.1);
    await expect(done).resolves.toBe(true);
    expect(anim.state).toBe('idle');
  });

  it('cancel() interrupts a held one-shot; missing clips warn instead of crashing', async () => {
    const anim = make();
    anim.locomotion(3);
    const jump = anim.once('jump', { hold: true });
    anim.update(2);
    await expect(jump).resolves.toBe(true); // the clip ended…
    expect(anim.state).toBe('jump'); // …but it holds its last frame
    anim.cancel('jump');
    expect(anim.state).toBe('move');
    const early = anim.once('attack');
    anim.update(0.1);
    anim.cancel();
    await expect(early).resolves.toBe(false); // interrupted
    const warn = console.warn;
    console.warn = () => {};
    await expect(anim.once('fall')).resolves.toBe(false);
    console.warn = warn;
  });
});
