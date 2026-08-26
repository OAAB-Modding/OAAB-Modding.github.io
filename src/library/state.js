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

export function createProductionLibraryState({
  storage = globalThis.localStorage,
  windowObject = globalThis.window,
} = {}) {
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
    vanilla: readStoredBoolean('oaab_vanilla', false, storage),
    scale: readStoredScale(storage),
    theme: windowObject?.OAAB_THEME ? windowObject.OAAB_THEME.read() : 'dark',
    narrow: windowObject?.matchMedia
      ? windowObject.matchMedia('(max-width: 820px)').matches
      : false,
    renderPreview: null,
    renderPreviewLoaded: false,
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
