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
