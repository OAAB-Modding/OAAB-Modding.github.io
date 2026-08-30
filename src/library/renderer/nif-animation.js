const EPSILON = 1e-8;
const SIN_THRESHOLD = 0.001;

export function externalKfPath(meshPath) {
  const value = String(meshPath || '');
  if (!value.toLowerCase().endsWith('.nif')) return null;
  const slash = value.lastIndexOf('/');
  const directory = slash >= 0 ? value.slice(0, slash + 1) : '';
  const filename = value.slice(slash + 1, -4);
  return filename ? `${directory}x${filename}.kf` : null;
}

export function mergeExternalAnimationPacket(packet, externalPacket) {
  const externalAnimations = externalPacket?.animations || [];
  if (!externalAnimations.length) return packet;
  const externalTargets = new Set(externalAnimations
    .map(animation => normalizedTarget(animation.target))
    .filter(Boolean));
  const retainedAnimations = (packet.animations || []).filter(animation => (
    animation.data?.kind !== 'keyframe'
    || !externalTargets.has(normalizedTarget(animation.target))
  ));
  packet.animations = [...retainedAnimations, ...externalAnimations];
  if (externalPacket.animationGroups?.length) {
    packet.animationGroups = externalPacket.animationGroups;
  }
  if (packet.stats) packet.stats.animations = packet.animations.length;
  return packet;
}

export function selectIdleAnimationGroup(groups = []) {
  return groups
    .map((group, index) => ({ group, index, score: idleGroupScore(group?.name) }))
    .filter(({ group, score }) => score < Number.POSITIVE_INFINITY
      && Number(group.stopTime) > Number(group.startTime))
    .sort((left, right) => left.score - right.score || left.index - right.index)[0]?.group || null;
}

function idleGroupScore(name) {
  const normalized = String(name || '').toLowerCase().replace(/[\s:_-]+/g, '');
  if (normalized === 'idle' || normalized === 'idle1') return 0;
  const match = /^idle(\d+)$/.exec(normalized);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function normalizedTarget(value) {
  return String(value || '').trim().toLowerCase();
}

export function animationGroupTime(group, elapsed) {
  const groupStart = finiteNumber(group?.startTime, 0);
  const groupStop = finiteNumber(group?.stopTime, groupStart);
  const loopStart = finiteNumber(group?.loopStartTime, groupStart);
  const loopStop = finiteNumber(group?.loopStopTime, groupStop);
  const start = loopStop > loopStart ? loopStart : groupStart;
  const stop = loopStop > loopStart ? loopStop : groupStop;
  const duration = stop - start;
  if (!(duration > 0)) return start;
  return start + positiveModulo(finiteNumber(elapsed, 0), duration);
}

export function controllerAnimationTime(animation, elapsed) {
  const start = finiteNumber(animation?.startTime, 0);
  const stop = finiteNumber(animation?.stopTime, start);
  const duration = stop - start;
  const frequency = finiteNumber(animation?.frequency, 1);
  const phase = finiteNumber(animation?.phase, 0);
  const raw = finiteNumber(elapsed, 0) * frequency + phase;
  if (!(duration > 0)) return start + raw;
  if (animation?.cycleType === 'Clamp') return clamp(raw, start, stop);
  if (animation?.cycleType === 'Reverse') {
    const doubled = positiveModulo(raw - start, duration * 2);
    return doubled > duration ? stop - (doubled - duration) : start + doubled;
  }
  return start + positiveModulo(raw - start, duration);
}

export function sampleScalarCurve(curve, time, fallback = 0) {
  const interval = keyInterval(curve?.keys, time);
  if (!interval) return fallback;
  const { before, after, beforeIndex, afterIndex, fraction } = interval;
  if (before === after) return finiteNumber(before.value, fallback);
  if (curve.interpolation === 'Bezier') {
    return hermite(
      finiteNumber(before.value, fallback),
      finiteNumber(before.outTan, 0),
      finiteNumber(after.inTan, 0),
      finiteNumber(after.value, fallback),
      fraction,
    );
  }
  if (curve.interpolation === 'TCB') {
    return hermite(
      finiteNumber(before.value, fallback),
      tcbTangent(curve.keys, beforeIndex, 'out', false),
      tcbTangent(curve.keys, afterIndex, 'in', false),
      finiteNumber(after.value, fallback),
      fraction,
    );
  }
  return lerp(finiteNumber(before.value, fallback), finiteNumber(after.value, fallback), fraction);
}

export function sampleVectorCurve(curve, time, fallback = [0, 0, 0]) {
  const interval = keyInterval(curve?.keys, time);
  if (!interval) return [...fallback];
  const { before, after, beforeIndex, afterIndex, fraction } = interval;
  const beforeValue = vector(before.value, fallback.length, fallback);
  if (before === after) return beforeValue;
  const afterValue = vector(after.value, fallback.length, fallback);
  if (curve.interpolation === 'Bezier') {
    return hermiteVector(
      beforeValue,
      vector(before.outTan, fallback.length),
      vector(after.inTan, fallback.length),
      afterValue,
      fraction,
    );
  }
  if (curve.interpolation === 'TCB') {
    return hermiteVector(
      beforeValue,
      tcbTangent(curve.keys, beforeIndex, 'out', true),
      tcbTangent(curve.keys, afterIndex, 'in', true),
      afterValue,
      fraction,
    );
  }
  return beforeValue.map((value, index) => lerp(value, afterValue[index], fraction));
}

export function sampleQuaternionCurve(curve, time, fallback = [0, 0, 0, 1]) {
  const interval = keyInterval(curve?.keys, time);
  if (!interval) return [...fallback];
  const { before, after, beforeIndex, afterIndex, fraction } = interval;
  const beforeValue = quatNormalize(vector(before.value, 4, fallback));
  if (before === after) return beforeValue;
  const afterValue = quatNormalize(vector(after.value, 4, fallback));
  if (curve.interpolation === 'Bezier') {
    return quatNormalize(squad(
      beforeValue,
      bezierRotationTangent(curve.keys, beforeIndex),
      bezierRotationTangent(curve.keys, afterIndex),
      afterValue,
      fraction,
    ));
  }
  if (curve.interpolation === 'TCB') {
    return quatNormalize(squad(
      beforeValue,
      tcbRotationTangent(curve.keys, beforeIndex, 'out'),
      tcbRotationTangent(curve.keys, afterIndex, 'in'),
      afterValue,
      fraction,
    ));
  }
  return quatNormalize(nifSlerp(beforeValue, afterValue, fraction));
}

export function sampleStep(keys, time, fallback = true) {
  let value = fallback;
  for (const key of keys || []) {
    if (finiteNumber(key.time, 0) > time) break;
    value = !!key.value;
  }
  return value;
}

function keyInterval(keys, time) {
  const values = keys || [];
  if (!values.length) return null;
  if (time <= finiteNumber(values[0].time, 0)) {
    return { before: values[0], after: values[0], beforeIndex: 0, afterIndex: 0, fraction: 0 };
  }
  for (let index = 1; index < values.length; index += 1) {
    if (time <= finiteNumber(values[index].time, 0)) {
      const before = values[index - 1];
      const after = values[index];
      const span = finiteNumber(after.time, 0) - finiteNumber(before.time, 0);
      return {
        before,
        after,
        beforeIndex: index - 1,
        afterIndex: index,
        fraction: span > 0 ? (time - before.time) / span : 0,
      };
    }
  }
  const index = values.length - 1;
  return { before: values[index], after: values[index], beforeIndex: index, afterIndex: index, fraction: 0 };
}

function tcbTangent(keys, index, direction, vectorValue) {
  const current = keys[index];
  const last = keys.length - 1;
  const currentValue = vectorValue ? vector(current.value, 3) : finiteNumber(current.value, 0);
  const neighborValue = position => vectorValue
    ? vector(keys[position].value, currentValue.length)
    : finiteNumber(keys[position].value, 0);
  const addValue = (left, right) => vectorValue
    ? left.map((value, component) => value + right[component])
    : left + right;
  const subtractValue = (left, right) => vectorValue
    ? left.map((value, component) => value - right[component])
    : left - right;
  const scaleValue = (value, scale) => vectorValue
    ? value.map(component => component * scale)
    : value * scale;

  const previous = index === 0
    ? subtractValue(scaleValue(currentValue, 2), neighborValue(Math.min(1, last)))
    : neighborValue(index - 1);
  const previousTime = index === 0
    ? current.time * 2 - keys[Math.min(1, last)].time
    : keys[index - 1].time;
  const next = index === last
    ? subtractValue(scaleValue(currentValue, 2), neighborValue(Math.max(0, last - 1)))
    : neighborValue(index + 1);
  const nextTime = index === last
    ? current.time * 2 - keys[Math.max(0, last - 1)].time
    : keys[index + 1].time;
  const previousLength = subtractValue(currentValue, previous);
  const nextLength = subtractValue(next, currentValue);
  const tension = finiteNumber(current.tension, 0);
  const continuity = finiteNumber(current.continuity, 0);
  const bias = finiteNumber(current.bias, 0);
  const incoming = direction === 'in';
  const firstScale = (1 - tension)
    * (1 + (incoming ? -continuity : continuity))
    * (1 + bias);
  const secondScale = (1 - tension)
    * (1 + (incoming ? continuity : -continuity))
    * (1 - bias);
  const numerator = incoming ? current.time - previousTime : current.time - nextTime;
  const denominator = incoming ? nextTime - previousTime : previousTime - nextTime;
  if (Math.abs(denominator) < EPSILON) return vectorValue ? new Array(currentValue.length).fill(0) : 0;
  return scaleValue(
    addValue(scaleValue(previousLength, firstScale), scaleValue(nextLength, secondScale)),
    numerator / denominator,
  );
}

function rotationNeighbors(keys, index) {
  const last = keys.length - 1;
  const current = quatNormalize(vector(keys[index].value, 4, [0, 0, 0, 1]));
  const previous = index === 0
    ? quatMultiply(quatMultiply(current, quatConjugate(quatNormalize(vector(keys[Math.min(1, last)].value, 4)))), current)
    : quatNormalize(vector(keys[index - 1].value, 4));
  const next = index === last
    ? quatMultiply(quatMultiply(current, quatConjugate(quatNormalize(vector(keys[Math.max(0, last - 1)].value, 4)))), current)
    : quatNormalize(vector(keys[index + 1].value, 4));
  return { previous, current, next };
}

function bezierRotationTangent(keys, index) {
  const { previous, current, next } = rotationNeighbors(keys, index);
  return quatIntermediate(previous, current, next);
}

function tcbRotationTangent(keys, index, direction) {
  const currentKey = keys[index];
  const current = quatNormalize(vector(currentKey.value, 4, [0, 0, 0, 1]));
  const last = keys.length - 1;
  const previousIndex = Math.max(0, index - 1);
  const nextIndex = Math.min(last, index + 1);
  const rawPrevious = quatLog(quatMultiply(
    quatConjugate(quatNormalize(vector(keys[previousIndex].value, 4))),
    current,
  ));
  const rawNext = quatLog(quatMultiply(
    quatConjugate(current),
    quatNormalize(vector(keys[nextIndex].value, 4)),
  ));
  const previousLength = index === 0 ? rawNext : rawPrevious;
  const previousTime = index === 0
    ? currentKey.time * 2 - keys[Math.min(1, last)].time
    : keys[previousIndex].time;
  const nextLength = index === last ? rawPrevious : rawNext;
  const nextTime = index === last
    ? currentKey.time * 2 - keys[Math.max(0, last - 1)].time
    : keys[nextIndex].time;
  const tension = finiteNumber(currentKey.tension, 0);
  const continuity = finiteNumber(currentKey.continuity, 0);
  const bias = finiteNumber(currentKey.bias, 0);
  const incoming = direction === 'in';
  const firstScale = (1 - tension)
    * (1 + (incoming ? -continuity : continuity))
    * (1 + bias);
  const secondScale = (1 - tension)
    * (1 + (incoming ? continuity : -continuity))
    * (1 - bias);
  const denominator = nextTime - previousTime;
  if (Math.abs(denominator) < EPSILON) return current;
  const intervalScale = incoming
    ? (nextTime - currentKey.time) / denominator
    : (currentKey.time - previousTime) / denominator;
  const combined = quatScale(quatAdd(
    quatScale(previousLength, firstScale),
    quatScale(nextLength, secondScale),
  ), intervalScale);
  const exponent = incoming
    ? quatScale(quatAdd(previousLength, quatScale(combined, -1)), 0.5)
    : quatScale(quatAdd(combined, quatScale(nextLength, -1)), 0.5);
  return quatMultiply(current, quatExp(exponent));
}

function hermite(p0, outTangent, inTangent, p1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return p0 * (2 * t3 - 3 * t2 + 1)
    + p1 * (-2 * t3 + 3 * t2)
    + outTangent * (t3 - 2 * t2 + t)
    + inTangent * (t3 - t2);
}

function hermiteVector(p0, outTangent, inTangent, p1, t) {
  return p0.map((value, index) => hermite(
    value,
    outTangent[index],
    inTangent[index],
    p1[index],
    t,
  ));
}

function quatIntermediate(previous, current, next) {
  const inverse = quatConjugate(current);
  const length = quatAdd(
    quatLog(quatMultiply(inverse, previous)),
    quatLog(quatMultiply(inverse, next)),
  );
  return quatMultiply(current, quatExp(quatScale(length, -0.25)));
}

function squad(q0, a, b, q1, t) {
  return nifSlerp(nifSlerp(q0, q1, t), nifSlerp(a, b, t), 2 * t * (1 - t));
}

function nifSlerp(q0, q1, t) {
  const cosine = clamp(quatDot(q0, q1), -1, 1);
  const theta = Math.acos(cosine);
  const sine = Math.sin(theta);
  if (Math.abs(sine) < SIN_THRESHOLD) return [...q0];
  return quatAdd(
    quatScale(q0, Math.sin((1 - t) * theta) / sine),
    quatScale(q1, Math.sin(t * theta) / sine),
  );
}

function quatExp(quaternion) {
  const theta = Math.hypot(quaternion[0], quaternion[1], quaternion[2]);
  const sine = Math.sin(theta);
  const factor = Math.abs(sine) < SIN_THRESHOLD ? 1 : sine / theta;
  return [
    quaternion[0] * factor,
    quaternion[1] * factor,
    quaternion[2] * factor,
    Math.cos(theta),
  ];
}

function quatLog(quaternion) {
  const theta = Math.acos(clamp(quaternion[3], -1, 1));
  const sine = Math.sin(theta);
  const factor = Math.abs(sine) < SIN_THRESHOLD ? 1 : theta / sine;
  return [quaternion[0] * factor, quaternion[1] * factor, quaternion[2] * factor, 0];
}

function quatMultiply(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function quatConjugate(value) {
  return [-value[0], -value[1], -value[2], value[3]];
}

function quatNormalize(value) {
  const length = Math.hypot(...value);
  return length > EPSILON ? value.map(component => component / length) : [0, 0, 0, 1];
}

function quatDot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function quatScale(value, scale) {
  return value.map(component => component * scale);
}

function quatAdd(left, right) {
  return left.map((value, index) => value + right[index]);
}

function vector(value, length, fallback = []) {
  return Array.from({ length }, (_, index) => finiteNumber(value?.[index], fallback[index] || 0));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function lerp(start, stop, fraction) {
  return start + (stop - start) * fraction;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
