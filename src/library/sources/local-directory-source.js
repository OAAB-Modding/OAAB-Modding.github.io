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

  async indexDirectory(handle = this.directoryHandle) {
    if (!handle) throw new TypeError('A directory handle is required');
    this.directoryHandle = handle;
    await this.#walk(handle, '');
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

  async #walk(handle, prefix) {
    for await (const [name, entry] of handle.entries()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      if (entry.kind === 'directory') await this.#walk(entry, relative);
      else {
        try {
          const path = normalizeAssetPath(relative);
          this.entries.set(path, { handle: entry, relative });
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
