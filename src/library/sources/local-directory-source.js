import { AssetNotFoundError, AssetSource, mimeTypeForAsset } from './asset-source.js';
import { normalizeAssetPath } from '../resolver/path-utils.js';

export class LocalDirectorySource extends AssetSource {
  constructor({ id = 'local-loose-files', label = 'Local loose files', files, directoryHandle } = {}) {
    super({ id, label });
    this.entries = new Map();
    this.directoryHandle = directoryHandle || null;
    if (files) this.addFiles(files);
  }

  addFiles(files) {
    for (const file of Array.from(files || [])) {
      const relative = file.webkitRelativePath || file.relativePath || file.name;
      try {
        const path = normalizeAssetPath(relative);
        this.entries.set(path, { file, relative });
      } catch {}
    }
    return this;
  }

  // Index selected files in small batches so the caller can update a visible
  // progress indicator and the browser can paint between batches. File bytes
  // are still not read here; only the File reference and normalized path are
  // retained for later resolver requests.
  async addFilesWithProgress(files, { onProgress, batchSize = 250 } = {}) {
    const selected = Array.from(files || []);
    const size = Math.max(1, Number(batchSize) || 250);
    if (onProgress) await onProgress({ completed: 0, total: selected.length });
    if (selected.length) await yieldToBrowser();
    for (let start = 0; start < selected.length; start += size) {
      this.addFiles(selected.slice(start, start + size));
      const completed = Math.min(start + size, selected.length);
      if (onProgress) await onProgress({ completed, total: selected.length });
      if (completed < selected.length) await yieldToBrowser();
    }
    return this;
  }

  async indexDirectory(handle = this.directoryHandle, { onProgress } = {}) {
    if (!handle) throw new TypeError('A directory handle is required');
    this.directoryHandle = handle;
    await this.#walk(handle, '', onProgress, { completed: 0 });
    return this;
  }

  async stat(path) {
    const normalized = normalizeAssetPath(path);
    const entry = this.entries.get(normalized);
    if (!entry) throw new AssetNotFoundError(normalized, this.id);
    const file = await entryFile(entry);
    return {
      path: normalized,
      source: this.id,
      sourceLabel: this.label,
      size: file.size,
      lastModified: file.lastModified || null,
      mimeType: file.type || mimeTypeForAsset(normalized),
    };
  }

  async get(path) {
    const normalized = normalizeAssetPath(path);
    const entry = this.entries.get(normalized);
    if (!entry) throw new AssetNotFoundError(normalized, this.id);
    const file = await entryFile(entry);
    const bytes = await file.arrayBuffer();
    return {
      ...(await this.stat(normalized)),
      bytes,
      size: bytes.byteLength,
      file,
    };
  }

  async #walk(handle, prefix, onProgress, progress) {
    for await (const [name, entry] of handle.entries()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') await this.#walk(entry, relative, onProgress, progress);
      else {
        try {
          const path = normalizeAssetPath(relative);
          this.entries.set(path, { handle: entry, relative });
          progress.completed += 1;
          if (onProgress) await onProgress({ completed: progress.completed, total: 0 });
          if (progress.completed % 250 === 0) await yieldToBrowser();
        } catch {}
      }
    }
  }
}

async function entryFile(entry) {
  if (entry.file) return entry.file;
  if (entry.handle?.getFile) return entry.handle.getFile();
  throw new Error('Local asset entry is no longer readable');
}

function yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}
