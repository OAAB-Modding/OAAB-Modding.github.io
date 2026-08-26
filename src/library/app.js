import { Catalog } from './catalog/catalog.js';
import { OAABCatalog } from './catalog/oaab-catalog.js';
import { VanillaCatalog } from './catalog/vanilla-catalog.js';
import { AssetResolver } from './resolver/asset-resolver.js';
import { meshKey, normalizeAssetPath } from './resolver/path-utils.js';
import { OAABSource } from './sources/oaab-source.js';
import { createLibraryState } from './state.js';

const DATA_LOCAL = '/assets/data/library/';
const DATA_RAW = 'https://raw.githubusercontent.com/OAAB-Modding/OAAB-Modding.github.io/main/assets/data/library/';

export function fetchLibraryData(file, fetchImpl = globalThis.fetch.bind(globalThis)) {
  return fetchImpl(DATA_LOCAL + file)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    })
    .catch(() => fetchImpl(DATA_RAW + file));
}

export function createLibraryServices({ fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
  const resolver = new AssetResolver();
  resolver.addSource(new OAABSource({ fetchImpl }), 100);

  const fetchData = (file) => fetchLibraryData(file, fetchImpl);
  const catalog = new Catalog()
    .addProvider(new OAABCatalog({ fetchData }), 100)
    .addProvider(new VanillaCatalog({ fetchData }), 10);

  return {
    state: createLibraryState(),
    resolver,
    catalog,
  };
}

// The production Library's declarative runtime cannot import ES modules from
// inside its component body. This narrow bridge lets it consume the shared
// path/data utilities while the remainder of that page is migrated gradually.
if (typeof window !== 'undefined') {
  window.OAAB_LIBRARY = Object.freeze({
    fetchLibraryData,
    meshKey,
    normalizeAssetPath,
  });
}

export { AssetResolver, OAABSource, meshKey, normalizeAssetPath };
