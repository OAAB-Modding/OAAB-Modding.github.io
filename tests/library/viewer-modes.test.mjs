import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isEditorMarkerName,
  isViewerObjectVisible,
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
