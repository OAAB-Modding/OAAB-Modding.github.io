import test from 'node:test';
import assert from 'node:assert/strict';

import { PluginCatalog } from '../../src/library/catalog/plugin-catalog.js';
import { movePlugin, resolveLoadOrder } from '../../src/library/catalog/load-order.js';

const packet = {
  masters: [{ name: 'Morrowind.esm', size: 1 }],
  records: [{
    id: 'Example_Static',
    type: 'Static',
    name: '',
    mesh: 'Example\\Rock.NIF',
    icon: null,
    deleted: false,
    raw: {},
  }],
};

test('plugin catalog produces generic normalized records with local provenance', async () => {
  const catalog = new PluginCatalog({ filename: 'Example.esp', packet, fingerprint: 'abc123' });
  const [record] = await catalog.load();
  assert.equal(record.id, 'Example_Static');
  assert.equal(record.mesh, 'meshes/example/rock.nif');
  assert.equal(record.source, 'plugin:abc123');
  assert.equal(record.metadata.plugin.filename, 'Example.esp');
  assert.equal(record.metadata.plugin.masters[0].name, 'Morrowind.esm');
});

test('load order selects the last definition and retains an explainable chain', async () => {
  const first = (await new PluginCatalog({ filename: 'First.esp', packet, fingerprint: 'first' }).load())[0];
  const second = (await new PluginCatalog({
    filename: 'Second.esp',
    fingerprint: 'second',
    packet: { ...packet, records: [{ ...packet.records[0], name: 'Winning rock' }] },
  }).load())[0];
  const result = resolveLoadOrder([
    { id: first.source, filename: 'First.esp', records: [first] },
    { id: second.source, filename: 'Second.esp', records: [second] },
  ]);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].name, 'Winning rock');
  assert.equal(result.records[0].metadata.loadOrder.overrides.length, 2);
  assert.equal(result.records[0].metadata.loadOrder.winningPlugin, 'Second.esp');
});

test('load order movement is deterministic and does not mutate its input', () => {
  const plugins = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(movePlugin(plugins, 2, 0).map(plugin => plugin.id), ['c', 'a', 'b']);
  assert.deepEqual(plugins.map(plugin => plugin.id), ['a', 'b', 'c']);
});

test('a deleted winning definition hides the object but preserves its override identity', async () => {
  const first = (await new PluginCatalog({ filename: 'First.esp', packet, fingerprint: 'first' }).load())[0];
  const deleted = (await new PluginCatalog({
    filename: 'Delete.esp',
    fingerprint: 'delete',
    packet: { ...packet, records: [{ ...packet.records[0], deleted: true }] },
  }).load())[0];
  const result = resolveLoadOrder([
    { id: first.source, filename: 'First.esp', records: [first] },
    { id: deleted.source, filename: 'Delete.esp', records: [deleted] },
  ]);
  assert.equal(result.records.length, 0);
  assert.equal(result.identities.values().next().value.overrides.length, 2);
});
