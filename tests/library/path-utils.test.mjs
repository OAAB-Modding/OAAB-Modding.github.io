import test from 'node:test';
import assert from 'node:assert/strict';

import {
  InvalidAssetPathError,
  meshKey,
  normalizeAssetPath,
} from '../../src/library/resolver/path-utils.js';

test('normalizes the canonical examples and infers TES3 roots', () => {
  assert.equal(
    normalizeAssetPath('Meshes\\OAAB\\F\\Chair.nif'),
    'meshes/oaab/f/chair.nif',
  );
  assert.equal(normalizeAssetPath('oaab\\f\\chair.nif'), 'meshes/oaab/f/chair.nif');
  assert.equal(normalizeAssetPath('textures/foo.dds'), 'textures/foo.dds');
  assert.equal(normalizeAssetPath('OAAB\\f\\chair.dds'), 'textures/oaab/f/chair.dds');
});

test('collapses installer/repository prefixes and produces the existing mesh key', () => {
  const input = '01 Patch/00 Core/meshes/OAAB/X/Foo.nif';
  assert.equal(normalizeAssetPath(input), 'meshes/oaab/x/foo.nif');
  assert.equal(meshKey(input), 'oaab/x/foo.nif');
});

test('rejects traversal and URL inputs', () => {
  assert.throws(() => normalizeAssetPath('../meshes/foo.nif'), InvalidAssetPathError);
  assert.throws(() => normalizeAssetPath('https://example.com/foo.nif'), InvalidAssetPathError);
});
