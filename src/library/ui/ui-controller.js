export function withLibraryUi(Base) {
  return class LibraryUi extends Base {
  activeWin() { return this._pipWin || window; }

  activeDoc() { return this._pipWin ? this._pipWin.document : document; }

  applyTheme() {
    if (window.OAAB_THEME) window.OAAB_THEME.apply(this.state.theme);
    if (this._pipWin && this._pipWin.document && this._pipWin.document.body) {
      const root = this.activeDoc().querySelector('[data-root]');
      if (root) root.classList.toggle('theme-light', this.state.theme === 'light');
      this._pipWin.document.body.style.background = this.state.theme === 'light' ? '#f4ede0' : '#100d0a';
    }
  }

  // Always-on-top via the Document Picture-in-Picture API — the only web
  // mechanism that yields an OS-level always-on-top window. The whole app is
  // relocated into the PiP window (same live nodes, so React keeps rendering
  // into them) with the page's stylesheets/fonts mirrored across. Closing the
  // PiP window (button or OS) moves everything back and clears the flag.

  toggleAlwaysOnTop() {
    if (this.state.aot) {
      if (this._pipWin) { try { this._pipWin.close(); } catch (e) {} }
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      alert('Always-on-top needs a Chromium-based browser (Chrome, Edge). It is not available here.');
      return;
    }
    const w = Math.min(1180, Math.round(window.innerWidth || 1180));
    // Ask for the full available screen height. Chromium may still trim the
    // result to fit its PiP window chrome, but do not impose our own 820px cap.
    const h = Math.round((window.screen && window.screen.availHeight) || window.innerHeight || 820);
    window.documentPictureInPicture.requestWindow({ width: w, height: h }).then((pip) => {
      // Mirror stylesheets + font links so the moved DOM stays styled.
      document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"], style').forEach((node) => {
        pip.document.head.appendChild(node.cloneNode(true));
      });
      pip.document.documentElement.className = document.documentElement.className;
      pip.document.body.className = document.body.className;
      // Relocate every body child into the PiP window.
      this._pipParked = [];
      Array.prototype.slice.call(document.body.childNodes).forEach((n) => {
        this._pipParked.push(n);
        pip.document.body.appendChild(n);
      });
      this._pipWin = pip;
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('resize', this._onScroll);
      document.removeEventListener('mousedown', this._onDocDown, true);
      document.removeEventListener('keydown', this._onKey, true);
      pip.addEventListener('scroll', this._onScroll, { passive: true });
      pip.addEventListener('resize', this._onScroll, { passive: true });
      pip.document.addEventListener('mousedown', this._onDocDown, true);
      pip.document.addEventListener('keydown', this._onKey, true);
      this.applyTheme();
      this.syncContentsScrollLock();
      this.syncRenderScrollLock();
      this.setState({ aot: true });
      requestAnimationFrame(() => {
        this.updateDetailStickyTop();
        this.updateDetailScrollWidth();
        if (this._onScroll) this._onScroll();
      });
      const restore = () => {
        if (this._pipWin !== pip) return;
        pip.removeEventListener('scroll', this._onScroll);
        pip.removeEventListener('resize', this._onScroll);
        pip.document.removeEventListener('mousedown', this._onDocDown, true);
        pip.document.removeEventListener('keydown', this._onKey, true);
        try {
          (this._pipParked || []).forEach((n) => document.body.appendChild(n));
        } catch (e) {}
        this._pipParked = null;
        this._pipWin = null;
        window.addEventListener('scroll', this._onScroll, { passive: true });
        window.addEventListener('resize', this._onScroll, { passive: true });
        document.addEventListener('mousedown', this._onDocDown, true);
        document.addEventListener('keydown', this._onKey, true);
        this.syncContentsScrollLock();
        this.syncRenderScrollLock();
        this.setState({ aot: false });
        requestAnimationFrame(() => {
          this.updateDetailStickyTop();
          this.updateDetailScrollWidth();
          if (this._onScroll) this._onScroll();
        });
      };
      pip.addEventListener('pagehide', restore, { once: true });
    }).catch((e) => {
      console.warn('always-on-top failed', e);
    });
  }

  scrollContentsList(deltaY) {
    const list = this.activeDoc().querySelector('.library-contents-list') || this.activeDoc().querySelector('.library-book-body');
    if (!list || !deltaY) return;
    list.scrollTop += deltaY;
  }

  syncContentsScrollLock(forceUnlock) {
    try {
      const shouldLock = !forceUnlock && !!(this.state.contentsPreview || this.state.bookPreview);
      const lockDoc = this.activeDoc();
      if (shouldLock === !!this._contentsScrollLocked && (!shouldLock || this._contentsLockDoc === lockDoc)) return;
      if (this._contentsScrollLocked) {
        const oldDoc = this._contentsLockDoc || document;
        if (this._onContentsWheel) oldDoc.removeEventListener('wheel', this._onContentsWheel, true);
        if (this._onContentsTouchStart) oldDoc.removeEventListener('touchstart', this._onContentsTouchStart, true);
        if (this._onContentsTouchMove) oldDoc.removeEventListener('touchmove', this._onContentsTouchMove, true);
        this._contentsScrollLocked = false;
      }
      if (shouldLock) {
        this._contentsScrollLocked = true;
        this._onContentsWheel = (e) => {
          if (e && e.preventDefault) e.preventDefault();
          const list = this.activeDoc().querySelector('.library-contents-list') || this.activeDoc().querySelector('.library-book-body');
          const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 && list ? list.clientHeight : 1);
          this.scrollContentsList((e.deltaY || 0) * unit);
        };
        this._onContentsTouchStart = (e) => {
          const t = e.touches && e.touches[0];
          this._contentsTouchY = t ? t.clientY : 0;
        };
        this._onContentsTouchMove = (e) => {
          const t = e.touches && e.touches[0];
          const y = t ? t.clientY : this._contentsTouchY;
          const deltaY = this._contentsTouchY ? this._contentsTouchY - y : 0;
          if (e && e.preventDefault) e.preventDefault();
          this.scrollContentsList(deltaY);
          this._contentsTouchY = y;
        };
        this._contentsLockDoc = lockDoc;
        lockDoc.addEventListener('wheel', this._onContentsWheel, { passive: false, capture: true });
        lockDoc.addEventListener('touchstart', this._onContentsTouchStart, { passive: false, capture: true });
        lockDoc.addEventListener('touchmove', this._onContentsTouchMove, { passive: false, capture: true });
        return;
      }
      const oldDoc = this._contentsLockDoc || document;
      if (this._onContentsWheel) oldDoc.removeEventListener('wheel', this._onContentsWheel, true);
      if (this._onContentsTouchStart) oldDoc.removeEventListener('touchstart', this._onContentsTouchStart, true);
      if (this._onContentsTouchMove) oldDoc.removeEventListener('touchmove', this._onContentsTouchMove, true);
      this._contentsScrollLocked = false;
      this._contentsLockDoc = null;
      this._onContentsWheel = null;
      this._onContentsTouchStart = null;
      this._onContentsTouchMove = null;
      this._contentsTouchY = 0;
    } catch (e) {}
  }

  syncRenderScrollLock(forceUnlock) {
    try {
      const lockDoc = this.activeDoc();
      const shouldLock = !forceUnlock && !!this.state.renderPreview;
      const oldDoc = this._renderScrollLockDoc;

      if (oldDoc && oldDoc !== lockDoc) {
        oldDoc.body?.classList.remove('library-render-opened');
        this._renderScrollLockDoc = null;
      }

      if (shouldLock) {
        lockDoc.body?.classList.add('library-render-opened');
        this._renderScrollLockDoc = lockDoc;
      } else {
        lockDoc.body?.classList.remove('library-render-opened');
        this._renderScrollLockDoc = null;
      }
    } catch (e) {}
  }

  updateDetailStickyTop() {
    try {
      const toolbar = this.activeDoc().querySelector('[data-tabbar]');
      const bottom = toolbar ? Math.max(0, Math.ceil(toolbar.getBoundingClientRect().bottom)) : 0;
      this.activeDoc().documentElement.style.setProperty('--library-detail-sticky-top', bottom + 'px');
    } catch (e) {}
  }

  updateDetailScrollWidth() {
    try {
      const body = this.activeDoc().querySelector('[data-detail-wrap]');
      const table = body ? body.querySelector('.library-detail-table') : null;
      const top = this.activeDoc().querySelector('[data-detail-top-scroll]');
      const spacer = this.activeDoc().querySelector('.library-detail-top-scroll-spacer');
      if (!body || !table || !top || !spacer) return;
      const tableWidth = Math.ceil(table.getBoundingClientRect().width);
      const viewportGap = Math.max(0, (top.clientWidth || 0) - (body.clientWidth || 0));
      const width = Math.max(body.scrollWidth || 0, table.scrollWidth || 0, tableWidth || 0, body.clientWidth || 0) + viewportGap;
      if (width > 0 && spacer.style.width !== width + 'px') spacer.style.width = width + 'px';
      body.style.setProperty('--library-detail-scroll-left', (top.scrollLeft || 0) + 'px');
    } catch (e) {}
  }

  initTheme(tries) {
    if (window.OAAB_THEME) {
      const t = window.OAAB_THEME.read();
      window.OAAB_THEME.apply(t);
      if (t !== this.state.theme) this.setState({ theme: t });
      return;
    }
    if ((tries || 0) < 20) setTimeout(() => this.initTheme((tries || 0) + 1), 50);
  }

  themeVals() {
    const light = this.state.theme === 'light';
    return {
      isLight: light,
      isDark: !light,
      toggleTheme: () => {
        const n = light ? 'dark' : 'light';
        if (window.OAAB_THEME) window.OAAB_THEME.set(n);
        this.setState({ theme: n });
      },
    };
  }

  gridMetrics(width) {
    const compact = !!this.state.compact;
    const scale = this.state.scale || 1;
    // The popout deliberately tightens the compact grid to a fixed 4px gap
    // (see its .asset-grid override in style.css). Virtual row spacers must use
    // that rendered gap too, or their accumulated height changes whenever the
    // mounted row window advances and makes the thumbnails jump while scrolling.
    const isPopout = this._isPopout != null
      ? this._isPopout
      : ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('oaab_popout') === '1') || /[?&]popout=1/.test(location.search || ''));
    const gap = isPopout && compact ? 4 : Math.round((compact ? 10 : 14) * scale);
    const minCardWidth = Math.round((compact ? 112 : 176) * scale);
    const captionHeight = compact ? 0 : 78;
    const columns = Math.max(1, Math.floor((Math.max(0, width) + gap) / (minCardWidth + gap)));
    const cardWidth = minCardWidth;
    const rowHeight = cardWidth + captionHeight;
    return { columns, rowHeight, rowPitch: rowHeight + gap };
  }

  detailRowPitch() {
    return this.state.narrow ? 49 : 51;
  }

  // Extract a TOML array literal (key = [ "a", "b", ... ]) by key, returning the
  // decoded string entries. Tolerates nested brackets and \u escapes.
  };
}
