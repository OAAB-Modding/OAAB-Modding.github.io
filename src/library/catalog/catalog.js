import { recordKey } from '../records/record-utils.js';

export class Catalog {
  #providers = [];

  addProvider(provider, priority = 0) {
    if (!provider || typeof provider.load !== 'function') {
      throw new TypeError('Catalog providers must implement load()');
    }
    this.#providers.push({ provider, priority: Number(priority) || 0 });
    this.#providers.sort((a, b) => b.priority - a.priority);
    return this;
  }

  async load() {
    const merged = new Map();
    for (const { provider } of this.#providers) {
      const records = await provider.load();
      for (const record of records) {
        const key = recordKey(record);
        if (!merged.has(key)) merged.set(key, record);
      }
    }
    return [...merged.values()];
  }
}
