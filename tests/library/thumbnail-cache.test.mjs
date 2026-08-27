import test from 'node:test';
import assert from 'node:assert/strict';

import { fingerprintBytes, thumbnailCacheKey } from '../../src/library/storage/thumbnail-cache.js';
import { LIBRARY_DB_VERSION, LIBRARY_STORES } from '../../src/library/storage/library-db.js';

test('thumbnail keys include source, canonical path, asset version, and renderer version', () => {
  const key = thumbnailCacheKey({
    sourceFingerprint: 'oaab-data:master',
    path: 'OAAB\\F\\Chair.nif',
    assetVersion: 'deadbeef',
    rendererVersion: '9',
  });
  assert.match(key, /^thumbnail:v3:9:/);
  assert.match(decodeURIComponent(key), /meshes\/oaab\/f\/chair\.nif/);
  assert.match(key, /deadbeef$/);
});

test('byte fingerprints change when asset content changes', async () => {
  assert.notEqual(await fingerprintBytes(new Uint8Array([1, 2])), await fingerprintBytes(new Uint8Array([1, 3])));
});

test('database schema declares focused versioned stores', () => {
  assert.equal(LIBRARY_DB_VERSION, 1);
  assert.deepEqual([...LIBRARY_STORES], ['plugins', 'plugin-records', 'asset-metadata', 'thumbnails', 'settings']);
});
