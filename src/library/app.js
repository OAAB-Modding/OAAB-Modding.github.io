import { Catalog } from './catalog/catalog.js';
import { OAABCatalog } from './catalog/oaab-catalog.js';
import { VanillaCatalog } from './catalog/vanilla-catalog.js';
import { createLibraryComponent } from './component.js';
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
  const providers = Object.freeze({
    oaab: new OAABCatalog({ fetchData }),
    vanilla: new VanillaCatalog({ fetchData }),
  });
  const catalog = new Catalog()
    .addProvider(providers.oaab, 100)
    .addProvider(providers.vanilla, 10);

  return {
    state: createLibraryState(),
    resolver,
    catalog,
    providers,
  };
}

// The declarative runtime evaluates a classic-script component body. Keep its
// inline class to a compatibility shim and expose the module-backed component
// factory and shared utilities through one frozen bridge.
if (typeof window !== 'undefined') {
  window.OAAB_LIBRARY = Object.freeze({
    createLibraryComponent,
    createLibraryServices,
    fetchLibraryData,
    meshKey,
    normalizeAssetPath,
  });
}

export { AssetResolver, createLibraryComponent, OAABSource, meshKey, normalizeAssetPath };
