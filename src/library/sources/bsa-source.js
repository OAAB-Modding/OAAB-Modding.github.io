import { AssetNotFoundError, AssetSource, mimeTypeForAsset } from './asset-source.js';
import { normalizeAssetPath } from '../resolver/path-utils.js';

const HEADER_SIZE = 12;
const TES3_BSA_VERSION = 0x100;

export class BsaSource extends AssetSource {
  constructor({ file, id, label } = {}) {
    if (!file?.slice) throw new TypeError('BsaSource requires a File or Blob');
    const filename = file.name || 'archive.bsa';
    super({ id: id || `bsa:${filename.toLowerCase()}`, label: label || filename });
    this.file = file;
    this.entries = new Map();
    this.indexed = false;
  }

  async index() {
    const header = await this.file.slice(0, HEADER_SIZE).arrayBuffer();
    if (header.byteLength < HEADER_SIZE) throw new Error('BSA is smaller than its header');
    const view = new DataView(header);
    if (view.getUint32(0, true) !== TES3_BSA_VERSION) throw new Error('Unsupported BSA version');
    const hashOffset = view.getUint32(4, true);
    const count = view.getUint32(8, true);
    if (!count) throw new Error('BSA contains no files');
    const hasNames = hashOffset !== 8 * count;
    if (hasNames && hashOffset < 12 * count) throw new Error('Invalid BSA hash table offset');
    if (!hasNames) throw new Error('Name-less BSAs cannot provide path-based asset resolution');

    const hashesStart = HEADER_SIZE + hashOffset;
    const dataStart = hashesStart + 8 * count;
    if (dataStart > this.file.size) throw new Error('BSA index extends past the file');
    const indexBytes = await this.file.slice(HEADER_SIZE, hashesStart).arrayBuffer();
    const index = new DataView(indexBytes);
    const nameOffsetsStart = 8 * count;
    const namesStart = 12 * count;
    const namesEnd = hashOffset;
    const decoder = new TextDecoder('windows-1252');
    const raw = new Uint8Array(indexBytes);

    for (let i = 0; i < count; i += 1) {
      const size = index.getUint32(i * 8, true);
      const relativeOffset = index.getUint32(i * 8 + 4, true);
      const nameOffset = index.getUint32(nameOffsetsStart + i * 4, true);
      const start = namesStart + nameOffset;
      if (start < namesStart || start >= namesEnd) throw new Error('BSA filename offset is outside its table');
      let end = start;
      while (end < namesEnd && raw[end] !== 0) end += 1;
      if (end === namesEnd) throw new Error('BSA filename is not null terminated');
      const storedName = decoder.decode(raw.subarray(start, end));
      let path;
      try { path = normalizeAssetPath(storedName); } catch { continue; }
      const offset = dataStart + relativeOffset;
      if (offset + size > this.file.size) throw new Error(`BSA entry extends past archive: ${storedName}`);
      if (!this.entries.has(path)) this.entries.set(path, { path, offset, size, storedName });
    }
    this.indexed = true;
    return this;
  }

  async stat(path) {
    if (!this.indexed) await this.index();
    const normalized = normalizeAssetPath(path);
    const entry = this.entries.get(normalized);
    if (!entry) throw new AssetNotFoundError(normalized, this.id);
    return {
      path: normalized,
      source: this.id,
      sourceLabel: this.label,
      size: entry.size,
      offset: entry.offset,
      lastModified: this.file.lastModified || null,
      mimeType: mimeTypeForAsset(normalized),
    };
  }

  async get(path) {
    const stat = await this.stat(path);
    const bytes = await this.file.slice(stat.offset, stat.offset + stat.size).arrayBuffer();
    return { ...stat, bytes };
  }
}

export const BSA_PRIORITIES = Object.freeze({
  loose: 600,
  pluginFolder: 500,
  oaab: 400,
  tribunal: 300,
  bloodmoon: 200,
  morrowind: 100,
});
