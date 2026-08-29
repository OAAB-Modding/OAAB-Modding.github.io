export function withLibraryRenderValues(Base) {
  return class LibraryRenderValues extends Base {
  renderVals() {
    const d = this.state.data;
    const all = (d && d.items) || [];
    const types = (d && d.types) || [];
    const total = (d && d.total) || 0;

    const active = this.state.active;
    const selTags = this.state.tags || [];
    const compact = !!this.state.compact;
    const comfortable = !compact;
    // Theme-aware neutral palette for the toolbar's inline-coloured controls.
    // Accent (ember/azura) selected states stay the same in both themes.
    const light = this.state.theme === 'light';
    const P = light
      ? { surface: '#fbf7ef', border: '#d8cdb8', muted: '#6a5d49', soft: '#8a7c66', strong: '#2b2218', dim: '#b3a89a', tagText: '#5b5170', tagOn: '#3f3768' }
      : { surface: '#15100b', border: '#322a20', muted: '#b3a690', soft: '#9a8d77', strong: '#f4ecdd', dim: '#5a5346', tagText: '#cabfdb', tagOn: '#efe9f6' };
    const catalogSourceOptions = typeof this.libraryCatalogSourceOptions === 'function'
      ? this.libraryCatalogSourceOptions()
      : [{ id: 'oaab-data', label: 'OAAB_Data', summary: 'OAAB_Data public catalogue', count: 0, enabled: true }];
    const selectedCatalogSources = catalogSourceOptions.filter(source => source.enabled);
    const catalogSourcesAll = catalogSourceOptions.length > 0 && selectedCatalogSources.length === catalogSourceOptions.length;
    const catalogSourceSummary = selectedCatalogSources.length === 0
      ? 'No catalog source'
      : (catalogSourcesAll
        ? 'All sources'
        : (selectedCatalogSources.length === 1
          ? selectedCatalogSources[0].label
          : `${selectedCatalogSources.length} sources`));
    const catalogSourceMenu = catalogSourceOptions.map(source => {
      const on = !!source.enabled;
      return {
        id: source.id,
        label: source.label,
        summary: source.summary,
        count: source.count == null ? (source.id === 'vanilla' ? (this._vanillaLoading ? 'Loading…' : 'Load') : '—') : source.count,
        mark: on ? '\u2713' : '',
        checkBg: on ? '#9a92d6' : 'transparent',
        checkBd: on ? '#9a92d6' : P.border,
        labelColor: on ? P.strong : P.soft,
        countColor: P.soft,
      };
    });
    const catalogSourceAllRow = {
      mark: catalogSourcesAll ? '\u2713' : '',
      checkBg: catalogSourcesAll ? '#9a92d6' : 'transparent',
      checkBd: catalogSourcesAll ? '#9a92d6' : P.border,
      labelColor: catalogSourcesAll ? P.strong : P.soft,
    };
    const catalogSourceDefault = selectedCatalogSources.length === 1 && selectedCatalogSources[0]?.id === 'oaab-data';
    const catalogSourceFilterActive = !catalogSourcesAll && !catalogSourceDefault;
    const tilesetDefs = this._tilesetDefs || { pieces: [], tilesets: [] };
    const tilesets = tilesetDefs.tilesets || [];
    const activeTileset = tilesets.find(set => set.key === this.state.tileset) || null;
    const tilesetActive = !!activeTileset;
    const validSubset = activeTileset && activeTileset.subsets.some(subset => subset.key === this.state.tilesetSubset)
      ? this.state.tilesetSubset
      : 'all';
    const activeTilesetPiece = tilesetActive && (tilesetDefs.pieces || []).some(piece => piece.key === this.state.tilesetPiece)
      ? this.state.tilesetPiece
      : '';
    const activeTilesetIds = tilesetActive ? this.tilesetIds(activeTileset, validSubset, activeTilesetPiece) : [];
    const activeTilesetIdSet = new Set(activeTilesetIds.map(id => String(id || '').toLowerCase()));
    const tilesetFilterKey = tilesetActive
      ? activeTileset.key + '\u0000' + validSubset + '\u0000' + activeTilesetPiece
      : '';

    // Tag rules are loaded from assets/data/library/tags.json. They use plain
    // include/exclude word lists matched against IDs and can exclude complete
    // object types; all comparisons are case-insensitive.
    const TAG_DEFS = this._tagDefs || [];
    const tagsFor = (item) => {
      const cache = this._tagCache || (this._tagCache = Object.create(null));
      const idText = String((item && item.id) || '').toLowerCase();
      const typeText = String((item && item.type) || '').trim().toLowerCase();
      const key = typeText + '\u0000' + idText;
      return cache[key] || (cache[key] = TAG_DEFS
        .filter(t =>
          t.excludeTypes.indexOf(typeText) === -1 &&
          t.include.some(word => this.tagWordMatches(idText, word)) &&
          !t.exclude.some(word => this.tagWordMatches(idText, word))
        )
        .map(t => t.label));
    };

    // Type filtering and tag counts do not change while the virtual row window
    // moves, so retain them until either the records or active type changes.
    let typeFiltered, tagCounts;
    const typeCache = this._typeCache;
    if (typeCache && typeCache.data === d && typeCache.active === active && typeCache.tilesetKey === tilesetFilterKey) {
      typeFiltered = typeCache.items;
      tagCounts = typeCache.tagCounts;
    } else {
      typeFiltered = active === 'All' ? all : all.filter(x => x.type === active);
      if (tilesetActive) {
        typeFiltered = typeFiltered.filter(x => activeTilesetIdSet.has(String(x.id || '').toLowerCase()));
      }
      tagCounts = {};
      TAG_DEFS.forEach(t => { tagCounts[t.label] = 0; });
      typeFiltered.forEach(x => tagsFor(x).forEach(l => { tagCounts[l]++; }));
      this._typeCache = { data: d, active, tilesetKey: tilesetFilterKey, items: typeFiltered, tagCounts };
    }

    const mkType = (label, count) => {
      const on = label === active;
      return {
        label, count,
        bg: on ? '#d2823f' : 'transparent',
        fg: on ? '#15110c' : P.muted,
        bd: on ? '#d2823f' : P.border,
        fw: on ? '600' : '400',
      };
    };
    const tabs = [mkType('All', total)].concat(types.map(t => mkType(t.label, t.count)));

    // Single-select Type dropdown (popout only) — no counts.
    const mkTypeRow = (label, displayLabel) => {
      const on = label === active;
      return {
        label, displayLabel,
        mark: on ? '\u2713' : '',
        checkBg: on ? '#d2823f' : 'transparent',
        checkBd: on ? '#d2823f' : P.border,
        labelColor: on ? P.strong : P.soft,
      };
    };
    const typeMenu = [mkTypeRow('All', 'All objects')].concat(types.map(t => mkTypeRow(t.label, t.label)));

    const noTags = selTags.length === 0;
    const mkTagRow = (label, count, isAll) => {
      const on = isAll ? noTags : selTags.indexOf(label) !== -1;
      const dim = (!isAll && count === 0);
      return {
        label,
        count: isAll ? '' : count,
        mark: on ? '\u2713' : '',
        checkBg: on ? '#9a92d6' : 'transparent',
        checkBd: on ? '#9a92d6' : P.border,
        labelColor: on ? P.tagOn : (dim ? P.dim : P.tagText),
        countColor: dim ? P.dim : P.soft,
      };
    };
    const allRow = mkTagRow('All', 0, true);
    const tagMenu = TAG_DEFS
      // Hide tags with no matches under the current Type, unless already selected.
      .filter(t => tagCounts[t.label] > 0 || selTags.indexOf(t.label) !== -1)
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(t => mkTagRow(t.label, tagCounts[t.label], false));

    // Tag filter (OR across selected tags) applied on top of the type filter.
    const tagKey = selTags.join('\u0000');
    let tagFiltered;
    const tagFilterCache = this._tagFilterCache;
    if (tagFilterCache && tagFilterCache.items === typeFiltered && tagFilterCache.key === tagKey) {
      tagFiltered = tagFilterCache.filtered;
    } else {
      tagFiltered = noTags ? typeFiltered : typeFiltered.filter(x => {
        const tl = tagsFor(x);
        return selTags.some(s => tl.indexOf(s) !== -1);
      });
      this._tagFilterCache = { items: typeFiltered, key: tagKey, filtered: tagFiltered };
    }

    // ---- Release provenance ----------------------------------------------
    // relData is newest-first, so the first release containing an id is the
    // most recent one that touched it — that's the id's default card badge.
    const relData = this.state.relData || [];
    const relSels = this.state.releases || [];
    const relKinds = this.state.relKinds || ['added', 'modified'];
    const kindOn = (k) => relKinds.indexOf(k) !== -1;
    let relSet, relMap;
    const relCache = this._relCache;
    if (relCache && relCache.data === relData) {
      relSet = relCache.relSet;
      relMap = relCache.relMap;
    } else {
      relSet = {};   // version -> { added:Set, modified:Set }
      relMap = {};   // id -> { version, status } (newest touch)
      relData.forEach(r => {
        const a = new Set(r.added || []);
        const m = new Set(r.modified || []);
        relSet[r.version] = { added: a, modified: m };
        a.forEach(id => { if (!relMap[id]) relMap[id] = { version: r.version, status: 'added' }; });
        m.forEach(id => { if (!relMap[id]) relMap[id] = { version: r.version, status: 'modified' }; });
      });
      this._relCache = { data: relData, relSet, relMap };
    }

    // Release menu counts reflect the current Type selection (like tag counts).
    let relCounts;
    const relCountCache = this._relCountCache;
    if (relCountCache && relCountCache.data === relData && relCountCache.items === typeFiltered) {
      relCounts = relCountCache.counts;
    } else {
      relCounts = {};
      relData.forEach(r => {
        const s = relSet[r.version];
        relCounts[r.version] = typeFiltered.reduce(
          (n, x) => n + ((s.added.has(x.id) || s.modified.has(x.id)) ? 1 : 0), 0);
      });
      this._relCountCache = { data: relData, items: typeFiltered, counts: relCounts };
    }

    // Apply the release filter on top of the tag filter. Multiple releases are
    // OR'd together (show assets touched in ANY selected release).
    const activeRels = relSels.filter(v => relSet[v]);
    const relKey = relSels.join('\u0000');
    const kindKey = relKinds.slice().sort().join('\u0000');
    let relFiltered;
    const relFilterCache = this._relFilterCache;
    if (
      relFilterCache &&
      relFilterCache.items === tagFiltered &&
      relFilterCache.data === relData &&
      relFilterCache.key === relKey &&
      relFilterCache.mode === kindKey
    ) {
      relFiltered = relFilterCache.filtered;
    } else {
      relFiltered = tagFiltered;
      if (activeRels.length) {
        relFiltered = tagFiltered.filter(x => activeRels.some(v => {
          const s = relSet[v];
          return (kindOn('added') && s.added.has(x.id)) ||
                 (kindOn('modified') && s.modified.has(x.id));
        }));
      }
      this._relFilterCache = {
        items: tagFiltered, data: relData, key: relKey, mode: kindKey, filtered: relFiltered,
      };
    }

    const mkRelRow = (version, count, isAll) => {
      const on = isAll ? relSels.length === 0 : relSels.indexOf(version) !== -1;
      const dim = (!isAll && count === 0);
      return {
        version,
        count: isAll ? '' : count,
        mark: on ? '\u2713' : '',
        checkBg: on ? '#9a92d6' : 'transparent',
        checkBd: on ? '#9a92d6' : P.border,
        labelColor: on ? P.tagOn : (dim ? P.dim : P.tagText),
        countColor: dim ? P.dim : P.soft,
      };
    };
    const relAllRow = mkRelRow('', 0, true);
    const relMenu = relData.map(r => mkRelRow(r.version, relCounts[r.version], false));
    const relModes = [
      {
        key: 'added', label: 'New',
        bg: kindOn('added') ? '#d2823f' : 'transparent',
        fg: kindOn('added') ? '#15110c' : P.soft,
        bd: kindOn('added') ? '#d2823f' : P.border,
      },
      {
        key: 'modified', label: 'Updated',
        bg: kindOn('modified') ? 'rgba(154,146,214,0.16)' : 'transparent',
        fg: kindOn('modified') ? (light ? '#4a4173' : '#cdc5ea') : P.soft,
        bd: kindOn('modified') ? '#5a5380' : P.border,
      },
    ];

    // Text search applies on top of the filters. Special helpers are selected
    // with the embedded mode dropdown; book text also accepts `text:` directly.
    const rawQuery = (this.state.query || '').trim();
    const allowedSearchModes = this.allowedSearchModesForItems(typeFiltered, active);
    const selectedSearchMode = allowedSearchModes[this.state.searchMode] ? this.state.searchMode : '';
    const activeSearch = this.activeSearchMode(rawQuery, selectedSearchMode, allowedSearchModes);
    const displayedSearchMode = activeSearch.explicit ? activeSearch.mode : selectedSearchMode;
    const normalQuery = activeSearch.mode ? '' : rawQuery;
    const q = normalQuery.toLowerCase();
    const qPath = q.replace(/\\/g, '/');
    const inventoryQuery = activeSearch.mode === 'inventory' ? activeSearch.term : '';
    const inventoryKey = inventoryQuery.toLowerCase();
    const bookTextQuery = activeSearch.mode === 'text' ? activeSearch.term : '';
    const bookTextKey = this.normalizeBookSearchText(bookTextQuery);
    const effectQuery = activeSearch.mode === 'effect' ? activeSearch.term : '';
    const effectKey = this.effectSearchKey(effectQuery);
    const ingredientEffectQuery = activeSearch.mode === 'ingredient' ? activeSearch.term : '';
    const ingredientEffectKey = this.effectSearchKey(ingredientEffectQuery);
    const alchemyEffectQuery = activeSearch.mode === 'alchemy' ? activeSearch.term : '';
    const alchemyEffectKey = this.effectSearchKey(alchemyEffectQuery);
    const enchantEffectQuery = activeSearch.mode === 'enchant' ? activeSearch.term : '';
    const enchantEffectKey = this.effectSearchKey(enchantEffectQuery);
    const spellEffectQuery = activeSearch.mode === 'spell' ? activeSearch.term : '';
    const spellEffectKey = this.effectSearchKey(spellEffectQuery);
    const colorSearchQuery = activeSearch.mode === 'color' ? activeSearch.term : '';
    const colorQuery = activeSearch.mode === 'color' ? this.parseColorQuery(colorSearchQuery) : (activeSearch.mode ? null : this.parseColorQuery(rawQuery));
    const colorKey = colorQuery ? colorQuery.hex + '~' + colorQuery.tolerance : (colorSearchQuery ? 'invalid:' + colorSearchQuery.toLowerCase() : '');
    let filtered;
    const queryCache = this._queryCache;
    if (
      queryCache &&
      queryCache.items === relFiltered &&
      queryCache.query === q &&
      queryCache.colorKey === colorKey &&
      queryCache.inventoryKey === inventoryKey &&
      queryCache.bookTextKey === bookTextKey &&
      queryCache.effectKey === effectKey &&
      queryCache.ingredientEffectKey === ingredientEffectKey &&
      queryCache.alchemyEffectKey === alchemyEffectKey &&
      queryCache.enchantEffectKey === enchantEffectKey &&
      queryCache.spellEffectKey === spellEffectKey &&
      queryCache.vanillaItems === this._vanillaItems
    ) {
      filtered = queryCache.filtered;
    } else {
      if (inventoryQuery) {
        filtered = this.inventorySearchItems(inventoryQuery, all);
      } else if (bookTextQuery) {
        filtered = this.bookTextSearchItems(bookTextQuery, relFiltered);
      } else if (ingredientEffectQuery) {
        filtered = this.ingredientEffectSearchItems(ingredientEffectKey, all);
      } else if (alchemyEffectQuery) {
        filtered = this.alchemyEffectSearchItems(alchemyEffectKey, all);
      } else if (spellEffectQuery) {
        filtered = this.spellEffectSearchItems(spellEffectKey, all);
      } else if (enchantEffectQuery) {
        filtered = this.enchantmentEffectSearchItems(enchantEffectKey, all);
      } else if (effectQuery) {
        filtered = this.effectSearchItems(effectKey, all);
      } else if (colorSearchQuery) {
        filtered = colorQuery
          ? relFiltered.filter(x => this.colorDistanceSq(x.lightRgb, colorQuery.rgb) <= colorQuery.toleranceSq)
          : [];
      } else {
        filtered = !q ? relFiltered : relFiltered.filter(x => {
          const mesh = (x.mesh || '').toLowerCase();
          return (
            (x.id || '').toLowerCase().indexOf(q) !== -1 ||
            (x.name || '').toLowerCase().indexOf(q) !== -1 ||
            mesh.indexOf(q) !== -1 ||
            mesh.replace(/\\/g, '/').indexOf(qPath) !== -1 ||
            ((x.lightHex || '').toLowerCase().indexOf(q) !== -1) ||
            (colorQuery && this.colorDistanceSq(x.lightRgb, colorQuery.rgb) <= colorQuery.toleranceSq)
          );
        });
      }
      this._queryCache = { items: relFiltered, query: q, colorKey, inventoryKey, bookTextKey, effectKey, ingredientEffectKey, alchemyEffectKey, enchantEffectKey, spellEffectKey, vanillaItems: this._vanillaItems, filtered };
    }

    const detailAvailable = active !== 'All';
    const detailView = detailAvailable && !!this.state.detailView;
    const detailFilters = this.state.detailFilters || {};
    const detailFilterCount = Object.keys(detailFilters).filter(k => String(detailFilters[k] || '').trim()).length;
    let detailColumns = [];
    let detailItems = filtered;
    if (detailView) {
      detailColumns = this.detailColumnsFor(active, filtered);
      detailColumns.forEach(col => {
        col.filterValue = detailFilters[col.key] || '';
        if (this.state.detailSort && this.state.detailSort.key === col.key) {
          col.sortMark = this.state.detailSort.dir === 'desc' ? '\u2193' : '\u2191';
        }
      });
      detailItems = this.applyDetailFilters(filtered, detailColumns, detailFilters);
      detailItems = this.sortDetailItems(detailItems, this.state.detailSort);
    }

    // Materialise only complete rows around the viewport. Fixed-height captions
    // make the skipped rows' height deterministic across responsive columns.
    this._filteredCount = detailView ? 0 : filtered.length;
    const gridWidth = this.state.gridWidth || 1180;
    const metrics = this.gridMetrics(gridWidth);
    const rowCount = Math.ceil(filtered.length / metrics.columns);
    const maxStart = Math.max(0, rowCount - 1);
    const startRow = Math.max(0, Math.min(maxStart, this.state.virtualStartRow || 0));
    const endRow = rowCount === 0 ? 0 : Math.min(
      rowCount,
      Math.max(startRow + 1, this.state.virtualEndRow || 8)
    );
    const startIndex = startRow * metrics.columns;
    const endIndex = Math.min(filtered.length, endRow * metrics.columns);
    this._renderPreviewItems = (detailView ? detailItems : filtered)
      .map(x => this.renderPreviewPayload(x))
      .filter(x => x && (x.src || x.mesh));
    this._bookPreviewItems = (detailView ? detailItems : filtered).filter(x => x && x.bookRef);
    const REL_ADDED = { bg: 'rgba(210,130,63,0.94)', fg: '#1a120a', bd: 'rgba(210,130,63,0.94)', glyph: '+' };
    const REL_UPD = light
      ? { bg: 'rgba(154,146,214,0.18)', fg: '#352d5e', bd: 'rgba(120,110,185,0.85)', glyph: '\u21bb' }
      : { bg: 'rgba(154,146,214,0.18)', fg: '#cdc5ea', bd: 'rgba(154,146,214,0.55)', glyph: '\u21bb' };
    const items = filtered.slice(startIndex, endIndex).map(x => {
      // When releases are selected, the badge reflects the newest selected
      // release that touched the asset; otherwise it shows the newest release
      // overall that touched it (relMap).
      // Only badge cards when at least one release tag is selected.
      let prov = null;
      if (activeRels.length) {
        for (let i = 0; i < relData.length; i++) {
          const v = relData[i].version;
          if (activeRels.indexOf(v) === -1) continue;
          const s = relSet[v];
          if (kindOn('added') && s.added.has(x.id)) { prov = { version: v, status: 'added' }; break; }
          if (kindOn('modified') && s.modified.has(x.id)) { prov = { version: v, status: 'modified' }; break; }
        }
      }
      const sty = prov ? (prov.status === 'added' ? REL_ADDED : REL_UPD) : REL_UPD;
      const generatedThumbnail = !!(x.imported && x.mesh);
      const thumbnailReady = !!x.thumbnailReady;
      const thumbnailFailed = generatedThumbnail && !thumbnailReady && x.thumbnailStatus === 'failed';
      const thumbnailPending = generatedThumbnail && !thumbnailReady && !thumbnailFailed;
      return {
        id: x.id,
        name: x.name || '',
        hasName: !!(x.name && x.name.length),
        localThumbnail: generatedThumbnail && !thumbnailReady,
        thumbnailPending,
        thumbnailFailed,
        thumbnailStatusLabel: thumbnailFailed ? 'Preview unavailable · click to retry' : 'Generating preview',
        type: x.type,
        img: x.img,
        render: (x.isSpell || x.isLeveledList || (generatedThumbnail && !thumbnailReady)) ? '' : (x.render || x.img),
        renderId: x.id || '',
        renderTitle: x.id || '',
        renderMeta: x.mesh || x.name || x.type || '',
        thumbKey: x.id + '|' + (x.img || '') + '|' + (x.thumbnailStatus || '') + '|' + ((x.collageThumbs || []).map(t => t.src).join(',')) + '|' + (x.lightTint || '') + '|' + (x.lightColor || '') + '|' + (x.lightHex || '') + '|' + (x.lightMask || ''),
        lightTint: x.lightTint || '',
        lightColor: x.lightColor || '',
        lightHex: x.lightHex || '',
        lightMask: x.lightMask || '',
        hasContents: !!(x.hasContents && x.contentIds && x.contentIds.length),
        contentsTitle: x.contentIds && x.contentIds.length
          ? 'Open contents: ' + x.contentIds.length + ' valid content' + (x.contentIds.length === 1 ? '' : 's')
          : '',
        compactContentsLabel: 'Open contents',
        hasEffects: !!(x.effects && x.effects.length),
        effects: x.effects || [],
        hasEnchantment: !!x.enchantment,
        enchantmentTitle: x.enchantment ? x.enchantment.title : '',
        hasAlchemy: !!x.alchemy,
        alchemyTitle: x.alchemy ? x.alchemy.title : '',
        hasBookText: !!x.bookRef,
        bookTitle: x.bookRef ? ('Read ' + (x.name || x.id || 'book')) : '',
        detailsLabel: x.detailKind === 'spell' ? 'Inspect spell' : 'Inspect enchantment',
        isSpell: !!x.isSpell,
        isNotSpell: !x.isSpell,
        isLeveledList: !!x.isLeveledList,
        hasSingleImage: !!(x.img && !(x.hasCollage || x.hasListPlaceholder) && (!generatedThumbnail || thumbnailReady)),
        hasCollage: !!x.hasCollage,
        collageThumbs: x.collageThumbs || [],
        collageClass: x.collageClass || '',
        hasListPlaceholder: !!x.hasListPlaceholder,
        hasSpellThumb: !!(x.spellEffects && x.spellEffects.length),
        spellEffects: x.spellEffects || [],
        spellLayoutClass: this.spellLayoutClass(x.spellEffects ? x.spellEffects.length : 0),
        previewClass: (x.isSpell || x.isLeveledList) ? 'asset-thumb-frame-no-preview' : '',
        hasCompactActions: !!(x.bookRef || (x.hasContents && x.contentIds && x.contentIds.length) || (x.effects && x.effects.length) || x.enchantment || x.alchemy),
        compactActionsOpen: this.state.compactActionsId === x.id,
        nif: x.mesh || (x.img || ''),
        tip: comfortable
          ? (x.mesh || x.id || x.img || '')
          : ((x.type ? x.type + '\n' : '') + x.id + (x.name ? '  \u00b7  ' + x.name : '') + (x.mesh ? '\n' + x.mesh : '')),
        relShow: !!prov && comfortable,
        relVer: prov ? prov.version : '',
        relGlyph: sty.glyph,
        relBg: sty.bg,
        relFg: sty.fg,
        relBd: sty.bd,
      };
    });
    this._detailRowCount = detailView ? detailItems.length : 0;
    const detailRowHeight = this.detailRowPitch();
    const detailMaxStart = Math.max(0, detailItems.length - 1);
    const detailStartIndex = detailView ? Math.max(0, Math.min(detailMaxStart, this.state.virtualStartRow || 0)) : 0;
    const detailEndIndex = detailView && detailItems.length
      ? Math.min(detailItems.length, Math.max(detailStartIndex + 1, this.state.virtualEndRow || 8))
      : 0;
    const detailRows = detailView ? this.detailRowsFor(detailItems.slice(detailStartIndex, detailEndIndex), detailColumns, detailStartIndex) : [];
    const detailTopPad = detailView ? detailStartIndex * detailRowHeight : 0;
    const detailBottomPad = detailView ? Math.max(0, detailItems.length - detailEndIndex) * detailRowHeight : 0;
    const detailTableWidth = detailView
      ? Math.max(1180, detailColumns.reduce((sum, col) => sum + this.detailColumnPixelWidth(col), 0))
      : 1180;
    const tagLabel = noTags ? '' : (selTags.length === 1 ? selTags[0] : selTags.length + ' tags');
    // Popout mode strips the nav/hero/footer for a minimal, embeddable window.
    const isPopout = this._isPopout != null
      ? this._isPopout
      : (this._isPopout = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('oaab_popout') === '1') || /[?&]popout=1/.test(location.search || ''));

    // On mobile (non-popout) the wrapping Type tab row is replaced by the
    // compact Type dropdown, and the toolbar tightens to align with the
    // shorter mobile nav.
    const narrow = !isPopout && !!this.state.narrow;

    const hasFilterWithoutSearch = active !== 'All' || selTags.length > 0 || relSels.length > 0 || tilesetActive || catalogSourceFilterActive;
    let emptyTitle = 'No thumbnails in this category yet.';
    let emptyCopy = "These records exist in the library data but aren't part of the current thumbnail render set.";
    if (detailView && filtered.length > 0 && detailItems.length === 0) {
      emptyTitle = 'No rows match the column filters.';
      emptyCopy = 'Clear a table filter or broaden the filters above.';
    } else if (rawQuery) {
      emptyTitle = 'No matching records.';
      emptyCopy = bookTextQuery
        ? 'No book text matches "' + bookTextQuery + '".'
        : (ingredientEffectQuery
        ? 'No ingredient effect matches "' + ingredientEffectQuery + '".'
        : (alchemyEffectQuery
          ? 'No alchemy effect matches "' + alchemyEffectQuery + '".'
          : (spellEffectQuery
            ? 'No spell effect matches "' + spellEffectQuery + '".'
            : (enchantEffectQuery
              ? 'No enchantment effect matches "' + enchantEffectQuery + '".'
              : (effectQuery
                ? 'No ingredient, alchemy, spell, or enchantment effect matches "' + effectQuery + '".'
                : 'No object ID, name, mesh, or light color matches "' + rawQuery + '".')))));
    } else if (hasFilterWithoutSearch) {
      emptyTitle = 'No matching thumbnails.';
      emptyCopy = 'Try clearing a source, type, tag, release, or tileset filter.';
    }

    // Active-filter count powers the mobile "Filters" toggle badge.
    const filterCount =
      (active !== 'All' ? 1 : 0) + selTags.length + (rawQuery || selectedSearchMode ? 1 : 0) + relSels.length +
      (catalogSourceFilterActive ? 1 : 0) + (tilesetActive ? 1 : 0) + detailFilterCount;
    const filtersOpen = !!this.state.filtersOpen;
    const filterHistory = Array.isArray(this.state.filterHistory) ? this.state.filterHistory : [];
    const filterHistoryIndex = typeof this.state.filterHistoryIndex === 'number' ? this.state.filterHistoryIndex : -1;
    const searchModeMenu = this.searchModeDefs()
      .filter(mode => mode.key === '' || allowedSearchModes[mode.key])
      .map(mode => {
        const on = mode.key === displayedSearchMode;
        return {
          key: mode.key,
          label: mode.label,
          mark: on ? '\u2713' : '',
          checkBg: on ? '#d2823f' : 'transparent',
          checkBd: on ? '#d2823f' : P.border,
          labelColor: on ? P.strong : P.soft,
        };
      });
    const searchSuggestions = this.searchSuggestions(relFiltered, activeSearch);
    const searchPlaceholderMap = {
      effect: 'Search magic effect names',
      ingredient: 'Search ingredient effect names',
      alchemy: 'Search alchemy effect names',
      spell: 'Search spell effect names',
      enchant: 'Search enchantment effect names',
      inventory: 'Search content owner IDs',
      color: 'Search light colors by hex',
      text: 'Search book text',
    };
    const searchPlaceholder = searchPlaceholderMap[displayedSearchMode] || 'Search ID, name, mesh, or light color';

    const tilesetOptions = tilesets.map(set => ({ key: set.key, label: set.label }));
    const activeSubsetDef = activeTileset && validSubset !== 'all'
      ? activeTileset.subsets.find(subset => subset.key === validSubset)
      : null;
    const tilesetSubsetOptions = activeTileset
      ? [{ key: 'all', label: 'All subsets' }].concat(activeTileset.subsets)
      : [];
    const tilesetAllIds = activeTileset ? this.tilesetIds(activeTileset, validSubset, '') : [];
    const pieceDefinition = activeTilesetPiece
      ? (tilesetDefs.pieces || []).find(piece => piece.key === activeTilesetPiece)
      : null;
    const pieceRows = (tilesetDefs.pieces || []).map(piece => {
      const count = activeTileset ? this.tilesetIds(activeTileset, validSubset, piece.key).length : 0;
      const subsetLabel = activeSubsetDef ? activeSubsetDef.label : 'this tileset';
      const art = this.tilesetPieceArt(piece.key);
      return {
        key: piece.key,
        label: piece.label,
        displayLabel: piece.group === 'hall'
          ? piece.label.replace(/^Hall\s+/i, '')
          : (piece.group === 'room' ? piece.label.replace(/^Room\s+/i, '') : piece.label),
        group: piece.group,
        order: piece.order,
        floorPath: art.floor,
        cornerPath: art.corners,
        wallPath: art.walls,
        count,
        active: piece.key === activeTilesetPiece,
        disabled: count === 0,
        title: count
          ? piece.label + ' \u00b7 ' + count + ' variant' + (count === 1 ? '' : 's')
          : piece.label + ' \u00b7 unavailable in ' + subsetLabel,
      };
    });
    const tilesetHallPieces = pieceRows.filter(piece => piece.group === 'hall').sort((a, b) => a.order - b.order);
    const tilesetRoomPieces = pieceRows.filter(piece => piece.group === 'room').sort((a, b) => a.order - b.order);
    const tilesetAdditionalPieces = pieceRows.filter(piece => piece.group === 'additional').sort((a, b) => a.order - b.order);
    const mappedPieceCount = pieceRows.filter(piece => piece.count > 0).length;
    const selectionCount = activeTilesetPiece ? activeTilesetIds.length : tilesetAllIds.length;
    const tilesetSelectionSummary = activeTilesetPiece && pieceDefinition
      ? pieceDefinition.label + ' \u00b7 ' + selectionCount + ' variant' + (selectionCount === 1 ? '' : 's')
      : tilesetAllIds.length + ' assets across ' + mappedPieceCount + ' piece types';
    const tilesetResultLabel = activeTileset
      ? [activeTileset.label, activeSubsetDef ? activeSubsetDef.label : '', pieceDefinition ? pieceDefinition.label : ''].filter(Boolean).join(' \u00b7 ')
      : '';
    const renderPreview = this.state.renderPreview;
    const renderPreviewMode = renderPreview?.mesh ? (this.state.renderPreviewMode || 'preview') : 'preview';
    const renderPreviewItem = renderPreview?.id ? this.findCatalogItem(renderPreview.id) : null;
    const renderPreviewRecord = renderPreviewItem?.record;
    const renderPreviewDetails = renderPreviewRecord?.raw || renderPreviewItem?.detail || {};
    const bookPreviewSearch = this.bookPreviewSearchData(this.state.bookPreview);

    return {
      yes: true,
      no: false,
      comfortable,
      compact,
      gridCols: 'repeat(auto-fill,' + Math.round((compact ? 112 : 176) * (this.state.scale || 1)) + 'px)',
      gridGap: Math.round((compact ? 10 : 14) * (this.state.scale || 1)),
      imgPad: Math.round((compact ? 7 : 12) * (this.state.scale || 1)),
      scale: this.state.scale || 1,
      scalePct: Math.round((this.state.scale || 1) * 100) + '%',
      showThumbScale: !detailView,
      onScale: (e) => {
        const v = Math.max(0.5, Math.min(3, parseFloat(e.target.value) || 1));
        try { localStorage.setItem('oaab_scale', String(v)); } catch (err) {}
        this.setState({ scale: v });
      },
      detailView,
      detailAvailable,
      galleryActive: !detailView && !compact,
      compactActive: !detailView && compact,
      detailActive: detailView,
      detailDisabled: !detailAvailable,
      galleryBg: (!detailView && !compact) ? (light ? 'rgba(43,34,24,0.07)' : 'rgba(244,236,221,0.09)') : 'transparent',
      galleryFg: (!detailView && !compact) ? P.strong : P.soft,
      compactBg: (!detailView && compact) ? 'rgba(154,146,214,0.16)' : 'transparent',
      compactFg: (!detailView && compact) ? (light ? '#4a4173' : '#efe9f6') : P.soft,
      detailBg: detailView ? 'rgba(210,130,63,0.16)' : 'transparent',
      detailFg: !detailAvailable ? P.dim : (detailView ? (light ? '#7a3f12' : '#f0c89c') : P.soft),
      galleryTitle: 'Gallery',
      compactTitle: 'Compact',
      detailTitle: detailAvailable ? 'Details' : 'Details — pick a type first',
      filterBackDisabled: !(filterHistoryIndex > 0),
      filterForwardDisabled: !(filterHistoryIndex >= 0 && filterHistoryIndex < filterHistory.length - 1),
      filterHistoryBack: () => this.moveFilterHistory(-1),
      filterHistoryForward: () => this.moveFilterHistory(1),
      cycleViewMode: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        this.setState(s => {
          const effectiveDetail = detailAvailable && !!s.detailView;
          let nextCompact = false;
          let nextDetail = false;
          if (effectiveDetail) {
            nextCompact = false;
            nextDetail = false;
          } else if (s.compact) {
            nextCompact = false;
            nextDetail = detailAvailable;
          } else {
            nextCompact = true;
            nextDetail = false;
          }
          try {
            localStorage.setItem('oaab_compact_v2', nextCompact ? '1' : '0');
            localStorage.setItem('oaab_detail_view', nextDetail ? '1' : '0');
          } catch (err) {}
          return {
            compact: nextCompact,
            detailView: nextDetail,
            compactActionsId: null,
            virtualStartRow: 0,
            virtualEndRow: 8,
          };
        });
      },
      setViewMode: (e) => {
        const mode = e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.mode : '';
        if (mode === 'detail' && !detailAvailable) return;
        const nextCompact = mode === 'compact';
        const nextDetail = mode === 'detail';
        try {
          localStorage.setItem('oaab_compact_v2', nextCompact ? '1' : '0');
          localStorage.setItem('oaab_detail_view', nextDetail ? '1' : '0');
        } catch (err) {}
        this.setState({ compact: nextCompact, detailView: nextDetail, compactActionsId: null, virtualStartRow: 0, virtualEndRow: 8 });
      },
      sortDetailColumn: (e) => {
        const key = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.detailSort || '') : '';
        if (!key || key === 'thumb') return;
        this.setState(s => {
          const cur = s.detailSort || {};
          const dir = cur.key === key && cur.dir !== 'desc' ? 'desc' : 'asc';
          return { detailSort: { key, dir }, virtualStartRow: 0, virtualEndRow: 8 };
        });
      },
      filterDetailColumn: (e) => {
        const key = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.detailFilter || '') : '';
        if (!key) return;
        const value = e.currentTarget.value || '';
        this.setFilterState(s => {
          const next = Object.assign({}, s.detailFilters || {});
          if (value) next[key] = value;
          else delete next[key];
          return { detailFilters: next, virtualStartRow: 0, virtualEndRow: 8 };
        }, { coalesceKey: 'detail:' + key });
      },
      syncDetailScrollTop: (e) => {
        if (this._syncingDetailScroll) return;
        const top = e.currentTarget;
        const body = this.activeDoc().querySelector('[data-detail-wrap]');
        if (!top || !body) return;
        this._syncingDetailScroll = true;
        body.style.setProperty('--library-detail-scroll-left', (top.scrollLeft || 0) + 'px');
        this._syncingDetailScroll = false;
      },
      syncDetailScrollBody: (e) => {
        if (this._syncingDetailScroll) return;
        const body = e.currentTarget;
        const top = this.activeDoc().querySelector('[data-detail-top-scroll]');
        if (!top || !body) return;
        this._syncingDetailScroll = true;
        body.style.setProperty('--library-detail-scroll-left', (top.scrollLeft || 0) + 'px');
        this._syncingDetailScroll = false;
      },
      toggleCompactActions: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.compactActionId || '') : '';
        if (!id) return;
        this.setState(s => ({ compactActionsId: s.compactActionsId === id ? null : id }));
      },
      stopCompactActionsClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      },
      catalogSourceOpen: !!this.state.catalogSourceOpen,
      catalogSourceSummary,
      catalogSourceMenu,
      catalogSourceAllRow,
      catalogSourcesAll,
      catalogSourceChevronDeg: this.state.catalogSourceOpen ? '180' : '0',
      toggleCatalogSource: () => this.setState(s => ({ catalogSourceOpen: !s.catalogSourceOpen })),
      pickCatalogSource: (e) => {
        const target = e && e.currentTarget;
        if (!target) return;
        if (target.dataset.all === '1') {
          this.setLibrarySourceSelection(catalogSourcesAll ? [] : catalogSourceOptions.map(source => source.id));
          return;
        }
        const id = target.dataset.catalogSource || '';
        const source = catalogSourceOptions.find(option => option.id === id);
        if (source) this.setLibrarySourceEnabled(id, !source.enabled);
      },
      tilesetActive,
      tilesetsUnavailable: tilesets.length === 0,
      showTilesetBrowser: tilesetActive,
      tilesetToggleBg: tilesetActive ? 'rgba(154,146,214,0.15)' : P.surface,
      tilesetToggleBd: tilesetActive ? '#5a5380' : P.border,
      tilesetToggleFg: tilesetActive ? (light ? '#4a4173' : '#efe9f6') : P.soft,
      tilesetBrowserTitle: activeTileset ? activeTileset.label + ' tileset' : 'Tilesets',
      activeTilesetKey: activeTileset ? activeTileset.key : '',
      activeTilesetSubset: validSubset,
      tilesetOptions,
      tilesetSubsetOptions,
      tilesetHallPieces,
      tilesetRoomPieces,
      tilesetAdditionalPieces,
      tilesetAllPiecesActive: !activeTilesetPiece,
      tilesetAllCount: tilesetAllIds.length,
      tilesetSelectionSummary,
      toggleTilesets: () => {
        if (tilesetActive) {
          this.setFilterState({ tileset: '', tilesetSubset: 'all', tilesetPiece: '', virtualStartRow: 0, virtualEndRow: 8 });
          return;
        }
        if (!tilesets.length) return;
        const sourceSelection = this.getLibrarySourceEnabled();
        sourceSelection.add('vanilla');
        this.setFilterState({
          catalogSources: [...sourceSelection],
          vanilla: true,
          tileset: tilesets[0].key,
          tilesetSubset: 'all',
          tilesetPiece: '',
          active: 'All',
          detailFilters: {},
          detailSort: null,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
      },
      closeTilesets: () => this.setFilterState({ tileset: '', tilesetSubset: 'all', tilesetPiece: '', virtualStartRow: 0, virtualEndRow: 8 }),
      pickTileset: (e) => {
        const key = e.currentTarget && e.currentTarget.value ? e.currentTarget.value : '';
        const nextSet = tilesets.find(set => set.key === key);
        if (!nextSet) return;
        const sourceSelection = this.getLibrarySourceEnabled();
        sourceSelection.add('vanilla');
        this.setFilterState({
          catalogSources: [...sourceSelection],
          vanilla: true,
          tileset: nextSet.key,
          tilesetSubset: 'all',
          tilesetPiece: '',
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
      },
      pickTilesetSubset: (e) => {
        if (!activeTileset) return;
        const key = e.currentTarget && e.currentTarget.value ? e.currentTarget.value : 'all';
        const allowed = key === 'all' || activeTileset.subsets.some(subset => subset.key === key);
        if (!allowed) return;
        const keepPiece = activeTilesetPiece && this.tilesetIds(activeTileset, key, activeTilesetPiece).length
          ? activeTilesetPiece
          : '';
        this.setFilterState({ tilesetSubset: key, tilesetPiece: keepPiece, virtualStartRow: 0, virtualEndRow: 8 });
      },
      pickTilesetPiece: (e) => {
        if (!activeTileset) return;
        const key = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.tilesetPiece || '') : '';
        const next = key && key === activeTilesetPiece ? '' : key;
        if (next && !this.tilesetIds(activeTileset, validSubset, next).length) return;
        this.setFilterState({ tilesetPiece: next, virtualStartRow: 0, virtualEndRow: 8 });
      },
      isPopout,
      showChrome: !isPopout,
      showPopoutButton: !isPopout && !narrow,
      showTabBar: !isPopout && !narrow,
      // Desktop puts the library controls (size / view mode / history) in the
      // Type row; popout & mobile keep them inline in the filter row.
      controlsInFilterRow: isPopout || narrow,
      showTypeMenu: isPopout || narrow,
      // Mobile: collapse the secondary filter controls behind a toggle so the
      // toolbar doesn't eat the screen. On desktop/popout the wrapper is
      // display:contents, leaving the existing flex layout untouched.
      showFilterToggle: narrow,
      filtersOpen,
      toggleFilters: () => this.setState(s => ({ filtersOpen: !s.filtersOpen })),
      filterWrapDisp: narrow ? (filtersOpen ? 'flex' : 'none') : 'contents',
      filterToggleLabel: filterCount > 0 ? 'Filters · ' + filterCount : 'Filters',
      filterToggleDotOp: filterCount > 0 ? '1' : '0',
      filterToggleChevron: filtersOpen ? '180' : '0',
      filterToggleFg: P.tagText,
      filterToggleBg: P.surface,
      filterToggleBd: P.border,
      catalogSourceDotOp: catalogSourceFilterActive ? '1' : '0',
      catalogSourceBtnFg: catalogSourceFilterActive ? (light ? '#4a4173' : '#efe9f6') : P.soft,
      catalogSourceBtnBg: catalogSourceFilterActive ? 'rgba(154,146,214,0.15)' : P.surface,
      catalogSourceBtnBd: catalogSourceFilterActive ? '#5a5380' : P.border,
      tabbarTop: isPopout ? 28 : (this.state.navHeight || (narrow ? 65 : 73)),
      barPadX: isPopout ? 12 : (narrow ? 14 : 32),
      secPadX: isPopout ? 12 : (narrow ? 14 : 32),
      openPopout: () => {
        const w = 1180, h = 820;
        const sx = window.screenLeft != null ? window.screenLeft : (screen.availLeft || 0);
        const sy = window.screenTop != null ? window.screenTop : 0;
        const left = Math.max(0, Math.round(sx + (window.outerWidth - w) / 2));
        const top = Math.max(0, Math.round(sy + (window.outerHeight - h) / 2));
        // popup + location/toolbar/menubar=no requests a chromeless window so
        // the browser's address bar auto-hides where the platform allows it.
        const win = window.open(
          location.pathname + '?popout=1',
          'oaab_library_popout',
          'popup=yes,location=no,toolbar=no,menubar=no,status=no,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top
        );
        if (win) win.focus();
      },
      aotOn: !!this.state.aot,
      aotTitle: this.state.aot
        ? 'Window is pinned on top — click to unpin'
        : 'Keep this window always on top of others',
      toggleAlwaysOnTop: () => this.toggleAlwaysOnTop(),
      imgLoad: (e) => {
        const img = e && e.target;
        if (!img) return;
        img.style.opacity = '1';
        const wrap = img.parentNode;
        const spin = wrap && wrap.querySelector('[data-spin]');
        if (spin) spin.style.display = 'none';
      },
      imgErr: (e) => {
        const img = e && e.target;
        if (!img) return;
        img.style.opacity = '0';
        const wrap = img.parentNode;
        const spin = wrap && wrap.querySelector('[data-spin]');
        if (spin) spin.style.display = 'none';
      },
      imgRef: (img) => {
        if (!img || !img.complete) return;
        const ok = !!(img.naturalWidth || img.naturalHeight);
        img.style.opacity = ok ? '1' : '0';
        const wrap = img.parentNode;
        const spin = wrap && wrap.querySelector('[data-spin]');
        if (spin) spin.style.display = 'none';
      },
      openRenderPreview: (e) => {
        const el = e.currentTarget;
        const src = el && el.dataset ? (el.dataset.render || '') : '';
        const id = (el.dataset.renderId || '').trim();
        const list = this._renderPreviewItems || [];
        const catalogItem = id ? this.findCatalogItem(id) : null;
        const item = (id && list.find(x => x.id === id))
          || (src && list.find(x => x.src === src))
          || (catalogItem && this.renderPreviewPayload(catalogItem))
          || (src ? {
          id,
          src,
          title: (el.dataset.renderTitle || '').trim(),
          meta: (el.dataset.renderMeta || '').trim(),
          lightTint: '',
          lightColor: '',
          lightHex: '',
          lightMask: '',
          hasContents: false,
          contentsTitle: '',
          hasEnchantment: false,
          enchantmentTitle: '',
          hasAlchemy: false,
          alchemyTitle: '',
          hasEffects: false,
          effects: [],
        } : null);
        if (!item || (!item.src && !item.mesh)) return;
        this.setState({
          renderPreview: item,
          renderPreviewLoaded: false,
          renderPreviewMode: 'preview',
        });
      },
      retryImportedThumbnail: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget?.dataset?.thumbnailId || '';
        if (id) this._workspace?.retryImportedThumbnail(id);
      },
      setRenderPreviewMode: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const mode = e.currentTarget?.dataset?.liveMode || 'preview';
        if (!['preview', '3d', 'details'].includes(mode)) return;
        if (mode !== 'preview' && !this.state.renderPreview?.mesh) return;
        this.setState({ renderPreviewMode: mode });
      },
      openEnchantmentDetails: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.enchantmentItemId || '') : '';
        const item = this.findCatalogItem(id);
        const payload = this.enchantmentPreviewPayload(item, 'enchantment');
        if (!payload) return;
        this.setState({ enchantmentPreview: payload, compactActionsId: null });
      },
      openAlchemyDetails: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.alchemyItemId || '') : '';
        const item = this.findCatalogItem(id);
        if (!item || !item.alchemy) return;
        const payload = this.enchantmentPreviewPayload(item, 'alchemy');
        if (!payload) return;
        this.setState({ enchantmentPreview: payload, compactActionsId: null });
      },
      openBookText: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.bookId || '') : '';
        const item = this.findCatalogItem(id);
        this.openBookPreviewForItem(item, bookTextQuery);
      },
      openContentsDetails: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.contentsId || '') : '';
        const item = this.findCatalogItem(id);
        const payload = this.contentsPreviewPayload(item);
        if (!payload) return;
        this.setState({ contentsPreview: payload, compactActionsId: null });
      },
      searchContentsId: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.contentSearchId || '') : '';
        this.searchFromContentsId(id);
      },
      closeContentsDetails: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.setState({ contentsPreview: null });
      },
      stopContentsDetailsClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      },
      closeBookText: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.setState({ bookPreview: null });
      },
      stopBookTextClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      },
      previousBookTextMatch: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.showAdjacentBookTextMatch(-1);
      },
      nextBookTextMatch: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.showAdjacentBookTextMatch(1);
      },
      closeEnchantmentDetails: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.setState({ enchantmentPreview: null });
      },
      stopEnchantmentDetailsClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      },
      closeRenderPreview: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.setState({ renderPreview: null, renderPreviewLoaded: false, renderPreviewMode: 'preview' });
      },
      stopRenderPreviewClick: (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
      },
      renderLoad: () => this.setState({ renderPreviewLoaded: true }),
      renderErr: () => this.setState({ renderPreviewLoaded: true }),
      onDrag: (e) => {
        const id = e.currentTarget.dataset.eid;
        if (!id) return;
        // Format A — Unicode text (CF_UNICODETEXT)
        e.dataTransfer.setData('text/plain', 'cs-object:' + id);
        // Format B — HTML Format, element carrying data-cs-object
        e.dataTransfer.setData('text/html',
          '<div data-cs-object="' + id + '">' + id + '</div>');
        e.dataTransfer.effectAllowed = 'copy';
      },
      detailRowMouseDown: (e) => {
        const row = e && e.currentTarget;
        const target = e && e.target;
        if (!row || !target || e.button !== 0) return;
        const restore = () => {
          row.draggable = true;
          document.removeEventListener('mouseup', restore, true);
          document.removeEventListener('dragend', restore, true);
        };
        const interactive = target.closest && target.closest('button,input,textarea,select,a');
        const selectableText = target.closest && target.closest('.library-detail-id,.library-detail-table td > span:not(.library-detail-empty)');
        if (selectableText || (interactive && !interactive.classList.contains('library-detail-thumb'))) {
          row.draggable = false;
          document.addEventListener('mouseup', restore, true);
          document.addEventListener('dragend', restore, true);
        } else {
          row.draggable = true;
        }
      },
      total,
      query: this.state.query || '',
      hasQuery: !!(rawQuery || selectedSearchMode),
      searchPlaceholder,
      searchModeLabel: this.searchModeLabel(displayedSearchMode),
      searchModeOpen: !!this.state.searchModeOpen,
      searchModeChevronDeg: this.state.searchModeOpen ? '180' : '0',
      searchModeMenu,
      showSearchSuggestions: !!(this.state.searchSuggestOpen && rawQuery && searchSuggestions.length),
      searchSuggestions,
      onSearch: (e) => this.setFilterState({ query: e.target.value, searchSuggestOpen: true, virtualStartRow: 0, virtualEndRow: 8 }, { coalesceKey: 'search' }),
      openSearchSuggestions: () => this.setState({ searchSuggestOpen: true }),
      clearSearch: () => this.setFilterState({ query: '', searchMode: '', searchModeOpen: false, searchSuggestOpen: false, virtualStartRow: 0, virtualEndRow: 8 }),
      toggleSearchMode: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        this.setState(s => ({ searchModeOpen: !s.searchModeOpen, searchSuggestOpen: false, tagOpen: false, typeOpen: false, relOpen: false }));
      },
      pickSearchMode: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const mode = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.searchMode || '') : '';
        this.setFilterState({
          searchMode: allowedSearchModes[mode] ? mode : '',
          searchModeOpen: false,
          searchSuggestOpen: true,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          const input = this.activeDoc().querySelector('.search-input');
          if (input) {
            try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
          }
        });
      },
      pickSearchSuggestion: (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (e && e.stopPropagation) e.stopPropagation();
        const data = e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
        const value = data.suggestion || '';
        const mode = data.suggestionMode || '';
        if (!value) return;
        this.setFilterState({
          query: value,
          searchMode: allowedSearchModes[mode] ? mode : '',
          searchSuggestOpen: false,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          const input = this.activeDoc().querySelector('.search-input');
          if (input) {
            try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
          }
        });
      },
      pickColor: (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const color = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.color || '') : '';
        if (!color) return;
        const allowed = this.allowedSearchModesForType(this.state.active || 'All');
        const curSearch = this.activeSearchMode(this.state.query || '', this.state.searchMode || '', allowed);
        const curColor = this.parseColorQuery(curSearch.mode === 'color' ? curSearch.term : '');
        const nextColor = this.parseColorQuery(color);
        const isCurrent = curSearch.mode === 'color' && curColor && nextColor && curColor.hex === nextColor.hex;
        this.setFilterState({
          query: isCurrent ? '' : color,
          searchMode: isCurrent ? '' : (allowed.color ? 'color' : ''),
          searchModeOpen: false,
          searchSuggestOpen: false,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          const input = this.activeDoc().querySelector('.search-input');
          if (input) {
            try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
          }
        });
      },
      pickInventoryContents: (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const id = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.inventoryId || '') : '';
        if (!id) return;
        const curSearch = this.activeSearchMode(this.state.query || '', this.state.searchMode || '', this.allowedSearchModesForType(this.state.active || 'All'));
        const isCurrent = curSearch.mode === 'inventory' && curSearch.term.toLowerCase() === id.toLowerCase();
        this.setFilterState({
          query: isCurrent ? '' : id,
          searchMode: isCurrent ? '' : 'inventory',
          searchModeOpen: false,
          searchSuggestOpen: false,
          tagOpen: false,
          typeOpen: false,
          relOpen: false,
          compactActionsId: null,
          renderPreview: null,
          renderPreviewLoaded: false,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          if (!isCurrent) {
            const target = this.activeDoc().querySelector('.library-results-header') || this.activeDoc().querySelector('[data-grid]');
            const toolbar = this.activeDoc().querySelector('[data-tabbar]');
            if (target) {
              const offset = (toolbar ? toolbar.getBoundingClientRect().height : 0) + 20;
              const top = target.getBoundingClientRect().top + this.activeWin().scrollY - offset;
              this.activeWin().scrollTo({ top: Math.max(0, Math.floor(top)), behavior: 'auto' });
            }
          }
          const input = this.activeDoc().querySelector('.search-input');
          if (input) {
            try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
          }
        });
      },
      pickEffect: (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const effect = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.effect || '') : '';
        if (!effect) return;
        const mode = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.effectMode || 'ingredient') : 'ingredient';
        const parsed = { mode: mode || 'ingredient', term: effect };
        const curSearch = this.activeSearchMode(this.state.query || '', this.state.searchMode || '', this.allowedSearchModesForType(this.state.active || 'All'));
        const isCurrent = curSearch.mode === parsed.mode && this.effectSearchKey(curSearch.term) === this.effectSearchKey(parsed.term);
        this.setFilterState({
          query: isCurrent ? '' : parsed.term,
          searchMode: isCurrent ? '' : parsed.mode,
          searchModeOpen: false,
          searchSuggestOpen: false,
          tagOpen: false,
          typeOpen: false,
          relOpen: false,
          compactActionsId: null,
          renderPreview: null,
          renderPreviewLoaded: false,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          if (!isCurrent) {
            const target = this.activeDoc().querySelector('.library-results-header') || this.activeDoc().querySelector('[data-grid]');
            const toolbar = this.activeDoc().querySelector('[data-tabbar]');
            if (target) {
              const offset = (toolbar ? toolbar.getBoundingClientRect().height : 0) + 20;
              const top = target.getBoundingClientRect().top + this.activeWin().scrollY - offset;
              this.activeWin().scrollTo({ top: Math.max(0, Math.floor(top)), behavior: 'auto' });
            }
          }
          const input = this.activeDoc().querySelector('.search-input');
          if (input) input.blur();
        });
      },
      pickEnchantmentEffect: (e) => {
        if (e.preventDefault) e.preventDefault();
        if (e.stopPropagation) e.stopPropagation();
        const effect = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.effect || '') : '';
        if (!effect) return;
        const mode = e.currentTarget && e.currentTarget.dataset ? (e.currentTarget.dataset.effectMode || 'enchant') : 'enchant';
        const parsed = { mode: mode || 'enchant', term: effect };
        const curSearch = this.activeSearchMode(this.state.query || '', this.state.searchMode || '', this.allowedSearchModesForType(this.state.active || 'All'));
        const isCurrent = curSearch.mode === parsed.mode && this.effectSearchKey(curSearch.term) === this.effectSearchKey(parsed.term);
        this.setFilterState({
          query: isCurrent ? '' : parsed.term,
          searchMode: isCurrent ? '' : parsed.mode,
          searchModeOpen: false,
          searchSuggestOpen: false,
          tagOpen: false,
          typeOpen: false,
          relOpen: false,
          enchantmentPreview: null,
          renderPreview: null,
          renderPreviewLoaded: false,
          virtualStartRow: 0,
          virtualEndRow: 8,
        });
        requestAnimationFrame(() => {
          if (!isCurrent) {
            const target = this.activeDoc().querySelector('.library-results-header') || this.activeDoc().querySelector('[data-grid]');
            const toolbar = this.activeDoc().querySelector('[data-tabbar]');
            if (target) {
              const offset = (toolbar ? toolbar.getBoundingClientRect().height : 0) + 20;
              const top = target.getBoundingClientRect().top + this.activeWin().scrollY - offset;
              this.activeWin().scrollTo({ top: Math.max(0, Math.floor(top)), behavior: 'auto' });
            }
          }
          const input = this.activeDoc().querySelector('.search-input');
          if (input) input.blur();
        });
      },
      typeCount: types.length,
      tabs,
      typeOpen: !!this.state.typeOpen,
      toggleType: () => this.setState(s => ({ typeOpen: !s.typeOpen, tagOpen: false, relOpen: false })),
      typeMenu,
      typeBtnLabel: active === 'All' ? 'All objects' : active,
      typeChevronDeg: this.state.typeOpen ? '180' : '0',
      typeBtnFg: active === 'All' ? P.soft : P.strong,
      typeBtnBg: active === 'All' ? P.surface : 'rgba(210,130,63,0.12)',
      typeBtnBd: active === 'All' ? P.border : '#4a3526',
      pickType: (e) => {
        const nextType = e.currentTarget.dataset.type;
        const allowed = this.allowedSearchModesForType(nextType);
        this.setFilterState(s => ({
          active: nextType,
          typeOpen: false,
          searchModeOpen: false,
          searchSuggestOpen: false,
          searchMode: allowed[s.searchMode] ? s.searchMode : '',
          detailFilters: {},
          detailSort: null,
          virtualStartRow: 0,
          virtualEndRow: 8,
        }));
      },
      searchFlex: narrow ? '1 1 100%' : '1 1 auto',
      rowWrap: (isPopout || narrow) ? 'wrap' : 'nowrap',
      ctrlBtnOrder: isPopout ? 1 : 0,
      dropOrder: isPopout ? 3 : 0,
      ctrlBtnMargin: isPopout ? '0' : 'auto',
      allRow,
      tagMenu,
      tagOpen: !!this.state.tagOpen,
      toggleTags: () => this.setState(s => ({ tagOpen: !s.tagOpen })),
      closeTags: () => this.setState({ tagOpen: false }),
      tagSummary: noTags ? 'All tags' : (selTags.length === 1 ? selTags[0] : selTags.length + ' tags selected'),
      tagDotOp: noTags ? '0' : '1',
      chevronDeg: this.state.tagOpen ? '180' : '0',
      tagBtnFg: noTags ? P.tagText : (light ? '#4a4173' : '#efe9f6'),
      tagBtnBg: noTags ? P.surface : 'rgba(154,146,214,0.12)',
      tagBtnBd: noTags ? P.border : '#5a5380',
      items,
      detailColumns,
      detailRows,
      detailColumnCount: detailColumns.length || 1,
      detailTopPad,
      detailBottomPad,
      detailHasTopPad: detailTopPad > 0,
      detailHasBottomPad: detailBottomPad > 0,
      detailTableWidth,
      showDetailView: detailView,
      showGalleryView: !detailView,
      gridPadTop: startRow * metrics.rowPitch,
      gridPadBottom: (rowCount - endRow) * metrics.rowPitch,
      activeLabel: tilesetActive ? tilesetResultLabel : (active === 'All' ? 'All objects' : active),
      tagLabel,
      hasTagFilter: !noTags,
      // ---- release facet ----
      relMenu,
      relAllRow,
      relModes,
      relOpen: !!this.state.relOpen,
      hasReleases: relData.length > 0,
      hasRelFilter: relSels.length > 0,
      relSummary: relSels.length === 0 ? 'All releases' : (relSels.length === 1 ? relSels[0] : relSels.length + ' releases'),
      relDotOp: relSels.length ? '1' : '0',
      relChevronDeg: this.state.relOpen ? '180' : '0',
      relBtnFg: relSels.length ? (light ? '#4a4173' : '#efe9f6') : P.tagText,
      relBtnBg: relSels.length ? 'rgba(154,146,214,0.12)' : P.surface,
      relBtnBd: relSels.length ? '#5a5380' : P.border,
      toggleRel: () => this.setState(s => ({ relOpen: !s.relOpen, tagOpen: false })),
      pickRel: (e) => {
        if (e.currentTarget.dataset.all === '1') { this.setFilterState({ releases: [], relKinds: ['added', 'modified'], relOpen: false }); return; }
        const v = e.currentTarget.dataset.rel || '';
        const cur = this.state.releases || [];
        const next = cur.indexOf(v) !== -1 ? cur.filter(x => x !== v) : cur.concat(v);
        this.setFilterState({ releases: next });
      },
      setRelMode: (e) => {
        const k = e.currentTarget.dataset.mode;
        const cur = this.state.relKinds || ['added', 'modified'];
        const next = cur.indexOf(k) !== -1 ? cur.filter(x => x !== k) : cur.concat(k);
        if (next.length === 0) return; // keep at least one kind selected
        this.setFilterState({ relKinds: next });
      },
      anyFilter: active !== 'All' || selTags.length > 0 || !!rawQuery || !!selectedSearchMode || relSels.length > 0 || tilesetActive || detailFilterCount > 0,
      clearAll: () => this.setFilterState({
        active: 'All', tags: [], query: '', releases: [], relKinds: ['added', 'modified'],
        tagOpen: false, typeOpen: false, relOpen: false, searchMode: '', searchModeOpen: false, searchSuggestOpen: false,
        tileset: '', tilesetSubset: 'all', tilesetPiece: '', detailFilters: {}, detailSort: null,
      }),
      shownCount: detailView ? detailItems.length : filtered.length,
      shownNoun: detailView ? 'rows' : 'thumbnails',
      isEmpty: !!d && (detailView ? detailItems.length === 0 : filtered.length === 0),
      emptyTitle,
      emptyCopy,
      pickTab: (e) => {
        const label = e.currentTarget.dataset.ttab;
        const allowed = this.allowedSearchModesForType(label);
        this.setFilterState(s => ({
          active: label,
          searchMode: allowed[s.searchMode] ? s.searchMode : '',
          searchModeOpen: false,
          searchSuggestOpen: false,
          detailFilters: {},
          detailSort: null,
          virtualStartRow: 0,
          virtualEndRow: 8,
        }));
        this.activeWin().scrollTo({ top: Math.min(this.activeWin().scrollY, 620), behavior: 'auto' });
      },
      pickTag: (e) => {
        const label = e.currentTarget.dataset.tag;
        if (e.currentTarget.dataset.all === '1') { this.setFilterState({ tags: [] }); return; }
        const cur = this.state.tags || [];
        const next = cur.indexOf(label) !== -1 ? cur.filter(l => l !== label) : cur.concat(label);
        this.setFilterState({ tags: next });
      },
      isLight: light,
      isDark: !light,
      showRenderPreview: !!this.state.renderPreview,
      renderPreviewHasImage: !!renderPreview?.src,
      renderPreviewHasMesh: !!renderPreview?.mesh,
      renderPreview3dTitle: renderPreview?.vanilla && !this._workspace?.assetSources?.length
        ? 'Add a Morrowind Data Files folder or BSA through Local files to enable 3D'
        : 'Inspect this mesh in 3D',
      renderPreviewWaitingForThumbnail: !!renderPreview?.thumbnailPending,
      renderPreviewModePreview: renderPreviewMode === 'preview',
      renderPreviewMode3d: renderPreviewMode === '3d',
      renderPreviewModeDetails: renderPreviewMode === 'details',
      renderPreviewMesh: renderPreview?.mesh || '',
      renderPreviewRecordSource: renderPreviewItem?.source || renderPreview?.source || 'Unknown',
      renderPreviewDetailsJson: JSON.stringify(renderPreviewDetails, null, 2),
      renderPreviewId: this.state.renderPreview ? this.state.renderPreview.id : '',
      renderPreviewSrc: this.state.renderPreview ? this.state.renderPreview.src : '',
      renderPreviewTitle: this.state.renderPreview ? this.state.renderPreview.title : '',
      renderPreviewMeta: this.state.renderPreview ? this.state.renderPreview.meta : '',
      hasRenderPreviewMeta: !!(this.state.renderPreview && this.state.renderPreview.meta),
      showRenderSpinner: !!(this.state.renderPreview && !this.state.renderPreviewLoaded),
      renderPreviewOpacity: this.state.renderPreviewLoaded ? '1' : '0',
      renderPreviewLightTint: this.state.renderPreview ? (this.state.renderPreview.lightTint || '') : '',
      renderPreviewLightMask: this.state.renderPreview ? (this.state.renderPreview.lightMask || '') : '',
      renderPreviewLightColor: this.state.renderPreview ? (this.state.renderPreview.lightColor || '') : '',
      renderPreviewLightHex: this.state.renderPreview ? (this.state.renderPreview.lightHex || '') : '',
      renderPreviewHasContents: !!(this.state.renderPreview && this.state.renderPreview.hasContents),
      renderPreviewContentsTitle: this.state.renderPreview ? (this.state.renderPreview.contentsTitle || '') : '',
      renderPreviewHasEnchantment: !!(this.state.renderPreview && this.state.renderPreview.hasEnchantment),
      renderPreviewEnchantmentTitle: this.state.renderPreview ? (this.state.renderPreview.enchantmentTitle || '') : '',
      renderPreviewHasAlchemy: !!(this.state.renderPreview && this.state.renderPreview.hasAlchemy),
      renderPreviewAlchemyTitle: this.state.renderPreview ? (this.state.renderPreview.alchemyTitle || '') : '',
      renderPreviewHasBookText: !!(this.state.renderPreview && this.state.renderPreview.hasBookText),
      renderPreviewBookTitle: this.state.renderPreview ? (this.state.renderPreview.bookTitle || '') : '',
      renderPreviewHasEffects: !!(this.state.renderPreview && this.state.renderPreview.hasEffects),
      renderPreviewEffects: this.state.renderPreview ? (this.state.renderPreview.effects || []) : [],
      showContentsPreview: !!this.state.contentsPreview,
      contentsPreviewTitle: this.state.contentsPreview ? this.state.contentsPreview.title : '',
      contentsPreviewMeta: this.state.contentsPreview ? this.state.contentsPreview.meta : '',
      contentsPreviewRows: this.state.contentsPreview ? (this.state.contentsPreview.rows || []) : [],
      showBookPreview: !!this.state.bookPreview,
      bookPreviewTitle: this.state.bookPreview ? (this.state.bookPreview.title || '') : '',
      bookPreviewMeta: this.state.bookPreview ? (this.state.bookPreview.meta || '') : '',
      bookPreviewSourceUrl: this.state.bookPreview ? (this.state.bookPreview.sourceUrl || '') : '',
      bookPreviewLoading: !!(this.state.bookPreview && this.state.bookPreview.loading),
      bookPreviewError: this.state.bookPreview ? (this.state.bookPreview.error || '') : '',
      bookPreviewBlocks: bookPreviewSearch.blocks,
      showBookPreviewSearchMatches: bookPreviewSearch.hasMatches,
      bookPreviewHasMultipleMatches: bookPreviewSearch.hasMultipleMatches,
      bookPreviewSearchTerm: bookPreviewSearch.term,
      bookPreviewSearchMatchLabel: bookPreviewSearch.matchLabel,
      showEnchantmentPreview: !!this.state.enchantmentPreview,
      enchantmentPreviewTitle: this.state.enchantmentPreview ? this.state.enchantmentPreview.title : '',
      enchantmentPreviewIsSpell: !!(this.state.enchantmentPreview && this.state.enchantmentPreview.kind === 'spell'),
      enchantmentPreviewIsAlchemy: !!(this.state.enchantmentPreview && this.state.enchantmentPreview.kind === 'alchemy'),
      enchantmentPreviewIsEnchantment: !(this.state.enchantmentPreview && (this.state.enchantmentPreview.kind === 'spell' || this.state.enchantmentPreview.kind === 'alchemy')),
      enchantmentPreviewItem: this.state.enchantmentPreview && (this.state.enchantmentPreview.kind === 'alchemy' || this.state.enchantmentPreview.kind === 'spell')
        ? this.enchantmentPreviewItemLabel(this.state.enchantmentPreview)
        : this.state.enchantmentPreview
        ? ((this.state.enchantmentPreview.itemName || this.state.enchantmentPreview.itemId || '') + (this.state.enchantmentPreview.itemType ? ' · ' + this.state.enchantmentPreview.itemType : ''))
        : '',
      enchantmentPreviewRows: this.state.enchantmentPreview ? (this.state.enchantmentPreview.rows || []) : [],
      enchantmentPreviewHasEffects: !!(this.state.enchantmentPreview && this.state.enchantmentPreview.hasEffects),
      enchantmentPreviewEffects: this.state.enchantmentPreview ? (this.state.enchantmentPreview.effects || []) : [],
      toggleTheme: () => {
        const n = light ? 'dark' : 'light';
        if (window.OAAB_THEME) window.OAAB_THEME.set(n);
        this.setState({ theme: n });
      },
    };
  }
  };
}
