import test from 'node:test';
import assert from 'node:assert/strict';

import { BsaSource, BSA_PRIORITIES } from '../../src/library/sources/bsa-source.js';

test('indexes TES3 BSA names and slices individual assets lazily', async () => {
  const archive = makeBsa([
    ['textures\\Tx_Wood.DDS', new Uint8Array([1, 2, 3])],
    ['meshes\\OAAB\\Chair.NIF', new Uint8Array([4, 5])],
  ]);
  let slicedBytes = 0;
  const file = {
    name: 'Morrowind.bsa',
    size: archive.size,
    lastModified: 99,
    slice(start, end) {
      slicedBytes += end - start;
      return archive.slice(start, end);
    },
  };
  const source = new BsaSource({ file });
  await source.index();
  const beforeAsset = slicedBytes;
  const asset = await source.get('Textures/tx_wood.dds');
  assert.deepEqual([...new Uint8Array(asset.bytes)], [1, 2, 3]);
  assert.equal(asset.sourceLabel, 'Morrowind.bsa');
  assert.equal(slicedBytes - beforeAsset, 3);
  assert.equal(await source.has('meshes/oaab/chair.nif'), true);
});

test('declares the required loose, mod, OAAB, and master archive priority order', () => {
  assert.deepEqual(BSA_PRIORITIES, {
    loose: 600,
    pluginFolder: 500,
    oaab: 400,
    tribunal: 300,
    bloodmoon: 200,
    morrowind: 100,
  });
});

function makeBsa(entries) {
  const encoder = new TextEncoder();
  const names = entries.map(([name]) => encoder.encode(`${name}\0`));
  const namesLength = names.reduce((sum, name) => sum + name.length, 0);
  const count = entries.length;
  const hashOffset = 12 * count + namesLength;
  const dataStart = 12 + hashOffset + 8 * count;
  const total = dataStart + entries.reduce((sum, [, data]) => sum + data.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x100, true);
  view.setUint32(4, hashOffset, true);
  view.setUint32(8, count, true);
  let nameOffset = 0;
  let dataOffset = 0;
  for (let i = 0; i < count; i += 1) {
    view.setUint32(12 + i * 8, entries[i][1].length, true);
    view.setUint32(16 + i * 8, dataOffset, true);
    view.setUint32(12 + 8 * count + i * 4, nameOffset, true);
    bytes.set(names[i], 12 + 12 * count + nameOffset);
    bytes.set(entries[i][1], dataStart + dataOffset);
    nameOffset += names[i].length;
    dataOffset += entries[i][1].length;
  }
  return new Blob([bytes]);
}
