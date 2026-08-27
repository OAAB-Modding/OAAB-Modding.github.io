export function withProductionCatalog(Base) {
  return class ProductionCatalog extends Base {
  initializeProductionCatalog() {
    const REPO = 'https://cdn.jsdelivr.net/gh/OAAB-Modding/OAAB-Modding.github.io@main';
    const THUMB = '/assets/images/library/thumbnails/meshes/';
    const NPC_THUMB = '/assets/images/library/thumbnails/npc/';
    const RENDER = '/assets/images/library/renders/meshes/';
    const NPC_RENDER = '/assets/images/library/renders/npc/';
    const EFFECT = '/assets/images/library/effects/';
    const LIGHT_MASK = REPO + '/assets/images/library/masks/marker_light_mask.webp';
    const WIKI_BOOK_API = 'https://api.github.com/repos/OAAB-Modding/wiki/contents/oaab-content/books?ref=main';
    const WIKI_RAW_ROOT = 'https://raw.githubusercontent.com/OAAB-Modding/wiki/main/';
    const WIKI_BOOK_RAW = 'https://raw.githubusercontent.com/OAAB-Modding/wiki/main/oaab-content/books/';
    const WIKI_BOOK_SITE = 'https://www.oaab.dev/wiki/books/';
    const WIKI_BOOKART_RAW = 'https://www.oaab.dev/wiki/resources/gallery/bookart/';
    const UESP_API = 'https://en.uesp.net/w/api.php';
    const UESP_BOOK_SITE = 'https://en.uesp.net/wiki/';
    this._THUMB = THUMB;
    this._NPC_THUMB = NPC_THUMB;
    this._RENDER = RENDER;
    this._NPC_RENDER = NPC_RENDER;
    this._EFFECT = EFFECT;
    this._LIGHT_MASK = LIGHT_MASK;
    this._WIKI_RAW_ROOT = WIKI_RAW_ROOT;
    this._WIKI_BOOK_RAW = WIKI_BOOK_RAW;
    this._WIKI_BOOK_SITE = WIKI_BOOK_SITE;
    this._WIKI_BOOKART_RAW = WIKI_BOOKART_RAW;
    this._UESP_API = UESP_API;
    this._UESP_BOOK_SITE = UESP_BOOK_SITE;
    this._uespBookCache = Object.create(null);

    // Data JSON must always reflect the freshly deployed source. jsdelivr caches
    // the mutable @main ref for hours, so a lowercased mesh path (or any data
    // edit) lags well behind the repo — which is why the catalogue still showed
    // "OAAB\\…" tooltips after the source was lowercased. Read data same-origin
    // (GitHub Pages purges its CDN on every deploy, so it is always current) and
    // fall back to raw.githubusercontent (also always current) when the page is
    // not served from the site itself, e.g. a local file open or a preview.
    const DATA_LOCAL = '/assets/data/library/';
    const DATA_RAW = 'https://raw.githubusercontent.com/OAAB-Modding/OAAB-Modding.github.io/main/assets/data/library/';
    const fetchData = (file) => window.OAAB_LIBRARY
      ? window.OAAB_LIBRARY.fetchLibraryData(file)
      : fetch(DATA_LOCAL + file)
        .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r; })
        .catch(() => fetch(DATA_RAW + file));
    this._fetchData = fetchData;
    this._libraryServices = window.OAAB_LIBRARY.createLibraryServices();
    this._catalogProviders = this._libraryServices.providers;

    // Tag rules live beside the other library JSON so they can be edited and
    // deployed independently of this page. Invalid individual rules are
    // ignored; a failed tag file never prevents the asset catalogue loading.
    const loadTags = fetchData('tags.json')
      .then(r => r.json())
      .then(data => this.tagDefinitions(data))
      .catch(e => { console.warn('tag definitions load failed', e); return []; });
    const loadTilesets = fetchData('tilesets.json')
      .then(r => r.json())
      .then(data => this.tilesetDefinitions(data))
      .catch(e => { console.warn('tileset definitions load failed', e); return { pieces: [], tilesets: [] }; });

    // Deprecated IDs come straight from OAAB_Data's own metadata file
    // ([tools.csse] deprecated = [ ... ]), so the list stays current as the
    // team marks new objects deprecated — no separate snapshot to maintain.
    const META = 'https://raw.githubusercontent.com/OAAB-Modding/Data/master/00%20Core/OAAB_Data-metadata.toml';
    const loadDeprecated = fetch(META)
      .then(r => r.text())
      .then(txt => {
        const set = Object.create(null);
        this.tomlArray(txt, 'deprecated').forEach(id => { set[id] = 1; });
        return set;
      })
      .catch(e => { console.warn('deprecated list load failed', e); return Object.create(null); });
    const loadWikiBooks = fetch(WIKI_BOOK_API)
      .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(rows => {
        const entries = [];
        (Array.isArray(rows) ? rows : []).forEach(row => {
          const name = row && row.name ? String(row.name) : '';
          if (!/\.md$/i.test(name) || name.toLowerCase() === 'index.md') return;
          const slug = name.replace(/\.md$/i, '');
          entries.push({
            file: name,
            rawUrl: row.download_url || (WIKI_BOOK_RAW + encodeURIComponent(name)),
            wikiUrl: WIKI_BOOK_SITE + encodeURIComponent(slug),
          });
        });
        return Promise.all(entries.map(entry =>
          fetch(entry.rawUrl)
            .then(r => {
              if (!r.ok) throw new Error('http ' + r.status);
              return r.text();
            })
            .then(markdown => {
              const meta = this.wikiBookFrontmatter(markdown);
              return Object.assign({}, entry, {
                markdown,
                title: meta.title || entry.file.replace(/\.md$/i, ''),
                ids: meta.ids || [],
              });
            })
            .catch(e => {
              console.warn('wiki book metadata load failed', entry.file, e);
              return null;
            })
        ));
      })
      .then(entries => {
        const byId = Object.create(null);
        (entries || []).forEach(entry => {
          if (!entry || !entry.ids || !entry.ids.length) return;
          const multi = entry.ids.length > 1;
          entry.ids.forEach((id, index) => {
            const key = String(id || '').trim().toLowerCase();
            if (!key || byId[key]) return;
            const anchor = multi ? this.wikiBookAnchorForOrdinal(entry.markdown, index + 1) : '';
            byId[key] = {
              file: entry.file,
              rawUrl: entry.rawUrl,
              wikiUrl: entry.wikiUrl + (anchor ? '#' + anchor : ''),
              anchor,
              title: entry.title,
            };
          });
        });
        return byId;
      })
      .catch(e => { console.warn('wiki book index load failed', e); return Object.create(null); });

    Promise.all([
      this._catalogProviders.oaab.load(),
      loadDeprecated,
      loadWikiBooks,
      loadTags,
      loadTilesets,
    ])
      .then(([catalogRecords, deprecated, wikiBooks, tagDefs, tilesetDefs]) => {
        this._tagDefs = tagDefs;
        this._tilesetDefs = tilesetDefs;
        const records = catalogRecords.map(record => record.raw);
        const recordByRaw = new WeakMap(catalogRecords.map(record => [record.raw, record]));
        this.enrichOaabRecords(catalogRecords, deprecated, wikiBooks, tagDefs, tilesetDefs);
        const enchantmentsByKey = this.enchantmentMap(records);
        const labelType = (t) => this.displayType(t);
        const thumbnailPath = (mesh) => {
          const rel = String(mesh || '').replace(/\\/g, '/').toLowerCase().replace(/^meshes\//, '');
          if (!/\.nif$/.test(rel)) return null;
          return rel.replace(/\.nif$/, '.webp');
        };
        const seen = Object.create(null);
        const contentSeen = Object.create(null);
        const contentRecords = [];
        const items = [];
        records.forEach(r => {
          const id = r.id;
          const idKey = String(id || '').trim().toLowerCase();
          if (id && !deprecated[id] && !contentSeen[idKey]) {
            contentSeen[idKey] = 1;
            contentRecords.push({
              record: recordByRaw.get(r),
              source: 'oaab-data',
              id: id,
              name: r.name || '',
              type: labelType(r.type),
              inventory: Array.isArray(r.inventory) ? r.inventory : null,
              spells: Array.isArray(r.spells) ? r.spells : null,
              leveledItems: Array.isArray(r.items) ? r.items : null,
              leveledCreatures: Array.isArray(r.creatures) ? r.creatures : null,
            });
          }
          const mesh = (r.mesh || '');
          const npc = this.isNpcRecord(r);
          const spell = this.isSpellRecord(r);
          const leveledList = this.isLeveledListType(r.type);
          const markerLight = this.isMeshlessLight(r);
          const lightColor = this.labelType(r.type).toLowerCase() === 'light' ? this.lightColorCss(r) : '';
          const lightHex = lightColor ? this.lightColorHex(r) : '';
          const lightRgb = lightColor ? this.lightColorRgb(r) : null;
          const bookRef = this.wikiBookRef(r, wikiBooks);
          if (leveledList) {
            if (!id || seen[id] || deprecated[id]) return;
            seen[id] = 1;
            items.push({
              record: recordByRaw.get(r),
              source: 'oaab-data',
              id: id,
              name: r.name || '',
              type: labelType(r.type),
              img: '',
              render: '',
              mesh: '',
              isLeveledList: true,
              leveledItems: Array.isArray(r.items) ? r.items : null,
              leveledCreatures: Array.isArray(r.creatures) ? r.creatures : null,
              inventory: null,
              spells: null,
              effects: [],
              enchantment: null,
              alchemy: null,
              bookRef: null,
              detail: this.detailSourceRecord(r),
            });
            return;
          }
          // Mesh thumbnails are keyed by their path relative to Morrowind's
          // Meshes folder. Meshless lights and NPCs use special thumbnail keys.
          const meshThumb = thumbnailPath(mesh);
          if (!spell && !npc && !markerLight && !meshThumb) return;
          if (!id || seen[id]) return;
          if (deprecated[id]) return; // skip deprecated IDs
          const rel = npc ? null : (markerLight ? 'marker_light.webp' : meshThumb);
          const spellEffects = spell ? this.spellThumbnailEffects(r) : [];
          const img = spell ? (spellEffects[0] ? spellEffects[0].img : '') : (npc ? this.npcThumbnailUrl(id) : (rel ? THUMB + rel : ''));
          const render = spell ? '' : (npc ? this.npcRenderUrl(id) : (rel ? RENDER + rel : ''));
          if (!img) return;
          const alchemy = spell ? null : this.alchemyDetails(r);
          seen[id] = 1;
          items.push({
            record: recordByRaw.get(r),
            source: 'oaab-data',
            id: id,
            name: r.name || '',
            type: labelType(r.type),
            img: img,
            render: render,
            mesh: mesh,
            isSpell: spell,
            detailKind: spell ? 'spell' : (alchemy ? 'alchemy' : ''),
            spellEffects: spellEffects,
            lightTint: markerLight ? lightColor : '',
            lightColor: lightColor,
            lightHex: lightHex,
            lightRgb: lightRgb,
            lightMask: markerLight ? LIGHT_MASK : '',
            inventory: Array.isArray(r.inventory) ? r.inventory : null,
            spells: Array.isArray(r.spells) ? r.spells : null,
            effects: spell || alchemy ? [] : this.ingredientEffects(r),
            enchantment: spell ? this.spellDetails(r) : this.itemEnchantment(r, enchantmentsByKey),
            alchemy: alchemy,
            bookRef: bookRef,
            detail: this.detailSourceRecord(r),
          });
        });
        items.sort((a, b) => this.csCompareIds(a.id, b.id));
        this._oaabItems = items;
        this._oaabContentRecords = contentRecords;
        this.setState({ data: this.buildData() });
        this.loadMeshDiffs(items);
        this.loadVanilla();
      })
      .catch(e => console.error('library data load failed', e));
  }

  findCatalogItem(id) {
    const key = String(id || '').trim().toLowerCase();
    if (!key) return null;
    const displayed = this.state?.data?.items || [];
    const displayedItem = displayed.find(x => String(x.id || '').trim().toLowerCase() === key);
    if (displayedItem) return displayedItem;
    const all = (this._importedItems || []).concat(this._oaabItems || [], this._vanillaItems || []);
    return all.find(x => String(x.id || '').trim().toLowerCase() === key) || null;
  }

  enrichOaabRecords(records, deprecated, wikiBooks, tagDefs, tilesetDefs) {
    const tilesetsById = new Map();
    for (const tileset of tilesetDefs.tilesets || []) {
      for (const [piece, subsets] of Object.entries(tileset.pieces || {})) {
        for (const [subset, ids] of Object.entries(subsets || {})) {
          for (const id of ids) {
            const key = String(id).toLowerCase();
            if (!tilesetsById.has(key)) tilesetsById.set(key, []);
            tilesetsById.get(key).push({ key: tileset.key, label: tileset.label, piece, subset });
          }
        }
      }
    }
    for (const record of records) {
      const idKey = record.id.toLowerCase();
      const typeKey = this.displayType(record.type).toLowerCase();
      const tags = (tagDefs || []).filter(tag => (
        !tag.excludeTypes.includes(typeKey) &&
        tag.include.some(word => this.tagWordMatches(idKey, word)) &&
        !tag.exclude.some(word => this.tagWordMatches(idKey, word))
      )).map(tag => tag.label);
      record.metadata.oaab = {
        tags,
        tilesets: tilesetsById.get(idKey) || [],
        releaseAdded: null,
        releaseModified: [],
        deprecated: !!deprecated[record.id],
        wikiPage: wikiBooks[idKey]?.wikiUrl || null,
      };
    }
  }

  // Compose the catalogue shown in the grid. OAAB objects are always present;
  // when the Vanilla toggle is on, the base-game objects (Morrowind, Tribunal,
  // Bloodmoon) are merged in too. Type counts/tabs are derived from the merged
  // set so the toggle updates them automatically. Called only on data load and
  // when the toggle flips — never per render — so `data` identity stays stable
  // for the renderVals caches.

  buildData(vanillaOn) {
    const showVan = (vanillaOn != null) ? vanillaOn : this.state.vanilla;
    const sourceEnabled = this._librarySourceEnabled || new Set(['oaab-data', 'vanilla']);
    const oaab = sourceEnabled.has('oaab-data') ? (this._oaabItems || []) : [];
    const van = (showVan && sourceEnabled.has('vanilla') && this._vanillaItems) ? this._vanillaItems : [];
    const imported = (this._importedItems || []).filter(item => sourceEnabled.has(item.source));
    let items;
    if (!van.length) {
      items = oaab.slice();
    } else {
      const seen = Object.create(null);
      items = [];
      oaab.forEach(x => { seen[x.id] = 1; items.push(x); });
      van.forEach(x => { if (!seen[x.id]) { seen[x.id] = 1; items.push(x); } });
      items.sort((a, b) => this.csCompareIds(a.id, b.id));
    }
    if (imported.length) {
      const winners = new Map(items.map(item => [String(item.id || '').toLowerCase(), item]));
      imported.forEach(item => winners.set(String(item.id || '').toLowerCase(), item));
      items = [...winners.values()].sort((a, b) => this.csCompareIds(a.id, b.id));
    }
    const searchableItems = oaab.concat(this._vanillaItems || [], imported);
    const displayByKey = Object.create(null);
    searchableItems.forEach(x => { displayByKey[String(x.id || '').trim().toLowerCase()] = x; });
    const contentByKey = Object.create(null);
    const contentRecords = (this._oaabContentRecords || []).concat(this._vanillaContentRecords || []);
    contentRecords.forEach(x => {
      const key = String(x.id || '').trim().toLowerCase();
      if (key && !contentByKey[key]) contentByKey[key] = x;
    });
    this.refreshLeveledListThumbnails(searchableItems, contentByKey, displayByKey);
    searchableItems.forEach(x => {
      const contentIds = this.objectContentIds(x, displayByKey);
      x.contentIds = contentIds;
      x.hasContents = contentIds.length > 0;
    });
    const counts = Object.create(null);
    items.forEach(x => { counts[x.type] = (counts[x.type] || 0) + 1; });
    const types = Object.keys(counts)
      .map(k => ({ label: k, count: counts[k] }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return { total: items.length, types, items };
  }

  setLibrarySourceEnabled(sourceId, enabled) {
    if (!this._librarySourceEnabled) this._librarySourceEnabled = new Set(['oaab-data', 'vanilla']);
    if (enabled) this._librarySourceEnabled.add(sourceId);
    else this._librarySourceEnabled.delete(sourceId);
    this.setState({ data: this.buildData() });
  }

  setImportedRecords(records) {
    this._importedItems = (records || []).map(record => {
      const raw = record.raw || {};
      return {
        record,
        source: record.source,
        id: record.id,
        name: record.name || '',
        type: this.displayType(record.type),
        img: '/assets/images/general/icon.png',
        render: '',
        mesh: record.mesh || '',
        inventory: Array.isArray(raw.contents) ? raw.contents : null,
        spells: null,
        effects: [],
        enchantment: null,
        alchemy: null,
        bookRef: null,
        detail: this.detailSourceRecord(raw),
        imported: true,
      };
    });
    this.setState({ data: this.buildData() });
  }

  setImportedThumbnail(record, url) {
    const item = (this._importedItems || []).find(value => value.record === record || (
      value.source === record.source && String(value.id).toLowerCase() === String(record.id).toLowerCase()
    ));
    if (!item) return;
    item.img = url;
    item.render = url;
    this.setState({ data: this.buildData() });
  }

  // Lazily load the vanilla object catalogues. The three base-game files share
  // the same {type,id,mesh} shape as OAAB_Data and their thumbnails live under
  // the same meshes/ tree (just without the oaab/ prefix), so the mesh path maps
  // straight to a .webp. The three sources are merged into one set — the toggle
  // doesn't distinguish between games.

  loadVanilla() {
    if (this._vanillaItems || this._vanillaLoading) return;
    this._vanillaLoading = true;
    const THUMB = this._THUMB;
    const RENDER = this._RENDER;
    const LIGHT_MASK = this._LIGHT_MASK;
    this._catalogProviders.vanilla.load().then(catalogRecords => {
      const recordByRaw = new WeakMap(catalogRecords.map(record => [record.raw, record]));
      const parts = [catalogRecords.map(record => record.raw)];
      const seen = Object.create(null);
      const contentSeen = Object.create(null);
      const contentRecords = [];
      const items = [];
      const allRecords = [];
      parts.forEach(records => { (records || []).forEach(r => allRecords.push(r)); });
      const enchantmentsByKey = this.enchantmentMap(allRecords);
      parts.forEach(records => {
        (records || []).forEach(r => {
          const id = r.id;
          const idKey = String(id || '').trim().toLowerCase();
          if (id && !contentSeen[idKey]) {
            contentSeen[idKey] = 1;
            contentRecords.push({
              record: recordByRaw.get(r),
              source: 'vanilla',
              id: id,
              name: r.name || '',
              type: this.displayType(r.type),
              inventory: Array.isArray(r.inventory) ? r.inventory : null,
              spells: Array.isArray(r.spells) ? r.spells : null,
              leveledItems: Array.isArray(r.items) ? r.items : null,
              leveledCreatures: Array.isArray(r.creatures) ? r.creatures : null,
            });
          }
          const mesh = r.mesh || '';
          const norm = mesh.replace(/\\/g, '/').toLowerCase();
          const npc = this.isNpcRecord(r);
          const spell = this.isSpellRecord(r);
          const leveledList = this.isLeveledListType(r.type);
          const markerLight = this.isMeshlessLight(r);
          const lightColor = this.labelType(r.type).toLowerCase() === 'light' ? this.lightColorCss(r) : '';
          const lightHex = lightColor ? this.lightColorHex(r) : '';
          const lightRgb = lightColor ? this.lightColorRgb(r) : null;
          const bookRef = this.uespBookRef(r);
          if (leveledList) {
            if (!id || seen[id]) return;
            seen[id] = 1;
            items.push({
              record: recordByRaw.get(r),
              source: 'vanilla',
              id: id,
              name: r.name || '',
              type: this.displayType(r.type),
              img: '',
              render: '',
              mesh: '',
              isLeveledList: true,
              leveledItems: Array.isArray(r.items) ? r.items : null,
              leveledCreatures: Array.isArray(r.creatures) ? r.creatures : null,
              inventory: null,
              spells: null,
              effects: [],
              enchantment: null,
              alchemy: null,
              bookRef: null,
              detail: this.detailSourceRecord(r),
              vanilla: true,
            });
            return;
          }
          if (!spell && !npc && !markerLight && !/\.nif$/.test(norm)) return;
          if (!id || seen[id]) return;
          seen[id] = 1;
          const rel = npc ? null : (markerLight ? 'marker_light.webp' : norm.replace(/\.nif$/, '.webp'));
          const spellEffects = spell ? this.spellThumbnailEffects(r) : [];
          const img = spell ? (spellEffects[0] ? spellEffects[0].img : '') : (npc ? this.npcThumbnailUrl(id) : THUMB + rel);
          if (!img) return;
          const alchemy = spell ? null : this.alchemyDetails(r);
          items.push({
            record: recordByRaw.get(r),
            source: 'vanilla',
            id: id,
            name: r.name || '',
            type: this.displayType(r.type),
            img: img,
            render: spell ? '' : (npc ? this.npcRenderUrl(id) : RENDER + rel),
            mesh: mesh,
            isSpell: spell,
            detailKind: spell ? 'spell' : (alchemy ? 'alchemy' : ''),
            spellEffects: spellEffects,
            lightTint: markerLight ? lightColor : '',
            lightColor: lightColor,
            lightHex: lightHex,
            lightRgb: lightRgb,
            lightMask: markerLight ? LIGHT_MASK : '',
            inventory: Array.isArray(r.inventory) ? r.inventory : null,
            spells: Array.isArray(r.spells) ? r.spells : null,
            effects: spell || alchemy ? [] : this.ingredientEffects(r),
            enchantment: spell ? this.spellDetails(r) : this.itemEnchantment(r, enchantmentsByKey),
            alchemy: alchemy,
            bookRef: bookRef,
            detail: this.detailSourceRecord(r),
            vanilla: true,
          });
        });
      });
      items.sort((a, b) => this.csCompareIds(a.id, b.id));
      this._vanillaItems = items;
      this._vanillaContentRecords = contentRecords;
      this._vanillaLoading = false;
      this.setState({ data: this.buildData(this.state.vanilla) });
    }).catch(error => {
      this._vanillaLoading = false;
      console.warn('vanilla catalog load failed', error);
    });
  }

  // Build the Release facet (relData) from the published mesh diffs. One mesh
  // can back several object IDs, so a single changed file may badge multiple
  // library cards. Releases are returned newest-first; the newest entry that
  // contains an id wins its default card badge.

  loadMeshDiffs(items) {
    const meshToIds = Object.create(null);
    items.forEach(x => {
      const k = this.meshKey(x.mesh);
      if (!k) return;
      (meshToIds[k] || (meshToIds[k] = [])).push(x.id);
    });

    // Version chain — each adjacent pair has a mesh_diff_<from>_to_<to>.json.
    // Append new versions here as releases ship.
    const CHAIN = ['1.9.0', '1.10.0', '1.11.0', '1.12.0', '1.13.0', '1.14.0',
      '1.15.0', '1.16.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0', '2.4.0',
      '2.5.0', '2.6.0'];
    const fetchData = this._fetchData;

    const jobs = [];
    for (let i = 1; i < CHAIN.length; i++) {
      const from = CHAIN[i - 1], to = CHAIN[i];
      jobs.push(
        fetchData('mesh_diff_' + from + '_to_' + to + '.json')
          .then(r => { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(diff => {
            const added = new Set(), modified = new Set();
            (diff.meshes || []).forEach(m => {
              // A = added, M = modified; ignore deletions/anything else.
              if (m.status !== 'A' && m.status !== 'M') return;
              const ids = meshToIds[this.meshKey(m.path)];
              if (!ids) return; // mesh has no catalogued (non-deprecated) thumbnail
              const bucket = m.status === 'A' ? added : modified;
              ids.forEach(id => bucket.add(id));
            });
            // An id added & modified in the same span counts as added.
            modified.forEach(id => { if (added.has(id)) modified.delete(id); });
            return {
              version: diff.to || to,
              added: [...added].sort((a, b) => this.csCompareIds(a, b)),
              modified: [...modified].sort((a, b) => this.csCompareIds(a, b)),
            };
          })
          .catch(e => { console.warn('mesh diff load failed: ' + to, e); return null; })
      );
    }

    Promise.all(jobs).then(rows => {
      const releases = rows.filter(r => r && (r.added.length || r.modified.length)).reverse();
      const itemsById = new Map(items.map(item => [String(item.id).toLowerCase(), item]));
      for (const release of releases.slice().reverse()) {
        for (const id of release.added) {
          const metadata = itemsById.get(String(id).toLowerCase())?.record?.metadata?.oaab;
          if (metadata && !metadata.releaseAdded) metadata.releaseAdded = release.version;
        }
        for (const id of release.modified) {
          const metadata = itemsById.get(String(id).toLowerCase())?.record?.metadata?.oaab;
          if (metadata) metadata.releaseModified.push(release.version);
        }
      }
      this.setState({ relData: releases });
    });
  }
  };
}
