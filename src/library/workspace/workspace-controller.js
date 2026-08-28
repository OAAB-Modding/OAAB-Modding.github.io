import { PluginCatalog } from '../catalog/plugin-catalog.js';
import { resolveLoadOrder } from '../catalog/load-order.js';
import { Tes3WorkerClient } from '../workers/tes3-worker-client.js';
import { BsaSource, BSA_PRIORITIES } from '../sources/bsa-source.js';
import { LocalDirectorySource } from '../sources/local-directory-source.js';
import { scanDependencies } from '../diagnostics/dependency-scanner.js';
import { LibraryDatabase } from '../storage/library-db.js';
import {
  NIF_RENDERER_VERSION,
  THUMBNAIL_VARIANT_GRID,
  THUMBNAIL_VARIANT_PREVIEW,
  ThumbnailCache,
  fingerprintBytes,
} from '../storage/thumbnail-cache.js';
import { normalizeAssetPath } from '../resolver/path-utils.js';
import { thumbnailViewForRecord } from '../renderer/viewer-modes.js';

const THUMBNAIL_MAX_ATTEMPTS = 2;
const VIEWER_TOGGLES = {
  markers: { property: 'markersVisible', method: 'setMarkersVisible' },
  wireframe: { property: 'wireframe', method: 'setWireframe' },
  collision: { property: 'collisionVisible', method: 'setCollisionVisible' },
  normals: { property: 'normalInspector', method: 'setNormalInspector' },
};

export function initializeLibraryWorkspace(component) {
  const workspace = new LibraryWorkspace(component);
  workspace.mount();
  return workspace;
}

export class LibraryWorkspace {
  constructor(component) {
    this.component = component;
    this.doc = component.activeDoc?.() || document;
    this.worker = new Tes3WorkerClient();
    this.plugins = [];
    this.assetSources = [];
    this.database = new LibraryDatabase();
    this.thumbnailCache = new ThumbnailCache(this.database);
    this.selectedRecord = null;
    this.thumbnailJobs = new Map();
    this.thumbnailQueue = [];
    this.thumbnailPumpRunning = false;
    this.thumbnailGeneration = 0;
    this.thumbnailObserver = null;
    this.thumbnailQueueSequence = 0;
    this.thumbnailCacheReadable = true;
    this.thumbnailCacheWritable = true;
    this.thumbnailCacheWarningLogged = false;
    this.interactiveViewerActive = false;
    this.productionViewerActive = false;
    this.productionPreviewActive = false;
    this.productionPreviewKey = null;
    this.productionLoadKey = null;
    this.productionViewerMessage = '';
    this.productionDetailsKey = null;
    this.productionDetailsSource = '';
    this.viewerDownloadReady = false;
    this.viewerDownloadPending = false;
    this.viewerDownloadName = '';
  }

  mount() {
    const host = this.doc.querySelector('.filter-row');
    if (!host || this.doc.querySelector('[data-library-workspace-button]')) return;
    this.button = element('button', {
      className: 'library-workspace-open',
      type: 'button',
      textContent: 'Local files',
      title: 'Open plugins, loose assets, BSAs, diagnostics, and the 3D viewer',
      dataset: { libraryWorkspaceButton: '' },
    }, this.doc);
    this.button.addEventListener('click', () => this.open());
    host.append(this.button);

    this.dialog = element('div', { className: 'library-workspace-backdrop', hidden: true }, this.doc);
    this.dialog.innerHTML = workspaceMarkup();
    this.doc.body.append(this.dialog);
    this.dialog.addEventListener('click', (event) => {
      const cacheActions = this.dialog.querySelector('.library-cache-actions');
      if (cacheActions?.open && !event.target.closest?.('.library-cache-actions')) {
        cacheActions.open = false;
      }
      if (event.target === this.dialog || event.target.closest('[data-workspace-close]')) this.close();
    });
    this.dialog.querySelector('[data-open-plugin]').addEventListener('click', () => this.pluginInput.click());
    this.pluginInput = this.dialog.querySelector('[data-plugin-input]');
    this.pluginInput.addEventListener('change', () => this.importPlugins(this.pluginInput.files));
    this.dataInput = this.dialog.querySelector('[data-files-input]');
    this.dataInput.addEventListener('change', () => this.addLooseFiles(this.dataInput.files));
    this.dialog.querySelector('[data-add-files]').addEventListener('click', () => this.dataInput.click());
    this.directoryInput = this.dialog.querySelector('[data-directory-input]');
    this.directoryInput.addEventListener('change', () => this.addFolderFiles(this.directoryInput.files));
    this.dialog.querySelector('[data-add-directory]').addEventListener('click', () => this.addDirectory());
    this.bsaInput = this.dialog.querySelector('[data-bsa-input]');
    this.bsaInput.addEventListener('change', () => this.addBsas(this.bsaInput.files));
    this.dialog.querySelector('[data-add-bsa]').addEventListener('click', () => this.bsaInput.click());
    this.dialog.querySelector('[data-run-diagnostics]').addEventListener('click', () => this.runDiagnostics());
    this.dialog.querySelector('[data-clear-plugins]').addEventListener('click', () => this.clearImportedPlugins());
    this.dialog.querySelector('[data-clear-thumbnails]').addEventListener('click', () => this.clearThumbnails());
    this.dialog.querySelector('[data-clear-all]').addEventListener('click', () => this.clearAllCache());
    this.dialog.querySelector('[data-workspace-tablist]').addEventListener('click', (event) => {
      const button = event.target.closest('[data-workspace-tab]');
      if (button) this.selectTab(button.dataset.workspaceTab);
    });
    this.thumbnailHost = this.dialog.querySelector('[data-thumbnail-render-host]');
    const ThumbnailObserver = this.doc.defaultView?.IntersectionObserver || globalThis.IntersectionObserver;
    if (ThumbnailObserver) {
      this.thumbnailObserver = new ThumbnailObserver(entries => {
        const candidates = entries
          .filter(entry => entry.isIntersecting && entry.target?.isConnected !== false)
          .map(entry => ({ target: entry.target, ...this.thumbnailTargetMetrics(entry.target) }))
          .sort(compareThumbnailPriority);
        for (const candidate of candidates) {
          const { target, ...priority } = candidate;
          this.thumbnailObserver.unobserve(target);
          this.queueImportedThumbnail(target, priority);
        }
        this.prioritizeThumbnailQueue();
        this.pumpThumbnailQueue();
      }, { rootMargin: '240px' });
    }
    this.render();
    this.restorePlugins();
  }

  open() {
    this.dialog.hidden = false;
    this.doc.body.classList.add('library-workspace-opened');
    this.dialog.querySelector('[data-open-plugin]').focus();
    this.syncImportedThumbnailTargets();
  }

  close() {
    this.dialog.hidden = true;
    this.doc.body.classList.remove('library-workspace-opened');
    this.interactiveViewerActive = false;
    this.button?.focus();
  }

  async importPlugins(files) {
    const selected = Array.from(files || []).filter(file => /\.(?:esp|esm)$/i.test(file.name));
    if (!selected.length) return this.status('Choose one or more .esp or .esm files.', true);
    const importedSourceIds = new Set();
    for (const file of selected) {
      this.status(`Parsing ${file.name} locally…`);
      try {
        const bytes = await file.arrayBuffer();
        const fingerprint = (await fingerprintBytes(bytes)).slice(0, 24);
        const packet = await this.worker.parsePlugin(bytes);
        const provider = new PluginCatalog({ filename: file.name, packet, fingerprint });
        const records = await provider.load();
        this.plugins = this.plugins.filter(plugin => plugin.id !== provider.id);
        this.plugins.push({
          id: provider.id,
          filename: file.name,
          fingerprint,
          file,
          packet,
          records,
          enabled: true,
        });
        await this.persistPlugin(this.plugins.at(-1));
        this.component._librarySourceEnabled ??= new Set(this.component.state.catalogSources || ['oaab-data']);
        this.component._librarySourceEnabled.add(provider.id);
        importedSourceIds.add(provider.id);
      } catch (error) {
        this.status(`${file.name}: ${error.message}`, true);
      }
    }
    this.applyLoadOrder();
    if (importedSourceIds.size) {
      const sourceSelection = this.component.getLibrarySourceEnabled?.()
        || new Set(this.component.state.catalogSources || ['oaab-data']);
      importedSourceIds.forEach(id => sourceSelection.add(id));
      this.component.setLibrarySourceSelection?.(sourceSelection);
    }
    await this.persistWorkspaceSettings();
    this.render();
    this.restoreCachedThumbnails(this.resolved?.records || []);
    const total = this.plugins.reduce((sum, plugin) => sum + plugin.records.length, 0);
    this.status(`${this.plugins.length} plugin${this.plugins.length === 1 ? '' : 's'} loaded · ${total.toLocaleString()} supported records`);
    this.pluginInput.value = '';
  }

  applyLoadOrder() {
    const active = this.plugins.filter(plugin => plugin.enabled);
    this.resolved = resolveLoadOrder(active);
    this.component.setImportedRecords(this.resolved.records);
  }

  async persistPlugin(plugin) {
    try {
      await this.database.put('plugins', {
        id: plugin.id,
        filename: plugin.filename,
        fingerprint: plugin.fingerprint,
        masters: plugin.packet.masters || [],
        stats: plugin.packet.stats || {},
        importedAt: Date.now(),
      });
      await this.database.put('plugin-records', {
        pluginId: plugin.id,
        records: plugin.packet.records || [],
      });
    } catch (error) {
      console.warn('plugin cache write failed', error);
    }
  }

  async persistWorkspaceSettings() {
    try {
      await this.database.put('settings', {
        key: 'workspace',
        pluginOrder: this.plugins.map(plugin => plugin.id),
        enabledSources: [...(this.component._librarySourceEnabled || new Set(this.component.state.catalogSources || ['oaab-data']))],
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn('workspace settings write failed', error);
    }
  }

  async restorePlugins() {
    try {
      const [stored, settings] = await Promise.all([
        this.database.getAll('plugins'),
        this.database.get('settings', 'workspace'),
      ]);
      if (this.plugins.length) return;
      const order = new Map((settings?.pluginOrder || []).map((id, index) => [id, index]));
      stored.sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER));
      const enabledSources = new Set(settings?.enabledSources ?? (
        Array.isArray(this.component.state.catalogSources)
          ? this.component.state.catalogSources
          : [
            'oaab-data',
            ...(this.component.state.vanilla ? ['vanilla'] : []),
            ...stored.map(plugin => plugin.id),
          ]
      ));
      this.component._librarySourceEnabled = enabledSources;
      this.component.setState({
        catalogSources: [...enabledSources],
        vanilla: enabledSources.has('vanilla'),
      });
      if (!stored.length) {
        this.component.setState({ data: this.component.buildData() });
        this.render();
        return;
      }
      for (const metadata of stored) {
        const recordEntry = await this.database.get('plugin-records', metadata.id);
        const packet = {
          masters: metadata.masters || [],
          stats: metadata.stats || {},
          records: recordEntry?.records || [],
        };
        const provider = new PluginCatalog({
          id: metadata.id,
          filename: metadata.filename,
          fingerprint: metadata.fingerprint,
          packet,
        });
        this.plugins.push({
          ...metadata,
          packet,
          records: await provider.load(),
          enabled: enabledSources.has(metadata.id),
          restored: true,
        });
      }
      this.applyLoadOrder();
      this.render();
      await this.restoreCachedThumbnails(this.resolved.records);
      this.status(`${stored.length} cached plugin${stored.length === 1 ? '' : 's'} restored · cached thumbnails available`);
    } catch (error) {
      console.warn('plugin cache restore failed', error);
    }
  }

  movePlugin(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= this.plugins.length) return;
    const [plugin] = this.plugins.splice(index, 1);
    this.plugins.splice(target, 0, plugin);
    this.applyLoadOrder();
    this.render();
    this.persistWorkspaceSettings();
  }

  toggleSource(id, enabled) {
    if (id === 'oaab-data' || id === 'vanilla') {
      this.component.setLibrarySourceEnabled(id, enabled);
    } else {
      const plugin = this.plugins.find(entry => entry.id === id);
      if (plugin) plugin.enabled = enabled;
      this.component.setLibrarySourceEnabled(id, enabled);
      this.applyLoadOrder();
    }
    this.render();
    this.persistWorkspaceSettings();
  }

  selectRecord(record) {
    this.selectedRecord = record;
    this.renderRecord();
    this.resolveRecordAsset(record);
  }

  async resolveRecordAsset(record) {
    const target = this.dialog.querySelector('[data-record-asset-source]');
    if (!target || !record.mesh) return;
    target.textContent = 'Resolving…';
    try {
      const asset = await this.component._libraryServices.resolver.resolve(record.mesh);
      if (record === this.selectedRecord) target.textContent = asset.sourceLabel || asset.source;
    } catch {
      if (record === this.selectedRecord) target.textContent = 'Missing';
    }
  }

  async addLooseFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    let source = this.assetSources.find(entry => entry.id === 'local-loose-files');
    if (!source) {
      source = new LocalDirectorySource({ id: 'local-loose-files', label: 'Loose files' });
      this.assetSources.push(source);
      this.component._libraryServices.resolver.addSource(source, BSA_PRIORITIES.loose);
    }
    this.beginProgress('Indexing loose files', selected.length);
    try {
      await source.addFilesWithProgress(selected, {
        onProgress: progress => this.updateProgress({
          ...progress,
          label: `Indexing loose files · ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()}`,
        }),
      });
      this.dataInput.value = '';
      this.render();
      this.refreshImportedThumbnailsForAssetChange();
      this.status(`${selected.length.toLocaleString()} local file${selected.length === 1 ? '' : 's'} indexed in memory`);
    } catch (error) {
      this.status(`Could not index loose files: ${error.message}`, true);
    } finally {
      this.endProgress();
    }
  }

  async addFolderFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const label = selected[0].webkitRelativePath?.split('/')[0] || 'Selected Data Files';
    const source = new LocalDirectorySource({ id: `plugin-folder:${slug(label)}`, label });
    this.beginProgress(`Indexing ${label}`, selected.length);
    try {
      await source.addFilesWithProgress(selected, {
        onProgress: progress => this.updateProgress({
          ...progress,
          label: `Indexing ${label} · ${progress.completed.toLocaleString()} of ${progress.total.toLocaleString()}`,
        }),
      });
      this.replaceAssetSource(source, BSA_PRIORITIES.pluginFolder);
      this.directoryInput.value = '';
      this.render();
      this.refreshImportedThumbnailsForAssetChange();
      this.status(`${source.entries.size.toLocaleString()} assets indexed from ${label}`);
    } catch (error) {
      this.status(`Could not index ${label}: ${error.message}`, true);
    } finally {
      this.endProgress();
    }
  }

  async addDirectory() {
    if (!globalThis.showDirectoryPicker) {
      this.directoryInput.click();
      return;
    }
    try {
      const handle = await globalThis.showDirectoryPicker({ mode: 'read' });
      const source = new LocalDirectorySource({ id: `plugin-folder:${slug(handle.name)}`, label: handle.name, directoryHandle: handle });
      this.beginProgress(`Indexing ${handle.name}`, 0);
      await source.indexDirectory(handle, {
        onProgress: progress => this.updateProgress({
          ...progress,
          label: `Indexing ${handle.name} · ${progress.completed.toLocaleString()} files found`,
        }),
      });
      this.replaceAssetSource(source, BSA_PRIORITIES.pluginFolder);
      this.render();
      this.refreshImportedThumbnailsForAssetChange();
      this.status(`${source.entries.size.toLocaleString()} assets indexed lazily from ${handle.name}`);
    } catch (error) {
      if (error.name !== 'AbortError') this.status(error.message, true);
    } finally {
      this.endProgress();
    }
  }

  async addBsas(files) {
    let added = 0;
    for (const file of Array.from(files || []).filter(value => /\.bsa$/i.test(value.name))) {
      try {
        this.status(`Indexing ${file.name}…`);
        const source = new BsaSource({ file, id: `bsa:${slug(file.name)}` });
        await source.index();
        const lower = file.name.toLowerCase();
        const priority = lower.includes('tribunal') ? BSA_PRIORITIES.tribunal
          : lower.includes('bloodmoon') ? BSA_PRIORITIES.bloodmoon
            : lower.includes('morrowind') ? BSA_PRIORITIES.morrowind
              : BSA_PRIORITIES.pluginFolder;
        this.replaceAssetSource(source, priority);
        added += 1;
      } catch (error) {
        this.status(`${file.name}: ${error.message}`, true);
      }
    }
    this.bsaInput.value = '';
    this.render();
    if (added) this.refreshImportedThumbnailsForAssetChange();
    this.status(`${this.assetSources.filter(source => source instanceof BsaSource).length} BSA archive${this.assetSources.filter(source => source instanceof BsaSource).length === 1 ? '' : 's'} indexed`);
  }

  replaceAssetSource(source, priority) {
    const previous = this.assetSources.find(entry => entry.id === source.id);
    if (previous) this.component._libraryServices.resolver.removeSource(previous);
    this.assetSources = this.assetSources.filter(entry => entry.id !== source.id);
    source.priority = priority;
    this.assetSources.push(source);
    this.component._libraryServices.resolver.addSource(source, priority);
    this.component.setState({
      assetSourceRevision: (this.component.state.assetSourceRevision || 0) + 1,
    });
  }

  resetImportedThumbnailJobs() {
    this.thumbnailGeneration += 1;
    this.thumbnailQueue = [];
    this.thumbnailJobs.clear();
  }

  refreshImportedThumbnailsForAssetChange() {
    this.resetImportedThumbnailJobs();
    this.component.setImportedRecords(this.resolved?.records || [], { preserveThumbnails: false });
    this.syncImportedThumbnailTargets();
  }

  async runDiagnostics() {
    const records = this.resolved?.records || [];
    if (!records.length) return this.status('Open a plugin with mesh-bearing records first.', true);
    const button = this.dialog.querySelector('[data-run-diagnostics]');
    button.disabled = true;
    this.selectTab('diagnostics');
    try {
      this.diagnostics = await scanDependencies(records, {
        resolver: this.component._libraryServices.resolver,
        parseNif: bytes => this.worker.parseNif(bytes),
        onProgress: ({ completed, total }) => this.status(`Scanning dependencies ${completed}/${total}…`),
      });
      await this.persistDiagnostics();
      this.renderDiagnostics();
      const counts = this.diagnostics.counts;
      this.status(`Dependency scan complete · ${counts.missingNifs + counts.missingTextures} missing assets`);
    } catch (error) {
      this.status(error.message, true);
    } finally {
      button.disabled = false;
    }
  }

  async persistDiagnostics() {
    try {
      const sourceKey = this.plugins.filter(plugin => plugin.enabled).map(plugin => plugin.fingerprint || plugin.id).join(':');
      await this.database.put('asset-metadata', {
        key: `dependencies:${sourceKey || 'none'}`,
        counts: this.diagnostics.counts,
        assets: this.diagnostics.assets.map(asset => ({
          mesh: asset.mesh,
          status: asset.status,
          source: asset.source,
          textures: asset.textures,
          packetStats: asset.packetStats,
          error: asset.error,
        })),
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.warn('dependency metadata write failed', error);
    }
  }

  selectTab(name) {
    for (const button of this.dialog.querySelectorAll('[data-workspace-tab]')) {
      button.setAttribute('aria-selected', String(button.dataset.workspaceTab === name));
    }
    for (const panel of this.dialog.querySelectorAll('[data-workspace-panel]')) {
      panel.hidden = panel.dataset.workspacePanel !== name;
    }
  }

  beginProgress(label, total) {
    this.progressActive = true;
    this.progressTotal = Math.max(0, Number(total) || 0);
    this.progressCompleted = 0;
    this.updateProgress({ label, completed: 0, total: this.progressTotal });
    this.setWorkspaceBusy(true);
  }

  updateProgress({ label, completed = 0, total = this.progressTotal } = {}) {
    if (!this.progressActive) return;
    this.progressTotal = Math.max(0, Number(total) || 0);
    this.progressCompleted = Math.max(0, Number(completed) || 0);
    const wrap = this.dialog?.querySelector('[data-workspace-progress]');
    const bar = this.dialog?.querySelector('[data-workspace-progress-bar]');
    const text = this.dialog?.querySelector('[data-progress-label]');
    const value = this.dialog?.querySelector('[data-progress-value]');
    if (!wrap || !bar || !text || !value) return;
    wrap.hidden = false;
    text.textContent = label || 'Working…';
    if (this.progressTotal > 0) {
      bar.max = this.progressTotal;
      bar.value = Math.min(this.progressCompleted, this.progressTotal);
      const percent = Math.round((bar.value / this.progressTotal) * 100);
      value.textContent = `${percent}%`;
      bar.setAttribute('aria-valuetext', `${percent}% complete`);
    } else {
      bar.removeAttribute('value');
      value.textContent = `${this.progressCompleted.toLocaleString()} found`;
      bar.setAttribute('aria-valuetext', `${this.progressCompleted.toLocaleString()} files found`);
    }
  }

  endProgress() {
    if (!this.progressActive) return;
    this.progressActive = false;
    const wrap = this.dialog?.querySelector('[data-workspace-progress]');
    const bar = this.dialog?.querySelector('[data-workspace-progress-bar]');
    if (wrap) wrap.hidden = true;
    if (bar) bar.removeAttribute('aria-valuetext');
    this.setWorkspaceBusy(false);
  }

  setWorkspaceBusy(busy) {
    const selectors = '[data-open-plugin], [data-add-files], [data-add-directory], [data-add-bsa]';
    for (const button of this.dialog?.querySelectorAll(selectors) || []) button.disabled = !!busy;
  }

  status(message, error = false) {
    const target = this.dialog?.querySelector('[data-workspace-status]');
    if (!target) return;
    target.textContent = message;
    target.dataset.error = String(error);
  }

  render() {
    if (!this.dialog) return;
    const sourceList = this.dialog.querySelector('[data-source-list]');
    const sourceEnabled = sourceId => typeof this.component.isLibrarySourceEnabled === 'function'
      ? this.component.isLibrarySourceEnabled(sourceId)
      : this.component._librarySourceEnabled?.has(sourceId) !== false;
    const builtins = [
      { id: 'oaab-data', filename: 'OAAB_Data (public)', enabled: sourceEnabled('oaab-data'), summary: 'Built-in catalogue and public assets' },
      { id: 'vanilla', filename: 'Vanilla masters', enabled: sourceEnabled('vanilla'), summary: 'Morrowind, Tribunal, and Bloodmoon catalogue' },
    ];
    const importedSources = this.plugins.map(plugin => ({
      ...plugin,
      enabled: sourceEnabled(plugin.id),
    }));
    sourceList.replaceChildren(...builtins.concat(importedSources).map((source, index) => {
      const row = element('li', { className: 'library-source-row' }, this.doc);
      const stats = source.packet?.stats;
      row.innerHTML = `<label><input type="checkbox" ${source.enabled ? 'checked' : ''}><span><strong>${escapeHtml(source.filename)}</strong><small>${escapeHtml(source.summary || `${stats.totalRecords} records · ${stats.meshRecords} meshes · ${stats.uniqueMeshes} unique NIFs`)}</small></span></label>`;
      row.querySelector('input').addEventListener('change', (event) => this.toggleSource(source.id, event.target.checked));
      if (source.packet) {
        const controls = element('span', { className: 'library-source-order' }, this.doc);
        for (const [label, delta] of [['↑', -1], ['↓', 1]]) {
          const button = element('button', { type: 'button', textContent: label, title: `Move ${delta < 0 ? 'earlier' : 'later'} in load order` }, this.doc);
          button.disabled = delta < 0 ? index === builtins.length : index === builtins.length + this.plugins.length - 1;
          button.addEventListener('click', () => this.movePlugin(index - builtins.length, delta));
          controls.append(button);
        }
        row.append(controls);
      }
      return row;
    }));
    const assetList = this.dialog.querySelector('[data-asset-source-list]');
    const resolverSources = this.component._libraryServices?.resolver.sources || [];
    assetList.replaceChildren(...resolverSources.map(({ source, priority }) => {
      const row = element('li', { className: 'library-asset-source-row' }, this.doc);
      row.innerHTML = `<span><strong>${escapeHtml(source.label || source.id)}</strong><small>${escapeHtml(source.id)}</small></span><code>${priority}</code>`;
      return row;
    }));

    const records = this.resolved?.records || [];
    const recordList = this.dialog.querySelector('[data-record-list]');
    recordList.replaceChildren(...records.slice(0, 1000).map(record => {
      const button = element('button', { className: 'library-imported-record', type: 'button' }, this.doc);
      button.innerHTML = `<code>${escapeHtml(record.id)}</code><span>${escapeHtml(record.name || record.type)}</span><small>${escapeHtml(record.type)} · ${escapeHtml(sourceName(record))}</small>`;
      button.addEventListener('click', () => this.selectRecord(record));
      return button;
    }));
    this.dialog.querySelector('[data-record-count]').textContent = records.length > 1000
      ? `Showing 1,000 of ${records.length.toLocaleString()} winning records`
      : `${records.length.toLocaleString()} winning records`;
    this.renderRecord();
    this.dialog.querySelector('[data-run-diagnostics]').disabled = !records.length;
    this.renderDiagnostics();
  }

  renderRecord() {
    const panel = this.dialog.querySelector('[data-record-detail]');
    const record = this.selectedRecord;
    if (!record) {
      panel.innerHTML = '<p class="library-workspace-empty">Select an imported record to inspect its source, assets, and override chain.</p>';
      return;
    }
    const chain = record.metadata?.loadOrder?.overrides || [];
    panel.innerHTML = `
      <div class="library-record-heading"><div><code>${escapeHtml(record.id)}</code><h3>${escapeHtml(record.name || record.type)}</h3></div><span>${escapeHtml(record.type)}</span></div>
      <div class="library-record-modes" role="tablist">
        <button type="button" data-record-mode="preview" role="tab">Preview</button>
        <button type="button" data-record-mode="3d" role="tab" ${record.mesh ? '' : 'disabled'}>3D</button>
        <button type="button" data-record-mode="details" role="tab" aria-selected="true">Details</button>
      </div>
      <div data-record-preview hidden class="library-record-preview"><img src="${escapeHtml(this.component.findCatalogItem(record.id)?.img || '/assets/images/general/icon.png')}" alt="${escapeHtml(record.id)}"></div>
      <div data-record-live hidden class="library-record-live"><div data-record-viewer-status class="library-viewer-status"></div></div>
      <div data-record-details><dl class="library-record-facts">
        <dt>Record source</dt><dd>${escapeHtml(sourceName(record))}</dd>
        <dt>Mesh</dt><dd><code>${escapeHtml(record.mesh || 'None')}</code></dd>
        <dt>Asset source</dt><dd data-record-asset-source>${record.mesh ? 'Resolving…' : 'None'}</dd>
        <dt>Icon</dt><dd><code>${escapeHtml(record.icon || 'None')}</code></dd>
        <dt>Masters</dt><dd>${escapeHtml((record.metadata?.plugin?.masters || []).map(master => master.name).join(', ') || 'None')}</dd>
      </dl>
      <h4>Override chain</h4>
      <ol class="library-override-chain">${chain.map(entry => `<li>${escapeHtml(entry.plugin)}${entry.deleted ? ' (deleted)' : ''}</li>`).join('') || '<li>Only definition</li>'}</ol>
      <details><summary>Parsed fields</summary><pre>${escapeHtml(JSON.stringify(record.raw, null, 2))}</pre></details></div>`;
    panel.querySelector('.library-record-modes').addEventListener('click', (event) => {
      const button = event.target.closest('[data-record-mode]');
      if (button && !button.disabled) this.showRecordMode(button.dataset.recordMode, record);
    });
  }

  async showRecordMode(mode, record) {
    const panel = this.dialog.querySelector('[data-record-detail]');
    for (const button of panel.querySelectorAll('[data-record-mode]')) {
      button.setAttribute('aria-selected', String(button.dataset.recordMode === mode));
    }
    panel.querySelector('[data-record-preview]').hidden = mode !== 'preview';
    panel.querySelector('[data-record-details]').hidden = mode !== 'details';
    const live = panel.querySelector('[data-record-live]');
    live.hidden = mode !== '3d';
    this.interactiveViewerActive = mode === '3d';
    if (mode !== '3d') {
      this.syncImportedThumbnailTargets();
      return;
    }
    const status = live.querySelector('[data-record-viewer-status]');
    try {
      const viewer = await this.ensureViewer(live, status);
      this.setViewerDownloadState(false, record.id);
      const result = await viewer.load(record.mesh);
      status.textContent = `${record.mesh} · drag to rotate · middle/right drag to pan · wheel to zoom`;
      this.setViewerDownloadState(true, record.id);
      await this.cacheThumbnail(record, result);
    } catch (error) {
      this.setViewerDownloadState(false, record.id);
      status.textContent = error.message;
      status.dataset.error = 'true';
    }
  }

  async ensureViewer(host, status) {
    this.viewerStatus = status;
    if (!this.viewer) {
      this.viewerCreationPromise ??= import('../renderer/viewer.js').then(({ NifViewer }) => {
        this.viewerCanvas = element('canvas', { className: 'library-live-canvas' }, this.doc);
        return new NifViewer({
          canvas: this.viewerCanvas,
          resolver: this.component._libraryServices.resolver,
          onStatus: ({ message }) => {
            if (this.viewerStatus?.isConnected) this.viewerStatus.textContent = message;
          },
        });
      });
      this.viewer = await this.viewerCreationPromise;
    }
    this.viewer.attachTo(host);
    this.ensureViewerControls(host, this.viewer);
    return this.viewer;
  }

  ensureViewerControls(host, viewer) {
    if (!this.viewerControls) {
      this.viewerControls = element('div', { className: 'library-viewer-controls' }, this.doc);
      this.viewerControls.setAttribute('role', 'toolbar');
      this.viewerControls.setAttribute('aria-label', '3D viewer controls');
      this.viewerControls.innerHTML = `
        <button type="button" data-viewer-toggle="markers" title="Show or hide shapes named EditorMarker">Markers</button>
        <button type="button" data-viewer-toggle="wireframe" title="Show triangle edges">Wireframe</button>
        <button type="button" data-viewer-toggle="collision" title="Show or hide RootCollisionNode geometry">Collision</button>
        <button type="button" data-viewer-toggle="normals" title="Color surfaces by their normals">Normals</button>
        <button type="button" data-viewer-download disabled title="Download the current camera view with a transparent background">Download PNG</button>`;
      this.viewerControls.addEventListener('pointerdown', event => event.stopPropagation());
      this.viewerControls.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const downloadButton = event.target.closest('[data-viewer-download]');
        if (downloadButton) {
          this.downloadViewerPng(viewer, downloadButton);
          return;
        }
        const button = event.target.closest('[data-viewer-toggle]');
        const toggle = VIEWER_TOGGLES[button?.dataset.viewerToggle];
        if (!toggle) return;
        viewer[toggle.method](!viewer[toggle.property]);
        this.syncViewerControls(viewer);
      });
    }
    if (this.viewerControls.parentElement !== host) host.append(this.viewerControls);
    this.syncViewerControls(viewer);
    this.syncViewerDownloadControl();
  }

  syncViewerControls(viewer = this.viewer) {
    if (!viewer || !this.viewerControls) return;
    for (const button of this.viewerControls.querySelectorAll('[data-viewer-toggle]')) {
      const toggle = VIEWER_TOGGLES[button.dataset.viewerToggle];
      if (toggle) button.setAttribute('aria-pressed', String(!!viewer[toggle.property]));
    }
  }

  setViewerDownloadState(ready, name = this.viewerDownloadName) {
    this.viewerDownloadReady = !!ready;
    this.viewerDownloadName = String(name || 'oaab-3d-view');
    this.syncViewerDownloadControl();
  }

  syncViewerDownloadControl() {
    const button = this.viewerControls?.querySelector('[data-viewer-download]');
    if (!button) return;
    button.disabled = !this.viewerDownloadReady || this.viewerDownloadPending;
    button.textContent = this.viewerDownloadPending ? 'Preparing…' : 'Download PNG';
    button.setAttribute('aria-busy', String(this.viewerDownloadPending));
  }

  async downloadViewerPng(viewer = this.viewer, button = null) {
    if (!viewer || !this.viewerDownloadReady || this.viewerDownloadPending) return false;
    this.viewerDownloadPending = true;
    this.syncViewerDownloadControl();
    try {
      const blob = await viewer.capturePng();
      triggerBlobDownload(this.doc, blob, pngFilenameForView(this.viewerDownloadName));
      return true;
    } catch (error) {
      console.warn('3D PNG download failed', error);
      if (button) button.title = `PNG download failed: ${error.message}`;
      return false;
    } finally {
      this.viewerDownloadPending = false;
      this.syncViewerDownloadControl();
    }
  }

  async ensureThumbnailViewer() {
    if (!this.thumbnailViewer) {
      this.thumbnailViewerCreationPromise ??= import('../renderer/viewer.js').then(({ NifViewer }) => {
        this.thumbnailViewerCanvas = element('canvas', { className: 'library-live-canvas' }, this.doc);
        return new NifViewer({
          canvas: this.thumbnailViewerCanvas,
          resolver: this.component._libraryServices.resolver,
        });
      });
      this.thumbnailViewer = await this.thumbnailViewerCreationPromise;
    }
    this.thumbnailViewer.attachTo(this.thumbnailHost);
    this.thumbnailViewer.setGridVisible(false);
    return this.thumbnailViewer;
  }

  async getOrCreateThumbnail(record, result, {
    viewer = this.viewer,
    variant = THUMBNAIL_VARIANT_GRID,
    captureOptions = null,
    shouldCommit = () => true,
  } = {}) {
    if (!viewer || !shouldCommit()) return null;
    const meshSourceFingerprint = assetSourceFingerprint(result.asset);
    const identity = {
      sourceFingerprint: thumbnailSourceFingerprint(result),
      path: result.path,
      assetVersion: result.assetFingerprint,
      rendererVersion: NIF_RENDERER_VERSION,
      variant,
    };
    let cached = null;
    if (this.thumbnailCacheReadable !== false) {
      try {
        cached = await this.thumbnailCache.get(identity);
      } catch (error) {
        this.thumbnailCacheReadable = false;
        this.reportThumbnailCacheFailure(error);
      }
    }
    if (!shouldCommit()) return null;
    if (!cached) {
      const view = thumbnailViewForRecord(record);
      const options = {
        includeGrid: false,
        ...(view ? { view } : {}),
        ...(captureOptions || {}),
      };
      const blob = await viewer.captureThumbnail(options);
      if (!shouldCommit()) return null;
      if (this.thumbnailCacheWritable !== false) {
        try {
          cached = await this.thumbnailCache.put(identity, blob, {
            recordId: record.id,
            recordSource: record.source,
            meshSourceFingerprint,
          });
        } catch (error) {
          // IndexedDB is only an acceleration layer. Quota pressure, private
          // browsing restrictions, or a broken connection must not stop the
          // renderer for every subsequent card in the session.
          this.thumbnailCacheWritable = false;
          this.reportThumbnailCacheFailure(error);
        }
      }
      if (!cached) {
        const key = `transient:${variant}:${thumbnailRecordKey(record)}:${identity.assetVersion}:${identity.sourceFingerprint}`;
        cached = { ...identity, key, blob, url: this.thumbnailCache.urlFor({ key, blob }) };
      }
    }
    return shouldCommit() ? cached : null;
  }

  reportThumbnailCacheFailure(error) {
    if (this.thumbnailCacheWarningLogged) return;
    this.thumbnailCacheWarningLogged = true;
    console.warn('thumbnail persistence unavailable; using session thumbnails', error);
  }

  async cacheThumbnail(record, result, options = {}) {
    const {
      variant = THUMBNAIL_VARIANT_GRID,
      applyToItem = variant === THUMBNAIL_VARIANT_GRID,
      shouldCommit = () => true,
    } = options;
    const cached = await this.getOrCreateThumbnail(record, result, options);
    if (!cached || !shouldCommit()) return false;
    if (applyToItem) this.component.setImportedThumbnail(record, cached.url);
    return true;
  }

  async findCachedThumbnail(record, variant = THUMBNAIL_VARIANT_GRID) {
    if (this.thumbnailCacheReadable === false) return null;
    let path;
    try {
      path = normalizeAssetPath(record?.mesh, { root: 'meshes' });
    } catch {
      return null;
    }
    let entries;
    try {
      entries = await this.database.getThumbnailsByPath(path);
    } catch (error) {
      this.thumbnailCacheReadable = false;
      this.reportThumbnailCacheFailure(error);
      return null;
    }
    const entry = newestThumbnailEntry(entries, record, path, variant);
    return entry ? { ...entry, url: this.thumbnailCache.urlFor(entry) } : null;
  }

  syncImportedThumbnailTargets() {
    if (!this.dialog) return;
    // Virtualized cards are frequently detached and replaced while scrolling.
    // Rebuild observation from the mounted window so the observer cannot retain
    // an ever-growing trail of old elements.
    this.thumbnailObserver?.disconnect();
    const candidatesByKey = new Map();
    for (const target of this.doc.querySelectorAll('[data-local-thumbnail="true"]')) {
      const id = target.dataset.localThumbnailId || '';
      const item = this.component.findCatalogItem(id);
      if (
        !item?.imported
        || !item.mesh
        || item.thumbnailReady
        || item.thumbnailStatus === 'failed'
      ) continue;
      const record = item.record || item;
      const key = thumbnailRecordKey(record);
      const candidate = { target, item, record, key, ...this.thumbnailTargetMetrics(target) };
      const previous = candidatesByKey.get(key);
      if (!previous || compareThumbnailPriority(candidate, previous) < 0) {
        candidatesByKey.set(key, candidate);
      }
    }

    const candidates = [...candidatesByKey.values()].sort(compareThumbnailPriority);
    const activeKeys = new Set(candidates.map(candidate => candidate.key));
    const visibleKeys = new Set(candidates.filter(candidate => candidate.priority === 0).map(candidate => candidate.key));

    // Drop queued work that is no longer in the mounted virtual window. A
    // loading job also loses permission to commit once it leaves the viewport;
    // the current parse may finish, but its capture/cache work is skipped.
    for (const [key, job] of this.thumbnailJobs) {
      const candidate = candidatesByKey.get(key);
      const currentJob = candidate
        && job?.record === candidate.record
        && job.generation === this.thumbnailGeneration;
      const supersededByViewport = job?.status === 'loading'
        && visibleKeys.size > 0
        && !visibleKeys.has(key);
      if (supersededByViewport && Number.isFinite(job.viewerGeneration)) {
        this.thumbnailViewer?.cancelLoad?.(job.viewerGeneration);
      }
      if (
        !currentJob
        || !activeKeys.has(key)
        || supersededByViewport
        || job.status === 'done'
        || job.status === 'failed'
      ) this.thumbnailJobs.delete(key);
    }
    this.thumbnailQueue = this.thumbnailQueue.filter(entry => {
      const job = this.thumbnailJobs.get(entry.key);
      return activeKeys.has(entry.key)
        && entry.generation === this.thumbnailGeneration
        && job?.record === entry.record
        && job?.status === 'queued';
    });

    const fallbackLimit = Math.max(4, visibleKeys.size);
    let fallbackQueued = 0;
    for (const candidate of candidates) {
      this.updateThumbnailQueuePriority(candidate.key, candidate);
      if (candidate.priority === 0) {
        this.queueImportedThumbnail(candidate.target, candidate);
      } else if (this.thumbnailObserver) {
        this.thumbnailObserver.observe(candidate.target);
      } else if (fallbackQueued < fallbackLimit) {
        fallbackQueued += 1;
        this.queueImportedThumbnail(candidate.target, candidate);
      }
    }
    this.prioritizeThumbnailQueue();
    this.pumpThumbnailQueue();
  }

  thumbnailTargetMetrics(target) {
    const rect = target?.getBoundingClientRect?.();
    const win = this.doc?.defaultView || globalThis.window;
    const width = Number(win?.innerWidth || this.doc?.documentElement?.clientWidth || 0);
    const height = Number(win?.innerHeight || this.doc?.documentElement?.clientHeight || 0);
    if (!rect || width <= 0 || height <= 0) return { priority: 0, distance: 0 };
    const visible = rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
    const center = (rect.top + rect.bottom) / 2;
    const distance = visible
      ? Math.abs(center - height / 2)
      : rect.bottom <= 0 ? -rect.bottom : Math.max(0, rect.top - height);
    return { priority: visible ? 0 : 1, distance };
  }

  updateThumbnailQueuePriority(key, { priority = 1, distance = Number.MAX_SAFE_INTEGER } = {}) {
    const entry = this.thumbnailQueue.find(candidate => candidate.key === key);
    if (!entry) return;
    entry.priority = priority;
    entry.distance = distance;
  }

  prioritizeThumbnailQueue() {
    this.thumbnailQueue.sort(compareThumbnailPriority);
  }

  queueImportedThumbnail(target, priority = this.thumbnailTargetMetrics(target)) {
    if (target?.isConnected === false) return;
    const id = target?.dataset?.localThumbnailId || '';
    if (!id) return;
    const item = this.component.findCatalogItem(id);
    if (!item?.imported || !item.mesh || item.thumbnailReady || item.thumbnailStatus === 'failed') return;
    const record = item.record || item;
    const key = thumbnailRecordKey(record);
    const existing = this.thumbnailJobs.get(key);
    if (existing?.record === record && existing.generation === this.thumbnailGeneration) {
      if (existing.status === 'queued') this.updateThumbnailQueuePriority(key, priority);
      return;
    }
    if (existing) this.thumbnailJobs.delete(key);
    const generation = this.thumbnailGeneration;
    this.thumbnailQueueSequence = (this.thumbnailQueueSequence || 0) + 1;
    this.thumbnailJobs.set(key, { record, status: 'queued', generation, attempts: 0 });
    this.thumbnailQueue.push({
      key,
      record,
      generation,
      attempts: 0,
      priority: priority.priority ?? 1,
      distance: priority.distance ?? Number.MAX_SAFE_INTEGER,
      sequence: this.thumbnailQueueSequence,
    });
    this.component.setImportedThumbnailStatus?.(record, 'pending');
  }

  retryImportedThumbnail(id) {
    const item = this.component.findCatalogItem(id);
    if (!item?.imported || !item.mesh || item.thumbnailReady) return;
    const record = item.record || item;
    const key = thumbnailRecordKey(record);
    this.thumbnailJobs.delete(key);
    this.thumbnailQueue = this.thumbnailQueue.filter(entry => entry.key !== key);
    const generation = this.thumbnailGeneration;
    this.thumbnailQueueSequence = (this.thumbnailQueueSequence || 0) + 1;
    this.thumbnailJobs.set(key, { record, status: 'queued', generation, attempts: 0 });
    this.thumbnailQueue.push({
      key,
      record,
      generation,
      attempts: 0,
      priority: 0,
      distance: 0,
      sequence: this.thumbnailQueueSequence,
    });
    this.component.setImportedThumbnailStatus?.(record, 'pending');
    this.prioritizeThumbnailQueue();
    this.pumpThumbnailQueue();
  }

  async pumpThumbnailQueue() {
    if (this.thumbnailPumpRunning) return;
    if (!this.dialog || this.interactiveViewerActive || this.productionViewerActive || this.productionPreviewActive) return;
    this.thumbnailPumpRunning = true;
    try {
      while (this.thumbnailQueue.length) {
        if (!this.dialog || this.interactiveViewerActive || this.productionViewerActive || this.productionPreviewActive) break;
        const entry = this.thumbnailQueue.shift();
        const queuedJob = entry && this.thumbnailJobs.get(entry.key);
        if (
          !entry
          || entry.generation !== this.thumbnailGeneration
          || queuedJob?.record !== entry.record
          || queuedJob?.generation !== entry.generation
          || queuedJob?.status !== 'queued'
        ) continue;
        // A persisted thumbnail may have been restored while this job was
        // waiting in the queue. Do not parse or render the mesh again.
        const currentItem = this.component.findCatalogItem?.(entry.record.id);
        if (currentItem?.thumbnailReady) {
          this.thumbnailJobs.set(entry.key, {
            record: entry.record,
            status: 'done',
            generation: entry.generation,
            attempts: entry.attempts || 0,
          });
          continue;
        }
        this.thumbnailJobs.set(entry.key, {
          record: entry.record,
          status: 'loading',
          generation: entry.generation,
          attempts: entry.attempts || 0,
        });
        this.component.setImportedThumbnailStatus?.(entry.record, 'loading');
        const isCurrent = () => {
          const job = this.thumbnailJobs.get(entry.key);
          return entry.generation === this.thumbnailGeneration
            && job?.record === entry.record
            && job?.generation === entry.generation
            && job?.status === 'loading';
        };
        try {
          const viewer = await this.ensureThumbnailViewer();
          if (!isCurrent()) continue;
          const loadPromise = viewer.load(entry.record.mesh, { resolveTextures: true });
          const loadingJob = this.thumbnailJobs.get(entry.key);
          if (loadingJob && isCurrent() && Number.isFinite(viewer.loadGeneration)) {
            loadingJob.viewerGeneration = viewer.loadGeneration;
          }
          const result = await loadPromise;
          const committed = await this.cacheThumbnail(entry.record, result, { viewer, shouldCommit: isCurrent });
          if (committed && isCurrent()) {
            this.thumbnailJobs.set(entry.key, {
              record: entry.record,
              status: 'done',
              generation: entry.generation,
              attempts: entry.attempts || 0,
            });
          }
        } catch (error) {
          if (isCurrent()) {
            const attempts = (entry.attempts || 0) + 1;
            if (attempts < THUMBNAIL_MAX_ATTEMPTS) {
              this.thumbnailJobs.set(entry.key, {
                record: entry.record,
                status: 'queued',
                generation: entry.generation,
                attempts,
              });
              this.thumbnailQueue.push({ ...entry, attempts });
              this.prioritizeThumbnailQueue();
              this.component.setImportedThumbnailStatus?.(entry.record, 'pending', error.message);
            } else {
              this.thumbnailJobs.set(entry.key, {
                record: entry.record,
                status: 'failed',
                generation: entry.generation,
                attempts,
              });
              this.component.setImportedThumbnailStatus?.(entry.record, 'failed', error.message);
              console.warn('local thumbnail generation failed', entry.record.id, error);
            }
          }
        }
        await yieldToBrowser();
      }
    } finally {
      this.thumbnailPumpRunning = false;
    }
  }

  async restoreCachedThumbnails(records) {
    const recordsByPath = new Map();
    for (const record of records || []) {
      if (!record?.mesh) continue;
      try {
        const path = normalizeAssetPath(record.mesh, { root: 'meshes' });
        const matches = recordsByPath.get(path) || [];
        matches.push(record);
        recordsByPath.set(path, matches);
      } catch {}
    }
    for (const [path, matchingRecords] of recordsByPath) {
      const entries = await this.database.getThumbnailsByPath(path);
      for (const record of matchingRecords) {
        const entry = newestThumbnailEntry(entries, record, path, THUMBNAIL_VARIANT_GRID);
        if (!entry) continue;
        // The cache key already includes the mesh and texture fingerprints.
        // Restore it immediately, even before the user reselects the local
        // Data Files folder. A later asset-source change clears these items
        // and schedules fresh captures, so stale local files cannot persist
        // once the resolver has new input.
        this.component.setImportedThumbnail(record, this.thumbnailCache.urlFor(entry));
      }
    }
  }

  syncProductionPreview() {
    const preview = this.component.state.renderPreview;
    const dialog = this.doc.querySelector('.library-render-dialog');
    if (!preview || !dialog || !preview.mesh) {
      this.productionLoadKey = null;
      this.productionDetailsKey = null;
      this.productionViewerActive = false;
      this.productionPreviewActive = false;
      this.productionPreviewKey = null;
      if (!this.interactiveViewerActive) this.setViewerDownloadState(false);
      this.syncImportedThumbnailTargets();
      return;
    }
    const mode = this.component.state.renderPreviewMode || 'preview';
    this.productionViewerActive = mode === '3d';
    if (mode === '3d') this.showProductionMode(mode, preview);
    else {
      this.productionLoadKey = null;
      if (mode === 'details') this.syncProductionDetails(preview, dialog);
      else this.ensureHighResolutionPreview(preview);
      this.syncImportedThumbnailTargets();
    }
  }

  async ensureHighResolutionPreview(preview) {
    const item = this.component.findCatalogItem(preview?.id);
    if (!preview?.mesh || !item?.imported || !item.record || !item.thumbnailReady) {
      this.productionPreviewActive = false;
      this.productionPreviewKey = null;
      return;
    }
    const key = `${preview.source || ''}\0${preview.id || ''}\0${preview.mesh}`;
    if (this.productionPreviewKey === key) return;
    this.productionPreviewKey = key;
    this.productionPreviewActive = true;
    const isCurrent = () => {
      const current = this.component.state.renderPreview;
      return this.productionPreviewKey === key
        && this.component.state.renderPreviewMode === 'preview'
        && current?.id === preview.id
        && current?.mesh === preview.mesh;
    };
    try {
      const cached = await this.findCachedThumbnail(item.record, THUMBNAIL_VARIANT_PREVIEW);
      if (cached) {
        if (isCurrent()) this.component.setState({
          renderPreview: { ...this.component.state.renderPreview, src: cached.url, thumbnailPending: false },
          renderPreviewLoaded: true,
        });
        return;
      }
      const viewer = await this.ensureThumbnailViewer();
      const result = await viewer.load(preview.mesh, { resolveTextures: true });
      const generated = await this.getOrCreateThumbnail(item.record, result, {
        viewer,
        variant: THUMBNAIL_VARIANT_PREVIEW,
        captureOptions: { width: 768, height: 768, quality: 0.9 },
        shouldCommit: isCurrent,
      });
      if (generated && isCurrent()) this.component.setState({
        renderPreview: { ...this.component.state.renderPreview, src: generated.url, thumbnailPending: false },
        renderPreviewLoaded: true,
      });
    } catch (error) {
      if (isCurrent()) console.warn('high-resolution preview generation failed', item.record.id, error);
    } finally {
      if (this.productionPreviewKey === key) this.productionPreviewActive = false;
      this.pumpThumbnailQueue();
    }
  }

  async showProductionMode(mode, preview = this.component.state.renderPreview) {
    if (mode !== '3d') return;
    const dialog = this.doc.querySelector('.library-render-dialog');
    const host = dialog?.querySelector('[data-live-preview-host]');
    const status = host?.querySelector('[data-live-status]');
    if (!preview || !host || !status) return;
    if (preview.vanilla && !this.assetSources.length) {
      this.setViewerDownloadState(false, preview.id);
      this.productionViewerMessage = 'Add a Morrowind Data Files folder or BSA through Local files to enable 3D.';
      status.textContent = this.productionViewerMessage;
      status.dataset.error = 'true';
      return;
    }
    const key = `${preview.source || ''}\0${preview.id || ''}\0${preview.mesh}`;
    if (this.productionLoadKey === key && this.viewer) {
      await this.ensureViewer(host, status);
      this.setViewerDownloadState(this.viewerDownloadName === preview.id && this.viewerDownloadReady, preview.id);
      status.textContent = this.productionViewerMessage || `${preview.mesh} · drag to rotate · middle/right drag to pan · wheel to zoom`;
      return;
    }
    this.productionLoadKey = key;
    this.setViewerDownloadState(false, preview.id);
    this.productionViewerMessage = `Loading ${preview.mesh}…`;
    status.textContent = this.productionViewerMessage;
    status.removeAttribute('data-error');
    const isCurrent = () => {
      const current = this.component.state.renderPreview;
      return this.productionLoadKey === key
        && this.component.state.renderPreviewMode === '3d'
        && current?.id === preview.id
        && current?.mesh === preview.mesh;
    };
    try {
      const viewer = await this.ensureViewer(host, status);
      if (!isCurrent()) return;
      const result = await viewer.load(preview.mesh);
      if (!isCurrent()) return;
      const item = this.component.findCatalogItem(preview.id);
      if (item?.imported && item.record) {
        await this.cacheThumbnail(item.record, result, { viewer, shouldCommit: isCurrent });
        if (!isCurrent()) return;
      }
      this.productionViewerMessage = `${preview.mesh} · drag to rotate · middle/right drag to pan · wheel to zoom`;
      this.setViewerDownloadState(true, preview.id);
      if (status.isConnected) status.textContent = this.productionViewerMessage;
    } catch (error) {
      if (!isCurrent()) return;
      this.setViewerDownloadState(false, preview.id);
      this.productionViewerMessage = error.message;
      if (status.isConnected) {
        status.textContent = error.message;
        status.dataset.error = 'true';
      }
    }
  }

  async syncProductionDetails(preview, dialog) {
    const target = dialog.querySelector('[data-live-asset-source]');
    if (!target) return;
    const key = `${preview.source || ''}\0${preview.id || ''}\0${preview.mesh}`;
    if (this.productionDetailsKey === key && this.productionDetailsSource) {
      target.textContent = this.productionDetailsSource;
      return;
    }
    this.productionDetailsKey = key;
    this.productionDetailsSource = '';
    target.textContent = 'Resolving…';
    try {
      const asset = await this.component._libraryServices.resolver.resolve(preview.mesh);
      this.productionDetailsSource = asset.sourceLabel || asset.source;
    } catch {
      this.productionDetailsSource = 'Missing';
    }
    const current = this.component.state.renderPreview;
    if (
      this.productionDetailsKey === key
      && this.component.state.renderPreviewMode === 'details'
      && current?.id === preview.id
      && current?.mesh === preview.mesh
    ) {
      const currentTarget = this.doc.querySelector('.library-render-dialog [data-live-asset-source]');
      if (currentTarget) currentTarget.textContent = this.productionDetailsSource;
    }
  }

  renderDiagnostics() {
    const panel = this.dialog.querySelector('[data-workspace-panel="diagnostics"]');
    if (!this.diagnostics) {
      panel.innerHTML = '<p class="library-workspace-empty">Run a dependency scan to trace every imported record through its NIF and texture sources.</p>';
      return;
    }
    const counts = this.diagnostics.counts;
    panel.innerHTML = `<div class="library-diagnostic-counts">
      ${Object.entries(counts).map(([key, value]) => `<div><strong>${Number(value).toLocaleString()}</strong><span>${escapeHtml(splitWords(key))}</span></div>`).join('')}
    </div><div class="library-dependency-tree">${this.diagnostics.trees.map(tree => `
      <details class="${tree.status}"><summary><code>${escapeHtml(tree.record.id)}</code><span>${escapeHtml(tree.mesh)}</span><strong>${escapeHtml(tree.sourceLabel || tree.status)}</strong></summary>
        <ul>${(tree.textures || []).map(texture => `<li class="${texture.status}"><code>${escapeHtml(texture.path)}</code><span>${escapeHtml(texture.sourceLabel || texture.status)}</span></li>`).join('') || '<li>No external textures</li>'}</ul>
      </details>`).join('')}</div>`;
  }

  async clearImportedPlugins() {
    await this.database.clearImportedPlugins();
    const sourceSelection = this.component.getLibrarySourceEnabled?.() || new Set(['oaab-data']);
    for (const plugin of this.plugins) this.component._librarySourceEnabled?.delete(plugin.id);
    this.plugins = [];
    this.selectedRecord = null;
    this.resetImportedThumbnailJobs();
    for (const sourceId of [...sourceSelection]) {
      if (sourceId !== 'oaab-data' && sourceId !== 'vanilla') sourceSelection.delete(sourceId);
    }
    this.component.setLibrarySourceSelection?.(sourceSelection);
    this.applyLoadOrder();
    await this.persistWorkspaceSettings();
    this.render();
    this.status('Imported plugin records cleared; built-in catalogues are unchanged.');
  }

  async clearThumbnails() {
    await this.thumbnailCache.clear();
    this.thumbnailCacheReadable = true;
    this.thumbnailCacheWritable = true;
    this.thumbnailCacheWarningLogged = false;
    this.refreshImportedThumbnailsForAssetChange();
    this.status('Generated thumbnail cache cleared.');
  }

  async clearAllCache() {
    await this.database.clearAll();
    const sourceSelection = this.component.getLibrarySourceEnabled?.() || new Set(['oaab-data']);
    for (const plugin of this.plugins) this.component._librarySourceEnabled?.delete(plugin.id);
    this.plugins = [];
    this.selectedRecord = null;
    this.resetImportedThumbnailJobs();
    for (const sourceId of [...sourceSelection]) {
      if (sourceId !== 'oaab-data' && sourceId !== 'vanilla') sourceSelection.delete(sourceId);
    }
    this.component.setLibrarySourceSelection?.(sourceSelection);
    this.thumbnailCache.revokeUrls();
    this.thumbnailCacheReadable = true;
    this.thumbnailCacheWritable = true;
    this.thumbnailCacheWarningLogged = false;
    this.applyLoadOrder();
    this.render();
    this.status('All local Library cache data cleared; built-in static data is unchanged.');
  }

  dispose() {
    this.viewer?.dispose();
    this.thumbnailViewer?.dispose();
    this.worker.terminate();
    this.thumbnailObserver?.disconnect();
    this.thumbnailGeneration += 1;
    this.thumbnailQueue = [];
    this.thumbnailJobs.clear();
    this.thumbnailCache.revokeUrls();
    this.database.close();
    this.viewerControls?.remove();
    this.dialog?.remove();
    this.button?.remove();
  }
}

export function pngFilenameForView(value) {
  const stem = String(value || 'oaab-3d-view')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '');
  return `${stem || 'oaab-3d-view'}.png`;
}

function triggerBlobDownload(doc, blob, filename) {
  const urlApi = doc.defaultView?.URL || globalThis.URL;
  const url = urlApi.createObjectURL(blob);
  const link = element('a', { href: url, download: filename, hidden: true }, doc);
  doc.body.append(link);
  link.click();
  link.remove();
  const defer = doc.defaultView?.setTimeout?.bind(doc.defaultView) || globalThis.setTimeout;
  defer(() => urlApi.revokeObjectURL(url), 0);
}

function workspaceMarkup() {
  return `<section class="library-workspace-dialog" role="dialog" aria-modal="true" aria-label="Local TES3 workspace">
    <header><div><span class="library-workspace-kicker">Browser-only asset explorer</span><h2>Local TES3 workspace</h2></div><button type="button" data-workspace-close aria-label="Close">×</button></header>
    <div class="library-workspace-actions">
      <button type="button" data-open-plugin class="library-workspace-primary">Open Plugin</button>
      <input data-plugin-input type="file" accept=".esp,.esm" multiple hidden>
      <button type="button" data-add-files>Add loose files</button>
      <input data-files-input type="file" accept=".nif,.dds,.tga,.bmp,.png,.jpg,.jpeg" multiple hidden>
      <button type="button" data-add-directory>Add Data Files folder</button>
      <input data-directory-input type="file" webkitdirectory multiple hidden>
      <button type="button" data-add-bsa>Add BSA</button>
      <input data-bsa-input type="file" accept=".bsa" multiple hidden>
      <button type="button" data-run-diagnostics disabled>Scan dependencies</button>
      <details class="library-cache-actions"><summary>Cache</summary><div><button type="button" data-clear-plugins>Clear imported plugins</button><button type="button" data-clear-thumbnails>Clear thumbnails</button><button type="button" data-clear-all>Clear all cache</button></div></details>
      <span data-workspace-status role="status">Files stay on this device.</span>
      <div data-workspace-progress hidden class="library-workspace-progress" role="status" aria-live="polite">
        <div><span data-progress-label>Working…</span><strong data-progress-value>0%</strong></div>
        <progress data-workspace-progress-bar max="1" value="0" aria-label="Library import progress"></progress>
      </div>
    </div>
    <nav data-workspace-tablist role="tablist" class="library-workspace-tabs">
      <button type="button" role="tab" data-workspace-tab="records" aria-selected="true">Records</button>
      <button type="button" role="tab" data-workspace-tab="diagnostics" aria-selected="false">Diagnostics</button>
    </nav>
    <div data-thumbnail-render-host class="library-thumbnail-render-host" aria-hidden="true"></div>
    <div class="library-workspace-grid">
      <aside><h3>Catalog sources and load order</h3><ul data-source-list class="library-source-list"></ul><h3 class="library-asset-source-heading">Asset resolver priority</h3><ul data-asset-source-list class="library-source-list"></ul></aside>
      <section data-workspace-panel="records" class="library-record-browser"><div><p data-record-count>0 winning records</p><div data-record-list class="library-imported-records"></div></div><article data-record-detail class="library-record-detail"></article></section>
      <section data-workspace-panel="diagnostics" hidden><p class="library-workspace-empty">Add asset sources, then scan records to trace record → NIF → texture resolution.</p></section>
    </div>
  </section>`;
}

function sourceName(record) {
  return record.metadata?.plugin?.filename || record.metadata?.loadOrder?.winningPlugin || record.source;
}

function thumbnailRecordKey(record) {
  return `${record?.source || ''}\0${String(record?.id || '').toLowerCase()}`;
}

function compareThumbnailPriority(left, right) {
  const priority = (left?.priority ?? 1) - (right?.priority ?? 1);
  if (priority) return priority;
  const distance = (left?.distance ?? Number.MAX_SAFE_INTEGER)
    - (right?.distance ?? Number.MAX_SAFE_INTEGER);
  if (distance) return distance;
  return (left?.sequence ?? 0) - (right?.sequence ?? 0);
}

function newestThumbnailEntry(entries, record, path, variant) {
  const recordId = String(record?.id || '').toLowerCase();
  let newest = null;
  for (const entry of entries || []) {
    if (
      !entry?.blob
      || entry.path !== path
      || entry.rendererVersion !== NIF_RENDERER_VERSION
      || (entry.variant || THUMBNAIL_VARIANT_GRID) !== variant
      || entry.recordSource !== record?.source
      || String(entry.recordId || '').toLowerCase() !== recordId
    ) continue;
    const createdAt = Number(entry.createdAt) || 0;
    const newestCreatedAt = Number(newest?.createdAt) || 0;
    if (!newest || createdAt >= newestCreatedAt) newest = entry;
  }
  return newest;
}

function assetSourceFingerprint(asset) {
  const version = asset?.lastModified ?? asset?.url ?? asset?.size ?? 'asset';
  return `${asset?.source || 'unknown'}:${version}`;
}

function thumbnailSourceFingerprint(result) {
  const textures = (result.textureDiagnostics || [])
    .filter(entry => entry.status === 'resolved' && entry.asset)
    .map(entry => `${entry.path}:${assetSourceFingerprint(entry.asset)}`)
    .sort();
  return [assetSourceFingerprint(result.asset), ...textures].join('|');
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function slug(value) {
  return String(value || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function splitWords(value) {
  return String(value).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function element(tag, properties = {}, doc = globalThis.document) {
  const node = doc.createElement(tag);
  const { dataset, ...rest } = properties;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  return node;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}
