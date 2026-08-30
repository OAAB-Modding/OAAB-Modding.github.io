import assert from 'node:assert/strict';
import test from 'node:test';

import {
  animationGroupTime,
  controllerAnimationTime,
  externalKfPath,
  mergeExternalAnimationPacket,
  sampleQuaternionCurve,
  sampleScalarCurve,
  sampleVectorCurve,
  selectIdleAnimationGroup,
} from '../../src/library/renderer/nif-animation.js';

test('derives and merges sibling x*.kf animation packets by target name', () => {
  assert.equal(
    externalKfPath('meshes/oaab/r/creature.nif'),
    'meshes/oaab/r/xcreature.kf',
  );
  const embeddedRoot = { target: 'Bip01', data: { kind: 'keyframe' } };
  const embeddedEffect = { target: 'Glow', data: { kind: 'keyframe' } };
  const visibility = { target: 'Glow', data: { kind: 'visibility' } };
  const externalRoot = { target: 'bip01', data: { kind: 'keyframe' } };
  const packet = {
    animations: [embeddedRoot, embeddedEffect, visibility],
    animationGroups: [],
    stats: { animations: 3 },
  };
  mergeExternalAnimationPacket(packet, {
    animations: [externalRoot],
    animationGroups: [{ name: 'Idle', startTime: 0, stopTime: 1 }],
  });
  assert.deepEqual(packet.animations, [embeddedEffect, visibility, externalRoot]);
  assert.equal(packet.animationGroups[0].name, 'Idle');
  assert.equal(packet.stats.animations, 3);
});

test('selects the canonical idle group and falls back to the lowest numbered idle', () => {
  assert.equal(selectIdleAnimationGroup([
    { name: 'Idle3', startTime: 3, stopTime: 4 },
    { name: 'Idle2', startTime: 1, stopTime: 2 },
  ]).name, 'Idle2');
  assert.equal(selectIdleAnimationGroup([
    { name: 'Idle2', startTime: 1, stopTime: 2 },
    { name: 'Idle', startTime: 5, stopTime: 6 },
  ]).name, 'Idle');
});

test('loops inside idle loop text keys when present', () => {
  const group = {
    startTime: 1,
    stopTime: 9,
    loopStartTime: 3,
    loopStopTime: 5,
  };
  assert.equal(animationGroupTime(group, 0), 3);
  assert.equal(animationGroupTime(group, 2.5), 3.5);
});

test('samples linear, Bezier, and TCB transform curves', () => {
  assert.equal(sampleScalarCurve({
    interpolation: 'Bezier',
    keys: [
      { time: 0, value: 0, outTan: 1 },
      { time: 1, value: 1, inTan: 1 },
    ],
  }, 0.5), 0.5);

  assert.deepEqual(sampleVectorCurve({
    interpolation: 'Linear',
    keys: [
      { time: 0, value: [0, 0, 0] },
      { time: 2, value: [2, 4, 6] },
    ],
  }, 1), [1, 2, 3]);

  const tcb = sampleScalarCurve({
    interpolation: 'TCB',
    keys: [
      { time: 0, value: 0, tension: 0, continuity: 0, bias: 0 },
      { time: 1, value: 1, tension: 0, continuity: 0, bias: 0 },
    ],
  }, 0.5);
  assert.ok(Number.isFinite(tcb));
  assert.ok(Math.abs(tcb - 0.5) < 1e-6);
});

test('uses Morrowind controller timing and normalized quaternion interpolation', () => {
  assert.equal(controllerAnimationTime({
    startTime: 2,
    stopTime: 4,
    frequency: 1,
    phase: 0,
    cycleType: 'Cycle',
  }, 5), 3);

  const quaternion = sampleQuaternionCurve({
    interpolation: 'Linear',
    keys: [
      { time: 0, value: [0, 0, 0, 1] },
      { time: 1, value: [0, 0, 1, 0] },
    ],
  }, 0.5);
  assert.ok(Math.abs(Math.hypot(...quaternion) - 1) < 1e-6);
  assert.ok(Math.abs(quaternion[2] - Math.SQRT1_2) < 1e-6);
});
