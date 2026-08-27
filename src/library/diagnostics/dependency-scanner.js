import { normalizeAssetPath } from '../resolver/path-utils.js';

export async function scanDependencies(records, { resolver, parseNif, concurrency = 4, onProgress = () => {} }) {
  if (!resolver || !parseNif) throw new TypeError('Dependency scan requires resolver and parseNif');
  const meshRows = new Map();
  const trees = [];
  for (const record of records || []) {
    if (!record.mesh) continue;
    let mesh;
    try { mesh = normalizeAssetPath(record.mesh, { root: 'meshes' }); }
    catch (error) {
      trees.push({ record, mesh: record.mesh, status: 'missing', error: error.message, textures: [] });
      continue;
    }
    if (!meshRows.has(mesh)) meshRows.set(mesh, []);
    meshRows.get(mesh).push(record);
  }

  let completed = 0;
  const scanned = await mapLimit([...meshRows], concurrency, async ([mesh, owners]) => {
    const result = { mesh, owners, status: 'missing', source: null, textures: [] };
    try {
      const asset = await resolver.resolve(mesh);
      result.status = 'resolved';
      result.source = asset.source;
      result.sourceLabel = asset.sourceLabel;
      const packet = await parseNif(asset.bytes);
      for (const rawTexture of packet.textures || []) {
        let path;
        try { path = normalizeAssetPath(rawTexture, { root: 'textures' }); }
        catch (error) {
          result.textures.push({ path: rawTexture, status: 'missing', error: error.message });
          continue;
        }
        try {
          const texture = await resolver.resolve(path);
          result.textures.push({ path, status: 'resolved', source: texture.source, sourceLabel: texture.sourceLabel });
        } catch (error) {
          result.textures.push({ path, status: 'missing', error: error.message });
        }
      }
      result.packetStats = packet.stats;
    } catch (error) {
      result.error = error.message;
    }
    completed += 1;
    onProgress({ completed, total: meshRows.size, mesh });
    return result;
  });

  for (const mesh of scanned) {
    for (const record of mesh.owners) trees.push({ record, ...mesh, owners: undefined });
  }
  const textures = scanned.flatMap((entry) => entry.textures);
  const uniqueTextures = new Map();
  for (const texture of textures) {
    const key = texture.path || `invalid:${texture.error || ''}`;
    if (!uniqueTextures.has(key) || uniqueTextures.get(key).status !== 'resolved') uniqueTextures.set(key, texture);
  }
  return {
    counts: {
      records: (records || []).length,
      meshRecords: [...meshRows.values()].reduce((sum, owners) => sum + owners.length, 0),
      uniqueNifs: meshRows.size,
      resolvedNifs: scanned.filter((entry) => entry.status === 'resolved').length,
      missingNifs: scanned.filter((entry) => entry.status === 'missing').length,
      resolvedTextures: [...uniqueTextures.values()].filter((entry) => entry.status === 'resolved').length,
      missingTextures: [...uniqueTextures.values()].filter((entry) => entry.status === 'missing').length,
    },
    assets: scanned,
    trees,
  };
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function work() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, work));
  return results;
}
