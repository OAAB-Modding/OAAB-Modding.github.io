import test from 'node:test';
import assert from 'node:assert/strict';

import { scanDependencies } from '../../src/library/diagnostics/dependency-scanner.js';
import { AssetResolver } from '../../src/library/resolver/asset-resolver.js';
import { AssetNotFoundError } from '../../src/library/sources/asset-source.js';

test('reports winning sources and missing NIF/texture dependencies', async () => {
  const assets = new Map([
    ['meshes/example/one.nif', new Uint8Array([1]).buffer],
    ['textures/example/resolved.dds', new Uint8Array([2]).buffer],
  ]);
  const source = {
    id: 'fixture',
    label: 'Fixture assets',
    async get(path) {
      const bytes = assets.get(path);
      if (!bytes) throw new AssetNotFoundError(path, this.id);
      return { path, bytes: bytes.slice(0), source: this.id, sourceLabel: this.label };
    },
  };
  const resolver = new AssetResolver().addSource(source, 10);
  const diagnostics = await scanDependencies([
    { id: 'one', mesh: 'example/one.nif' },
    { id: 'two', mesh: 'example/missing.nif' },
  ], {
    resolver,
    parseNif: async () => ({ textures: ['example/resolved.dds', 'example/missing.dds'], stats: {} }),
  });
  assert.deepEqual(diagnostics.counts, {
    records: 2,
    meshRecords: 2,
    uniqueNifs: 2,
    resolvedNifs: 1,
    missingNifs: 1,
    resolvedTextures: 1,
    missingTextures: 1,
  });
  assert.equal(diagnostics.assets[0].sourceLabel, 'Fixture assets');
  assert.equal(diagnostics.assets[0].textures[1].status, 'missing');
});
