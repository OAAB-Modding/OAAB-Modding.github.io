import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cameraDirectionForView,
  isEditorMarkerName,
  isViewerObjectVisible,
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
});
