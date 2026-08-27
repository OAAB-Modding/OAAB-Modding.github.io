export const LIBRARY_DB_NAME = 'oaab-library';
export const LIBRARY_DB_VERSION = 1;
export const LIBRARY_STORES = Object.freeze([
  'plugins',
  'plugin-records',
  'asset-metadata',
  'thumbnails',
  'settings',
]);

export class LibraryDatabase {
  constructor({ indexedDB = globalThis.indexedDB } = {}) {
    this.indexedDB = indexedDB;
    this.connection = null;
  }

  async open() {
    if (!this.indexedDB) throw new Error('IndexedDB is unavailable in this browser');
    if (this.connection) return this.connection;
    this.connection = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open(LIBRARY_DB_NAME, LIBRARY_DB_VERSION);
      request.onerror = () => reject(request.error || new Error('Unable to open Library cache'));
      request.onupgradeneeded = event => migrate(request.result, event.oldVersion);
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.connection = null;
        };
        resolve(database);
      };
    });
    return this.connection;
  }

  async get(store, key) {
    return this.#request(store, 'readonly', objectStore => objectStore.get(key));
  }

  async getAll(store) {
    return this.#request(store, 'readonly', objectStore => objectStore.getAll());
  }

  async put(store, value) {
    return this.#request(store, 'readwrite', objectStore => objectStore.put(value));
  }

  async delete(store, key) {
    return this.#request(store, 'readwrite', objectStore => objectStore.delete(key));
  }

  async clear(store) {
    return this.#request(store, 'readwrite', objectStore => objectStore.clear());
  }

  async clearImportedPlugins() {
    return this.#transaction(['plugins', 'plugin-records'], stores => {
      stores.plugins.clear();
      stores['plugin-records'].clear();
    });
  }

  async clearThumbnails() {
    return this.#transaction(['thumbnails', 'asset-metadata'], stores => {
      stores.thumbnails.clear();
      stores['asset-metadata'].clear();
    });
  }

  async clearAll() {
    return this.#transaction(LIBRARY_STORES, stores => {
      for (const store of Object.values(stores)) store.clear();
    });
  }

  close() {
    this.connection?.close();
    this.connection = null;
  }

  async #request(store, mode, operation) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, mode);
      const request = operation(transaction.objectStore(store));
      request.onerror = () => reject(request.error || transaction.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async #transaction(names, operation) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(names, 'readwrite');
      const stores = Object.fromEntries(names.map(name => [name, transaction.objectStore(name)]));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Library cache transaction aborted'));
      operation(stores);
    });
  }
}

function migrate(database, oldVersion) {
  if (oldVersion < 1) {
    database.createObjectStore('plugins', { keyPath: 'id' });
    database.createObjectStore('plugin-records', { keyPath: 'pluginId' });
    database.createObjectStore('asset-metadata', { keyPath: 'key' });
    const thumbnails = database.createObjectStore('thumbnails', { keyPath: 'key' });
    thumbnails.createIndex('path', 'path', { unique: false });
    database.createObjectStore('settings', { keyPath: 'key' });
  }
}
