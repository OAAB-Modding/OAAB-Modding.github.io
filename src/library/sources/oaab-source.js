import { AssetNotFoundError, AssetSource, mimeTypeForAsset } from './asset-source.js';
import { encodeAssetPath, normalizeAssetPath } from '../resolver/path-utils.js';

export const OAAB_DATA_REVISION = 'master';
export const OAAB_DATA_CDN_ROOT =
  `https://cdn.jsdelivr.net/gh/OAAB-Modding/Data@${OAAB_DATA_REVISION}/00%20Core/`;
export const OAAB_DATA_RAW_ROOT =
  `https://raw.githubusercontent.com/OAAB-Modding/Data/${OAAB_DATA_REVISION}/00%20Core/`;
export const OAAB_ASSET_MANIFEST_URLS = [
  '/assets/data/library/oaab-assets.json',
  'https://raw.githubusercontent.com/OAAB-Modding/OAAB-Modding.github.io/main/assets/data/library/oaab-assets.json',
];

/** Public, read-only view of OAAB_Data's installable `00 Core` directory. */
export class OAABSource extends AssetSource {
  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    baseUrls = [OAAB_DATA_CDN_ROOT, OAAB_DATA_RAW_ROOT],
    manifestUrls = OAAB_ASSET_MANIFEST_URLS,
  } = {}) {
    super({ id: 'oaab-data', label: 'OAAB_Data' });
    if (!fetchImpl) throw new TypeError('OAABSource requires fetch()');
    this.fetchImpl = fetchImpl;
    this.baseUrls = baseUrls.map((url) => String(url).replace(/\/?$/, '/'));
    this.manifestUrls = manifestUrls;
    this.caseMapPromise = null;
  }

  urls(path, { preserveCase = false } = {}) {
    const value = preserveCase ? String(path) : normalizeAssetPath(path);
    const relative = encodeAssetPath(value);
    return this.baseUrls.map((baseUrl) => baseUrl + relative);
  }

  async stat(path) {
    const normalized = normalizeAssetPath(path);
    let lastError;
    for (const url of await this.#candidateUrls(normalized)) {
      try {
        const response = await this.fetchImpl(url, { method: 'HEAD', mode: 'cors' });
        if (response.ok) {
          return {
            path: normalized,
            source: this.id,
            url,
            size: Number(response.headers.get('content-length')) || null,
            mimeType: response.headers.get('content-type') || mimeTypeForAsset(normalized),
          };
        }
        if (response.status !== 404) lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    throw new AssetNotFoundError(normalized, this.id, lastError);
  }

  async get(path) {
    const normalized = normalizeAssetPath(path);
    let lastError;
    for (const url of await this.#candidateUrls(normalized)) {
      try {
        const response = await this.fetchImpl(url, { mode: 'cors' });
        if (!response.ok) {
          if (response.status !== 404) lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        const bytes = await response.arrayBuffer();
        return {
          path: normalized,
          bytes,
          source: this.id,
          sourceLabel: this.label,
          url,
          mimeType: response.headers.get('content-type') || mimeTypeForAsset(normalized),
          size: bytes.byteLength,
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw new AssetNotFoundError(normalized, this.id, lastError);
  }

  async #candidateUrls(normalized) {
    const urls = this.urls(normalized);
    const caseMap = await this.#caseMap();
    const repositoryPath = caseMap[normalized];
    if (repositoryPath && repositoryPath !== normalized) {
      urls.unshift(...this.urls(repositoryPath, { preserveCase: true }));
    }
    return [...new Set(urls)];
  }

  async #caseMap() {
    if (!this.caseMapPromise) {
      this.caseMapPromise = (async () => {
        for (const url of this.manifestUrls) {
          try {
            const response = await this.fetchImpl(url, { mode: 'cors' });
            if (!response.ok) continue;
            const manifest = await response.json();
            if (manifest && typeof manifest.caseMap === 'object') return manifest.caseMap;
          } catch {}
        }
        return {};
      })();
    }
    return this.caseMapPromise;
  }
}
