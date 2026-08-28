import { writeStoredCatalogSources } from '../state.js';

export function withLibraryFilters(Base) {
  return class LibraryFilters extends Base {
  filterSnapshot(state) {
    const s = state || this.state || {};
    const filters = s.detailFilters || {};
    return {
      active: s.active || 'All',
      tags: (s.tags || []).slice(),
      query: s.query || '',
      searchMode: s.searchMode || '',
      releases: (s.releases || []).slice(),
      relKinds: (s.relKinds || ['added', 'modified']).slice(),
      vanilla: !!s.vanilla,
      catalogSources: Array.isArray(s.catalogSources)
        ? s.catalogSources.slice()
        : (s.vanilla ? ['oaab-data', 'vanilla'] : ['oaab-data']),
      detailFilters: Object.assign({}, filters),
      tileset: s.tileset || '',
      tilesetSubset: s.tilesetSubset || 'all',
      tilesetPiece: s.tilesetPiece || '',
    };
  }

  filterSnapshotKey(snapshot) {
    try { return JSON.stringify(snapshot || {}); }
    catch (e) { return ''; }
  }

  filterPatchForSnapshot(snapshot) {
    const snap = snapshot || this.filterSnapshot();
    return {
      active: snap.active || 'All',
      tags: (snap.tags || []).slice(),
      query: snap.query || '',
      searchMode: snap.searchMode || '',
      releases: (snap.releases || []).slice(),
      relKinds: (snap.relKinds || ['added', 'modified']).slice(),
      vanilla: !!snap.vanilla,
      catalogSources: Array.isArray(snap.catalogSources)
        ? snap.catalogSources.slice()
        : (snap.vanilla ? ['oaab-data', 'vanilla'] : ['oaab-data']),
      detailFilters: Object.assign({}, snap.detailFilters || {}),
      tileset: snap.tileset || '',
      tilesetSubset: snap.tilesetSubset || 'all',
      tilesetPiece: snap.tilesetPiece || '',
      tagOpen: false,
      typeOpen: false,
      relOpen: false,
      catalogSourceOpen: false,
      searchModeOpen: false,
      searchSuggestOpen: false,
      compactActionsId: null,
      renderPreview: null,
      renderPreviewLoaded: false,
      virtualStartRow: 0,
      virtualEndRow: 8,
    };
  }

  setFilterState(updater, options) {
    this.setState(s => {
      const patch = typeof updater === 'function' ? updater(s) : updater;
      if (!patch) return {};
      const hasCatalogSources = Object.prototype.hasOwnProperty.call(patch, 'catalogSources');
      if (hasCatalogSources || Object.prototype.hasOwnProperty.call(patch, 'vanilla')) {
        const sourceSelection = new Set(
          hasCatalogSources
            ? Array.from(patch.catalogSources || [])
            : (this._librarySourceEnabled || this.state.catalogSources || ['oaab-data']),
        );
        if (!hasCatalogSources) {
          if (patch.vanilla) sourceSelection.add('vanilla');
          else sourceSelection.delete('vanilla');
        }
        this._librarySourceEnabled = sourceSelection;
        patch.catalogSources = [...sourceSelection];
        patch.vanilla = sourceSelection.has('vanilla');
        try { localStorage.setItem('oaab_vanilla', patch.vanilla ? '1' : '0'); } catch (e) {}
        writeStoredCatalogSources(sourceSelection);
        this._workspace?.persistWorkspaceSettings?.();
        if (patch.vanilla && !this._vanillaItems) this.loadVanilla();
        patch.data = this.buildData(!!patch.vanilla);
        if (!patch.vanilla) {
          patch.tileset = '';
          patch.tilesetSubset = 'all';
          patch.tilesetPiece = '';
        }
      }

      const nextState = Object.assign({}, s, patch);
      const prevSnap = this.filterSnapshot(s);
      const nextSnap = this.filterSnapshot(nextState);
      const prevKey = this.filterSnapshotKey(prevSnap);
      const nextKey = this.filterSnapshotKey(nextSnap);
      if (prevKey === nextKey) return patch;

      let history = Array.isArray(s.filterHistory) ? s.filterHistory.slice() : [];
      let index = typeof s.filterHistoryIndex === 'number' ? s.filterHistoryIndex : history.length - 1;
      if (!history.length || index < 0) {
        history = [prevSnap];
        index = 0;
      } else {
        index = Math.max(0, Math.min(index, history.length - 1));
        if (this.filterSnapshotKey(history[index]) !== prevKey) {
          history = history.slice(0, index + 1);
          history.push(prevSnap);
          index = history.length - 1;
        }
      }

      const coalesceKey = options && options.coalesceKey ? options.coalesceKey : '';
      if (coalesceKey && s.filterHistoryCoalesce === coalesceKey && index === history.length - 1) {
        history[index] = nextSnap;
      } else {
        history = history.slice(0, index + 1);
        history.push(nextSnap);
        index = history.length - 1;
      }

      if (history.length > 10) {
        const drop = history.length - 10;
        history = history.slice(drop);
        index = Math.max(0, index - drop);
      }
      return Object.assign({}, patch, {
        filterHistory: history,
        filterHistoryIndex: index,
        filterHistoryCoalesce: coalesceKey,
      });
    });
  }

  moveFilterHistory(delta) {
    this.setState(s => {
      let history = Array.isArray(s.filterHistory) ? s.filterHistory.slice() : [];
      let index = typeof s.filterHistoryIndex === 'number' ? s.filterHistoryIndex : history.length - 1;
      const curSnap = this.filterSnapshot(s);
      const curKey = this.filterSnapshotKey(curSnap);

      if (!history.length || index < 0) {
        history = [curSnap];
        index = 0;
      } else {
        index = Math.max(0, Math.min(index, history.length - 1));
        if (this.filterSnapshotKey(history[index]) !== curKey) {
          history = history.slice(0, index + 1);
          history.push(curSnap);
          index = history.length - 1;
          if (history.length > 10) {
            const drop = history.length - 10;
            history = history.slice(drop);
            index = Math.max(0, index - drop);
          }
        }
      }

      const target = index + delta;
      if (target < 0 || target >= history.length) return {};
      const patch = this.filterPatchForSnapshot(history[target]);
      const sourceSelection = new Set(
        patch.catalogSources || (patch.vanilla ? ['oaab-data', 'vanilla'] : ['oaab-data']),
      );
      this._librarySourceEnabled = sourceSelection;
      patch.catalogSources = [...sourceSelection];
      patch.vanilla = sourceSelection.has('vanilla');
      try { localStorage.setItem('oaab_vanilla', patch.vanilla ? '1' : '0'); } catch (e) {}
      writeStoredCatalogSources(sourceSelection);
      this._workspace?.persistWorkspaceSettings?.();
      if (patch.vanilla && !this._vanillaItems) this.loadVanilla();
      patch.data = this.buildData(!!patch.vanilla);
      if (!patch.vanilla) {
        patch.tileset = '';
        patch.tilesetSubset = 'all';
        patch.tilesetPiece = '';
      }
      return Object.assign({}, patch, {
        filterHistory: history,
        filterHistoryIndex: target,
        filterHistoryCoalesce: '',
      });
    });
  }

  // Normalise a mesh path to a lowercase, forward-slash key relative to
  // Morrowind's Meshes folder. OAAB_Data_filtered.json stores relative mesh
  // paths like "oaab\\m\\foo.nif" or "x\\foo.nif"; the diffs store full repo
  // paths like "00 Core/meshes/oaab/m/foo.nif" (and patch sub-folders). Both
  // collapse to the same key so a changed file lines up with its catalogue id.

  searchModeDefs() {
    return [
      { key: '', label: 'All', kind: 'ID' },
      { key: 'color', label: 'Color', kind: 'Color' },
      { key: 'effect', label: 'Effect', kind: 'Effect' },
      { key: 'ingredient', label: 'IngredEffect', kind: 'Effect' },
      { key: 'alchemy', label: 'AlchemyEffect', kind: 'Effect' },
      { key: 'spell', label: 'SpellEffect', kind: 'Effect' },
      { key: 'enchant', label: 'EnchantEffect', kind: 'Effect' },
      { key: 'inventory', label: 'Contents', kind: 'ID' },
    ];
  }

  searchModeLabel(mode) {
    const defs = this.searchModeDefs();
    const found = defs.find(d => d.key === mode);
    return found ? found.label : defs[0].label;
  }

  allowedSearchModesForItems(items) {
    const scope = Array.isArray(items) ? items : [];
    const allowed = { '': true };
    const hasIngredient = scope.some(x => x && Array.isArray(x.effects) && x.effects.length);
    const hasAlchemy = scope.some(x => x && x.alchemy && Array.isArray(x.alchemy.effects) && x.alchemy.effects.length);
    const hasSpell = scope.some(x => x && x.detailKind === 'spell' && x.enchantment && Array.isArray(x.enchantment.effects) && x.enchantment.effects.length);
    const hasEnchant = scope.some(x => x && x.detailKind !== 'spell' && x.enchantment && Array.isArray(x.enchantment.effects) && x.enchantment.effects.length);
    const hasInventory = scope.some(x => x && x.hasContents && x.contentIds && x.contentIds.length);
    const hasColor = scope.some(x => x && (x.lightHex || x.lightRgb));
    if (hasColor) allowed.color = true;
    if (hasIngredient || hasAlchemy || hasSpell || hasEnchant) allowed.effect = true;
    if (hasIngredient) allowed.ingredient = true;
    if (hasAlchemy) allowed.alchemy = true;
    if (hasSpell) allowed.spell = true;
    if (hasEnchant) allowed.enchant = true;
    if (hasInventory) allowed.inventory = true;
    return allowed;
  }

  allowedSearchModesForType(type) {
    const d = this.state.data;
    const all = (d && d.items) || [];
    const scope = type === 'All' ? all : all.filter(x => x.type === type);
    return this.allowedSearchModesForItems(scope);
  }

  activeSearchMode(rawQuery, selectedMode, allowedModes) {
    const allowed = allowedModes || {};
    const mode = allowed[selectedMode] ? selectedMode : '';
    return { mode, term: mode ? String(rawQuery || '').trim() : '', explicit: false };
  }

  effectSuggestionLabels(items, mode) {
    const seen = Object.create(null);
    const out = [];
    const add = (effects) => {
      (effects || []).forEach(e => {
        const label = String((e && e.label) || '').trim();
        const key = this.effectSearchKey(label);
        if (!label || !key || seen[key]) return;
        seen[key] = 1;
        out.push(label);
      });
    };
    (items || []).forEach(x => {
      if (!x) return;
      if (mode === 'ingredient' || mode === 'effect') add(x.effects);
      if ((mode === 'alchemy' || mode === 'effect') && x.alchemy) add(x.alchemy.effects);
      if ((mode === 'spell' || mode === 'effect') && x.detailKind === 'spell' && x.enchantment) add(x.enchantment.effects);
      if ((mode === 'enchant' || mode === 'effect') && x.detailKind !== 'spell' && x.enchantment) add(x.enchantment.effects);
    });
    return out.sort((a, b) => a.localeCompare(b));
  }

  searchSuggestions(items, activeSearch) {
    const mode = activeSearch && activeSearch.mode ? activeSearch.mode : '';
    const term = String((activeSearch && activeSearch.term) || this.state.query || '').trim();
    if (!term) return [];
    const needle = term.toLowerCase();
    const source = Array.isArray(items) ? items : [];
    let values;
    if (mode === 'effect' || mode === 'ingredient' || mode === 'alchemy' || mode === 'spell' || mode === 'enchant') {
      values = this.effectSuggestionLabels(source, mode);
    } else if (mode === 'color') {
      values = source
        .map(x => String((x && x.lightHex) || '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } else {
      values = source
        .filter(x => mode !== 'inventory' || (x && x.hasContents && x.contentIds && x.contentIds.length))
        .map(x => String((x && x.id) || '').trim())
        .filter(Boolean)
        .sort((a, b) => this.csCompareIds(a, b));
    }
    const starts = [];
    const contains = [];
    const seen = Object.create(null);
    values.forEach(value => {
      const key = value.toLowerCase();
      if (seen[key] || key.indexOf(needle) === -1) return;
      seen[key] = 1;
      (key.indexOf(needle) === 0 ? starts : contains).push(value);
    });
    return starts.concat(contains).slice(0, 8).map(value => ({
      value,
      mode,
      kind: mode ? this.searchModeLabel(mode) : 'ID',
    }));
  }

  inventorySearchItems(ownerId, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    // `fallbackItems` is the active merged catalogue passed by renderVals.
    // Prefer it for both the owner and its entries so imported records remain
    // searchable when OAAB or vanilla records are also loaded.
    const displaySource = source.length ? source : all;
    const byKey = Object.create(null);
    displaySource.forEach(x => { byKey[String(x.id || '').toLowerCase()] = x; });
    const ownerSource = Object.create(null);
    source.forEach(x => { ownerSource[String(x.id || '').toLowerCase()] = x; });
    const owner = byKey[String(ownerId || '').trim().toLowerCase()];
    if (!owner || !ownerSource[String(ownerId || '').trim().toLowerCase()]) return [];
    return [owner].concat((owner.contentIds || []).map(id => byKey[String(id || '').toLowerCase()]).filter(Boolean));
  }

  effectSearchItems(effectKey, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    return source.filter(x =>
      (Array.isArray(x.effects) && x.effects.some(e => e.key.indexOf(effectKey) !== -1)) ||
      (x && x.alchemy && Array.isArray(x.alchemy.effects) && x.alchemy.effects.some(e => e.key.indexOf(effectKey) !== -1)) ||
      (x && x.enchantment && Array.isArray(x.enchantment.effects) && x.enchantment.effects.some(e => e.key.indexOf(effectKey) !== -1))
    );
  }

  ingredientEffectSearchItems(effectKey, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    return source.filter(x =>
      Array.isArray(x.effects) && x.effects.some(e => e.key.indexOf(effectKey) !== -1)
    );
  }

  enchantmentEffectSearchItems(effectKey, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    return source.filter(x => {
      if (x && x.detailKind === 'spell') return false;
      const e = x && x.enchantment && x.enchantment.effects;
      return Array.isArray(e) && e.some(effect => effect.key.indexOf(effectKey) !== -1);
    });
  }

  alchemyEffectSearchItems(effectKey, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    return source.filter(x => {
      const e = x && x.alchemy && x.alchemy.effects;
      return Array.isArray(e) && e.some(effect => effect.key.indexOf(effectKey) !== -1);
    });
  }

  spellEffectSearchItems(effectKey, fallbackItems) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const source = Array.isArray(fallbackItems) ? fallbackItems : all;
    return source.filter(x => {
      if (!x || x.detailKind !== 'spell') return false;
      const e = x.enchantment && x.enchantment.effects;
      return Array.isArray(e) && e.some(effect => effect.key.indexOf(effectKey) !== -1);
    });
  }
  };
}
