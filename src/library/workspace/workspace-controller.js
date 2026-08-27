import { PluginCatalog } from '../catalog/plugin-catalog.js';
import { resolveLoadOrder } from '../catalog/load-order.js';
import { Tes3WorkerClient } from '../workers/tes3-worker-client.js';
import { BsaSource, BSA_PRIORITIES } from '../sources/bsa-source.js';
import { LocalDirectorySource } from '../sources/local-directory-source.js';
import { scanDependencies } from '../diagnostics/dependency-scanner.js';
import { LibraryDatabase } from '../storage/library-db.js';
import {
  NIF_RENDERER_VERSION,
  ThumbnailCache,
  fingerprintBytes,
  thumbnailCacheKey,
} from '../storage/thumbnail-cache.js';

export function initializeLibraryWorkspace(component) {
  const workspace = new LibraryWorkspace(component);
  workspace.mount();
  return workspace;
}

class LibraryWorkspace {
  constructor(component) {
    this.component = component;
    this.doc = component.activeDoc?.() || document;
    this.worker = new Tes3WorkerClient();
    this.plugins = [];
    this.assetSources = [];
    this.database = new LibraryDatabase();
    this.thumbnailCache = new ThumbnailCache(this.database);
    this.selectedRecord = null;
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
    this.render();
    this.restorePlugins();
  }

  open() {
    this.dialog.hidden = false;
    this.doc.body.classList.add('library-workspace-opened');
    this.dialog.querySelector('[data-open-plugin]').focus();
  }

  close() {
    this.dialog.hidden = true;
    this.doc.body.classList.remove('library-workspace-opened');
    this.button?.focus();
  }

  async importPlugins(files) {
    const selected = Array.from(files || []).filter(file => /\.(?:esp|esm)$/i.test(file.name));
    if (!selected.length) return this.status('Choose one or more .esp or .esm files.', true);
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
          cells: packet.cells || [],
          enabled: true,
        });
        await this.persistPlugin(this.plugins.at(-1));
        this.component._librarySourceEnabled ??= new Set(['oaab-data', 'vanilla']);
        this.component._librarySourceEnabled.add(provider.id);
      } catch (error) {
        this.status(`${file.name}: ${error.message}`, true);
      }
    }
    this.applyLoadOrder();
    await this.persistWorkspaceSettings();
    this.render();
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
        cells: plugin.cells || [],
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
        enabledSources: [...(this.component._librarySourceEnabled || new Set(['oaab-data', 'vanilla']))],
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
      const enabledSources = new Set(settings?.enabledSources || ['oaab-data', 'vanilla', ...stored.map(plugin => plugin.id)]);
      this.component._librarySourceEnabled = enabledSources;
      if (!stored.length) {
        this.component.setState({ data: this.component.buildData() });
        this.render();
        return;
      }
      for (const metadata of stored) {
        const recordEntry = await this.database.get('plugin-records', metadata.id);
        const packet = {
          masters: metadata.masters || [],
          cells: metadata.cells || [],
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
          cells: packet.cells,
          enabled: enabledSources.has(metadata.id),
          restored: true,
        });
      }
      this.applyLoadOrder();
      this.render();
      await this.restoreCachedThumbnails(this.resolved.records);
      this.status(`${stored.length} cached plugin${stored.length === 1 ? '' : 's'} restored · reselect local asset sources when needed`);
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
      if (id === 'vanilla' && enabled && !this.component.state.vanilla) {
        this.component.setFilterState({ vanilla: true });
      }
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
    source.addFiles(selected);
    this.dataInput.value = '';
    this.render();
    this.status(`${selected.length.toLocaleString()} local file${selected.length === 1 ? '' : 's'} indexed in memory`);
  }

  async addFolderFiles(files) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    const label = selected[0].webkitRelativePath?.split('/')[0] || 'Selected Data Files';
    const source = new LocalDirectorySource({ id: `plugin-folder:${slug(label)}`, label });
    source.addFiles(selected);
    this.replaceAssetSource(source, BSA_PRIORITIES.pluginFolder);
    this.directoryInput.value = '';
    this.render();
    this.status(`${source.entries.size.toLocaleString()} assets indexed from ${label}`);
  }

  async addDirectory() {
    if (!globalThis.showDirectoryPicker) {
      this.directoryInput.click();
      return;
    }
    try {
      const handle = await globalThis.showDirectoryPicker({ mode: 'read' });
      const source = new LocalDirectorySource({ id: `plugin-folder:${slug(handle.name)}`, label: handle.name, directoryHandle: handle });
      this.status(`Indexing ${handle.name}…`);
      await source.indexDirectory();
      this.replaceAssetSource(source, BSA_PRIORITIES.pluginFolder);
      this.render();
      this.status(`${source.entries.size.toLocaleString()} assets indexed lazily from ${handle.name}`);
    } catch (error) {
      if (error.name !== 'AbortError') this.status(error.message, true);
    }
  }

  async addBsas(files) {
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
      } catch (error) {
        this.status(`${file.name}: ${error.message}`, true);
      }
    }
    this.bsaInput.value = '';
    this.render();
    this.status(`${this.assetSources.filter(source => source instanceof BsaSource).length} BSA archive${this.assetSources.filter(source => source instanceof BsaSource).length === 1 ? '' : 's'} indexed`);
  }

  replaceAssetSource(source, priority) {
    const previous = this.assetSources.find(entry => entry.id === source.id);
    if (previous) this.component._libraryServices.resolver.removeSource(previous);
    this.assetSources = this.assetSources.filter(entry => entry.id !== source.id);
    source.priority = priority;
    this.assetSources.push(source);
    this.component._libraryServices.resolver.addSource(source, priority);
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

  status(message, error = false) {
    const target = this.dialog?.querySelector('[data-workspace-status]');
    if (!target) return;
    target.textContent = message;
    target.dataset.error = String(error);
  }

  render() {
    if (!this.dialog) return;
    const sourceList = this.dialog.querySelector('[data-source-list]');
    const builtins = [
      { id: 'oaab-data', filename: 'OAAB_Data (public)', enabled: this.component._librarySourceEnabled?.has('oaab-data') !== false, summary: 'Built-in catalogue and public assets' },
      { id: 'vanilla', filename: 'Vanilla masters', enabled: !!this.component.state.vanilla && this.component._librarySourceEnabled?.has('vanilla') !== false, summary: 'Morrowind, Tribunal, and Bloodmoon catalogue' },
    ];
    sourceList.replaceChildren(...builtins.concat(this.plugins).map((source, index) => {
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
    this.renderCells();
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
    if (mode !== '3d') return;
    const status = live.querySelector('[data-record-viewer-status]');
    try {
      const viewer = await this.ensureViewer(live, status);
      const result = await viewer.load(record.mesh);
      status.textContent = `${record.mesh} · drag to rotate · wheel to zoom`;
      await this.cacheThumbnail(record, result);
    } catch (error) {
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
    return this.viewer;
  }

  async cacheThumbnail(record, result) {
    const sourceFingerprint = `${result.asset.source}:${result.asset.lastModified || result.asset.url || result.asset.size || 'asset'}`;
    const identity = {
      sourceFingerprint,
      path: result.path,
      assetVersion: result.assetFingerprint,
      rendererVersion: NIF_RENDERER_VERSION,
    };
    let cached = await this.thumbnailCache.get(identity);
    if (!cached) {
      const blob = await this.viewer.captureThumbnail();
      cached = await this.thumbnailCache.put(identity, blob, {
        recordId: record.id,
        recordSource: record.source,
      });
    }
    this.component.setImportedThumbnail(record, cached.url);
  }

  async restoreCachedThumbnails(records) {
    const entries = await this.database.getAll('thumbnails');
    const byRecord = new Map((records || []).map(record => [`${record.source}\0${record.id.toLowerCase()}`, record]));
    for (const entry of entries) {
      const record = byRecord.get(`${entry.recordSource}\0${String(entry.recordId || '').toLowerCase()}`);
      if (!record?.mesh) continue;
      try {
        const asset = await this.component._libraryServices.resolver.resolve(record.mesh);
        const assetVersion = await fingerprintBytes(asset.bytes);
        const sourceFingerprint = `${asset.source}:${asset.lastModified || asset.url || asset.size || 'asset'}`;
        const key = thumbnailCacheKey({
          sourceFingerprint,
          path: record.mesh,
          assetVersion,
          rendererVersion: NIF_RENDERER_VERSION,
        });
        if (key === entry.key) this.component.setImportedThumbnail(record, this.thumbnailCache.urlFor(entry));
      } catch {}
    }
  }

  syncProductionPreview() {
    const preview = this.component.state.renderPreview;
    const dialog = this.doc.querySelector('.library-render-dialog');
    if (!preview || !dialog || !preview.mesh) {
      this.productionPreviewId = null;
      return;
    }
    let controls = dialog.querySelector('[data-live-preview-controls]');
    if (!controls) {
      controls = element('div', { className: 'library-live-preview-controls', dataset: { livePreviewControls: '' } }, this.doc);
      controls.innerHTML = '<button type="button" data-live-mode="preview" aria-pressed="true">Preview</button><button type="button" data-live-mode="3d" aria-pressed="false">3D</button><button type="button" data-live-mode="details" aria-pressed="false">Details</button>';
      controls.addEventListener('click', event => {
        const button = event.target.closest('[data-live-mode]');
        if (button) this.showProductionMode(button.dataset.liveMode);
      });
      dialog.append(controls);
    }
    if (this.productionPreviewId !== preview.id) {
      this.productionPreviewId = preview.id;
      this.showProductionMode('preview');
    }
  }

  async showProductionMode(mode) {
    const preview = this.component.state.renderPreview;
    const dialog = this.doc.querySelector('.library-render-dialog');
    const media = dialog?.querySelector('.library-render-media');
    if (!preview || !dialog || !media) return;
    for (const button of dialog.querySelectorAll('[data-live-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.liveMode === mode));
    }
    for (const child of media.children) {
      if (!child.matches('[data-live-preview-host]')) child.hidden = mode !== 'preview';
    }
    let host = media.querySelector('[data-live-preview-host]');
    if (!host) {
      host = element('div', { className: 'library-live-preview-host', dataset: { livePreviewHost: '' } }, this.doc);
      media.append(host);
    }
    host.hidden = mode === 'preview';
    if (mode === 'details') {
      const item = this.component.findCatalogItem(preview.id);
      const record = item?.record;
      host.innerHTML = `<div class="library-live-details"><h3>${escapeHtml(preview.id)}</h3><dl><dt>Mesh</dt><dd><code>${escapeHtml(preview.mesh)}</code></dd><dt>Record source</dt><dd>${escapeHtml(item?.source || preview.source || 'Unknown')}</dd><dt>Asset source</dt><dd data-live-asset-source>Resolving…</dd></dl><pre>${escapeHtml(JSON.stringify(record?.raw || item?.detail || {}, null, 2))}</pre></div>`;
      try {
        const asset = await this.component._libraryServices.resolver.resolve(preview.mesh);
        host.querySelector('[data-live-asset-source]').textContent = asset.sourceLabel || asset.source;
      } catch {
        host.querySelector('[data-live-asset-source]').textContent = 'Missing';
      }
    } else if (mode === '3d') {
      host.innerHTML = '<div data-live-status class="library-viewer-status"></div>';
      const status = host.querySelector('[data-live-status]');
      try {
        const viewer = await this.ensureViewer(host, status);
        const result = await viewer.load(preview.mesh);
        status.textContent = `${preview.mesh} · drag to rotate · wheel to zoom`;
        const item = this.component.findCatalogItem(preview.id);
        if (item?.imported && item.record) await this.cacheThumbnail(item.record, result);
      } catch (error) {
        status.textContent = error.message;
        status.dataset.error = 'true';
      }
    }
  }

  renderCells() {
    const panel = this.dialog.querySelector('[data-workspace-panel="cells"]');
    const cells = this.resolved?.cells || [];
    if (!cells.length) {
      panel.innerHTML = '<p class="library-workspace-empty">No CELL records are present in the active plugins.</p>';
      return;
    }
    const recordsById = new Map((this.resolved?.records || []).map(record => [record.id.toLowerCase(), record]));
    const findBaseRecord = id => recordsById.get(String(id || '').toLowerCase())
      || this.component.findCatalogItem(id)?.record;
    panel.innerHTML = `<div class="library-cell-list">${cells.map(cell => `
      <details>
        <summary><strong>${escapeHtml(cell.name || cell.id || 'Wilderness')}</strong><span>${cell.interior ? 'Interior' : `Exterior ${cell.grid?.join(', ') || ''}`} · ${(cell.references || []).length} references</span></summary>
        <div class="library-cell-references">${(cell.references || []).map(reference => {
          const base = findBaseRecord(reference.objectId);
          return `<div><code>${escapeHtml(reference.objectId)}</code><span>${reference.translation.map(formatCoordinate).join(', ')}</span><span>${reference.rotation.map(formatCoordinate).join(', ')}</span><span>×${formatCoordinate(reference.scale)}</span><span>${base ? `<button type="button" data-base-id="${encodeURIComponent(base.id)}">${escapeHtml(base.name || base.type)}</button>` : 'Unresolved base object'}</span></div>`;
        }).join('') || '<p>No placed references</p>'}</div>
      </details>`).join('')}</div>`;
    panel.querySelector('.library-cell-list').addEventListener('click', event => {
      const button = event.target.closest('[data-base-id]');
      if (!button) return;
      const record = findBaseRecord(decodeURIComponent(button.dataset.baseId));
      if (record) {
        this.selectTab('records');
        this.selectRecord(record);
      }
    });
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
    for (const plugin of this.plugins) this.component._librarySourceEnabled?.delete(plugin.id);
    this.plugins = [];
    this.selectedRecord = null;
    this.applyLoadOrder();
    await this.persistWorkspaceSettings();
    this.render();
    this.status('Imported plugin records cleared; built-in catalogues are unchanged.');
  }

  async clearThumbnails() {
    await this.thumbnailCache.clear();
    this.component.setImportedRecords(this.resolved?.records || []);
    this.status('Generated thumbnail cache cleared.');
  }

  async clearAllCache() {
    await this.database.clearAll();
    for (const plugin of this.plugins) this.component._librarySourceEnabled?.delete(plugin.id);
    this.plugins = [];
    this.selectedRecord = null;
    this.thumbnailCache.revokeUrls();
    this.applyLoadOrder();
    this.render();
    this.status('All local Library cache data cleared; built-in static data is unchanged.');
  }

  dispose() {
    this.viewer?.dispose();
    this.worker.terminate();
    this.thumbnailCache.revokeUrls();
    this.database.close();
    this.dialog?.remove();
    this.button?.remove();
  }
}

function workspaceMarkup() {
  return `<section class="library-workspace-dialog" role="dialog" aria-modal="true" aria-label="Local TES3 workspace">
    <header><div><span class="library-workspace-kicker">Browser-only asset explorer</span><h2>Local TES3 workspace</h2></div><button type="button" data-workspace-close aria-label="Close">×</button></header>
    <div class="library-workspace-actions">
      <button type="button" data-open-plugin class="library-workspace-primary">Open Plugin</button>
      <input data-plugin-input type="file" accept=".esp,.esm" multiple hidden>
      <button type="button" data-add-files>Add loose files</button>
      <input data-files-input type="file" accept=".nif,.dds,.tga,.png,.jpg,.jpeg" multiple hidden>
      <button type="button" data-add-directory>Add Data Files folder</button>
      <input data-directory-input type="file" webkitdirectory multiple hidden>
      <button type="button" data-add-bsa>Add BSA</button>
      <input data-bsa-input type="file" accept=".bsa" multiple hidden>
      <button type="button" data-run-diagnostics disabled>Scan dependencies</button>
      <details class="library-cache-actions"><summary>Cache</summary><div><button type="button" data-clear-plugins>Clear imported plugins</button><button type="button" data-clear-thumbnails>Clear thumbnails</button><button type="button" data-clear-all>Clear all cache</button></div></details>
      <span data-workspace-status role="status">Files stay on this device.</span>
    </div>
    <nav data-workspace-tablist role="tablist" class="library-workspace-tabs">
      <button type="button" role="tab" data-workspace-tab="records" aria-selected="true">Records</button>
      <button type="button" role="tab" data-workspace-tab="cells" aria-selected="false">Cells</button>
      <button type="button" role="tab" data-workspace-tab="diagnostics" aria-selected="false">Diagnostics</button>
    </nav>
    <div class="library-workspace-grid">
      <aside><h3>Catalog sources and load order</h3><ul data-source-list class="library-source-list"></ul><h3 class="library-asset-source-heading">Asset resolver priority</h3><ul data-asset-source-list class="library-source-list"></ul></aside>
      <section data-workspace-panel="records" class="library-record-browser"><div><p data-record-count>0 winning records</p><div data-record-list class="library-imported-records"></div></div><article data-record-detail class="library-record-detail"></article></section>
      <section data-workspace-panel="cells" hidden><p class="library-workspace-empty">Cell data appears here after a plugin containing CELL records is opened.</p></section>
      <section data-workspace-panel="diagnostics" hidden><p class="library-workspace-empty">Add asset sources, then scan records to trace record → NIF → texture resolution.</p></section>
    </div>
  </section>`;
}

function sourceName(record) {
  return record.metadata?.plugin?.filename || record.metadata?.loadOrder?.winningPlugin || record.source;
}

function slug(value) {
  return String(value || 'source').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function formatCoordinate(value) {
  return Number(value || 0).toFixed(2).replace(/\.00$/, '');
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
