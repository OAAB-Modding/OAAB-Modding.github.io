import { normalizeAssetPath } from '../resolver/path-utils.js';

function optionalAssetPath(value, root) {
  if (!value) return null;
  try {
    return normalizeAssetPath(value, { root });
  } catch {
    return String(value);
  }
}

/** Create the source-neutral record shape used by future Library providers. */
export function createRecord(raw, { source, metadata = {} } = {}) {
  if (!raw || typeof raw !== 'object') throw new TypeError('A raw TES3 record is required');
  return {
    id: String(raw.id || ''),
    type: String(raw.type || ''),
    name: String(raw.name || ''),
    mesh: optionalAssetPath(raw.mesh, 'meshes'),
    icon: optionalAssetPath(raw.icon, 'icons'),
    source: String(source || raw.source || 'unknown'),
    raw,
    metadata,
  };
}

export function recordKey(record) {
  return `${String(record?.type || '').toLowerCase()}:${String(record?.id || '').toLowerCase()}`;
}
