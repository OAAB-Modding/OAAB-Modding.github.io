import { createRecord } from '../records/record-utils.js';

export class PluginCatalog {
  constructor({ id, filename, packet, fingerprint = '' }) {
    if (!packet || !Array.isArray(packet.records)) throw new TypeError('PluginCatalog requires parsed records');
    this.id = id || `plugin:${fingerprint || slug(filename)}`;
    this.filename = filename || 'Imported plugin';
    this.packet = packet;
    this.fingerprint = fingerprint;
  }

  async load() {
    return this.packet.records.map((parsed) => createRecord({
      ...parsed.raw,
      id: parsed.id,
      type: parsed.type,
      name: parsed.name,
      mesh: parsed.mesh,
      icon: parsed.icon,
      deleted: parsed.deleted,
    }, {
      source: this.id,
      metadata: {
        plugin: {
          filename: this.filename,
          fingerprint: this.fingerprint,
          masters: this.packet.masters || [],
          deleted: !!parsed.deleted,
        },
      },
    }));
  }
}

function slug(value) {
  return String(value || 'plugin').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
