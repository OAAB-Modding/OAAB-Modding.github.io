export function withLibraryRecordDetails(Base) {
  return class LibraryRecordDetails extends Base {
  meshKey(p) {
    if (window.OAAB_LIBRARY && window.OAAB_LIBRARY.meshKey) {
      return window.OAAB_LIBRARY.meshKey(p);
    }
    const fwd = String(p || '').replace(/\\/g, '/').toLowerCase();
    const meshesMarker = '/meshes/';
    const i = fwd.lastIndexOf(meshesMarker);
    if (i !== -1) return fwd.slice(i + meshesMarker.length);
    if (fwd.startsWith('meshes/')) return fwd.slice('meshes/'.length);
    return /\.nif$/.test(fwd) ? fwd.replace(/^\/+/, '') : null;
  }

  // Match the Construction Set's practical ID ordering more closely than
  // browser locale collation does. In particular, "@" sorts before "_".

  csCompareStrings(a, b) {
    const aa = String(a == null ? '' : a);
    const bb = String(b == null ? '' : b);
    const al = aa.toLowerCase();
    const bl = bb.toLowerCase();
    const n = Math.min(al.length, bl.length);
    for (let i = 0; i < n; i++) {
      const d = al.charCodeAt(i) - bl.charCodeAt(i);
      if (d) return d;
    }
    if (al.length !== bl.length) return al.length - bl.length;
    if (aa === bb) return 0;
    const m = Math.min(aa.length, bb.length);
    for (let i = 0; i < m; i++) {
      const d = aa.charCodeAt(i) - bb.charCodeAt(i);
      if (d) return d;
    }
    return aa.length - bb.length;
  }

  csCompareIds(a, b) {
    return this.csCompareStrings(a, b);
  }

  naturalCompareStrings(a, b) {
    const aa = String(a == null ? '' : a);
    const bb = String(b == null ? '' : b);
    const aparts = aa.match(/\d+|\D+/g) || [''];
    const bparts = bb.match(/\d+|\D+/g) || [''];
    const n = Math.min(aparts.length, bparts.length);
    for (let i = 0; i < n; i++) {
      const ap = aparts[i];
      const bp = bparts[i];
      if (/^\d+$/.test(ap) && /^\d+$/.test(bp)) {
        const an = parseInt(ap, 10);
        const bn = parseInt(bp, 10);
        if (an !== bn) return an - bn;
        if (ap.length !== bp.length) return ap.length - bp.length;
      } else {
        const d = this.csCompareStrings(ap, bp);
        if (d) return d;
      }
    }
    if (aparts.length !== bparts.length) return aparts.length - bparts.length;
    return this.csCompareStrings(aa, bb);
  }

  // Map a record's raw type tag to a readable label. Some records carry a raw
  // numeric TES3 record tag instead of a string label.

  labelType(t) {
    const TYPE_LABELS = {
      '1497648962': 'Body Part',
      npc: 'NPC',
      MiscItem: 'Misc Item',
      RepairItem: 'Repair Item',
    };
    t = (t == null ? '' : String(t));
    if (TYPE_LABELS[t]) return TYPE_LABELS[t];
    if (TYPE_LABELS[t.toLowerCase()]) return TYPE_LABELS[t.toLowerCase()];
    if (/^\d+$/.test(t)) {
      // Decode a 32-bit little-endian record tag (e.g. "BODY").
      let n = parseInt(t, 10), tag = '';
      for (let i = 0; i < 4; i++) { const c = n & 0xff; if (c >= 32 && c < 127) tag += String.fromCharCode(c); n >>>= 8; }
      return tag || 'Misc';
    }
    return t || 'Misc';
  }

  isMeshlessLight(r) {
    return this.labelType(r && r.type).toLowerCase() === 'light' && !String((r && r.mesh) || '').trim();
  }

  isNpcRecord(r) {
    return this.labelType(r && r.type).toLowerCase() === 'npc';
  }

  isSpellRecord(r) {
    return this.labelType(r && r.type).toLowerCase() === 'spell';
  }

  isLeveledItemType(type) {
    return this.labelType(type).toLowerCase() === 'leveleditem';
  }

  isLeveledListType(type) {
    const key = this.labelType(type).toLowerCase().replace(/[\s_-]+/g, '');
    return key === 'leveleditem' || key === 'leveledcreature' || key === 'leveledlist';
  }

  displayType(type) {
    return this.isLeveledListType(type) ? 'Leveled List' : this.labelType(type);
  }

  tagDefinitions(payload) {
    const rows = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.tags) ? payload.tags : []);
    const seen = Object.create(null);
    const definitions = [];

    rows.forEach((row, index) => {
      const label = String((row && row.label) || '').trim();
      const cleanValues = (values) => (Array.isArray(values) ? values : [])
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
      const cleanWords = (values) => cleanValues(values)
        .filter(value => value.replace(/\*/g, ''));
      const include = cleanWords(row && row.include);
      const exclude = cleanWords(row && row.exclude);
      const excludeTypes = cleanValues(row && row.exclude_types);
      const labelKey = label.toLowerCase();

      if (!label || !include.length) {
        console.warn('tag rule skipped at index ' + index + ': label and at least one include word are required');
        return;
      }
      if (seen[labelKey]) {
        console.warn('tag rule skipped at index ' + index + ': duplicate label "' + label + '"');
        return;
      }

      definitions.push({ label, include, exclude, excludeTypes });
      seen[labelKey] = 1;
    });

    if (!definitions.length) console.warn('no valid library tag definitions were loaded');
    return definitions;
  }

  // Tag files use ordinary, case-insensitive ID fragments. A single * may be
  // placed between fragments when any text is allowed there (for example,
  // "b_*head" finds an ID containing "b_" followed later by "head").

  tagWordMatches(id, word) {
    const parts = String(word || '').split('*').filter(Boolean);
    if (!parts.length) return false;
    let offset = 0;
    for (let i = 0; i < parts.length; i++) {
      const found = id.indexOf(parts[i], offset);
      if (found === -1) return false;
      offset = found + parts[i].length;
    }
    return true;
  }

  tilesetDefinitions(payload) {
    const rawPieces = payload && Array.isArray(payload.pieces) ? payload.pieces : [];
    const pieceKeys = Object.create(null);
    const pieces = [];
    rawPieces.forEach((row, index) => {
      const key = String((row && row.key) || '').trim().toLowerCase();
      const label = String((row && row.label) || '').trim();
      if (!key || !label || pieceKeys[key]) {
        console.warn('tileset piece skipped at index ' + index + ': key and unique label are required');
        return;
      }
      const rawGroup = String((row && row.group) || '').trim().toLowerCase();
      const group = rawGroup === 'hall' || rawGroup === 'room' ? rawGroup : 'additional';
      const rawOrder = Number(row && row.order);
      const order = Number.isFinite(rawOrder) && rawOrder > 0 ? rawOrder : index + 1;
      pieces.push({ key, label, group, order });
      pieceKeys[key] = 1;
    });

    const seenSets = Object.create(null);
    const tilesets = [];
    const rows = payload && Array.isArray(payload.tilesets) ? payload.tilesets : [];
    rows.forEach((row, index) => {
      const key = String((row && row.key) || '').trim().toLowerCase();
      const label = String((row && row.label) || '').trim();
      if (!key || !label || seenSets[key]) {
        console.warn('tileset skipped at index ' + index + ': key and unique label are required');
        return;
      }
      const subsetSeen = Object.create(null);
      const subsets = [];
      (Array.isArray(row.subsets) ? row.subsets : []).forEach(subset => {
        const subsetKey = String((subset && subset.key) || '').trim().toLowerCase();
        const subsetLabel = String((subset && subset.label) || '').trim();
        if (!subsetKey || !subsetLabel || subsetSeen[subsetKey]) return;
        subsetSeen[subsetKey] = 1;
        subsets.push({ key: subsetKey, label: subsetLabel });
      });
      if (!subsets.length) return;

      const mappings = Object.create(null);
      const rawMappings = row && row.pieces && typeof row.pieces === 'object' ? row.pieces : {};
      Object.keys(rawMappings).forEach(rawPieceKey => {
        const pieceKey = String(rawPieceKey || '').trim().toLowerCase();
        if (!pieceKeys[pieceKey]) return;
        const bySubset = Object.create(null);
        const rawBySubset = rawMappings[rawPieceKey] || {};
        Object.keys(rawBySubset).forEach(rawSubsetKey => {
          const subsetKey = String(rawSubsetKey || '').trim().toLowerCase();
          if (!subsetSeen[subsetKey]) return;
          const ids = [];
          const idSeen = Object.create(null);
          (Array.isArray(rawBySubset[rawSubsetKey]) ? rawBySubset[rawSubsetKey] : []).forEach(value => {
            const id = String(value || '').trim();
            const idKey = id.toLowerCase();
            if (id && !idSeen[idKey]) { ids.push(id); idSeen[idKey] = 1; }
          });
          if (ids.length) bySubset[subsetKey] = ids;
        });
        if (Object.keys(bySubset).length) mappings[pieceKey] = bySubset;
      });
      tilesets.push({
        key,
        label,
        source: String(row.source || '').trim(),
        subsets,
        pieces: mappings,
      });
      seenSets[key] = 1;
    });
    return { pieces, tilesets };
  }

  tilesetIds(tileset, subsetKey, pieceKey) {
    if (!tileset) return [];
    const mappings = tileset.pieces || {};
    if (pieceKey && !mappings[pieceKey]) return [];
    const keys = pieceKey ? [pieceKey] : Object.keys(mappings);
    const result = [];
    const seen = Object.create(null);
    keys.forEach(key => {
      const bySubset = mappings[key] || {};
      const subsetKeys = subsetKey && subsetKey !== 'all' ? [subsetKey] : Object.keys(bySubset);
      subsetKeys.forEach(subset => (bySubset[subset] || []).forEach(id => {
        const idKey = String(id || '').trim().toLowerCase();
        if (idKey && !seen[idKey]) { seen[idKey] = 1; result.push(id); }
      }));
    });
    return result;
  }

  tilesetPieceArt(key) {
    if (!this._tilesetPieceArt) {
      // Every core icon starts as one square floor with four corner blocks and
      // four inset side walls. Individual pieces are made only by removing
      // components, mirroring the modular tileset grammar used in-game.
      const floor = 'M4 4H44V44H4Z';
      const corners = {
        topLeft: 'M4 4H14V14H4Z',
        topRight: 'M34 4H44V14H34Z',
        bottomRight: 'M34 34H44V44H34Z',
        bottomLeft: 'M4 34H14V44H4Z',
      };
      const walls = {
        top: 'M14 4H34V9H14Z',
        right: 'M39 14H44V34H39Z',
        bottom: 'M14 39H34V44H14Z',
        left: 'M4 14H9V34H4Z',
      };
      const framework = (removedCorners, removedWalls) => {
        const cornerRemovals = new Set(removedCorners || []);
        const wallRemovals = new Set(removedWalls || []);
        return {
          floor,
          corners: Object.keys(corners)
            .filter(name => !cornerRemovals.has(name))
            .map(name => corners[name])
            .join(''),
          walls: Object.keys(walls)
            .filter(name => !wallRemovals.has(name))
            .map(name => walls[name])
            .join(''),
        };
      };

      this._tilesetPieceArt = {
        hall_corner: framework([], ['right', 'bottom']),
        room_corner: framework(['bottomRight'], ['right', 'bottom']),
        hall_straight: framework([], ['top', 'bottom']),
        hall_3way: framework([], ['right', 'bottom', 'left']),
        hall_4way: framework([], ['top', 'right', 'bottom', 'left']),
        room_wall: framework(['bottomRight', 'bottomLeft'], ['right', 'bottom', 'left']),
        room_entry: framework(['bottomRight', 'bottomLeft'], ['top', 'right', 'bottom', 'left']),
        hall_cap: framework([], ['bottom']),
        room_wall_entry_r: framework(['bottomLeft'], ['right', 'bottom', 'left']),
        room_wall_entry_l: framework(['bottomRight'], ['right', 'bottom', 'left']),
        room_corner_outer_double: framework(['topRight', 'bottomLeft'], ['top', 'right', 'bottom', 'left']),
        room_corner_double_entry: framework(['bottomRight'], ['top', 'right', 'bottom', 'left']),
        room_center: framework(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'], ['top', 'right', 'bottom', 'left']),
        room_corner_outer: framework(['topRight', 'bottomRight', 'bottomLeft'], ['top', 'right', 'bottom', 'left']),
      };
    }
    return this._tilesetPieceArt[key] || { floor: '', corners: '', walls: '' };
  }

  detailTypeKey(type) {
    return String(this.displayType(type) || '').toLowerCase().replace(/[\s_-]+/g, '');
  }

  hiddenDetailKey(typeKey, key) {
    const flagsHidden = {
      activator: 1, alchemy: 1, armor: 1, book: 1, clothing: 1, container: 1,
      creature: 1, door: 1, ingredient: 1, static: 1,
    };
    if (key === 'enchanting') return true;
    if (key === 'flags' && flagsHidden[typeKey]) return true;
    if (typeKey === 'ingredient' && (key === 'effects' || key === 'skills' || key === 'attributes')) return true;
    if (typeKey === 'creature' && (
      key === 'gold' || key === 'sound' || key === 'blood_type' ||
      key === 'ai_data' || key === 'ai_packages'
    )) return true;
    if (typeKey === 'door' && (key === 'open_sound' || key === 'close_sound')) return true;
    if (typeKey === 'npc' && (
      key === 'gold' || key === 'blood_type' || key === 'skills' ||
      key === 'ai_data' || key === 'ai_packages'
    )) return true;
    return false;
  }

  detailSourceRecord(record) {
    const typeKey = this.detailTypeKey(record && record.type);
    const out = Object.create(null);
    const formatObject = (value) => Object.keys(value || {})
      .filter(k => value[k] != null && value[k] !== '')
      .map(k => k + ': ' + this.formatDetailValue(value[k]))
      .filter(Boolean)
      .join(', ');
    const add = (key, value) => {
      if (this.hiddenDetailKey(typeKey, key)) return;
      if (value == null || value === '') return;
      const formatted = key === 'color' && Array.isArray(value) && value.length >= 3
        ? this.rgbToHex(value.slice(0, 3).map(v => parseInt(v, 10) || 0))
        : this.formatDetailValue(value, formatObject);
      if (formatted !== '') out[key] = formatted;
    };
    const simpleTopKeys = [
      'flags', 'script', 'icon', 'sound', 'open_sound', 'close_sound', 'race',
      'class', 'faction', 'head', 'hair', 'npc_flags', 'ai_data',
      'ai_packages', 'travel_destinations',
      'encumbrance', 'container_flags', 'leveled_item_flags',
      'leveled_creature_flags', 'chance_none', 'creature_flags', 'blood_type',
      'scale',
    ];
    simpleTopKeys.forEach(k => add(k, record && record[k]));
    const data = record && record.data ? record.data : {};
    Object.keys(data || {}).forEach(k => add(k, data[k]));
    const stats = data && data.stats ? data.stats : null;
    if (stats) {
      const attrKeys = ['strength', 'intelligence', 'willpower', 'agility', 'speed', 'endurance', 'personality', 'luck'];
      (stats.attributes || []).forEach((v, i) => {
        if (attrKeys[i]) add(attrKeys[i], v);
      });
      add('health', stats.health);
      add('magicka', stats.magicka);
      add('fatigue', stats.fatigue);
      add('skills', stats.skills);
      delete out.stats;
    }
    return out;
  }

  formatDetailValue(value, formatObject) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
      if (!value.length) return '';
      if (value.every(v => v == null || typeof v !== 'object')) return value.join('-');
      const objectFormatter = formatObject || ((obj) => Object.keys(obj || {})
        .filter(k => obj[k] != null && obj[k] !== '')
        .map(k => k + ': ' + this.formatDetailValue(obj[k]))
        .filter(Boolean)
        .join(', '));
      return value.map(v => typeof v === 'object' ? objectFormatter(v) : this.formatDetailValue(v, objectFormatter)).filter(Boolean).join(' | ');
    }
    if (typeof value === 'object') {
      const objectFormatter = formatObject || ((obj) => Object.keys(obj || {})
        .filter(k => obj[k] != null && obj[k] !== '')
        .map(k => k + ': ' + this.formatDetailValue(obj[k]))
        .filter(Boolean)
        .join(', '));
      return objectFormatter(value);
    }
    return String(value);
  }

  detailLabel(key) {
    const labels = {
      thumb: '',
      id: 'ID',
      name: 'Name',
      mesh: 'Mesh',
      contents: 'Contents',
      book_text: 'Text',
      effects_summary: 'Effects',
      enchantment_summary: 'Enchantment',
      flags: 'Flags',
      script: 'Script',
      icon: 'Icon',
      sound: 'Sound',
      open_sound: 'Open Sound',
      close_sound: 'Close Sound',
      npc_flags: 'NPC Flags',
      ai_data: 'AI',
      ai_packages: 'AI Packages',
      travel_destinations: 'Travel',
      container_flags: 'Container Flags',
      leveled_item_flags: 'List Flags',
      leveled_creature_flags: 'List Flags',
      chance_none: 'Chance None',
      creature_flags: 'Creature Flags',
      blood_type: 'Blood',
      armor_type: 'Armor Type',
      weapon_type: 'Weapon Type',
      clothing_type: 'Clothing Type',
      book_type: 'Book Type',
      apparatus_type: 'Apparatus',
      creature_type: 'Creature Type',
      spell_type: 'Spell Type',
      bodypart_type: 'Body Part Type',
      armor_rating: 'Rating',
      max_charge: 'Max Charge',
      enchant_type: 'Enchant Type',
      enchantment: 'Enchant Pts',
      attack1: 'Attack 1',
      attack2: 'Attack 2',
      attack3: 'Attack 3',
      chop_min: 'Chop Min',
      chop_max: 'Chop Max',
      slash_min: 'Slash Min',
      slash_max: 'Slash Max',
      thrust_min: 'Thrust Min',
      thrust_max: 'Thrust Max',
    };
    if (labels[key]) return labels[key];
    return String(key || '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, ch => ch.toUpperCase());
  }

  detailPreferredKeys(type) {
    const attributes = [
      'level', 'speed', 'strength', 'intelligence', 'willpower', 'agility',
      'endurance', 'personality', 'luck',
    ];
    const vitals = ['health', 'magicka', 'fatigue'];
    const typeKey = this.detailTypeKey(type);
    if (typeKey === 'leveledlist') {
      return [
        'thumb', 'id', 'contents', 'chance_none',
        'leveled_item_flags', 'leveled_creature_flags', 'flags',
      ];
    }
    if (typeKey === 'creature') {
      return [
        'thumb', 'id', 'name', 'creature_type', 'contents',
        'level',
      ].concat(vitals, attributes.filter(k => k !== 'level'), [
        'soul', 'combat', 'magic', 'stealth', 'attack1', 'attack2', 'attack3',
        'creature_flags', 'script', 'scale', 'travel_destinations',
      ]);
    }
    if (typeKey === 'npc') {
      return [
        'thumb', 'id', 'name', 'race', 'class', 'faction', 'rank', 'contents',
      ].concat(attributes, [
        'disposition', 'reputation',
      ], vitals, [
        'combat', 'magic', 'stealth',
        'script', 'head', 'hair', 'npc_flags', 'travel_destinations',
      ]);
    }
    if (typeKey === 'light') {
      return [
        'thumb', 'id', 'name', 'color', 'weight', 'value', 'radius', 'time',
        'flags', 'script', 'sound',
      ];
    }
    return [
      'thumb', 'id', 'name',
      'armor_type', 'weapon_type', 'clothing_type', 'book_text', 'book_type', 'apparatus_type',
      'creature_type', 'spell_type', 'bodypart_type', 'part',
      'weight', 'value', 'cost', 'quality', 'uses', 'health', 'armor_rating',
      'skill', 'enchantment', 'enchantment_summary', 'effects_summary', 'speed', 'reach', 'radius', 'time',
      'level', 'strength', 'intelligence', 'willpower', 'agility', 'endurance',
      'personality', 'luck', 'magicka', 'fatigue', 'soul', 'combat', 'magic',
      'stealth', 'attack1', 'attack2', 'attack3', 'gold', 'contents', 'chance_none',
      'flags', 'container_flags', 'leveled_item_flags', 'leveled_creature_flags',
      'creature_flags', 'color', 'script', 'sound', 'open_sound', 'close_sound',
      'encumbrance', 'scale', 'race', 'class', 'faction', 'rank', 'head', 'hair',
      'npc_flags', 'blood_type', 'ai_data', 'ai_packages',
      'travel_destinations', 'skills',
    ];
  }

  detailColumnsFor(type, items) {
    const preferred = this.detailPreferredKeys(type);
    const tail = ['mesh', 'icon'];
    const present = Object.create(null);
    const source = Array.isArray(items) ? items : [];
    source.forEach(x => {
      if (!x) return;
      if (x.id) present.id = 1;
      if (x.name) present.name = 1;
      if (x.mesh) present.mesh = 1;
      if (x.hasContents && x.contentIds && x.contentIds.length) present.contents = 1;
      if (x.bookRef) present.book_text = 1;
      if ((x.effects && x.effects.length) || (x.alchemy && x.alchemy.effects && x.alchemy.effects.length) || (x.enchantment && x.enchantment.effects && x.enchantment.effects.length)) present.effects_summary = 1;
      if (x.enchantment && x.detailKind !== 'spell') present.enchantment_summary = 1;
      Object.keys(x.detail || {}).forEach(k => { present[k] = 1; });
    });
    present.thumb = 1;
    present.id = 1;
    if (type !== 'Static' && type !== 'Bodypart' && !this.isLeveledListType(type)) present.name = 1;
    const ordered = preferred.filter(k => present[k]);
    Object.keys(present).sort().forEach(k => {
      if (ordered.indexOf(k) === -1 && tail.indexOf(k) === -1) ordered.push(k);
    });
    tail.forEach(k => { if (present[k] && ordered.indexOf(k) === -1) ordered.push(k); });
    return ordered.map(key => {
      const isThumb = key === 'thumb';
      const width = this.detailColumnWidth(key);
      return {
        key,
        label: this.detailLabel(key),
        width,
        className: isThumb ? 'library-detail-th-thumb' : '',
        filterable: !isThumb,
        filterValue: '',
        sortMark: '',
        sortTitle: key === 'thumb' ? 'Preview' : 'Sort by ' + this.detailLabel(key),
      };
    });
  }

  detailColumnWidth(key) {
    if (key === 'thumb') return '54px';
    if (key === 'id') return '220px';
    if (key === 'mesh') return '260px';
    if (key === 'icon') return '230px';
    if (key === 'leveled_item_flags' || key === 'leveled_creature_flags') return '210px';
    if (key === 'enchantment_summary') return '220px';
    if (key === 'effects_summary') return '420px';
    if (key === 'contents') return '130px';
    if (key === 'book_text') return '96px';
    return '150px';
  }

  detailColumnPixelWidth(column) {
    const value = column && column.width ? parseInt(column.width, 10) : 150;
    return isFinite(value) ? value : 150;
  }

  detailRawValue(item, key) {
    if (!item) return '';
    if (key === 'id') return item.id || '';
    if (key === 'name') return item.name || '';
    if (key === 'mesh') return item.mesh || '';
    if (key === 'contents') {
      const n = item.contentIds && item.contentIds.length ? item.contentIds.length : 0;
      return n ? String(n) : '';
    }
    if (key === 'effects_summary') {
      const labels = [];
      const add = (arr) => (arr || []).forEach(e => {
        const label = e && e.label;
        if (label && labels.indexOf(label) === -1) labels.push(label);
      });
      add(item.effects);
      if (item.alchemy) add(item.alchemy.effects);
      if (item.enchantment) add(item.enchantment.effects);
      return labels.join(', ');
    }
    if (key === 'enchantment_summary') {
      return item.enchantment ? (item.enchantment.id || item.enchantment.title || item.enchantment.meta || '') : '';
    }
    const value = item.detail ? item.detail[key] : '';
    if (Array.isArray(value)) return value.join('-');
    return value == null ? '' : value;
  }

  detailDisplayValue(item, key) {
    const raw = this.detailRawValue(item, key);
    if (raw == null || raw === '') return '';
    if (key === 'contents') {
      const n = parseInt(raw, 10) || 0;
      return n ? (n + ' item' + (n === 1 ? '' : 's')) : '';
    }
    if (key === 'flags' || /_flags$/.test(key)) return this.flagsLabel(raw) || String(raw);
    return String(raw);
  }

  detailFilterText(item, key) {
    let text = this.detailDisplayValue(item, key);
    if (key === 'contents') {
      text += ' ' + (item.contentIds || []).join(' ');
    }
    return String(text || '').toLowerCase();
  }

  applyDetailFilters(items, columns, filters) {
    const active = Object.keys(filters || {}).filter(k => String(filters[k] || '').trim());
    if (!active.length) return items;
    return (items || []).filter(item => active.every(key => {
      const q = String(filters[key] || '').trim().toLowerCase();
      return !q || this.detailFilterText(item, key).indexOf(q) !== -1;
    }));
  }

  sortDetailItems(items, sort) {
    const key = sort && sort.key;
    const dir = sort && sort.dir === 'desc' ? -1 : 1;
    if (!key || key === 'thumb') return items;
    return (items || []).slice().sort((a, b) => {
      const av = this.detailRawValue(a, key);
      const bv = this.detailRawValue(b, key);
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      let cmp;
      if (isFinite(an) && isFinite(bn) && String(av).match(/^-?\d+(\.\d+)?$/) && String(bv).match(/^-?\d+(\.\d+)?$/)) {
        cmp = an - bn;
      } else {
        cmp = this.naturalCompareStrings(String(av || ''), String(bv || ''));
      }
      if (!cmp) cmp = this.csCompareIds(a && a.id, b && b.id);
      return cmp * dir;
    });
  }

  detailCell(item, column) {
    const key = column.key;
    if (key === 'thumb') {
      const generatedThumbnail = !!(item.imported && item.mesh);
      const thumbnailReady = !!item.thumbnailReady;
      const thumbnailFailed = generatedThumbnail && !thumbnailReady && item.thumbnailStatus === 'failed';
      return {
        key,
        className: 'library-detail-cell-thumb',
        isThumb: true,
        isId: false,
        isContents: false,
        isPlain: false,
        img: generatedThumbnail && !thumbnailReady ? '' : (item.img || ''),
        localThumbnail: generatedThumbnail && !thumbnailReady,
        thumbnailPending: generatedThumbnail && !thumbnailReady && !thumbnailFailed,
        thumbnailFailed,
        thumbnailStatusLabel: thumbnailFailed ? 'Preview unavailable' : 'Generating preview',
        lightTint: item.lightTint || '',
        lightMask: item.lightMask || '',
        render: (item.isSpell || item.isLeveledList || (generatedThumbnail && !thumbnailReady)) ? '' : (item.render || item.img || ''),
        renderId: item.id || '',
        renderTitle: item.id || '',
        renderMeta: item.mesh || item.name || item.type || '',
        previewClass: (item.isSpell || item.isLeveledList) ? 'library-detail-thumb-no-preview' : '',
        title: item.id || '',
      };
    }
    if (key === 'contents') {
      const count = item.contentIds && item.contentIds.length ? item.contentIds.length : 0;
      return {
        key,
        className: 'library-detail-cell-contents',
        isThumb: false,
        isId: false,
        isContents: true,
        isColor: false,
        isPlain: false,
        value: count ? (count + ' item' + (count === 1 ? '' : 's')) : '',
        hasContents: !!count,
        hasNoContents: !count,
        contentsTitle: count ? 'Show contents for ' + item.id : '',
        title: count ? (item.contentIds || []).join(', ') : '',
      };
    }
    if (key === 'book_text') {
      const ref = item && item.bookRef;
      return {
        key,
        className: 'library-detail-cell-book',
        isThumb: false,
        isId: false,
        isContents: false,
        isBookText: true,
        isColor: false,
        isPlain: false,
        hasBookText: !!ref,
        hasNoBookText: !ref,
        bookTitle: ref ? ('Read ' + (item.name || item.id || 'book')) : '',
        value: ref ? 'Read' : '',
        title: ref ? ((ref.file || ref.title || item.id || '') + (ref.anchor ? '#' + ref.anchor : '')) : '',
      };
    }
    const value = this.detailDisplayValue(item, key);
    if (key === 'color' && value) {
      const hex = String(item.lightHex || value || '').trim();
      const css = item.lightColor || hex;
      return {
        key,
        className: 'library-detail-cell-color',
        isThumb: false,
        isId: false,
        isContents: false,
        isColor: true,
        isPlain: false,
        colorHex: hex,
        colorCss: css,
        colorTitle: hex ? 'Search similar colors: ' + hex : '',
        value: hex,
        title: hex,
      };
    }
    return {
      key,
      className: key === 'id' ? 'library-detail-cell-id' : (key === 'effects_summary' ? 'library-detail-cell-effects' : ''),
      isThumb: false,
      isId: key === 'id',
      isContents: false,
      isColor: false,
      isPlain: key !== 'id',
      value: value || '-',
      title: value || '',
    };
  }

  detailRowsFor(items, columns, startIndex) {
    let rowIndex = startIndex || 0;
    return (items || []).map(item => ({
      id: item.id || '',
      tip: (item.type ? item.type + '\n' : '') + (item.id || '') + (item.name ? '  ' + String.fromCharCode(183) + '  ' + item.name : '') + (item.mesh ? '\n' + item.mesh : ''),
      parityClass: (rowIndex++ % 2) ? 'library-detail-row-even' : '',
      cells: columns.map(col => this.detailCell(item, col)),
    }));
  }

  contentPreviewRows(item) {
    const all = (this._oaabItems || []).concat(this._vanillaItems || []);
    const byKey = Object.create(null);
    all.forEach(x => { byKey[String(x.id || '').trim().toLowerCase()] = x; });
    const contentRecords = (this._oaabContentRecords || []).concat(this._vanillaContentRecords || []);
    const contentByKey = Object.create(null);
    contentRecords.forEach(x => {
      const key = String(x.id || '').trim().toLowerCase();
      if (key && !contentByKey[key]) contentByKey[key] = x;
    });
    const rows = [];
    const add = (kind, rawId, count) => {
      const id = String(rawId || '').trim();
      if (!id) return;
      const key = id.toLowerCase();
      const display = byKey[key];
      const found = display || contentByKey[key];
      rows.push({
        id,
        kind: found && found.type ? found.type : kind,
        name: found && found.name ? found.name : '',
        count: count == null || count === '' ? '' : String(count),
        draggable: !!display,
        title: found ? ((found.type || '') + (found.mesh ? '\n' + found.mesh : '')) : 'No display record found',
      });
    };
    (item.inventory || []).forEach(entry => {
      if (Array.isArray(entry)) add('Item', entry[1], entry[0]);
      else if (entry && typeof entry === 'object') add('Item', entry.id || entry.item || entry.object || entry.content, entry.count || entry.quantity || '');
    });
    (item.spells || []).forEach(entry => add('Spell', this.contentEntryId(entry, 0), ''));
    this.leveledListEntries(item).forEach(entry => {
      if (Array.isArray(entry)) add('Level', entry[0], entry[1]);
      else if (entry && typeof entry === 'object') add('Level', entry.id || entry.item || entry.object || entry.content, entry.level || entry.count || '');
    });
    return rows;
  }

  contentsPreviewPayload(item) {
    if (!item) return null;
    const rows = this.contentPreviewRows(item);
    return {
      id: item.id || '',
      title: 'Contents: ' + (item.id || ''),
      meta: rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + (item.name ? ' ' + String.fromCharCode(183) + ' ' + item.name : ''),
      rows,
    };
  }

  searchFromContentsId(id) {
    const targetId = String(id || '').trim();
    if (!targetId) return;
    const item = this.findCatalogItem(targetId);
    const nextType = (item && item.type) || (this.state.active && this.state.active !== 'All' ? this.state.active : 'All');
    this.setFilterState({
      active: nextType,
      tags: [],
      query: targetId,
      releases: [],
      relKinds: ['added', 'modified'],
      tagOpen: false,
      typeOpen: false,
      relOpen: false,
      searchMode: '',
      searchModeOpen: false,
      searchSuggestOpen: false,
      detailView: nextType !== 'All',
      detailFilters: {},
      detailSort: null,
      contentsPreview: null,
      renderPreview: null,
      renderPreviewLoaded: false,
      compactActionsId: null,
      virtualStartRow: 0,
      virtualEndRow: 8,
    });
    requestAnimationFrame(() => {
      const target = this.activeDoc().querySelector('.library-results-header') || this.activeDoc().querySelector('[data-detail-wrap]') || this.activeDoc().querySelector('[data-grid]');
      const toolbar = this.activeDoc().querySelector('[data-tabbar]');
      if (target) {
        const offset = (toolbar ? toolbar.getBoundingClientRect().height : 0) + 20;
        const top = target.getBoundingClientRect().top + this.activeWin().scrollY - offset;
        this.activeWin().scrollTo({ top: Math.max(0, Math.floor(top)), behavior: 'auto' });
      }
      const input = this.activeDoc().querySelector('.search-input');
      if (input) {
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      }
    });
  }

  leveledListEntries(record) {
    if (!record) return [];
    if (Array.isArray(record.leveledItems)) return record.leveledItems;
    if (Array.isArray(record.leveledCreatures)) return record.leveledCreatures;
    if (Array.isArray(record.items)) return record.items;
    if (Array.isArray(record.creatures)) return record.creatures;
    return [];
  }

  tomlArray(toml, key) {
    const m = new RegExp(key + '\\s*=\\s*\\[').exec(toml);
    if (!m) return [];
    let depth = 1, i = m.index + m[0].length, end = -1;
    for (; i < toml.length; i++) {
      const ch = toml[i];
      if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) { end = i; break; }
    }
    if (end === -1) return [];
    const toks = toml.slice(m.index + m[0].length, end).match(/"(?:[^"\\]|\\.)*"/g) || [];
    return toks.map(t => { try { return JSON.parse(t); } catch (e) { return null; } }).filter(Boolean);
  }

  contentEntryId(entry, arrayIdIndex) {
    if (Array.isArray(entry)) return entry[arrayIdIndex];
    if (entry && typeof entry === 'object') return entry.id || entry.item || entry.object || entry.content;
    if (typeof entry === 'string') return entry;
    return '';
  }

  directContentIds(entries, idIndex, displayByKey, selfId, seen) {
    const out = [];
    const selfKey = String(selfId || '').trim().toLowerCase();
    (entries || []).forEach(entry => {
      let raw = this.contentEntryId(entry, idIndex);
      if (!raw && idIndex === 0 && typeof entry === 'string') raw = entry;
      const key = String(raw || '').trim().toLowerCase();
      const display = displayByKey[key];
      if (!display || key === selfKey || seen[display.id]) return;
      seen[display.id] = 1;
      out.push(display.id);
    });
    return out;
  }

  containerContentIds(inventory, spells, displayByKey, selfId) {
    if (!Array.isArray(inventory) && !Array.isArray(spells)) return [];
    const itemIds = [];
    const spellIds = [];
    const seen = Object.create(null);
    itemIds.push.apply(itemIds, this.directContentIds(inventory, 1, displayByKey, selfId, seen));
    spellIds.push.apply(spellIds, this.directContentIds(spells, 0, displayByKey, selfId, seen));
    return itemIds.sort((a, b) => this.csCompareIds(a, b))
      .concat(spellIds.sort((a, b) => this.csCompareIds(a, b)));
  }

  leveledListContentIds(record, displayByKey, selfId) {
    const seen = Object.create(null);
    return this.directContentIds(this.leveledListEntries(record), 0, displayByKey, selfId, seen)
      .sort((a, b) => this.csCompareIds(a, b));
  }

  objectContentIds(item, displayByKey) {
    if (!item) return [];
    if (this.isLeveledListType(item.type)) return this.leveledListContentIds(item, displayByKey, item.id);
    return this.containerContentIds(item.inventory, item.spells, displayByKey, item.id);
  }

  leveledListThumbnailUrls(record, contentByKey, displayByKey, max, visiting, seen, collected) {
    const out = collected || [];
    const limit = max || 4;
    const seenUrls = seen || Object.create(null);
    const stack = visiting || Object.create(null);
    const addUrl = (url) => {
      if (!url || seenUrls[url] || out.length >= limit) return;
      seenUrls[url] = 1;
      out.push(url);
    };
    const addId = (raw) => {
      if (out.length >= limit) return;
      const key = String(raw || '').trim().toLowerCase();
      if (!key || stack[key]) return;
      const display = displayByKey[key];
      const content = contentByKey[key] || display;
      if (content && this.isLeveledListType(content.type)) {
        stack[key] = 1;
        this.leveledListThumbnailUrls(content, contentByKey, displayByKey, limit, stack, seenUrls, out);
        delete stack[key];
        return;
      }
      if (display && display.img) addUrl(display.img);
    };
    this.leveledListEntries(record).forEach(entry => addId(this.contentEntryId(entry, 0)));
    return out;
  }

  refreshLeveledListThumbnails(items, contentByKey, displayByKey) {
    (items || []).forEach(x => {
      if (!x || !this.isLeveledListType(x.type)) return;
      const thumbs = this.leveledListThumbnailUrls(x, contentByKey, displayByKey, 4)
        .map(src => ({ src }));
      x.collageThumbs = thumbs;
      x.hasCollage = thumbs.length > 0;
      x.collageClass = 'asset-collage-' + Math.max(1, Math.min(4, thumbs.length));
      x.hasListPlaceholder = !x.hasCollage;
      x.img = thumbs[0] ? thumbs[0].src : '';
    });
  }

  inventoryOwnerLabel(type) {
    const label = String(type || 'inventory');
    return label.toLowerCase() === 'npc' ? 'NPC' : label.toLowerCase();
  }
  };
}
