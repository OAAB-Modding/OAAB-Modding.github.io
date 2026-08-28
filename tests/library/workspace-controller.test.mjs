import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryWorkspace } from '../../src/library/workspace/workspace-controller.js';

function workspaceWithoutConstructor() {
  return Object.create(LibraryWorkspace.prototype);
}

test('background thumbnails capture from their dedicated viewer', async () => {
  const workspace = workspaceWithoutConstructor();
  const record = { id: 'demo', source: 'plugin:demo' };
  const result = {
    path: 'meshes/demo.nif',
    asset: { source: 'local-files', lastModified: 42 },
    assetFingerprint: 'asset-hash',
  };
  let backgroundCaptures = 0;
  let interactiveCaptures = 0;
  let importedUrl = '';
  workspace.viewer = {
    async captureThumbnail() {
      interactiveCaptures += 1;
      return new Blob(['interactive']);
    },
  };
  const backgroundViewer = {
    async captureThumbnail() {
      backgroundCaptures += 1;
      return new Blob(['background']);
    },
  };
  workspace.thumbnailCache = {
    async get() { return null; },
    async put(_identity, _blob, metadata) {
      assert.deepEqual(metadata, { recordId: 'demo', recordSource: 'plugin:demo' });
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
  assert.equal(importedUrl, 'blob:background');
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
