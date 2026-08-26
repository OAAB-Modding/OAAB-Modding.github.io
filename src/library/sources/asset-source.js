import { normalizeAssetPath } from '../resolver/path-utils.js';

export class AssetNotFoundError extends Error {
  constructor(path, source, cause) {
    super(`Asset not found in ${source || 'source'}: ${path}`, cause ? { cause } : undefined);
    this.name = 'AssetNotFoundError';
    this.path = path;
    this.source = source;
  }
}

export class AssetSource {
  constructor({ id, label = id } = {}) {
    if (!id) throw new TypeError('AssetSource requires an id');
    this.id = id;
    this.label = label;
  }

  normalize(path) {
    return normalizeAssetPath(path);
  }

  async has(path) {
    try {
      return !!(await this.stat(path));
    } catch (error) {
      if (error instanceof AssetNotFoundError) return false;
      throw error;
    }
  }

  async get(_path) {
    throw new Error(`${this.constructor.name}.get() is not implemented`);
  }

  async stat(_path) {
    throw new Error(`${this.constructor.name}.stat() is not implemented`);
  }
}

export function mimeTypeForAsset(path) {
  const extension = String(path).toLowerCase().split('.').pop();
  return ({
    nif: 'application/octet-stream',
    dds: 'image/vnd-ms.dds',
    tga: 'image/x-tga',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  })[extension] || 'application/octet-stream';
}
