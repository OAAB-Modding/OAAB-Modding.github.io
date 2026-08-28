import test from 'node:test';
import assert from 'node:assert/strict';

import { fingerprintBytes, thumbnailCacheKey } from '../../src/library/storage/thumbnail-cache.js';
import { LibraryDatabase, LIBRARY_DB_VERSION, LIBRARY_STORES } from '../../src/library/storage/library-db.js';

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

test('thumbnail path lookup uses the existing path index', async () => {
  const expected = [{ key: 'thumbnail:one' }];
  const calls = [];
  const connection = {
    close() {},
    transaction(store, mode) {
      calls.push(['transaction', store, mode]);
      return {
        objectStore(name) {
          calls.push(['objectStore', name]);
          return {
            index(indexName) {
              calls.push(['index', indexName]);
              return {
                getAll(key) {
                  calls.push(['getAll', key]);
                  const request = {};
                  queueMicrotask(() => {
                    request.result = expected;
                    request.onsuccess();
                  });
                  return request;
                },
              };
            },
          };
        },
      };
    },
  };
  const indexedDB = {
    open(name, version) {
      calls.push(['open', name, version]);
      const request = {};
      queueMicrotask(() => {
        request.result = connection;
        request.onsuccess();
      });
      return request;
    },
  };

  const database = new LibraryDatabase({ indexedDB });
  const entries = await database.getThumbnailsByPath('meshes/oaab/demo.nif');

  assert.equal(entries, expected);
  assert.deepEqual(calls, [
    ['open', 'oaab-library', 1],
    ['transaction', 'thumbnails', 'readonly'],
    ['objectStore', 'thumbnails'],
    ['index', 'path'],
    ['getAll', 'meshes/oaab/demo.nif'],
  ]);
});
