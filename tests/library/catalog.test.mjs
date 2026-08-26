import test from 'node:test';
import assert from 'node:assert/strict';

import { createLibraryServices } from '../../src/library/app.js';

function responseFor(rows) {
  return new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('built-in providers expose source-neutral records to production adapters', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith('OAAB_Data_filtered.json')) {
      return responseFor([{ id: 'AB_Test', type: 'STAT', name: 'Test', mesh: 'OAAB\\x\\test.nif' }]);
    }
    return responseFor([{ id: 'vanilla_test', type: 'STAT', mesh: 'x\\test.nif' }]);
  };

  const services = createLibraryServices({ fetchImpl });
  const oaab = await services.providers.oaab.load();
  const vanilla = await services.providers.vanilla.load();

  assert.equal(oaab[0].source, 'oaab-data');
  assert.equal(oaab[0].mesh, 'meshes/oaab/x/test.nif');
  assert.equal(oaab[0].raw.id, 'AB_Test');
  assert.equal(vanilla.length, 3);
  assert.ok(vanilla.every(record => record.source === 'vanilla'));
  assert.ok(requested.some(url => url.endsWith('Morrowind_filtered.json')));
  assert.ok(requested.some(url => url.endsWith('Tribunal_filtered.json')));
  assert.ok(requested.some(url => url.endsWith('Bloodmoon_filtered.json')));
});
