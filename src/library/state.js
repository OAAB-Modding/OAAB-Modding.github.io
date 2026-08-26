export function readStoredBoolean(key, fallback = false) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value === '1';
  } catch {
    return fallback;
  }
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
