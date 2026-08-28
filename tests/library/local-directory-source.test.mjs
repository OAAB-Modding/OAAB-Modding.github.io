import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalDirectorySource } from '../../src/library/sources/local-directory-source.js';

function localFile(name, relativePath, text) {
  const blob = new Blob([text]);
  Object.defineProperties(blob, {
    name: { value: name },
    webkitRelativePath: { value: relativePath },
    lastModified: { value: 42 },
  });
  return blob;
}

test('indexes multi-file selections by case-insensitive Data Files paths', async () => {
  const source = new LocalDirectorySource({ files: [
    localFile('Chair.NIF', 'Example/Data Files/Meshes/OAAB/F/Chair.NIF', 'nif bytes'),
    localFile('Wood.DDS', 'Example/Data Files/Textures/OAAB/Wood.DDS', 'dds bytes'),
  ] });
  assert.equal(source.entries.size, 2);
  assert.equal(await source.has('meshes/oaab/f/chair.nif'), true);
  const asset = await source.get('Textures\\OAAB\\Wood.dds');
  assert.equal(new TextDecoder().decode(asset.bytes), 'dds bytes');
  assert.equal(asset.lastModified, 42);
});

test('directory handles are indexed without reading file payloads', async () => {
  let reads = 0;
  const file = localFile('lazy.nif', '', 'lazy');
  const root = {
    async *entries() {
      yield ['Meshes', { kind: 'directory', async *entries() {
        yield ['lazy.nif', { kind: 'file', async getFile() { reads += 1; return file; } }];
      } }];
    },
  };
  const source = new LocalDirectorySource();
  await source.indexDirectory(root);
  assert.equal(reads, 0);
  await source.get('meshes/lazy.nif');
  assert.equal(reads, 2); // stat and get preserve lazy File System Access reads
});

test('selected files can be indexed in paint-friendly batches with progress', async () => {
  const files = Array.from({ length: 5 }, (_, index) => (
    localFile(`asset-${index}.nif`, `Data Files/Meshes/asset-${index}.nif`, String(index))
  ));
  const progress = [];
  const source = new LocalDirectorySource();
  await source.addFilesWithProgress(files, {
    batchSize: 2,
    onProgress: value => progress.push({ ...value }),
  });

  assert.deepEqual(progress.map(value => [value.completed, value.total]), [
    [0, 5],
    [2, 5],
    [4, 5],
    [5, 5],
  ]);
  assert.equal(source.entries.size, 5);
});
