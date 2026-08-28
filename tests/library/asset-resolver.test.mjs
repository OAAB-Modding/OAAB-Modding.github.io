import test from 'node:test';
import assert from 'node:assert/strict';

import { AssetResolver, AssetResolutionError } from '../../src/library/resolver/asset-resolver.js';
import { AssetNotFoundError, AssetSource } from '../../src/library/sources/asset-source.js';

class MemorySource extends AssetSource {
  constructor(id, assets) {
    super({ id });
    this.assets = assets;
  }

  async get(path) {
    const bytes = this.assets[path];
    if (!bytes) throw new AssetNotFoundError(path, this.id);
    return { path, bytes, source: this.id, mimeType: 'application/octet-stream' };
  }

  async stat(path) {
    if (!this.assets[path]) throw new AssetNotFoundError(path, this.id);
    return { path, source: this.id, size: this.assets[path].byteLength };
  }
}

test('resolves case-insensitively from the highest-priority matching source', async () => {
  const resolver = new AssetResolver()
    .addSource(new MemorySource('low', {
      'meshes/oaab/foo.nif': new Uint8Array([1]).buffer,
    }), 1)
    .addSource(new MemorySource('high', {
      'meshes/oaab/foo.nif': new Uint8Array([2]).buffer,
    }), 10);

  const result = await resolver.resolve('Meshes\\OAAB\\FOO.NIF');
  assert.equal(result.path, 'meshes/oaab/foo.nif');
  assert.equal(result.source, 'high');
  assert.deepEqual([...new Uint8Array(result.bytes)], [2]);
});

test('falls through missing sources and reports all attempts', async () => {
  const resolver = new AssetResolver()
    .addSource(new MemorySource('empty-a', {}), 2)
    .addSource(new MemorySource('empty-b', {}), 1);

  await assert.rejects(
    () => resolver.resolve('oaab/missing.nif'),
    (error) => error instanceof AssetResolutionError && error.attempts.length === 2,
  );
});

test('resolves NIF tga references to installed dds replacements within source priority', async () => {
  const resolver = new AssetResolver()
    .addSource(new MemorySource('vanilla', {
      'textures/tx_wood.tga': new Uint8Array([1]).buffer,
    }), 1)
    .addSource(new MemorySource('data-files', {
      'textures/tx_wood.dds': new Uint8Array([2]).buffer,
    }), 10);

  const result = await resolver.resolve('textures\\tx_wood.tga');
  assert.equal(result.path, 'textures/tx_wood.dds');
  assert.equal(result.requestedPath, 'textures/tx_wood.tga');
  assert.equal(result.source, 'data-files');
  assert.deepEqual([...new Uint8Array(result.bytes)], [2]);
});
