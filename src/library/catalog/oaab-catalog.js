import { createRecord } from '../records/record-utils.js';

export class OAABCatalog {
  constructor({ fetchData }) {
    this.id = 'oaab-data';
    this.fetchData = fetchData;
  }

  async load() {
    const response = await this.fetchData('OAAB_Data_filtered.json');
    if (!response.ok) throw new Error(`OAAB catalogue request failed: HTTP ${response.status}`);
    const rows = await response.json();
    return rows.map((raw) => createRecord(raw, {
      source: this.id,
      metadata: { oaab: {} },
    }));
  }
}
