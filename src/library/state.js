export function readStoredBoolean(key, fallback = false, storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(key);
    return value == null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

export function readStoredScale(storage = globalThis.localStorage, fallback = 1) {
  try {
    const value = Number.parseFloat(storage?.getItem('oaab_scale'));
    return value >= 0.5 && value <= 3 ? value : fallback;
  } catch {
    return fallback;
  }
}

// Catalog sources are kept as a small JSON list so the toolbar control can
// preserve the user's choice without coupling the production component to the
// workspace's IndexedDB lifecycle. A missing value is distinct from an empty
// list: an empty list is a valid choice that means "show no sources".
export function readStoredCatalogSources(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem('oaab_catalog_sources');
    if (value == null) return null;
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    return [...new Set(parsed
      .filter(source => typeof source === 'string')
      .map(source => source.trim())
      .filter(Boolean))];
  } catch {
    return null;
  }
}

export function writeStoredCatalogSources(sources, storage = globalThis.localStorage) {
  try {
    const values = [...new Set(Array.from(sources || [])
      .filter(source => typeof source === 'string')
      .map(source => source.trim())
      .filter(Boolean))];
    storage?.setItem('oaab_catalog_sources', JSON.stringify(values));
  } catch {}
}

export function createProductionLibraryState({
  storage = globalThis.localStorage,
  windowObject = globalThis.window,
} = {}) {
  const storedCatalogSources = readStoredCatalogSources(storage);
  const legacyVanilla = readStoredBoolean('oaab_vanilla', false, storage);
  const catalogSources = storedCatalogSources || (legacyVanilla
    ? ['oaab-data', 'vanilla']
    : ['oaab-data']);
  return {
    data: null,
    active: 'All',
    tags: [],
    query: '',
    tagOpen: false,
    typeOpen: false,
    tileset: '',
    tilesetSubset: 'all',
    tilesetPiece: '',
    searchMode: '',
    searchModeOpen: false,
    searchSuggestOpen: false,
    catalogSourceOpen: false,
    catalogSources,
    relData: [],
    releases: [],
    relKinds: ['added', 'modified'],
    relOpen: false,
    filtersOpen: false,
    filterHistory: [],
    filterHistoryIndex: -1,
    filterHistoryCoalesce: '',
    gridWidth: 0,
    virtualStartRow: 0,
    virtualEndRow: 8,
    compactActionsId: null,
    detailView: readStoredBoolean('oaab_detail_view', false, storage),
    detailFilters: {},
    detailSort: null,
    compact: readStoredBoolean('oaab_compact_v2', false, storage),
    // Kept as a compatibility field for filter history and tileset behavior.
    // The Catalog Source control is authoritative for the visible source set.
    vanilla: catalogSources.includes('vanilla'),
    scale: readStoredScale(storage),
    theme: windowObject?.OAAB_THEME ? windowObject.OAAB_THEME.read() : 'dark',
    narrow: windowObject?.matchMedia
      ? windowObject.matchMedia('(max-width: 820px)').matches
      : false,
    renderPreview: null,
    renderPreviewLoaded: false,
    renderPreviewMode: 'preview',
    assetSourceRevision: 0,
    aot: false,
    enchantmentPreview: null,
    contentsPreview: null,
    bookPreview: null,
  };
}

export function createLibraryState() {
  return {
    records: [],
    sources: new Map(),
    sourceFilters: new Set(['oaab-data']),
    importedFiles: [],
    diagnostics: null,
  };
}
