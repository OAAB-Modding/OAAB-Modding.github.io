import { normalizeAssetPath } from './path-utils.js';
import { AssetNotFoundError } from '../sources/asset-source.js';

export class AssetResolutionError extends Error {
  constructor(path, attempts) {
    super(`Unable to resolve asset: ${path}`);
    this.name = 'AssetResolutionError';
    this.path = path;
    this.attempts = attempts;
  }
}

export class AssetResolver {
  #sources = [];
  #sequence = 0;

  addSource(source, priority = 0) {
    if (!source || typeof source.get !== 'function') {
      throw new TypeError('AssetResolver sources must implement get(path)');
    }
    this.removeSource(source.id);
    this.#sources.push({ source, priority: Number(priority) || 0, sequence: this.#sequence++ });
    this.#sources.sort((a, b) => (b.priority - a.priority) || (a.sequence - b.sequence));
    return this;
  }

  removeSource(sourceOrId) {
    const id = typeof sourceOrId === 'string' ? sourceOrId : sourceOrId?.id;
    this.#sources = this.#sources.filter((entry) => entry.source !== sourceOrId && entry.source.id !== id);
    return this;
  }

  get sources() {
    return this.#sources.map(({ source, priority }) => ({ source, priority }));
  }

  async resolve(path) {
    const normalized = normalizeAssetPath(path);
    const attempts = [];
    const candidates = resolutionCandidates(normalized);

    for (const { source, priority } of this.#sources) {
      for (const candidate of candidates) {
        try {
          const asset = await source.get(candidate);
          if (!asset) throw new AssetNotFoundError(candidate, source.id);
          return {
            ...asset,
            path: candidate,
            requestedPath: normalized,
            source: asset.source || source.id,
            sourceLabel: asset.sourceLabel || source.label || source.id,
            priority,
          };
        } catch (error) {
          attempts.push({ source: source.id, path: candidate, error });
        }
      }
    }

    throw new AssetResolutionError(normalized, attempts);
  }

  async has(path) {
    try {
      await this.resolve(path);
      return true;
    } catch (error) {
      if (error instanceof AssetResolutionError) return false;
      throw error;
    }
  }
}

// Morrowind assets frequently keep the authoring-time .tga reference in the
// NIF while distributing the optimized replacement as .dds. Resolve that
// replacement inside each source so normal source/load-order priority still
// wins before falling through to a lower-priority source.
function resolutionCandidates(path) {
  const candidates = [path];
  if (path.startsWith('textures/') && path.endsWith('.tga')) {
    candidates.push(`${path.slice(0, -4)}.dds`);
  }
  return candidates;
}
