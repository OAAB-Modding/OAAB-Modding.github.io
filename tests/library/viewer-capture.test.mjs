import test from 'node:test';
import assert from 'node:assert/strict';

import { captureTransparentPng } from '../../src/library/renderer/capture.js';

test('PNG capture removes viewport helpers and renders alpha zero before restoring the viewer', async () => {
  const background = { name: 'viewer background' };
  const scene = { background };
  const camera = {};
  const grid = { visible: true };
  const axes = { visible: true };
  const renders = [];
  let clearAlpha = 1;
  let controlUpdates = 0;
  const renderer = {
    getClearAlpha: () => clearAlpha,
    setClearAlpha(value) { clearAlpha = value; },
    render(renderedScene, renderedCamera) {
      assert.equal(renderedCamera, camera);
      renders.push({
        background: renderedScene.background,
        clearAlpha,
        gridVisible: grid.visible,
        axesVisible: axes.visible,
      });
    },
  };
  const canvas = {
    toBlob(callback, type) {
      assert.equal(type, 'image/png');
      callback(new Blob(['transparent'], { type }));
    },
  };

  const blob = await captureTransparentPng({
    scene,
    renderer,
    grid,
    axes,
    controls: { update() { controlUpdates += 1; } },
    camera,
    canvas,
  });

  assert.equal(blob.type, 'image/png');
  assert.equal(controlUpdates, 1);
  assert.deepEqual(renders, [
    { background: null, clearAlpha: 0, gridVisible: false, axesVisible: false },
    { background, clearAlpha: 1, gridVisible: true, axesVisible: true },
  ]);
  assert.equal(scene.background, background);
  assert.equal(clearAlpha, 1);
  assert.equal(grid.visible, true);
  assert.equal(axes.visible, true);
});

test('failed PNG encoding still restores the viewer background and helpers', async () => {
  const background = {};
  const scene = { background };
  const grid = { visible: true };
  const axes = { visible: false };
  let clearAlpha = 0.75;
  const renderer = {
    getClearAlpha: () => clearAlpha,
    setClearAlpha(value) { clearAlpha = value; },
    render() {},
  };

  await assert.rejects(captureTransparentPng({
    scene,
    renderer,
    grid,
    axes,
    controls: { update() {} },
    camera: {},
    canvas: { toBlob(callback) { callback(null); } },
  }), /Unable to encode PNG/);

  assert.equal(scene.background, background);
  assert.equal(clearAlpha, 0.75);
  assert.equal(grid.visible, true);
  assert.equal(axes.visible, false);
});
