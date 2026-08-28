export function withLibraryPreviews(Base) {
  return class LibraryPreviews extends Base {
  npcThumbnailUrl(id) {
    const key = String(id || '').trim().toLowerCase();
    return key ? this._NPC_THUMB + key + '.webp' : '';
  }

  npcRenderUrl(id) {
    const key = String(id || '').trim().toLowerCase();
    return key ? this._NPC_RENDER + key + '.webp' : '';
  }

  wikiBookSlug(value) {
    return String(value || '')
      .replace(/['`]/g, '')
      .replace(/&/g, ' and ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  yamlScalar(value) {
    return String(value || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
  }

  wikiBookFrontmatter(markdown) {
    const text = String(markdown || '').replace(/\r\n?/g, '\n');
    if (text.indexOf('---\n') !== 0) return { title: '', ids: [] };
    const end = text.indexOf('\n---', 4);
    if (end === -1) return { title: '', ids: [] };
    const lines = text.slice(4, end).split('\n');
    const ids = [];
    let title = '';
    let key = '';
    lines.forEach(raw => {
      const line = String(raw || '');
      const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (top) {
        key = top[1].trim().toLowerCase();
        const value = this.yamlScalar(top[2]);
        if (key === 'title') title = value;
        if ((key === 'id' || key === 'ids') && value) {
          if (/^\[.*\]$/.test(value)) {
            value.replace(/^\[|\]$/g, '').split(',').forEach(part => {
              const id = this.yamlScalar(part);
              if (id) ids.push(id);
            });
          } else {
            ids.push(value);
          }
        }
        return;
      }
      const item = /^\s*-\s*(.+?)\s*$/.exec(line);
      if (item && (key === 'id' || key === 'ids')) {
        const id = this.yamlScalar(item[1]);
        if (id) ids.push(id);
      }
    });
    return { title, ids };
  }

  ordinalVariants(index) {
    const n = parseInt(index, 10) || 0;
    const cardinal = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] || String(n);
    const weird = ['', 'oneth', 'twoth', 'threeth', 'fourth', 'fiveth', 'sixth', 'seventh', 'eighth', 'nineth', 'tenth', 'eleventh', 'twelfth'][n] || cardinal;
    const ordinal = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'][n] || cardinal;
    const roman = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'][n] || '';
    return [String(n), cardinal, weird, ordinal, roman].filter(Boolean).filter((value, i, arr) => arr.indexOf(value) === i);
  }

  wikiBookAnchorForOrdinal(markdown, ordinalIndex) {
    const variants = this.ordinalVariants(ordinalIndex).map(v => this.wikiBookSlug(v)).filter(Boolean);
    const headings = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
      .filter(line => /^(#{1,6})\s+/.test(line))
      .map(line => {
        const text = this.wikiHeadingText(line);
        const slug = this.wikiBookSlug(text);
        const tokens = slug.split('-').filter(Boolean);
        return { text, slug, tokens };
      })
      .filter(x => x.slug);
    const hasVariant = (heading) => variants.some(v => heading.tokens.indexOf(v) !== -1 || heading.slug === v);
    const preferred = headings.find(h => hasVariant(h) && /\b(book|chapter|part|volume|vol)\b/i.test(h.text));
    if (preferred) return preferred.slug;
    const fallback = headings.find(hasVariant);
    return fallback ? fallback.slug : '';
  }

  wikiBookRef(record, wikiBooks) {
    if (!record || this.labelType(record.type).toLowerCase() !== 'book') return null;
    const key = String(record.id || '').trim().toLowerCase();
    const ref = key ? (wikiBooks || Object.create(null))[key] : null;
    const searchText = String(record.text || '').trim();
    if (!ref) {
      return searchText ? {
        source: 'record',
        title: record.name || record.id || 'Book',
        text: searchText,
        searchText,
      } : null;
    }
    return Object.assign({}, ref, {
      title: record.name || ref.title || record.id || ref.file,
      searchText: searchText || ref.searchText || '',
    });
  }

  uespBookTitleFromName(value) {
    const title = String(value || '').replace(/\s+/g, ' ').trim();
    return title ? 'Morrowind:' + title : '';
  }

  uespPageUrl(title) {
    const clean = String(title || '').replace(/\s+/g, '_').trim();
    if (!clean) return '';
    return this._UESP_BOOK_SITE + clean
      .split('/')
      .map(part => encodeURIComponent(part))
      .join('/')
      .replace(/Morrowind%3A/i, 'Morrowind:');
  }

  uespApiUrl(params) {
    const query = new URLSearchParams(Object.assign({
      format: 'json',
      formatversion: '2',
      origin: '*',
    }, params || {}));
    return this._UESP_API + '?' + query.toString();
  }

  uespBookRef(record) {
    if (!record || this.labelType(record.type).toLowerCase() !== 'book') return null;
    const id = String(record.id || '').trim();
    if (!id) return null;
    const title = this.uespBookTitleFromName(record.name || id);
    return {
      source: 'uesp',
      id,
      title: record.name || id,
      uespTitle: title,
      wikiUrl: this.uespPageUrl(title),
      searchText: String(record.text || '').trim(),
    };
  }

  uespTitleScore(title, preferredTitle) {
    const t = String(title || '').trim().toLowerCase();
    const preferred = String(preferredTitle || '').trim().toLowerCase();
    if (preferred && t === preferred) return 4;
    if (/^morrowind:(books|scrolls|letters|notes)$/i.test(title || '')) return 0;
    if (/^morrowind:/i.test(title || '')) return 2;
    return 1;
  }

  fetchUespSearchTitles(id, preferredTitle) {
    const cleanId = String(id || '').replace(/"/g, '').trim();
    if (!cleanId) return Promise.resolve([]);
    return fetch(this.uespApiUrl({
      action: 'query',
      list: 'search',
      srnamespace: '110',
      srlimit: '12',
      srsearch: '"' + cleanId + '"',
    }))
      .then(r => {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(data => {
        const seen = Object.create(null);
        return (((data || {}).query || {}).search || [])
          .map(row => String((row || {}).title || '').trim())
          .filter(title => /^Morrowind:/i.test(title))
          .filter(title => {
            const key = title.toLowerCase();
            if (!key || seen[key]) return false;
            seen[key] = 1;
            return true;
          })
          .sort((a, b) => this.uespTitleScore(b, preferredTitle) - this.uespTitleScore(a, preferredTitle));
      });
  }

  fetchUespParsedPage(title) {
    return fetch(this.uespApiUrl({
      action: 'parse',
      page: title,
      prop: 'text|wikitext',
      redirects: '1',
    }))
      .then(r => {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      })
      .then(data => {
        if (data && data.error) throw new Error(data.error.info || data.error.code || 'UESP parse failed');
        if (!data || !data.parse || !data.parse.text) throw new Error('No UESP page text found.');
        return data.parse;
      });
  }

  uespParsedPageIdMatches(parsed, id) {
    const target = String(id || '').trim().toLowerCase();
    if (!target || !parsed) return false;
    const doc = new DOMParser().parseFromString(String(parsed.text || ''), 'text/html');
    const hasBookBody = !!doc.querySelector('.book, .poem');
    const rows = Array.from(doc.querySelectorAll('table.infobox tr, table.wikitable tr'));
    for (let i = 0; i < rows.length; i++) {
      const th = rows[i].querySelector('th');
      const td = rows[i].querySelector('td');
      const label = th ? th.textContent.replace(/\s+/g, ' ').trim().toLowerCase() : '';
      if (label !== 'id' || !td) continue;
      const rawIdText = this.uespNodeText(td).replace(/\u00a0/g, ' ');
      const idText = rawIdText
        .replace(/\u00a0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (idText === target) return true;
      const ids = rawIdText
        .split(/[,;\n]+/)
        .map(x => x.replace(/\s+/g, ' ').trim().toLowerCase())
        .filter(Boolean);
      if (ids.indexOf(target) !== -1) return true;
    }
    if (!hasBookBody) return false;
    const wikitext = String(parsed.wikitext || '');
    return new RegExp('(^|[\\s|,;])' + target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([\\s|,;]|$)', 'i').test(wikitext);
  }

  fetchFirstUespBookPage(titles, id) {
    const list = (titles || []).filter(Boolean);
    let index = 0;
    let lastError = null;
    const next = () => {
      if (index >= list.length) throw (lastError || new Error('No matching UESP page found.'));
      const title = list[index++];
      return this.fetchUespParsedPage(title)
        .then(parsed => {
          if (this.uespParsedPageIdMatches(parsed, id)) return parsed;
          lastError = new Error('UESP page ID did not match: ' + title);
          return next();
        })
        .catch(err => {
          lastError = err;
          return next();
        });
    };
    return next();
  }

  resolveUespBookPage(item, ref) {
    const id = String((item && item.id) || (ref && ref.id) || '').trim();
    const key = id.toLowerCase();
    if (!key) return Promise.reject(new Error('No UESP book ID.'));
    if (this._uespBookCache && this._uespBookCache[key]) return this._uespBookCache[key];
    const preferredTitle = (ref && ref.uespTitle) || this.uespBookTitleFromName((item && item.name) || id);
    const promise = this.fetchUespSearchTitles(id, preferredTitle)
      .catch(() => [])
      .then(titles => {
        const list = titles.slice();
        if (preferredTitle && list.map(x => x.toLowerCase()).indexOf(preferredTitle.toLowerCase()) === -1) {
          list.push(preferredTitle);
        }
        return this.fetchFirstUespBookPage(list, id);
      });
    this._uespBookCache[key] = promise.catch(err => {
      if (this._uespBookCache) delete this._uespBookCache[key];
      throw err;
    });
    return this._uespBookCache[key];
  }

  cleanUespText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  uespNodeText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.nodeValue || '';
    if (node.nodeType !== 1) return '';
    const tag = node.tagName ? node.tagName.toUpperCase() : '';
    if (tag === 'BR') return '\n';
    if (tag === 'STYLE' || tag === 'SCRIPT') return '';
    if (node.classList && (node.classList.contains('mw-editsection') || node.classList.contains('reference'))) return '';
    return Array.from(node.childNodes || []).map(child => this.uespNodeText(child)).join('');
  }

  uespAbsoluteUrl(value) {
    const src = String(value || '').trim();
    if (!src) return '';
    if (/^\/\//.test(src)) return 'https:' + src;
    if (/^https?:\/\//i.test(src)) return src;
    try {
      return new URL(src, this._UESP_BOOK_SITE).href;
    } catch (e) {
      return '';
    }
  }

  uespFullImageUrl(value) {
    const url = this.uespAbsoluteUrl(value);
    if (!url) return '';
    const match = /^(https?:\/\/images\.uesp\.net)\/thumb\/([^?#]+?)\/[^\/?#]+(?:[?#].*)?$/i.exec(url);
    return match ? (match[1] + '/' + match[2]) : url;
  }

  uespImageBlocks(el) {
    const seen = Object.create(null);
    const images = [];
    Array.from((el && el.querySelectorAll) ? el.querySelectorAll('img') : []).forEach(img => {
      const src = this.uespFullImageUrl(img.getAttribute('src') || '');
      if (!src || seen[src]) return;
      seen[src] = 1;
      images.push({
        isImage: true,
        src,
        alt: img.getAttribute('alt') || img.getAttribute('title') || 'Book art',
      });
    });
    return images;
  }

  uespBookBlocksFromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    Array.from(doc.querySelectorAll('style,script,.mw-editsection,sup.reference,table.infobox')).forEach(el => el.remove());
    const root = doc.querySelector('.book, .poem') || doc.querySelector('.mw-parser-output') || doc.body;
    const blocks = [];
    const pushText = (el, kind) => {
      const text = this.cleanUespText(this.uespNodeText(el));
      if (!text) return;
      if (kind === 'heading') blocks.push({ isHeading: true, text });
      else if (kind === 'quote') blocks.push({ isQuote: true, text });
      else blocks.push({ isParagraph: true, text });
    };
    const visit = (el) => {
      if (!el || el.nodeType !== 1) return;
      const tag = el.tagName.toUpperCase();
      if (tag === 'HR') {
        blocks.push({ isRule: true, text: '' });
        return;
      }
      if (/^H[1-6]$/.test(tag)) {
        pushText(el, 'heading');
        return;
      }
      if (tag === 'BLOCKQUOTE') {
        pushText(el, 'quote');
        return;
      }
      if (tag === 'IMG') {
        const src = this.uespFullImageUrl(el.getAttribute('src') || '');
        if (src) blocks.push({ isImage: true, src, alt: el.getAttribute('alt') || 'Book art' });
        return;
      }
      if (tag === 'P' || tag === 'PRE') {
        this.uespImageBlocks(el).forEach(image => blocks.push(image));
        pushText(el, 'paragraph');
        return;
      }
      if (tag === 'UL' || tag === 'OL') {
        const lines = Array.from(el.querySelectorAll('li')).map(li => '- ' + this.cleanUespText(this.uespNodeText(li))).filter(Boolean);
        if (lines.length) blocks.push({ isParagraph: true, text: lines.join('\n') });
        return;
      }
      if (tag === 'DL') {
        const lines = Array.from(el.querySelectorAll('dt,dd')).map(row => this.cleanUespText(this.uespNodeText(row))).filter(Boolean);
        if (lines.length) blocks.push({ isParagraph: true, text: lines.join('\n') });
        return;
      }
      const hasBlockChildren = Array.from(el.children || []).some(child => /^(P|DIV|H[1-6]|BLOCKQUOTE|HR|UL|OL|DL|PRE|IMG)$/i.test(child.tagName || ''));
      if (hasBlockChildren) {
        Array.from(el.childNodes || []).forEach(child => {
          if (child.nodeType === 1) visit(child);
          else if (this.cleanUespText(child.nodeValue || '')) blocks.push({ isParagraph: true, text: this.cleanUespText(child.nodeValue || '') });
        });
      } else {
        pushText(el, 'paragraph');
      }
    };
    Array.from(root.children || []).forEach(child => visit(child));
    if (!blocks.length) {
      const text = this.cleanUespText(this.uespNodeText(root));
      if (text) blocks.push({ isParagraph: true, text });
    }
    return blocks;
  }

  fetchUespBookPreview(item, ref) {
    return this.resolveUespBookPage(item, ref)
      .then(parsed => {
        const blocks = this.uespBookBlocksFromHtml(parsed.text || '');
        return {
          id: item.id || '',
          title: item.name || item.id || (ref && ref.title) || 'Book',
          meta: '',
          sourceUrl: this.uespPageUrl(parsed.title || (ref && ref.uespTitle) || ''),
          loading: false,
          error: '',
          blocks: blocks.length ? blocks : [{ isParagraph: true, text: 'No readable text was found for this UESP entry.' }],
        };
      });
  }

  wikiHeadingText(line) {
    return String(line || '')
      .replace(/^#{1,6}\s*/, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  markdownSection(markdown, anchor) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const target = String(anchor || '').replace(/^#/, '').trim();
    if (!target) return lines.join('\n');
    let start = -1, level = 7;
    for (let i = 0; i < lines.length; i++) {
      const m = /^(#{1,6})\s+/.exec(lines[i]);
      if (!m) continue;
      const text = this.wikiHeadingText(lines[i]);
      if (this.wikiBookSlug(text) === target) {
        start = i;
        level = m[1].length;
        break;
      }
    }
    if (start === -1) return lines.join('\n');
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      const m = /^(#{1,6})\s+/.exec(lines[i]);
      if (m && m[1].length <= level) {
        end = i;
        break;
      }
    }
    return lines.slice(start, end).join('\n');
  }

  markdownInlineText(value) {
    return String(value || '')
      .replace(/!\[\[([^\]]+)\]\]/g, '')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
      .replace(/[*_~`]/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  wikiEncodePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map(part => encodeURIComponent(part))
      .join('/');
  }

  wikiImageAlt(target, label) {
    const given = String(label || '').trim();
    if (given && !/^\d+(?:x\d+)?$/i.test(given)) return this.markdownInlineText(given);
    const file = String(target || '').replace(/\\/g, '/').split('/').pop() || 'Book art';
    return file.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Book art';
  }

  wikiImageUrl(target, ref) {
    let path = String(target || '').trim().replace(/^<|>$/g, '');
    if (!path) return '';
    if (/^\/\//.test(path)) return 'https:' + path;
    if (/^https?:\/\//i.test(path)) return path;
    path = path.split('#')[0].split('?')[0].trim().replace(/\\/g, '/');
    if (!path) return '';
    if (path.indexOf('/') === -1) return this._WIKI_BOOKART_RAW + this.wikiEncodePath(path);
    let clean = path.replace(/^\.?\//, '');
    if (/^oaab-content\//i.test(clean)) return this._WIKI_RAW_ROOT + this.wikiEncodePath(clean);
    if (/^resources\/gallery\/bookart\//i.test(clean)) return this._WIKI_RAW_ROOT + this.wikiEncodePath('oaab-content/' + clean);
    if (/^bookart\//i.test(clean)) return this._WIKI_BOOKART_RAW + this.wikiEncodePath(clean.replace(/^bookart\//i, ''));
    try {
      return new URL(path, (ref && ref.rawUrl) || this._WIKI_BOOK_RAW).href;
    } catch (e) {
      return '';
    }
  }

  markdownImageBlocks(line, ref) {
    const images = [];
    let text = String(line || '');
    text = text.replace(/!\[\[([^\]]+)\]\]/g, (match, target) => {
      const parts = String(target || '').split('|');
      const imageTarget = parts.shift() || '';
      const src = this.wikiImageUrl(imageTarget, ref);
      if (src) images.push({ isImage: true, src, alt: this.wikiImageAlt(imageTarget, parts.join('|')) });
      return ' ';
    });
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, target) => {
      const src = this.wikiImageUrl(target, ref);
      if (src) images.push({ isImage: true, src, alt: this.wikiImageAlt(target, alt) });
      return ' ';
    });
    return { text: text.trim(), images };
  }

  markdownBookBlocks(markdown, ref) {
    const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
    const blocks = [];
    let para = [];
    let inFrontMatter = false;
    const flush = () => {
      const text = this.markdownInlineText(para.join('\n'));
      para = [];
      if (text) blocks.push({ isParagraph: true, text });
    };
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i] || '';
      if (i === 0 && line.trim() === '---') { inFrontMatter = true; continue; }
      if (inFrontMatter) {
        if (line.trim() === '---') inFrontMatter = false;
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        flush();
        blocks.push({ isRule: true, text: '' });
        continue;
      }
      if (/^#{1,6}\s+/.test(line)) {
        flush();
        const text = this.wikiHeadingText(line);
        if (text) blocks.push({ isHeading: true, text });
        continue;
      }
      if (/^\s*>/.test(line)) {
        flush();
        continue;
      }
      const media = this.markdownImageBlocks(line, ref);
      if (media.images.length) {
        flush();
        media.images.forEach(image => blocks.push(image));
        if (media.text) para.push(media.text);
        continue;
      }
      para.push(line.trim());
    }
    flush();
    return blocks;
  }

  decodePluginBookEntities(value) {
    const named = {
      amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    };
    const codePoint = (code, fallback) => (
      Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : fallback
    );
    return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (/^#x/i.test(entity)) {
        return codePoint(parseInt(entity.slice(2), 16), match);
      }
      if (/^#/.test(entity)) {
        return codePoint(parseInt(entity.slice(1), 10), match);
      }
      return Object.prototype.hasOwnProperty.call(named, entity.toLowerCase())
        ? named[entity.toLowerCase()]
        : match;
    });
  }

  pluginBookBlocks(value) {
    const ruleMarker = '__OAAB_BOOK_RULE__';
    const text = this.decodePluginBookEntities(String(value || '')
      .replace(/<hr\b[^>]*>/gi, '\n\n' + ruleMarker + '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<img\b[^>]*>/gi, '\n')
      .replace(/<\/(?:div|p|center|h[1-6])\s*>/gi, '\n\n')
      .replace(/<(?:div|p|center|h[1-6])\b[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''))
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (!text) return [];
    return text.split(/\n{2,}/).map(section => section.trim()).filter(Boolean).map(section => (
      section === ruleMarker
        ? { isRule: true, text: '' }
        : { isParagraph: true, text: section }
    ));
  }

  fetchBookPreview(item) {
    const ref = item && item.bookRef;
    if (ref && (ref.source === 'plugin' || ref.source === 'record')) {
      const blocks = this.pluginBookBlocks(ref.text || '');
      return Promise.resolve({
        id: item.id || '',
        title: item.name || item.id || ref.title || 'Book',
        meta: '',
        sourceUrl: '',
        loading: false,
        error: '',
        blocks: blocks.length ? blocks : [{ isParagraph: true, text: 'No readable text was found in this record.' }],
      });
    }
    if (ref && ref.source === 'uesp') return this.fetchUespBookPreview(item, ref);
    if (!ref || !ref.rawUrl) return Promise.reject(new Error('No wiki book text found.'));
    return fetch(ref.rawUrl)
      .then(r => {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.text();
      })
      .then(markdown => {
        const section = this.markdownSection(markdown, ref.anchor);
        const blocks = this.markdownBookBlocks(section, ref);
        return {
          id: item.id || '',
          title: item.name || item.id || ref.title || 'Book',
          meta: '',
          sourceUrl: ref.wikiUrl || '',
          loading: false,
          error: '',
          blocks: blocks.length ? blocks : [{ isParagraph: true, text: 'No readable text was found for this wiki entry.' }],
        };
      });
  }

  openBookPreviewForItem(item) {
    if (!item || !item.bookRef) return;
    const loadingPayload = {
      id: item.id || '',
      title: item.name || item.id || 'Book',
      meta: '',
      sourceUrl: item.bookRef.wikiUrl || '',
      loading: true,
      error: '',
      blocks: [],
    };
    this.setState({
      bookPreview: loadingPayload,
      compactActionsId: null,
    });
    this.fetchBookPreview(item)
      .then(payload => {
        if (this.state.bookPreview && this.state.bookPreview.id === payload.id) {
          this.setState({ bookPreview: payload });
        }
      })
      .catch(err => {
        if (this.state.bookPreview && this.state.bookPreview.id === (item.id || '')) {
          this.setState({
            bookPreview: Object.assign({}, loadingPayload, {
              loading: false,
              meta: 'Book text unavailable',
              error: 'Could not load this book text.',
            }),
          });
        }
        console.warn('book text load failed', err);
      });
  }

  showAdjacentBookPreview(step) {
    const list = this._bookPreviewItems || [];
    const cur = this.state.bookPreview;
    if (!cur || !list.length) return;
    let idx = list.findIndex(x => x && x.id && cur.id && x.id === cur.id);
    if (idx < 0) return;
    const next = list[(idx + step + list.length) % list.length];
    if (!next || !next.bookRef) return;
    this.openBookPreviewForItem(next);
  }

  renderPreviewPayload(x) {
    const contentCount = x && x.contentIds && x.contentIds.length ? x.contentIds.length : 0;
    const isSpell = !!(x && x.isSpell);
    const isLeveledList = !!(x && x.isLeveledList);
    const thumbnailPending = !!(x && x.imported && x.mesh && !x.thumbnailReady);
    return {
      id: x && x.id ? String(x.id) : '',
      src: (isSpell || isLeveledList || thumbnailPending) ? '' : ((x && (x.render || x.img)) || ''),
      title: (x && x.id) || '',
      meta: (x && (x.mesh || x.name || x.type)) || '',
      mesh: (x && x.mesh) || '',
      source: (x && x.source) || '',
      thumbnailPending,
      lightTint: (x && x.lightTint) || '',
      lightColor: (x && x.lightColor) || '',
      lightHex: (x && x.lightHex) || '',
      lightMask: (x && x.lightMask) || '',
      hasContents: !!contentCount,
      contentsTitle: contentCount
        ? 'Open contents: ' + contentCount + ' valid content' + (contentCount === 1 ? '' : 's')
        : '',
      hasEnchantment: !!(x && x.enchantment),
      enchantmentTitle: x && x.enchantment ? (x.enchantment.title || x.enchantment.id || 'Enchantment details') : '',
      hasAlchemy: !!(x && x.alchemy),
      alchemyTitle: x && x.alchemy ? (x.alchemy.title || x.alchemy.id || 'Alchemy details') : '',
      hasBookText: !!(x && x.bookRef),
      bookTitle: x && x.bookRef ? ('Read ' + (x.name || x.id || 'book')) : '',
      hasEffects: !!(x && x.effects && x.effects.length),
      effects: (x && x.effects) || [],
      isSpell: isSpell,
      vanilla: !!(x && x.vanilla),
      detailKind: (x && x.detailKind) || '',
      spellEffects: (x && x.spellEffects) || [],
      hasSpellThumb: !!(x && x.spellEffects && x.spellEffects.length),
      spellLayoutClass: x && x.spellEffects ? this.spellLayoutClass(x.spellEffects.length) : '',
    };
  }

  showAdjacentRenderPreview(step) {
    const list = this._renderPreviewItems || [];
    const cur = this.state.renderPreview;
    if (!cur || !list.length) return;
    let idx = list.findIndex(x => x.id && cur.id && x.id === cur.id);
    if (idx < 0) idx = list.findIndex(x => x.src === cur.src && x.title === cur.title);
    if (idx < 0) return;
    const next = list[(idx + step + list.length) % list.length];
    if (!next || (!next.src && !next.mesh)) return;
    this.setState({ renderPreview: next, renderPreviewLoaded: false, renderPreviewMode: 'preview' });
  }

  };
}
