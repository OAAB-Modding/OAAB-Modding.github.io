import test from 'node:test';
import assert from 'node:assert/strict';

import { OAABSource } from '../../src/library/sources/oaab-source.js';

test('uses the generated case map while retaining the canonical virtual path', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url === '/manifest.json') {
      return new Response(JSON.stringify({
        caseMap: {
          'meshes/oaab/d/combarshelfdoor.nif': 'meshes/oaab/d/comBarShelfDoor.nif',
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('meshes/oaab/d/comBarShelfDoor.nif')) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }
    return new Response(null, { status: 404 });
  };
  const source = new OAABSource({
    fetchImpl,
    baseUrls: ['https://assets.example/'],
    manifestUrls: ['/manifest.json'],
  });

  const asset = await source.get('Meshes\\OAAB\\D\\COMBARSHELFDOOR.NIF');
  assert.equal(asset.path, 'meshes/oaab/d/combarshelfdoor.nif');
  assert.equal(asset.size, 3);
  assert.ok(requested.some((url) => url.endsWith('comBarShelfDoor.nif')));
});
