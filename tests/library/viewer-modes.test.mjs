import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cameraDistanceScaleForView,
  cameraFrameMarginForView,
  cameraDirectionForView,
  isEditorMarkerName,
  isViewerObjectVisible,
  THUMBNAIL_FLIP_COVERAGE_DELTA,
  THUMBNAIL_FLIP_COVERAGE_RATIO,
  THUMBNAIL_ORIENTATION_RENDER_SIZE,
  thumbnailOrientationFromCoverage,
  thumbnailViewForRecord,
} from '../../src/library/renderer/viewer-modes.js';

test('EditorMarker shapes are recognized by name without case sensitivity', () => {
  assert.equal(isEditorMarkerName('EditorMarker'), true);
  assert.equal(isEditorMarkerName('Tri EditorMarker 01'), true);
  assert.equal(isEditorMarkerName('tri_editormarker_box'), true);
  assert.equal(isEditorMarkerName('Marker'), false);
  assert.equal(isEditorMarkerName(null), false);
});

test('viewer visibility composes hidden, marker, and collision flags', () => {
  assert.equal(isViewerObjectVisible({}), true);
  assert.equal(isViewerObjectVisible({ marker: true }), true);
  assert.equal(isViewerObjectVisible({ marker: true }, { markersVisible: false }), false);
  assert.equal(isViewerObjectVisible({ collision: true }), false);
  assert.equal(isViewerObjectVisible({ collision: true }, { collisionVisible: true }), true);
  assert.equal(isViewerObjectVisible(
    { marker: true, collision: true },
    { markersVisible: true, collisionVisible: false },
  ), false);
  assert.equal(isViewerObjectVisible(
    { hidden: true },
    { markersVisible: true, collisionVisible: true },
  ), false);
});

test('head bodyparts use the legacy front-facing thumbnail view', () => {
  assert.equal(thumbnailViewForRecord({
    type: 'Bodypart',
    raw: { data: { part: 'Head' } },
  }), 'front');
  assert.equal(thumbnailViewForRecord({
    type: 'Bodypart',
    raw: { data: { part: 'Hair' } },
  }), '');
  assert.equal(thumbnailViewForRecord({
    type: 'Miscellaneous',
    name: 'Slaughterfish Head',
  }), '');
  assert.deepEqual(cameraDirectionForView('front'), [0, 0, 1]);
  assert.deepEqual(cameraDirectionForView(), [1, 0.72, 1]);
  assert.equal(cameraDistanceScaleForView('front'), 0.9);
  assert.equal(cameraDistanceScaleForView(), 1);
  assert.equal(cameraFrameMarginForView('front'), 1.25);
  assert.equal(cameraFrameMarginForView(), 1);
});

test('backside detection uses the named ratio and absolute coverage thresholds', () => {
  assert.equal(THUMBNAIL_ORIENTATION_RENDER_SIZE, 128);
  assert.equal(THUMBNAIL_FLIP_COVERAGE_RATIO, 1.75);
  assert.equal(THUMBNAIL_FLIP_COVERAGE_DELTA, 0.08);

  assert.deepEqual(thumbnailOrientationFromCoverage(0.2, 0.36), {
    currentCoverage: 0.2,
    flippedCoverage: 0.36,
    coverageRatio: 1.7999999999999998,
    thumbnailFlip180: true,
    thumbnailRotationY: 180,
  });
  assert.equal(thumbnailOrientationFromCoverage(0.1, 0.175).thumbnailFlip180, false);
  assert.equal(thumbnailOrientationFromCoverage(0.2, 0.34).thumbnailFlip180, false);
  assert.equal(thumbnailOrientationFromCoverage(0, 0.1).thumbnailFlip180, true);
  assert.equal(thumbnailOrientationFromCoverage(0, 0).coverageRatio, 1);
});

test('skinned bones are evaluated relative to the skin root rather than its parent', () => {
  const source = readFileSync(
    new URL('../../src/library/renderer/viewer.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /binding\.rootInverse\.copy\(rootNode\.matrixWorld\)\.invert\(\)/);
  assert.doesNotMatch(source, /rootNode\?\.parent/);
});
