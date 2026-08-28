import test from 'node:test';
import assert from 'node:assert/strict';

import { withProductionCatalog } from '../../src/library/catalog/production-catalog.js';

class CatalogBase {
  constructor() {
    this.state = {
      vanilla: false,
      catalogSources: ['oaab-data'],
      catalogSourceOpen: true,
      data: { items: [] },
    };
  }

  setState(next) {
    this.state = { ...this.state, ...next };
  }

  displayType(type) {
    return String(type || '');
  }

  tagWordMatches(id, word) {
    return id.includes(String(word).toLowerCase());
  }

  csCompareIds(left, right) {
    return String(left).localeCompare(String(right));
  }

  refreshLeveledListThumbnails() {}

  objectContentIds() {
    return [];
  }
}

const ProductionCatalog = withProductionCatalog(CatalogBase);

test('displayed load-order winner is the record returned for details and cell links', () => {
  const catalog = new ProductionCatalog();
  const builtin = { id: 'shared_id', source: 'oaab-data' };
  const winner = { id: 'SHARED_ID', source: 'plugin:override' };
  catalog._oaabItems = [builtin];
  catalog._importedItems = [winner];
  catalog.state.data.items = [winner];
  assert.equal(catalog.findCatalogItem('shared_id'), winner);
});

test('OAAB enrichment stays on OAAB records and carries project metadata', () => {
  const catalog = new ProductionCatalog();
  const record = { id: 'oaab_ash_wall', type: 'Static', metadata: {} };
  catalog.enrichOaabRecords(
    [record],
    { oaab_ash_wall: 1 },
    { oaab_ash_wall: { wikiUrl: 'https://example.test/wiki' } },
    [{ label: 'Ash', include: ['ash'], exclude: [], excludeTypes: [] }],
    { tilesets: [{ key: 'ash', label: 'Ash', pieces: { wall: { plain: ['oaab_ash_wall'] } } }] },
  );
  assert.deepEqual(record.metadata.oaab.tags, ['Ash']);
  assert.equal(record.metadata.oaab.tilesets[0].piece, 'wall');
  assert.equal(record.metadata.oaab.deprecated, true);
  assert.equal(record.metadata.oaab.wikiPage, 'https://example.test/wiki');
});

test('catalog source selection controls built-in and imported records', () => {
  const catalog = new ProductionCatalog();
  catalog._oaabItems = [{ id: 'oaab_object', type: 'Static' }];
  catalog._vanillaItems = [{ id: 'vanilla_object', type: 'Static' }];
  catalog._importedItems = [{ id: 'mod_object', type: 'Static', source: 'plugin:demo', record: { metadata: { plugin: { filename: 'Demo.esp' } } } }];

  assert.deepEqual(catalog.libraryCatalogSourceOptions().map(source => [source.id, source.enabled]), [
    ['oaab-data', true],
    ['vanilla', false],
    ['plugin:demo', false],
  ]);
  assert.deepEqual(catalog.buildData().items.map(item => item.id), ['oaab_object']);

  catalog.setLibrarySourceEnabled('vanilla', true);
  assert.equal(catalog.state.vanilla, true);
  assert.deepEqual(catalog.state.data.items.map(item => item.id), ['oaab_object', 'vanilla_object']);

  catalog.setLibrarySourceSelection(['vanilla', 'plugin:demo']);
  assert.equal(catalog.state.vanilla, true);
  assert.deepEqual(catalog.state.data.items.map(item => item.id), ['mod_object', 'vanilla_object']);
  assert.deepEqual(catalog.libraryCatalogSourceOptions().filter(source => source.enabled).map(source => source.id), [
    'vanilla',
    'plugin:demo',
  ]);
});
