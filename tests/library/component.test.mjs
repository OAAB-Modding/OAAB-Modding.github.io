import test from 'node:test';
import assert from 'node:assert/strict';

import { createLibraryComponent } from '../../src/library/component.js';
import {
  createProductionLibraryState,
  readStoredBoolean,
  readStoredScale,
  readStoredCatalogSources,
  writeStoredCatalogSources,
} from '../../src/library/state.js';

class TestLogic {
  setState(update) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    this.state = { ...this.state, ...patch };
  }
}

function memoryStorage(values = {}) {
  return {
    getItem(key) {
      return Object.hasOwn(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = String(value);
    },
  };
}

test('production state restores persisted display preferences', () => {
  const storage = memoryStorage({
    oaab_detail_view: '1',
    oaab_compact_v2: '0',
    oaab_vanilla: '1',
    oaab_scale: '1.75',
  });
  const windowObject = {
    OAAB_THEME: { read: () => 'light' },
    matchMedia: () => ({ matches: true }),
  };

  const state = createProductionLibraryState({ storage, windowObject });
  assert.equal(state.detailView, true);
  assert.equal(state.compact, false);
  assert.equal(state.vanilla, true);
  assert.equal(state.scale, 1.75);
  assert.equal(state.theme, 'light');
  assert.equal(state.narrow, true);
  assert.equal(state.renderPreviewMode, 'preview');
});

test('stored preference readers use safe defaults', () => {
  const throwingStorage = { getItem: () => { throw new Error('denied'); } };
  assert.equal(readStoredBoolean('missing', true, throwingStorage), true);
  assert.equal(readStoredScale(memoryStorage({ oaab_scale: '9' })), 1);
  assert.equal(readStoredScale(memoryStorage({ oaab_scale: '0.5' })), 0.5);
});

test('catalog source preference supersedes the legacy vanilla flag', () => {
  const storage = memoryStorage({
    oaab_vanilla: '1',
    oaab_catalog_sources: JSON.stringify(['oaab-data', 'plugin:demo', 'oaab-data']),
  });
  const state = createProductionLibraryState({ storage });
  assert.deepEqual(state.catalogSources, ['oaab-data', 'plugin:demo']);
  assert.equal(state.vanilla, false);

  writeStoredCatalogSources(new Set(['vanilla', 'oaab-data']), storage);
  assert.deepEqual(readStoredCatalogSources(storage), ['vanilla', 'oaab-data']);
});

test('component factory composes the production behavior modules', () => {
  const Component = createLibraryComponent(TestLogic);
  const component = new Component();

  assert.equal(typeof component.componentDidMount, 'function');
  assert.equal(typeof component.renderVals, 'function');
  assert.equal(typeof component.loadVanilla, 'function');
  assert.equal(typeof component.openBookPreviewForItem, 'function');
  assert.equal(typeof component.magicEffectEntries, 'function');
  assert.equal(component.naturalCompareStrings('item9', 'item10') < 0, true);

  const pendingPreview = component.renderPreviewPayload({
    id: 'demo',
    imported: true,
    mesh: 'meshes/demo.nif',
    img: '/assets/images/general/icon.png',
    thumbnailReady: false,
  });
  assert.equal(pendingPreview.src, '');
  assert.equal(pendingPreview.mesh, 'meshes/demo.nif');
  assert.equal(pendingPreview.thumbnailPending, true);

  const snapshot = component.filterSnapshot({
    ...component.state,
    active: 'Book',
    tags: ['Dunmer'],
    query: 'ash',
  });
  assert.equal(snapshot.active, 'Book');
  assert.deepEqual(snapshot.tags, ['Dunmer']);
  assert.equal(snapshot.query, 'ash');
});

test('imported plugins reuse built-in book, magic, light, and record-type features', async () => {
  const Component = createLibraryComponent(TestLogic);
  const component = new Component();
  const effect = {
    magic_effect: 'FireDamage',
    skill: 'None',
    attribute: 'None',
    range: 'OnTarget',
    area: 0,
    duration: 5,
    min_magnitude: 2,
    max_magnitude: 4,
  };
  const imported = (id, type, raw = {}, mesh = null, name = '') => ({
    id,
    type,
    name,
    mesh,
    source: 'plugin:demo',
    raw: { id, type, name, mesh, ...raw },
  });
  const records = [
    imported('enchant_test', 'Enchanting', {
      effects: [effect],
      data: { enchant_type: 'CastWhenUsed', cost: 12, max_charge: 40, flags: '' },
    }),
    imported('armor_test', 'Armor', { enchanting: 'enchant_test', data: { armor_rating: 8 } }, 'meshes/a/test.nif', 'Test Armor'),
    imported('body_test', 'Bodypart', { data: { bodypart_type: 'Skin' } }, 'meshes/b/test.nif'),
    imported('clothing_test', 'Clothing', { data: { clothing_type: 'Robe' } }, 'meshes/c/test.nif', 'Test Robe'),
    imported('creature_test', 'Creature', { inventory: [[1, 'armor_test']], spells: ['spell_test'] }, 'meshes/r/test.nif', 'Test Creature'),
    imported('potion_test', 'Alchemy', { effects: [effect], data: { value: 25, weight: 0.5, flags: '' } }, 'meshes/m/potion.nif', 'Test Potion'),
    imported('spell_test', 'Spell', { effects: [effect], data: { spell_type: 'Spell', cost: 7, flags: '' } }, null, 'Test Spell'),
    imported('items_test', 'LeveledItem', { items: [['armor_test', 1]], chance_none: 0 }),
    imported('creatures_test', 'LeveledCreature', { creatures: [['creature_test', 2]], chance_none: 5 }),
    imported('book_test', 'Book', { text: '<DIV ALIGN="CENTER">Title &amp; Text</DIV><BR>Second line' }, 'meshes/m/book.nif', 'Test Book'),
    imported('light_test', 'Light', { data: { color: [10, 20, 30, 0], flags: '' } }),
  ];

  component.setImportedRecords(records);
  const byId = new Map(component._importedItems.map(item => [item.id, item]));

  assert.equal(byId.has('enchant_test'), false);
  assert.equal(byId.get('armor_test').enchantment.effects[0].label, 'Fire Damage');
  assert.equal(byId.get('body_test').type, 'Bodypart');
  assert.equal(byId.get('clothing_test').type, 'Clothing');
  assert.deepEqual(byId.get('creature_test').spells, ['spell_test']);
  assert.equal(byId.get('potion_test').alchemy.effects[0].label, 'Fire Damage');
  assert.equal(byId.get('spell_test').isSpell, true);
  assert.match(byId.get('spell_test').img, /fire_damage\.webp$/);
  assert.equal(byId.get('items_test').type, 'Leveled List');
  assert.deepEqual(byId.get('creatures_test').leveledCreatures, [['creature_test', 2]]);
  assert.equal(byId.get('book_test').bookRef.source, 'plugin');
  assert.match(byId.get('book_test').bookRef.searchText, /Second line/);
  assert.equal(byId.get('light_test').lightHex, '#0a141e');
  assert.equal(byId.get('light_test').lightTint, 'rgb(10, 20, 30)');
  assert.match(byId.get('light_test').img, /marker_light\.webp$/);

  const preview = await component.fetchBookPreview(byId.get('book_test'));
  assert.equal(preview.loading, false);
  assert.deepEqual(preview.blocks.map(block => block.text), ['Title & Text', 'Second line']);
});

test('book text mode searches OAAB, vanilla, and parser-opened books', () => {
  const Component = createLibraryComponent(TestLogic);
  const component = new Component();
  const oaabRecord = {
    id: 'oaab_book',
    type: 'Book',
    name: 'OAAB Book',
    text: '<DIV>The lantern remembers the buried moon.</DIV>',
  };
  const vanillaRecord = {
    id: 'vanilla_book',
    type: 'Book',
    name: 'Vanilla Book',
    text: '<P>Speak, friend &amp; enter the old hall.</P>',
  };
  const oaab = {
    id: oaabRecord.id,
    type: 'Book',
    bookRef: component.wikiBookRef(oaabRecord, {
      oaab_book: { source: 'wiki', rawUrl: 'https://example.test/book.md' },
    }),
  };
  const vanilla = {
    id: vanillaRecord.id,
    type: 'Book',
    bookRef: component.uespBookRef(vanillaRecord),
  };
  component.setImportedRecords([{
    id: 'plugin_book',
    type: 'Book',
    name: 'Plugin Book',
    mesh: 'meshes/plugin_book.nif',
    source: 'plugin:demo',
    raw: {
      id: 'plugin_book',
      type: 'Book',
      text: '<DIV>Stars fall<BR>behind Red Mountain.</DIV>',
    },
  }]);
  const plugin = component._importedItems[0];
  const books = [oaab, vanilla, plugin];

  assert.equal(component.allowedSearchModesForItems(books, 'Book').text, true);
  assert.equal(component.allowedSearchModesForItems(books.concat({ id: 'crate', type: 'Container' }), 'All').text, undefined);
  assert.deepEqual(component.activeSearchMode('text: buried moon', '', { '': true, text: true }), {
    mode: 'text', term: 'buried moon', explicit: true,
  });
  assert.deepEqual(component.bookTextSearchItems('buried moon', books).map(item => item.id), ['oaab_book']);
  assert.deepEqual(component.bookTextSearchItems('friend & enter', books).map(item => item.id), ['vanilla_book']);
  assert.deepEqual(component.bookTextSearchItems('fall behind red mountain', books).map(item => item.id), ['plugin_book']);

  component._isPopout = false;
  component.state = {
    ...component.state,
    active: 'Book',
    query: 'text: buried moon',
    searchMode: '',
    data: { items: books, types: [{ label: 'Book', count: books.length }], total: books.length },
  };
  const values = component.renderVals();
  assert.deepEqual(values.items.map(item => item.id), ['oaab_book']);
  assert.equal(values.searchModeLabel, 'Text');
  assert.equal(values.searchPlaceholder, 'Search book text');
});

test('imported plugin contents remain searchable alongside built-in records', () => {
  const Component = createLibraryComponent(TestLogic);
  const component = new Component();
  component._oaabItems = [{
    id: 'oaab_only',
    type: 'Static',
    name: '',
    mesh: 'meshes/oaab_only.nif',
    source: 'oaab-data',
    raw: { id: 'oaab_only', type: 'Static' },
  }];
  component._librarySourceEnabled = new Set(['oaab-data', 'plugin:demo']);
  component.setImportedRecords([
    {
      id: 'items_test',
      type: 'LeveledItem',
      name: '',
      mesh: null,
      source: 'plugin:demo',
      raw: { id: 'items_test', type: 'LeveledItem', items: [['armor_test', 1]] },
    },
    {
      id: 'armor_test',
      type: 'Armor',
      name: 'Test Armor',
      mesh: 'meshes/armor_test.nif',
      source: 'plugin:demo',
      raw: { id: 'armor_test', type: 'Armor' },
    },
  ]);

  const results = component.inventorySearchItems('items_test', component.state.data.items);
  assert.deepEqual(results.map(item => item.id), ['items_test', 'armor_test']);
});

test('catalog source changes participate in filter history', () => {
  const Component = createLibraryComponent(TestLogic);
  const component = new Component();
  component._oaabItems = [];
  component._vanillaItems = [];
  let persistedSelections = 0;
  component._workspace = {
    persistWorkspaceSettings() {
      persistedSelections += 1;
    },
  };

  component.setLibrarySourceSelection(['vanilla']);
  assert.deepEqual(component.state.catalogSources, ['vanilla']);
  assert.equal(component.state.filterHistoryIndex, 1);

  persistedSelections = 0;
  component.moveFilterHistory(-1);
  assert.deepEqual(component.state.catalogSources, ['oaab-data']);
  assert.equal(component.state.vanilla, false);
  assert.equal(persistedSelections, 1);
});

test('component factory rejects an invalid runtime base', () => {
  assert.throws(() => createLibraryComponent(null), /DCLogic base class/);
});
