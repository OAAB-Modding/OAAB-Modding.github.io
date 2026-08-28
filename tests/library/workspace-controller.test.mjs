import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LibraryWorkspace,
  pngFilenameForView,
} from '../../src/library/workspace/workspace-controller.js';
import { NIF_RENDERER_VERSION } from '../../src/library/storage/thumbnail-cache.js';

function workspaceWithoutConstructor() {
  return Object.create(LibraryWorkspace.prototype);
}

test('PNG download filenames are safe and retain the record ID', () => {
  assert.equal(pngFilenameForView('oaab_de_chair_01'), 'oaab_de_chair_01.png');
  assert.equal(pngFilenameForView('bad:name / view. '), 'bad-name - view.png');
  assert.equal(pngFilenameForView(''), 'oaab-3d-view.png');
});

test('3D PNG downloads capture the current transparent frame and revoke the temporary URL', async () => {
  const workspace = workspaceWithoutConstructor();
  const events = [];
  const anchor = {
    click() { events.push(['click', this.download]); },
    remove() { events.push(['remove']); },
  };
  workspace.doc = {
    body: { append(node) { events.push(['append', node.href]); } },
    createElement(tag) {
      assert.equal(tag, 'a');
      return anchor;
    },
    defaultView: {
      URL: {
        createObjectURL(blob) {
          assert.equal(blob.type, 'image/png');
          events.push(['create']);
          return 'blob:current-view';
        },
        revokeObjectURL(url) { events.push(['revoke', url]); },
      },
      setTimeout(callback) { callback(); },
    },
  };
  workspace.viewerDownloadReady = true;
  workspace.viewerDownloadPending = false;
  workspace.viewerDownloadName = 'oaab_chair_01';
  workspace.syncViewerDownloadControl = () => {};
  let captures = 0;
  const downloaded = await workspace.downloadViewerPng({
    async capturePng() {
      captures += 1;
      return new Blob(['png'], { type: 'image/png' });
    },
  });

  assert.equal(downloaded, true);
  assert.equal(captures, 1);
  assert.deepEqual(events, [
    ['create'],
    ['append', 'blob:current-view'],
    ['click', 'oaab_chair_01.png'],
    ['remove'],
    ['revoke', 'blob:current-view'],
  ]);
});

test('background thumbnails capture from their dedicated viewer', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'demo', source: 'plugin:demo' };
  const result = {
    path: 'meshes/demo.nif',
    asset: { source: 'local-files', lastModified: 42 },
    assetFingerprint: 'asset-hash',
    textureDiagnostics: [{
      path: 'textures/demo.dds',
      status: 'resolved',
      asset: { source: 'plugin-folder:data-files', lastModified: 84 },
    }],
  };
  let backgroundCaptures = 0;
  let interactiveCaptures = 0;
  let importedUrl = '';
  let cacheIdentity;
  let captureOptions;
  workspace.viewer = {
    async captureThumbnail() {
      interactiveCaptures += 1;
      return new Blob(['interactive']);
    },
  };
  const backgroundViewer = {
    async captureThumbnail(options) {
      backgroundCaptures += 1;
      captureOptions = options;
      return new Blob(['background']);
    },
  };
  workspace.thumbnailCache = {
    async get(identity) { cacheIdentity = identity; return null; },
    async put(_identity, _blob, metadata) {
      assert.deepEqual(metadata, {
        recordId: 'demo',
        recordSource: 'plugin:demo',
        meshSourceFingerprint: 'local-files:42',
      });
      return { url: 'blob:background' };
    },
  };
  workspace.component = {
    setImportedThumbnail(value, url) {
      assert.equal(value, record);
      importedUrl = url;
    },
  };

  const committed = await workspace.cacheThumbnail(record, result, { viewer: backgroundViewer });
  assert.equal(committed, true);
  assert.equal(backgroundCaptures, 1);
  assert.equal(interactiveCaptures, 0);
  assert.deepEqual(captureOptions, { includeGrid: false });
  assert.match(cacheIdentity.sourceFingerprint, /textures\/demo\.dds:plugin-folder:data-files:84/);
  assert.equal(importedUrl, 'blob:background');
});

test('generated head thumbnails request the front-facing camera preset', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = {
    id: 'face',
    source: 'plugin:demo',
    raw: { type: 'Bodypart', data: { part: 'Head' } },
  };
  let captureOptions;
  workspace.thumbnailCache = {
    async get() { return null; },
    async put() { return { url: 'blob:face' }; },
  };

  const cached = await workspace.getOrCreateThumbnail(record, {
    path: 'meshes/face.nif',
    asset: { source: 'local-files', lastModified: 42 },
    assetFingerprint: 'asset-hash',
    textureDiagnostics: [],
  }, {
    viewer: {
      async captureThumbnail(options) {
        captureOptions = options;
        return new Blob(['face']);
      },
    },
  });

  assert.equal(cached.url, 'blob:face');
  assert.deepEqual(captureOptions, { includeGrid: false, view: 'front' });
});

test('thumbnail persistence failures fall back to a session URL', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'demo', source: 'plugin:demo' };
  let importedUrl = '';
  let putAttempts = 0;
  workspace.thumbnailCacheReadable = true;
  workspace.thumbnailCacheWritable = true;
  workspace.thumbnailCacheWarningLogged = false;
  workspace.thumbnailCache = {
    async get() { return null; },
    async put() {
      putAttempts += 1;
      throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
    },
    urlFor(entry) {
      assert.match(entry.key, /^transient:grid:plugin:demo\0demo:/);
      return 'blob:session';
    },
  };
  workspace.component = {
    setImportedThumbnail(value, url) {
      assert.equal(value, record);
      importedUrl = url;
    },
  };

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const committed = await workspace.cacheThumbnail(record, {
      path: 'meshes/demo.nif',
      asset: { source: 'local-files', lastModified: 42 },
      assetFingerprint: 'asset-hash',
      textureDiagnostics: [],
    }, {
      viewer: {
        async captureThumbnail() { return new Blob(['session']); },
      },
    });
    assert.equal(committed, true);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(putAttempts, 1);
  assert.equal(workspace.thumbnailCacheWritable, false);
  assert.equal(importedUrl, 'blob:session');
});

test('mounted viewport thumbnails jump ahead of previously revealed work', () => {
  const workspace = workspaceWithoutConstructor();
  const visibleRecord = { id: 'visible', source: 'plugin:demo', mesh: 'meshes/visible.nif' };
  const nearRecord = { id: 'near', source: 'plugin:demo', mesh: 'meshes/near.nif' };
  const staleRecord = { id: 'stale', source: 'plugin:demo', mesh: 'meshes/stale.nif' };
  const visibleItem = { ...visibleRecord, imported: true, record: visibleRecord, thumbnailReady: false, thumbnailStatus: 'pending' };
  const nearItem = { ...nearRecord, imported: true, record: nearRecord, thumbnailReady: false, thumbnailStatus: 'pending' };
  const target = (id, top, bottom) => ({
    isConnected: true,
    dataset: { localThumbnailId: id },
    getBoundingClientRect: () => ({ top, bottom, left: 0, right: 160 }),
  });
  const visibleTarget = target('visible', 220, 380);
  const nearTarget = target('near', 700, 860);
  const observed = [];
  let disconnects = 0;
  workspace.dialog = {};
  workspace.doc = {
    defaultView: { innerWidth: 1000, innerHeight: 600 },
    documentElement: {},
    querySelectorAll: () => [nearTarget, visibleTarget],
  };
  workspace.thumbnailGeneration = 4;
  workspace.thumbnailQueueSequence = 1;
  workspace.thumbnailQueue = [
    { key: 'plugin:demo\0stale', record: staleRecord, generation: 4, attempts: 0, priority: 1, distance: 0, sequence: 0 },
    { key: 'plugin:demo\0near', record: nearRecord, generation: 4, attempts: 0, priority: 1, distance: 100, sequence: 1 },
  ];
  workspace.thumbnailJobs = new Map([
    ['plugin:demo\0stale', { record: staleRecord, status: 'queued', generation: 4, attempts: 0 }],
    ['plugin:demo\0near', { record: nearRecord, status: 'queued', generation: 4, attempts: 0 }],
  ]);
  workspace.thumbnailObserver = {
    disconnect() { disconnects += 1; },
    observe(value) { observed.push(value); },
  };
  workspace.component = {
    findCatalogItem(id) { return id === 'visible' ? visibleItem : id === 'near' ? nearItem : null; },
    setImportedThumbnailStatus() {},
  };
  workspace.pumpThumbnailQueue = () => {};

  workspace.syncImportedThumbnailTargets();

  assert.equal(disconnects, 1);
  assert.deepEqual(observed, [nearTarget]);
  assert.deepEqual(workspace.thumbnailQueue.map(entry => entry.key), [
    'plugin:demo\0visible',
    'plugin:demo\0near',
  ]);
  assert.equal(workspace.thumbnailJobs.has('plugin:demo\0stale'), false);
});

test('an offscreen loading thumbnail loses commit priority when the viewport changes', () => {
  const workspace = workspaceWithoutConstructor();
  const cancelledGenerations = [];
  const visibleRecord = { id: 'visible', source: 'plugin:demo', mesh: 'meshes/visible.nif' };
  const offscreenRecord = { id: 'offscreen', source: 'plugin:demo', mesh: 'meshes/offscreen.nif' };
  const items = new Map([
    ['visible', { ...visibleRecord, imported: true, record: visibleRecord, thumbnailReady: false, thumbnailStatus: 'pending' }],
    ['offscreen', { ...offscreenRecord, imported: true, record: offscreenRecord, thumbnailReady: false, thumbnailStatus: 'loading' }],
  ]);
  const target = (id, top, bottom) => ({
    isConnected: true,
    dataset: { localThumbnailId: id },
    getBoundingClientRect: () => ({ top, bottom, left: 0, right: 160 }),
  });
  workspace.dialog = {};
  workspace.doc = {
    defaultView: { innerWidth: 1000, innerHeight: 600 },
    documentElement: {},
    querySelectorAll: () => [target('offscreen', 700, 860), target('visible', 100, 260)],
  };
  workspace.thumbnailGeneration = 2;
  workspace.thumbnailQueue = [];
  workspace.thumbnailJobs = new Map([[
    'plugin:demo\0offscreen',
    { record: offscreenRecord, status: 'loading', generation: 2, attempts: 0, viewerGeneration: 7 },
  ]]);
  workspace.thumbnailViewer = {
    cancelLoad(generation) { cancelledGenerations.push(generation); },
  };
  workspace.thumbnailObserver = { disconnect() {}, observe() {} };
  workspace.component = {
    findCatalogItem(id) { return items.get(id); },
    setImportedThumbnailStatus() {},
  };
  workspace.pumpThumbnailQueue = () => {};

  workspace.syncImportedThumbnailTargets();

  assert.equal(workspace.thumbnailJobs.has('plugin:demo\0offscreen'), false);
  assert.equal(workspace.thumbnailJobs.get('plugin:demo\0visible').status, 'queued');
  assert.deepEqual(cancelledGenerations, [7]);
});

test('background thumbnail jobs resolve textures before capture', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'demo', source: 'plugin:demo', mesh: 'meshes/demo.nif' };
  const key = 'plugin:demo\0demo';
  let loadOptions;
  const statuses = [];
  workspace.dialog = {};
  workspace.interactiveViewerActive = false;
  workspace.productionViewerActive = false;
  workspace.thumbnailPumpRunning = false;
  workspace.thumbnailGeneration = 3;
  workspace.thumbnailQueue = [{ key, record, generation: 3, attempts: 0 }];
  workspace.thumbnailJobs = new Map([[key, { record, status: 'queued', generation: 3, attempts: 0 }]]);
  workspace.component = {
    state: { renderPreview: null },
    setImportedThumbnailStatus(_record, status) { statuses.push(status); },
  };
  workspace.ensureThumbnailViewer = async () => ({
    async load(_path, options) {
      loadOptions = options;
      return {};
    },
  });
  workspace.cacheThumbnail = async () => true;

  await workspace.pumpThumbnailQueue();

  assert.deepEqual(loadOptions, { resolveTextures: true });
  assert.deepEqual(statuses, ['loading']);
  assert.equal(workspace.thumbnailJobs.get(key).status, 'done');
});

test('background thumbnail failures retry once and then expose a failed state', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'broken', source: 'plugin:demo', mesh: 'meshes/broken.nif' };
  const key = 'plugin:demo\0broken';
  const statuses = [];
  workspace.dialog = {};
  workspace.interactiveViewerActive = false;
  workspace.productionViewerActive = false;
  workspace.thumbnailPumpRunning = false;
  workspace.thumbnailGeneration = 2;
  workspace.thumbnailQueue = [{ key, record, generation: 2, attempts: 0 }];
  workspace.thumbnailJobs = new Map([[key, { record, status: 'queued', generation: 2, attempts: 0 }]]);
  workspace.component = {
    state: { renderPreview: null },
    setImportedThumbnailStatus(_record, status) { statuses.push(status); },
  };
  workspace.ensureThumbnailViewer = async () => ({
    async load() { throw new Error('parse failed'); },
  });

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await workspace.pumpThumbnailQueue();
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(statuses, ['loading', 'pending', 'loading', 'failed']);
  assert.equal(workspace.thumbnailJobs.get(key).status, 'failed');
  assert.equal(workspace.thumbnailJobs.get(key).attempts, 2);
});

test('stale thumbnail generations cannot capture or commit', async () => {
  const workspace = workspaceWithoutConstructor();
  let current = true;
  let captures = 0;
  let commits = 0;
  workspace.thumbnailCache = {
    async get() {
      current = false;
      return null;
    },
  };
  workspace.component = {
    setImportedThumbnail() {
      commits += 1;
    },
  };
  const committed = await workspace.cacheThumbnail(
    { id: 'demo', source: 'plugin:demo' },
    {
      path: 'meshes/demo.nif',
      asset: { source: 'local-files', size: 12 },
      assetFingerprint: 'asset-hash',
    },
    {
      viewer: {
        async captureThumbnail() {
          captures += 1;
          return new Blob(['stale']);
        },
      },
      shouldCommit: () => current,
    },
  );

  assert.equal(committed, false);
  assert.equal(captures, 0);
  assert.equal(commits, 0);
});

test('asset-source changes reset jobs and invalidate imported thumbnails', () => {
  const workspace = workspaceWithoutConstructor();
  const records = [{ id: 'demo' }];
  let refreshed = 0;
  let synced = 0;
  workspace.thumbnailGeneration = 4;
  workspace.thumbnailQueue = [{ key: 'old' }];
  workspace.thumbnailJobs = new Map([['old', { status: 'failed' }]]);
  workspace.resolved = { records };
  workspace.component = {
    setImportedRecords(values, options) {
      assert.equal(values, records);
      assert.deepEqual(options, { preserveThumbnails: false });
      refreshed += 1;
    },
  };
  workspace.syncImportedThumbnailTargets = () => { synced += 1; };

  workspace.refreshImportedThumbnailsForAssetChange();
  assert.equal(workspace.thumbnailGeneration, 5);
  assert.deepEqual(workspace.thumbnailQueue, []);
  assert.equal(workspace.thumbnailJobs.size, 0);
  assert.equal(refreshed, 1);
  assert.equal(synced, 1);
});

test('cached thumbnail lookup queries the normalized mesh path and selects the newest valid entry', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'Demo', source: 'plugin:demo', mesh: 'OAAB\\Furniture\\Chair.nif' };
  let queriedPath = '';
  workspace.database = {
    async getThumbnailsByPath(path) {
      queriedPath = path;
      return [
        { key: 'old', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'preview', recordSource: record.source, recordId: 'demo', createdAt: 10, blob: {} },
        { key: 'wrong-version', path, rendererVersion: 'old', variant: 'preview', recordSource: record.source, recordId: 'demo', createdAt: 50, blob: {} },
        { key: 'wrong-variant', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'grid', recordSource: record.source, recordId: 'demo', createdAt: 60, blob: {} },
        { key: 'wrong-record', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'preview', recordSource: record.source, recordId: 'other', createdAt: 70, blob: {} },
        { key: 'missing-blob', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'preview', recordSource: record.source, recordId: 'demo', createdAt: 80 },
        { key: 'new', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'preview', recordSource: record.source, recordId: 'DEMO', createdAt: 20, blob: {} },
      ];
    },
  };
  workspace.thumbnailCache = { urlFor: entry => `blob:${entry.key}` };

  const cached = await workspace.findCachedThumbnail(record, 'preview');

  assert.equal(queriedPath, 'meshes/oaab/furniture/chair.nif');
  assert.equal(cached.key, 'new');
  assert.equal(cached.url, 'blob:new');
});

test('cached thumbnail restoration queries each normalized mesh path once', async () => {
  const workspace = workspaceWithoutConstructor();
  const records = [
    { id: 'One', source: 'plugin:demo', mesh: 'OAAB\\Shared.nif' },
    { id: 'Two', source: 'plugin:demo', mesh: 'meshes/oaab/shared.nif' },
    { id: 'Invalid', source: 'plugin:demo', mesh: '../outside.nif' },
  ];
  const queries = [];
  workspace.database = {
    async getThumbnailsByPath(path) {
      queries.push(path);
      return [
        { key: 'one-old', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'grid', recordSource: 'plugin:demo', recordId: 'one', createdAt: 10, blob: {} },
        { key: 'one-new', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'grid', recordSource: 'plugin:demo', recordId: 'ONE', createdAt: 20, blob: {} },
        { key: 'one-preview', path, rendererVersion: NIF_RENDERER_VERSION, variant: 'preview', recordSource: 'plugin:demo', recordId: 'one', createdAt: 30, blob: {} },
        { key: 'two-legacy-grid', path, rendererVersion: NIF_RENDERER_VERSION, recordSource: 'plugin:demo', recordId: 'two', createdAt: 15, blob: {} },
        { key: 'two-old-renderer', path, rendererVersion: 'old', variant: 'grid', recordSource: 'plugin:demo', recordId: 'two', createdAt: 40, blob: {} },
      ];
    },
  };
  workspace.thumbnailCache = { urlFor: entry => `blob:${entry.key}` };
  const restored = [];
  workspace.component = {
    setImportedThumbnail(record, url) {
      restored.push([record.id, url]);
    },
  };

  await workspace.restoreCachedThumbnails(records);

  assert.deepEqual(queries, ['meshes/oaab/shared.nif']);
  assert.deepEqual(restored, [
    ['One', 'blob:one-new'],
    ['Two', 'blob:two-legacy-grid'],
  ]);
});

test('unknown totals remove the progress value attribute', () => {
  const workspace = workspaceWithoutConstructor();
  const attributes = new Map([['value', '0']]);
  const wrap = { hidden: true };
  const bar = {
    removeAttribute(name) { attributes.delete(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
  };
  const label = { textContent: '' };
  const value = { textContent: '' };
  const elements = new Map([
    ['[data-workspace-progress]', wrap],
    ['[data-workspace-progress-bar]', bar],
    ['[data-progress-label]', label],
    ['[data-progress-value]', value],
  ]);
  workspace.dialog = { querySelector: selector => elements.get(selector) };
  workspace.progressActive = true;
  workspace.progressTotal = 0;

  workspace.updateProgress({ label: 'Indexing folder', completed: 12, total: 0 });
  assert.equal(wrap.hidden, false);
  assert.equal(attributes.has('value'), false);
  assert.equal(attributes.get('aria-valuetext'), '12 files found');
  assert.equal(label.textContent, 'Indexing folder');
  assert.equal(value.textContent, '12 found');
});
