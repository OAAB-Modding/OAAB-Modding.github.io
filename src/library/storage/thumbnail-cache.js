import { normalizeAssetPath } from '../resolver/path-utils.js';

// Bump this whenever the rendered result changes. The cache key then leaves
// older captures in IndexedDB without ever displaying them as current.
export const NIF_RENDERER_VERSION = '5';
export const THUMBNAIL_VARIANT_GRID = 'grid';
export const THUMBNAIL_VARIANT_PREVIEW = 'preview';

export class ThumbnailCache {
  constructor(database) {
    this.database = database;
    this.urls = new Map();
  }

  async get(identity) {
    const key = thumbnailCacheKey(identity);
    const entry = await this.database.get('thumbnails', key);
    if (!entry?.blob) return null;
    return { ...entry, url: this.#url(entry.key || key, entry.blob) };
  }

  urlFor(entry) {
    return entry?.blob ? this.#url(entry.key || '', entry.blob) : null;
  }

  async put(identity, blob, metadata = {}) {
    const key = thumbnailCacheKey(identity);
    const entry = {
      key,
      path: normalizeAssetPath(identity.path, { root: 'meshes' }),
      sourceFingerprint: identity.sourceFingerprint,
      assetVersion: identity.assetVersion,
      rendererVersion: identity.rendererVersion || NIF_RENDERER_VERSION,
      variant: identity.variant || THUMBNAIL_VARIANT_GRID,
      blob,
      createdAt: Date.now(),
      ...metadata,
    };
    await this.database.put('thumbnails', entry);
    return { ...entry, url: this.#url(key, blob) };
  }

  async clear() {
    await this.database.clearThumbnails();
    this.revokeUrls();
  }

  revokeUrls() {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }

  #url(key, blob) {
    if (key && this.urls.has(key)) return this.urls.get(key);
    const url = URL.createObjectURL(blob);
    if (key) this.urls.set(key, url);
    return url;
  }
}

export function thumbnailCacheKey({
  sourceFingerprint,
  path,
  assetVersion,
  rendererVersion = NIF_RENDERER_VERSION,
  variant = THUMBNAIL_VARIANT_GRID,
}) {
  if (!sourceFingerprint || !assetVersion) throw new TypeError('Thumbnail identity requires source and asset fingerprints');
  const normalized = normalizeAssetPath(path, { root: 'meshes' });
  return `thumbnail:v3:${rendererVersion}:${encodeURIComponent(variant)}:${encodeURIComponent(sourceFingerprint)}:${encodeURIComponent(normalized)}:${assetVersion}`;
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
