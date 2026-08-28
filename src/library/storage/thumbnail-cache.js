import { normalizeAssetPath } from '../resolver/path-utils.js';

export const NIF_RENDERER_VERSION = '4';

export class ThumbnailCache {
  constructor(database) {
    this.database = database;
    this.urls = new Set();
  }

  async get(identity) {
    const key = thumbnailCacheKey(identity);
    const entry = await this.database.get('thumbnails', key);
    if (!entry?.blob) return null;
    return { ...entry, url: this.#url(entry.blob) };
  }

  urlFor(entry) {
    return entry?.blob ? this.#url(entry.blob) : null;
  }

  async put(identity, blob, metadata = {}) {
    const key = thumbnailCacheKey(identity);
    const entry = {
      key,
      path: normalizeAssetPath(identity.path, { root: 'meshes' }),
      sourceFingerprint: identity.sourceFingerprint,
      assetVersion: identity.assetVersion,
      rendererVersion: identity.rendererVersion || NIF_RENDERER_VERSION,
      blob,
      createdAt: Date.now(),
      ...metadata,
    };
    await this.database.put('thumbnails', entry);
    return { ...entry, url: this.#url(blob) };
  }

  async clear() {
    await this.database.clearThumbnails();
    this.revokeUrls();
  }

  revokeUrls() {
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  #url(blob) {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return url;
  }
}

export function thumbnailCacheKey({ sourceFingerprint, path, assetVersion, rendererVersion = NIF_RENDERER_VERSION }) {
  if (!sourceFingerprint || !assetVersion) throw new TypeError('Thumbnail identity requires source and asset fingerprints');
  const normalized = normalizeAssetPath(path, { root: 'meshes' });
  return `thumbnail:v3:${rendererVersion}:${encodeURIComponent(sourceFingerprint)}:${encodeURIComponent(normalized)}:${assetVersion}`;
}

export async function fingerprintBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (globalThis.crypto?.subtle) {
    const standalone = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    const digest = await crypto.subtle.digest('SHA-256', standalone);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const value of view) hash = Math.imul(hash ^ value, 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
