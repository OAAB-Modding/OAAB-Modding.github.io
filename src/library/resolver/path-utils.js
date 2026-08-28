const ASSET_ROOTS = new Set(['meshes', 'textures', 'icons']);

const EXTENSION_ROOTS = new Map([
  ['.nif', 'meshes'],
  ['.dds', 'textures'],
  ['.tga', 'textures'],
  ['.bmp', 'textures'],
  ['.png', 'textures'],
  ['.jpg', 'textures'],
  ['.jpeg', 'textures'],
]);

export class InvalidAssetPathError extends Error {
  constructor(path, reason) {
    super(`Invalid asset path "${String(path ?? '')}": ${reason}`);
    this.name = 'InvalidAssetPathError';
    this.path = path;
  }
}

/**
 * Convert a TES3 asset reference into a case-insensitive virtual path.
 *
 * The result always uses lower-case forward slashes and starts with one of the
 * supported Data Files roots. Bare references infer their root by extension,
 * so both `OAAB\\foo.nif` and `Meshes\\OAAB\\foo.nif` become
 * `meshes/oaab/foo.nif`.
 */
export function normalizeAssetPath(input, { root } = {}) {
  if (input == null) throw new InvalidAssetPathError(input, 'path is required');

  let value = String(input)
    .replace(/\0/g, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .toLowerCase();

  if (!value) throw new InvalidAssetPathError(input, 'path is empty');
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    throw new InvalidAssetPathError(input, 'URLs are not asset paths');
  }

  value = value.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  value = value.replace(/^(?:data files\/)+/, '');
  if (value.split('/').includes('..')) {
    throw new InvalidAssetPathError(input, 'parent traversal is not allowed');
  }

  // Repository and installer paths can contain arbitrary folders before the
  // actual Data Files root. Preserve only the final recognized root.
  const markers = [...ASSET_ROOTS].map((name) => ({
    name,
    index: value.lastIndexOf(`/${name}/`),
  }));
  const marker = markers.reduce((best, entry) => (
    entry.index > best.index ? entry : best
  ), { name: '', index: -1 });

  if (marker.index >= 0) {
    value = value.slice(marker.index + 1);
  }

  const first = value.split('/', 1)[0];
  let inferredRoot = root ? String(root).toLowerCase() : '';
  if (inferredRoot && !ASSET_ROOTS.has(inferredRoot)) {
    throw new InvalidAssetPathError(input, `unsupported asset root "${inferredRoot}"`);
  }

  if (!ASSET_ROOTS.has(first)) {
    if (!inferredRoot) {
      const dot = value.lastIndexOf('.');
      const extension = dot >= 0 ? value.slice(dot) : '';
      inferredRoot = EXTENSION_ROOTS.get(extension) || '';
    }
    if (!inferredRoot) {
      throw new InvalidAssetPathError(input, 'asset root cannot be inferred');
    }
    value = `${inferredRoot}/${value}`;
  }

  const segments = [];
  for (const segment of value.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new InvalidAssetPathError(input, 'parent traversal is not allowed');
    }
    segments.push(segment);
  }

  if (segments.length < 2 || !ASSET_ROOTS.has(segments[0])) {
    throw new InvalidAssetPathError(input, 'asset path has no filename');
  }

  return segments.join('/');
}

export function assetPathToUrl(path) {
  return encodeAssetPath(normalizeAssetPath(path));
}

export function encodeAssetPath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function meshKey(path) {
  try {
    const normalized = normalizeAssetPath(path, { root: 'meshes' });
    return normalized.startsWith('meshes/') ? normalized.slice('meshes/'.length) : null;
  } catch {
    return null;
  }
}

export function assetRoot(path) {
  return normalizeAssetPath(path).split('/', 1)[0];
}
