import { createRecord } from '../records/record-utils.js';

const VANILLA_FILES = ['Morrowind_filtered.json', 'Tribunal_filtered.json', 'Bloodmoon_filtered.json'];

export class VanillaCatalog {
  constructor({ fetchData }) {
    this.id = 'vanilla';
    this.fetchData = fetchData;
  }

  async load() {
    const responses = await Promise.all(VANILLA_FILES.map((file) => this.fetchData(file)));
    const parts = await Promise.all(responses.map((response) => {
      if (!response.ok) throw new Error(`Vanilla catalogue request failed: HTTP ${response.status}`);
      return response.json();
    }));
    return parts.flat().map((raw) => createRecord(raw, { source: this.id }));
  }
}
