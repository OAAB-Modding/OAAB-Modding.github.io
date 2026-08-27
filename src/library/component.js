import { withProductionCatalog } from './catalog/production-catalog.js';
import { withLibraryFilters } from './filters/filter-controller.js';
import { withLibraryPreviews } from './previews/preview-controller.js';
import { withLibraryMagic } from './records/magic-controller.js';
import { withLibraryRecordDetails } from './records/detail-controller.js';
import { withLibraryRenderValues } from './render/render-values.js';
import { createProductionLibraryState } from './state.js';
import { withLibraryUi } from './ui/ui-controller.js';
import { initializeLibraryWorkspace } from './workspace/workspace-controller.js';

export function createLibraryComponent(DCLogic) {
  if (typeof DCLogic !== 'function') throw new TypeError('A DCLogic base class is required');

  const LibraryBase = [
    withLibraryUi,
    withLibraryFilters,
    withLibraryRecordDetails,
    withLibraryPreviews,
    withLibraryMagic,
    withProductionCatalog,
    withLibraryRenderValues,
  ].reduce((Base, mixin) => mixin(Base), DCLogic);

  return class LibraryComponent extends LibraryBase {
  state = createProductionLibraryState();

  componentDidMount() {
    this.initTheme(0);
    // Popout-only class hooks keep the CSSE-inspired window treatment from
    // affecting the full Library page. The document title also carries into
    // the operating system's native popup title bar.
    try {
      const popoutWindow = this._isPopout != null
        ? this._isPopout
        : ((typeof sessionStorage !== 'undefined' && sessionStorage.getItem('oaab_popout') === '1') || /[?&]popout=1/.test(location.search || ''));
      this._isPopout = !!popoutWindow;
      document.documentElement.classList.toggle('library-popout-html', this._isPopout);
      document.body.classList.toggle('library-page--popout', this._isPopout);
      if (this._isPopout) {
        this._documentTitle = document.title;
        document.title = 'Asset Browser - OAAB';
      }
    } catch (e) {}
    // Track the mobile breakpoint so the Type filter can collapse from the full
    // tab row into the compact dropdown (matches style.css's 820px breakpoint).
    try {
      this._mql = window.matchMedia('(max-width: 820px)');
      this._onMql = (e) => this.setState({ narrow: e.matches });
      if (this._mql.addEventListener) this._mql.addEventListener('change', this._onMql);
      else if (this._mql.addListener) this._mql.addListener(this._onMql);
    } catch (e) {}
    // The library toolbar is sticky and must park directly below the fixed
    // .site-nav. Measuring the nav's real height keeps the toolbar's top
    // padding intact when scrolled — a hard-coded offset lets the nav overlap
    // and clip it. Re-measure on resize since the nav height is responsive.
    this._measureNav = () => {
      try {
        const nav = this.activeDoc().querySelector('.site-nav');
        const h = nav ? Math.round(nav.getBoundingClientRect().height) : 0;
        if (h && h !== this.state.navHeight) this.setState({ navHeight: h });
      } catch (e) {}
    };
    this._measureNav();
    window.addEventListener('resize', this._measureNav, { passive: true });
    // In popout mode, remember it for this window and tidy the address bar so
    // the ?popout=1 query string isn't shown (the browser's own URL bar on a
    // popup window can't be removed by the page, but we keep it clean).
    if (this._isPopout) {
      try { sessionStorage.setItem('oaab_popout', '1'); } catch (e) {}
      try {
        if (/[?&]popout=1/.test(location.search || '')) {
          history.replaceState(null, '', location.pathname + location.hash);
        }
      } catch (e) {}
    }

    // Pick up an initial tag filter from the URL hash (e.g. #tag=Telvanni),
    // used by the home page's library links.
    const hm = /[#&]tag=([^&]+)/.exec(location.hash || '');
    if (hm) {
      try { this.setState({ tags: [decodeURIComponent(hm[1])] }); } catch (e) {}
    }

    this._onDocDown = (e) => {
      const t = e.target;
      if (this.state.tagOpen && !(t.closest && t.closest('[data-tagdd]'))) {
        this.setState({ tagOpen: false });
      }
      if (this.state.typeOpen && !(t.closest && t.closest('[data-typedd]'))) {
        this.setState({ typeOpen: false });
      }
      if (this.state.searchModeOpen && !(t.closest && t.closest('[data-searchmodedd]'))) {
        this.setState({ searchModeOpen: false });
      }
      if (this.state.searchSuggestOpen && !(t.closest && t.closest('[data-searchbox]'))) {
        this.setState({ searchSuggestOpen: false });
      }
      if (this.state.relOpen && !(t.closest && t.closest('[data-reldd]'))) {
        this.setState({ relOpen: false });
      }
      if (this.state.compactActionsId && !(t.closest && t.closest('[data-compact-actions]'))) {
        this.setState({ compactActionsId: null });
      }
    };
    document.addEventListener('mousedown', this._onDocDown, true);

    // Type-ahead: while the Tag dropdown is open, typing letters jumps to the
    // first matching tag (alphabetical). Repeating the same letter cycles
    // through tags starting with it; Escape closes the menu.
    this._typeBuf = '';
    this._typeTs = 0;
    this._typeIdx = 0;
    this._onKey = (e) => {
      if (this.state.bookPreview) {
        if (e.key === 'Escape') {
          this.setState({ bookPreview: null });
          return;
        }
        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          this.showAdjacentBookPreview(e.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        return;
      }
      if (this.state.contentsPreview) {
        if (e.key === 'Escape') {
          this.setState({ contentsPreview: null });
          return;
        }
      }
      if (this.state.enchantmentPreview) {
        if (e.key === 'Escape') {
          this.setState({ enchantmentPreview: null });
          return;
        }
      }
      if (this.state.renderPreview) {
        if (e.key === 'Escape') {
          this.setState({ renderPreview: null, renderPreviewLoaded: false });
          return;
        }
        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          if (e.preventDefault) e.preventDefault();
          if (e.stopPropagation) e.stopPropagation();
          this.showAdjacentRenderPreview(e.key === 'ArrowRight' ? 1 : -1);
          return;
        }
        return;
      }
      if (this.state.compactActionsId && e.key === 'Escape') {
        this.setState({ compactActionsId: null });
        return;
      }
      if ((this.state.searchModeOpen || this.state.searchSuggestOpen) && e.key === 'Escape') {
        this.setState({ searchModeOpen: false, searchSuggestOpen: false });
        return;
      }
      if (!this.state.tagOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { this.setState({ tagOpen: false }); return; }
      const k = e.key;
      if (!k || k.length !== 1 || !/[a-z0-9]/i.test(k)) return;
      const dd = this.activeDoc().querySelector('[data-tagdd]');
      if (!dd) return;
      const scroller = dd.querySelector('.dropdown-scroll');
      const btns = [].slice.call(dd.querySelectorAll('[data-tag]'));
      if (!btns.length) return;

      const now = Date.now();
      if (now - this._typeTs > 800) this._typeBuf = '';
      this._typeTs = now;
      this._typeBuf += k.toLowerCase();

      let buf = this._typeBuf, cycle = false;
      if (buf.length > 1 && /^(.)\1+$/.test(buf)) { buf = buf[0]; cycle = true; }
      const matches = btns.filter(b => (b.dataset.tag || '').toLowerCase().indexOf(buf) === 0);
      if (!matches.length) return;

      let match;
      if (cycle) {
        this._typeIdx = (this._typeIdx + 1) % matches.length;
        match = matches[this._typeIdx];
      } else {
        this._typeIdx = 0;
        match = matches[0];
      }

      e.preventDefault();
      if (scroller) {
        const r = match.getBoundingClientRect();
        const cr = scroller.getBoundingClientRect();
        scroller.scrollTop += (r.top - cr.top) - 8;
      }
      try { match.focus({ preventScroll: true }); } catch (err) { match.focus(); }
    };
    document.addEventListener('keydown', this._onKey, true);

    // Release provenance is derived live from the per-release mesh diffs the
    // site publishes under assets/data/library/ (mesh_diff_<from>_to_<to>.json).
    // Each diff lists the .nif meshes added/modified in that span; we map those
    // mesh paths back to object IDs through OAAB_Data_filtered.json once it's
    // loaded (see loadMeshDiffs, called from the records .then below).

    // Keep only the visible grid rows mounted. The handler updates state only
    // when the row window changes, avoiding a React render on every scroll tick.
    this._onScroll = () => {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this.updateDetailStickyTop();
        const detailBody = this.activeDoc().querySelector('[data-detail-virtual-body]');
        if (detailBody) {
          const rowCount = this._detailRowCount || 0;
          const table = detailBody.closest ? detailBody.closest('.library-detail-table') : null;
          const head = table ? table.querySelector('thead') : null;
          const rowPitch = this.detailRowPitch();
          const tableTop = table ? (table.getBoundingClientRect().top + this.activeWin().scrollY) : (detailBody.getBoundingClientRect().top + this.activeWin().scrollY);
          const bodyTop = tableTop + (head ? Math.ceil(head.getBoundingClientRect().height) : 0);
          const viewportRows = Math.max(1, Math.ceil(this.activeWin().innerHeight / rowPitch));
          const overscan = viewportRows * 2;
          const firstVisible = Math.floor((this.activeWin().scrollY - bodyTop) / rowPitch);
          const lastVisible = Math.ceil((this.activeWin().scrollY + this.activeWin().innerHeight - bodyTop) / rowPitch);
          const maxStart = Math.max(0, rowCount - 1);
          const start = Math.max(0, Math.min(maxStart, firstVisible - overscan));
          const end = rowCount === 0 ? 0 : Math.min(
            rowCount,
            Math.max(start + 1, lastVisible + overscan)
          );
          const next = {};
          if (start !== this.state.virtualStartRow) next.virtualStartRow = start;
          if (end !== this.state.virtualEndRow) next.virtualEndRow = end;
          if (Object.keys(next).length) this.setState(next);
          return;
        }

        const grid = this.activeDoc().querySelector('[data-grid]');
        if (!grid) return;

        const width = grid.clientWidth;
        const metrics = this.gridMetrics(width);
        const rowCount = Math.ceil((this._filteredCount || 0) / metrics.columns);
        const gridTop = grid.getBoundingClientRect().top + this.activeWin().scrollY;
        const overscan = 3;
        const firstVisible = Math.floor((this.activeWin().scrollY - gridTop) / metrics.rowPitch);
        const lastVisible = Math.ceil((this.activeWin().scrollY + this.activeWin().innerHeight - gridTop) / metrics.rowPitch);
        const maxStart = Math.max(0, rowCount - 1);
        const start = Math.max(0, Math.min(maxStart, firstVisible - overscan));
        const end = rowCount === 0 ? 0 : Math.min(
          rowCount,
          Math.max(start + 1, start + overscan * 2 + 1, lastVisible + overscan)
        );

        if (
          width !== this.state.gridWidth ||
          start !== this.state.virtualStartRow ||
          end !== this.state.virtualEndRow
        ) {
          this.setState({ gridWidth: width, virtualStartRow: start, virtualEndRow: end });
        }
      });
    };
    window.addEventListener('scroll', this._onScroll, { passive: true });
    window.addEventListener('resize', this._onScroll, { passive: true });

    this.initializeProductionCatalog();
    this._workspace = initializeLibraryWorkspace(this);
  }

  componentWillUnmount() {
    try {
      document.documentElement.classList.remove('library-popout-html');
      document.body.classList.remove('library-page--popout');
      if (this._documentTitle) document.title = this._documentTitle;
    } catch (e) {}
    if (this._mql && this._onMql) {
      if (this._mql.removeEventListener) this._mql.removeEventListener('change', this._onMql);
      else if (this._mql.removeListener) this._mql.removeListener(this._onMql);
    }
    if (this._onDocDown) this.activeDoc().removeEventListener('mousedown', this._onDocDown, true);
    if (this._onKey) this.activeDoc().removeEventListener('keydown', this._onKey, true);
    if (this._onScroll) {
      this.activeWin().removeEventListener('scroll', this._onScroll);
      this.activeWin().removeEventListener('resize', this._onScroll);
    }
    if (this._measureNav) window.removeEventListener('resize', this._measureNav);
    if (this._raf) cancelAnimationFrame(this._raf);
    this.syncContentsScrollLock(true);
    this._workspace?.dispose();
  }

  // Recalculate after data/filter changes because they alter the virtual height.

  componentDidUpdate() {
    this.applyTheme();
    this.syncContentsScrollLock();
    this.updateDetailStickyTop();
    this.updateDetailScrollWidth();
    if (this._onScroll) this._onScroll();
    this._workspace?.syncProductionPreview();
  }
  };
}
