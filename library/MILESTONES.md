# OAAB Library modernization milestones

This is the durable implementation roadmap and agent handoff for turning the
OAAB Library into a browser-based TES3 asset explorer. Update this file whenever
a milestone changes state, scope, or verification evidence.

Last updated: 2026-08-26

## Goal

The finished Library should preserve the current OAAB_Data/vanilla catalogue
while allowing users to select local TES3 plugins and assets, inspect records
and dependencies, render supported NIFs in the browser, and cache generated
thumbnails. It must remain a static GitHub Pages application: no backend and no
uploading users' ESP, ESM, BSA, or loose asset files.

## Status at a glance

| Milestone | Status | Summary |
| --- | --- | --- |
| Proof of concept | **Complete** | A real OAAB NIF travels through OAAB source -> resolver -> worker/WASM -> Three.js, including textures. |
| Phase 1 — Modularize Library | **Complete** | Production logic is composed from focused modules; `library/index.html` retains only the declarative template and a one-line compatibility class. |
| Phase 2 — Asset sources | **Complete** | OAAB, loose-file/directory, and TES3 BSA sources share the ordered resolver. |
| Phase 3 — NIF renderer lab | **Complete** | The isolated lab and production viewer render supported NetImmerse 4.0.0.2 content. |
| Phase 4 — TES3 WASM | **Complete** | NIF and ESP/ESM parsing run through the worker/WASM boundary. |
| Phase 5 — Textures | **Complete** | DDS, TGA, PNG, and JPEG resolution, fallbacks, and diagnostics are implemented. |
| Phase 6 — Camera/preview | **Complete** | Framing, controls, debug toggles, and hidden-by-default collision are shared by lab and production. |
| Phases 7–11 | **Complete** | Local plugins/assets, BSA indexes, source priority, and dependency diagnostics are integrated. |
| Phases 12–17 | **Complete** | One live viewer, IndexedDB thumbnails/data, runtime HTTP cache, and OAAB enrichment are integrated. |
| Phases 18–20 | **Complete** | Load order, cells, selected controller playback, particles, and bind-pose skin support are implemented. |

## Completed proof-of-concept milestone

The first requested milestone is complete:

- [x] Add enough shared modules to introduce new components without extending
  the production page's inline application code.
- [x] Create `AssetResolver`.
- [x] Create `OAABSource`.
- [x] Create `/library/lab/`.
- [x] Add Three.js, pinned to version `0.185.1` by the lab import map.
- [x] Wrap Greatness7/tes3 NIF parsing in Rust/WASM.
- [x] Fetch actual NIF bytes from the public OAAB_Data repository/CDN.
- [x] Parse static geometry in a Web Worker.
- [x] Resolve referenced textures through the same resolver.
- [x] Display a textured, interactive model without pre-rendered Library images.
- [x] Exercise a 15-model representative browser corpus.
- [x] Document encountered unsupported blocks in
  [`lab/UNSUPPORTED.md`](lab/UNSUPPORTED.md).

The default lab model is `oaab/f/mv_bloodgrass_01.nif`. At the completion
checkpoint it rendered with two resolved OAAB DDS textures and no missing
textures. The browser corpus passed 15/15 fixtures, including architecture,
clutter, ingredients, weapons, doors, markers, alpha-tested meshes, collision
roots, controller-heavy lights, a case-mapped filename, and a particle-only
model. The particle-only fixture intentionally produces a valid packet with
zero renderable meshes and warnings.

## Required architectural constraints

These apply to every remaining milestone:

- Keep the deployed application static and compatible with GitHub Pages.
- Keep user-selected files local to the browser.
- Send every asset lookup through one `AssetResolver`.
- Use one TES3/NIF parser path for built-in and imported content.
- Use one renderer for live previews and thumbnail generation.
- Keep binary parsing in Web Workers.
- Treat TES3 asset paths case-insensitively and normalize them once.
- Turn unsupported NIF features into diagnostics and fallbacks, not app-wide
  failure.
- Reuse one WebGL renderer and dispose replaced GPU resources.
- Continue reducing `library/index.html`; do not add another large inline JS
  subsystem.
- Preserve existing Library URLs and user-visible behavior unless a milestone
  explicitly changes them.

## Milestone details

### Phase 1 — Refactor the Library into modules

**Status: Complete.**

The production Library's state, lifecycle, data loading, catalog adapters,
record normalization/details, filters/search, previews, magic-effect handling,
and render-value coordination now live under `src/library/`. The declarative
runtime component in `library/index.html` is a one-line subclass of the
module-backed component factory. `src/library/bootstrap.js` installs the module
bridge before loading the declarative runtime, avoiding a startup race on cold
module graphs.

The built-in OAAB and vanilla JSON now enter production through `OAABCatalog`
and `VanillaCatalog`, which emit the generic record shape. The production
catalog adapter retains each generic record and derives the existing gallery
view model from `record.raw`, keeping current thumbnails, tooltips, detail data,
and CSSE behavior intact while giving future imported catalogs the same
boundary.

Required modules include app/state, catalogs, generic record utilities, asset
sources, the resolver, renderer, storage/cache, and workers. Use a generic
record shape:

```js
{
  id,
  type,
  name,
  mesh,
  icon,
  source,
  raw,
  metadata,
}
```

Exit criteria:

- Gallery, compact, and detail views behave as before.
- Search, type/tag/tileset/release filters, and catalog-source selection are intact.
- Previews, books, container contents, enchantment/alchemy/effect data, CSSE
  drag/drop, popout mode, and existing URLs are intact.
- OAAB_Data JSON is a catalog provider rather than the core record model.
- Production logic is divided into focused modules with no new giant JS blob.

Verification on 2026-08-25:

- Eleven Node assertions passed across path utilities, resolver/source,
  built-in catalog providers, production state, and component composition.
- The production browser smoke test loaded 17,550 combined records and 826
  weapons, with 210 weapons when vanilla was disabled.
- Gallery search returned all six expected Bloodgrass records; compact and
  826-row Weapon detail views worked.
- Tag (`Ashlander`, 119), release (`2.6.0`, 282), and tileset-piece (2 variants)
  filters worked, as did render, container-content, book, enchantment, and
  alchemy preview paths.
- The isolated NIF lab still loaded the default textured model and passed the
  15/15 representative corpus with a clean console.

### Phase 2 — Create the asset-source abstraction

**Status: Complete.**

`AssetSource` exposes `has(path)`, `get(path)`, and `stat(path)`. `AssetResolver`
orders sources by numeric priority (higher first), preserves insertion order for
ties, and returns the first match. `OAABSource` reads public `00 Core/meshes`,
`textures`, and `icons` through jsDelivr with a raw GitHub fallback.

All paths pass through the shared normalizer. Inputs such as
`Meshes\\OAAB\\F\\Chair.nif`, `meshes/oaab/f/chair.nif`, and `OAAB/F/Chair.nif`
become a canonical lowercase, forward-slash path rooted under `meshes/` where
appropriate. `assets/data/library/oaab-assets.json` restores the repository's
case-sensitive spelling when the canonical TES3 path differs.

Exit criteria met:

- `resolver.resolve("meshes/oaab/...")` retrieves real OAAB_Data bytes.
- Resolver callers do not construct source-specific URLs.
- Path normalization and ordered-source behavior have Node tests.

`LocalDirectorySource` and `BsaSource` now implement the same contract. Loose
files/directories are indexed case-insensitively, while TES3 BSA archives keep
only their filename/offset/length index and slice individual assets lazily.

### Phase 3 — Create a NIF renderer proof of concept

**Status: Complete.**

The lab has a canvas, asset path input, load action, orbit controls, reset,
wireframe, and diagnostics. It targets NetImmerse `4.0.0.2` and renders static
`NiTriShape` and `NiTriStrips` data, including transforms, vertices, indices,
normals, UVs, vertex colors, diffuse textures, materials, alpha behavior, and
culling/stencil/depth properties where represented by the current packet.

Supported or recognized blocks and all current limitations are maintained in
[`lab/UNSUPPORTED.md`](lab/UNSUPPORTED.md). Phase 20 added selected controller
playback, point-particle rendering, and bind-pose skinning diagnostics; morph
controllers, deforming skinning, and complex texture effects remain deferred.

Exit criteria met:

- Supported OAAB NIFs render interactively from raw source bytes.
- Unknown/deferred blocks appear in diagnostics without crashing the viewer.
- A model with no supported geometry is handled as a valid empty scene.

### Phase 4 — Integrate Greatness7/tes3 through WebAssembly

**Status: Complete.**

The Rust crate in `wasm/` is a deliberately narrow browser boundary. It pins
Greatness7/tes3 at commit `44ea38ca389f5361229eef4800373b3df13f7063`
and `wasm-bindgen` at `0.2.117`. `parse_nif(bytes)` returns JSON describing a
render packet; the worker converts numeric arrays into transferable typed arrays
before handing it to the UI. `parse_plugin(bytes)` extracts masters, statistics,
cells/references, and Library-useful fields from `STAT`, `ACTI`, `DOOR`, `CONT`,
`LIGH`, `MISC`, `WEAP`, `APPA`, `LOCK`, `PROB`, `INGR`, `BOOK`, `ALCH`, and
`REPA`. `PluginCatalog` converts this packet directly to generic records.

Exit criteria met:

- Both NIF and plugin bytes are parsed off the UI thread through small,
  browser-oriented WASM functions.
- Plugin output is directly consumable as a catalog source.

### Phase 5 — Texture resolution

**Status: Complete.**

NIF texture paths return to `AssetResolver`; the renderer never constructs an
OAAB URL. The lab uses pinned Three.js loaders for DDS and TGA plus browser-native
PNG/JPEG loading. DDS DXT1, DXT3, and DXT5, alpha, and mipmaps are delegated to
the Three.js DDS loader. Missing textures show a visible fallback material and
remain listed separately from resolved textures.

OAAB NIFs may reference vanilla textures. Those paths now resolve through a
selected loose-file/directory or BSA source when present and otherwise remain
actionable missing-asset diagnostics.

Exit criteria met:

- Supported texture formats render through resolved bytes/object URLs.
- Diagnostics list resolved and missing texture paths and counts.
- One missing texture does not prevent the rest of the model from rendering.

### Phase 6 — Proper camera framing and preview behavior

**Status: Complete.**

The viewer derives a combined bound, centers the model, frames it according to
its size, and adjusts near/far clipping. Orbit, wheel zoom, pan,
double-click/reset, grid, axes, wireframe, collision visibility, and background
controls are present. Collision geometry is hidden by default.

Exit criteria met:

- Models of different scales begin in a useful framed view.
- Morrowind orientation is consistently applied.
- Debug overlays and render modes can be toggled without re-parsing.

The same reusable viewer now provides these behaviors in production Phase 12.

### Phase 7 — Plugin file loading

**Status: Complete.**

The **Local files** workspace opens one or more `.esp`/`.esm` files, parses them
in the TES3 worker, reports record/mesh/unique-NIF statistics, and feeds winning
generic records into the normal production search, type, detail, and source
filter paths. Parse failures stay scoped to the selected file.

Add an **Open Plugin** action for local `.esp` and `.esm` files. Read with
`File.arrayBuffer()`, parse in the TES3 worker, and add the result as another
catalog source. Display filename, total records, mesh-bearing records, and
unique mesh count. Add a source filter so OAAB_Data, vanilla masters, and
imported plugins use the normal Library browsing controls.

Exit criteria:

- Selected files never leave the browser.
- Supported records appear in search/filter/detail views through the generic
  catalog interface.
- Import errors are local, actionable, and do not break built-in catalogs.

The toolbar's Catalog Source control now selects OAAB_Data, vanilla masters,
and imported plugin catalogues as a persisted multi-source set. The former
vanilla-only switch remains readable as a legacy preference during migration.

### Phase 8 — Automatic OAAB dependency resolution

**Status: Complete.**

Imported records retain plugin provenance while their NIFs and textures resolve
independently through the configured `AssetResolver`. OAAB remains available at
priority 400 without prompting for an OAAB download, and the record and asset
source are displayed separately.

For mesh and texture paths referenced by imported plugins, query the configured
resolver automatically. An imported record and its resolved asset may have
different sources, for example `MyMod.esp` and `OAAB_Data`.

Exit criteria:

- A plugin record referencing an available `oaab/...` NIF resolves without the
  user selecting or downloading OAAB_Data.
- Record source and asset source are shown independently.

### Phase 9 — Local loose-file asset source

**Status: Complete.**

`LocalDirectorySource` supports multi-file input, `webkitdirectory` fallback,
and lazy `showDirectoryPicker()` handles. All entries use canonical,
case-insensitive Data Files paths and bytes are read only on resolution.
Multi-file and directory indexing expose determinate or indeterminate progress
in the Local TES3 workspace and yield between batches so large selections keep
the UI responsive.

Add **Add Data Files** with two modes:

- Cross-browser multi-file selection, indexed in memory by normalized path.
- `showDirectoryPicker()` when available, reading selected Data Files entries
  lazily rather than copying every file into memory.

Implement `local-directory-source.js` against the normal AssetSource contract.
Feature detection must leave the multi-file path usable in browsers without the
File System Access API.

Exit criteria:

- Loose NIFs/textures/icons resolve case-insensitively through AssetResolver.
- Files are read only when requested and remain local.

### Phase 10 — Morrowind BSA source

**Status: Complete.**

`BsaSource` validates and indexes TES3 BSA headers, file records, name tables,
and offsets, then returns only the requested `Blob.slice()`. The production
source order uses the priority values below and never stores archive bytes.

Add `bsa-source.js` for user-selected `Morrowind.bsa`, `Tribunal.bsa`, and
`Bloodmoon.bsa`. Parse only the archive index into normalized path, offset, and
length entries. Retrieve bytes lazily with `file.slice(offset, offset + length)`;
never copy a complete BSA into WASM memory or IndexedDB.

Initial priority order, highest first:

1. User loose files
2. Plugin/mod folder
3. OAAB_Data
4. Tribunal.bsa
5. Bloodmoon.bsa
6. Morrowind.bsa

Keep priorities internally configurable.

Exit criteria:

- `source.get("textures/tx_wood.dds")` works without callers knowing it is in a
  BSA.
- Large archives are indexed once and individual assets are sliced lazily.

### Phase 11 — Asset diagnostics

**Status: Complete.**

The dependency scanner processes unique record NIFs concurrently, parses them
through the worker, resolves unique texture paths, reports counts, and renders a
record → NIF → texture tree with the winning source or missing error. The latest
scan metadata is stored without storing asset bytes.

Scan imported records for mesh dependencies, then parsed NIFs for textures.
Report record, mesh, unique NIF, resolved, and missing counts. Each asset should
show its winning source or a missing state, with a dependency tree from record
to NIF to textures.

Exit criteria:

- Users can identify every unresolved dependency and see every resolved
  dependency's source.
- Diagnostic scans remain responsive and use the worker/resolver boundaries.

### Phase 12 — Integrate the live viewer into Library preview

**Status: Complete.**

Production previews now expose **Preview**, **3D**, and **Details** modes. One
lazily loaded `NifViewer`/canvas moves between records and the existing render
dialog; replaced geometry, materials, textures, object URLs, and worker state
are disposed or reused by the shared viewer.

Add **Preview**, **3D**, and **Details** modes for records with resolvable NIFs.
Use one reusable Three.js canvas rather than a renderer per gallery card. Dispose
replaced geometries, materials, textures, object URLs, and render targets when
the selected preview changes.

Exit criteria:

- Production browsing can open supported NIFs without regressing the existing
  pre-rendered preview path.
- Repeatedly browsing hundreds of records does not continually grow GPU memory
  or accumulate renderer instances.

### Phase 13 — Generated thumbnail cache

**Status: Complete.**

The shared renderer captures WebP thumbnails for imported records after their
first live render. `thumbnail:v3` keys include renderer version, source
fingerprint, canonical path, and asset-content hash; valid blobs are restored
after reload without re-parsing or re-rendering.

For records without a thumbnail, resolve and parse the NIF through the existing
pipeline, frame it with the shared renderer, render one frame, encode WebP, and
store the result in IndexedDB. Keep normal browsing image-based.
Imported mesh cards now enqueue only viewport-near records through one shared
offscreen viewer, cache the generated WebP, and skip texture reads for the
background pass; interactive 3D previews retain full texture resolution.

Use a stable versioned key containing the source fingerprint, normalized asset
path, asset modification timestamp/hash, and renderer version, for example
`thumbnail:v3:<renderer>:<source>:<path>:<asset-version>`.

Exit criteria:

- A generated thumbnail is reused after reload without re-rendering.
- Source or renderer changes invalidate only affected cached thumbnails.

### Phase 14 — IndexedDB storage layer

**Status: Complete.**

IndexedDB `oaab-library` schema version 1 contains the five focused stores below.
Parsed plugin indexes, source/load-order settings, dependency metadata, and
thumbnail blobs are persisted; local source/BSA payloads are not. Scoped clear
actions are available in the workspace.

Create focused stores for `plugins`, `plugin-records`, `asset-metadata`,
`thumbnails`, and `settings`. Store fingerprints, parsed record indexes,
dependency metadata, thumbnail blobs, and source settings—but never complete
Morrowind BSAs.
The selected catalog-source IDs are also kept in local display preferences so
the toolbar remains stable before or without workspace cache restoration.

Provide actions to clear imported plugins, clear thumbnail cache, and clear all
Library cache.

Exit criteria:

- Stored data has explicit schema/version migration behavior.
- Each clear action removes only its documented scope and leaves built-in
  static data untouched.

### Phase 15 — HTTP cache for OAAB assets

**Status: Complete.**

`library/sw.js` provides versioned runtime caching. Library JS/WASM uses
network-first behavior, requested OAAB assets use cache-first behavior, old
runtime versions are removed on activation, and OAAB_Data is never prefetched.

Add a Service Worker/Cache API runtime cache for requested OAAB NIFs and
textures, WASM, and Library JS. Use versioned cache names such as
`oaab-library-runtime-v1`. Do not pre-download OAAB_Data.

Exit criteria:

- Previously requested OAAB assets can be served from cache when appropriate.
- Cache version upgrades do not leave the app running incompatible JS/WASM.

### Phase 16 — Move the built-in catalog onto the same resolver architecture

**Status: Complete.**

Built-in and imported records now share generic record, resolver, preview, and
viewer contracts. Existing OAAB/vanilla WebP assets remain the fast default and
fallback, while the same record can opt into the live NIF path.

Represent the built-in experience as OAAB records plus OAAB asset source plus
OAAB metadata enrichment. Keep current pre-rendered images as fast thumbnails,
fallbacks, and support for NIFs the live renderer cannot handle.

Exit criteria:

- Built-in and imported records traverse the same catalog/resolver/viewer
  contracts.
- Existing pre-rendered Library assets remain available and browsing remains
  fast.

### Phase 17 — OAAB enrichment layer

**Status: Complete.**

OAAB-only metadata is attached under `record.metadata.oaab`. Tags, tileset
memberships, deprecation, wiki pages, and release-added/modified history are
enriched after the corresponding data sources load; imported records remain
source-neutral.

Keep project-specific fields outside the core TES3 record, for example:

```js
record.metadata.oaab = {
  tags,
  tileset,
  releaseAdded,
  releaseModified,
  deprecated,
  wikiPage,
};
```

Exit criteria:

- Generic plugin records do not need OAAB-specific fields.
- Existing OAAB tags, release data, tilesets, deprecation, and wiki links remain
  available through enrichment.

### Phase 18 — Plugin load-order support

**Status: Complete.**

Multiple imported plugins have an explicit, movable low-to-high load order.
Later object definitions win, deleted winners disappear, and every selected
winner retains an ordered, explainable override chain. Order and enabled-source
settings survive reload.

Allow multiple plugins in explicit load order and apply TES3 object-record
override semantics. Represent each identity with a `winningRecord` and ordered
`overrides`. Show which plugin defines the winning record and which plugins it
overrides or is overridden by.

Do not implement CELL/reference merging in this phase.

Exit criteria:

- Reordering plugins deterministically changes winning object records.
- The UI can explain the provenance/override chain for a selected record.

### Phase 19 — Cells and placed objects

**Status: Complete.**

The workspace **Cells** tab lists interiors/exteriors and each placed
reference's object ID, position, rotation, scale, and source. Base-object links
resolve against imported load-order winners and enabled built-in catalogs. Full
3D cell composition remains intentionally outside this data-view milestone.

Add a data-oriented **Cells** view. Display cell name, exterior coordinates,
placed references, object IDs, position, rotation, and scale. A selected
reference should link to its resolved base object.

Do not add full 3D cell rendering yet.

Exit criteria:

- Interior/exterior cells and references are inspectable as data.
- Base-object links honor the active load order.

### Phase 20 — Advanced NIF support

**Status: Complete.**

The render packet and shared viewer now support UV, flipbook, visibility, and
keyframe controller playback; `NiParticles`, `NiAutoNormalParticles`, and
`NiRotatingParticles` render as textured point sprites; and skin instances,
data, and partitions render in stable bind pose with diagnostics. A synthetic
Rust fixture covers every added block family, and the public lab corpus asserts
representative animation/particle output. Deforming skinning and particle
simulation remain explicitly documented fallbacks rather than silent failure.

Add features incrementally for `NiUVController`, `NiFlipController`,
`NiVisController`, `NiKeyframeController`, `NiSkinInstance`, `NiSkinData`,
`NiSkinPartition`, `NiParticles`, `NiAutoNormalParticles`, and
`NiRotatingParticles`. Extend the compatibility corpus with a representative
fixture and expected behavior for each feature.

Exit criteria:

- Each newly supported feature has a regression fixture.
- Static models continue to work when an advanced or animated model is only
  partially supported.
- Unsupported behavior remains visible in diagnostics.

## Maintenance sequence

All roadmap phases are implemented. Future work should begin with the baseline
verification below, preserve the single resolver/parser/viewer architecture,
and add a focused regression fixture before extending parser, controller,
archive, or cache behavior. Keep intentionally deferred renderer behavior in
[`lab/UNSUPPORTED.md`](lab/UNSUPPORTED.md) until its visual semantics are fully
implemented.

## Implementation handoff notes

- Primary lab entry point: `library/lab/index.html`.
- Browser app entry point: `src/library/lab/app.js`.
- Production bootstrap: `src/library/bootstrap.js`; production component
  composition: `src/library/component.js`.
- Shared renderer: `src/library/renderer/viewer.js`.
- Local workspace orchestration: `src/library/workspace/workspace-controller.js`.
- Plugin/load-order adapters: `src/library/catalog/plugin-catalog.js` and
  `src/library/catalog/load-order.js`.
- Local asset sources: `src/library/sources/local-directory-source.js` and
  `src/library/sources/bsa-source.js`.
- IndexedDB/cache modules: `src/library/storage/`; runtime HTTP cache:
  `library/sw.js`.
- Resolver ordering: higher numeric priority wins; the first source at a tied
  priority wins.
- OAAB public roots are `00 Core/meshes`, `00 Core/textures`, and
  `00 Core/icons` in OAAB_Data. The source currently tracks the `master` branch,
  while the parser dependency is commit-pinned.
- Refresh the OAAB case map with
  `./scripts/generate-oaab-asset-manifest.ps1 -Repository <OAAB_Data.git>`.
- WASM transports JSON across the binding boundary; the worker converts render
  arrays into transferable typed arrays. NIF and plugin parsing both use this
  worker.
- A `wasm-pack` build regenerates `wasm/pkg/.gitignore` containing `*`. Remove
  that generated file before staging refreshed checked-in package artifacts, or
  Git will silently ignore them. `wasm/.gitignore` should continue to ignore
  `/target/`.
- The release build runs wasm-opt with `-Os`, `--enable-bulk-memory`, and
  `--enable-nontrapping-float-to-int`; a local environment may need permission
  to execute wasm-pack's downloaded wasm-opt.
- IndexedDB schema version 1 stores parsed plugins/records, dependency metadata,
  thumbnails, and workspace settings. Increment the schema version and add an
  explicit migration before changing a store contract.
- The runtime cache is `oaab-library-runtime-v1`; bump the name when deployed
  application code/WASM becomes cache-incompatible.
- OAAB models may legitimately reference vanilla assets. Do not special-case
  them as parser errors; register a higher/lower-priority local or BSA source.
- The current case-sensitive repository fixture includes a canonical lowercase
  lookup for `comBarShelfDoor`; preserve this coverage when changing paths.

## Baseline verification

Run from the repository root:

```powershell
node tests/library/path-utils.test.mjs
node tests/library/asset-resolver.test.mjs
node tests/library/oaab-source.test.mjs
node tests/library/catalog.test.mjs
node tests/library/component.test.mjs
node tests/library/plugin-catalog.test.mjs
node tests/library/production-catalog.test.mjs
node tests/library/local-directory-source.test.mjs
node tests/library/bsa-source.test.mjs
node tests/library/dependency-scanner.test.mjs
node tests/library/thumbnail-cache.test.mjs
node tests/library/workspace-controller.test.mjs
cargo fmt --manifest-path wasm/Cargo.toml -- --check
cargo clippy --manifest-path wasm/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path wasm/Cargo.toml
wasm-pack build wasm --release --target web --out-dir pkg
python -m http.server 8765 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8765/library/lab/`, load the default model, and run
**Run 15-fixture corpus**. Also smoke-test `http://127.0.0.1:8765/library/` for
catalog loading and existing controls.

At the proof-of-concept checkpoint:

- All three Node test files passed.
- Rust format, clippy with warnings denied, and Rust tests passed.
- The optimized WASM payload was approximately 335,881 bytes.
- The lab console was clean and the 15-fixture corpus passed 15/15.
- The production Library catalog and control smoke test passed.

At the Phase 1 completion checkpoint:

- All eleven Node assertions passed, along with JavaScript syntax checks and
  `git diff --check`.
- Rust format, clippy with warnings denied, Rust tests, and the optimized
  `wasm-pack` release build passed.
- The production catalog/filter/view/preview smoke test passed with the counts
  recorded under Phase 1 above.
- The NIF lab loaded the default model and passed 15/15 corpus fixtures with no
  console warnings or errors.

At the Phase 20 completion checkpoint on 2026-08-26:

- All JavaScript modules passed `node --check`; 25 Node assertions passed across
  resolver, sources, catalogs/load order, dependency scanning, persistence key
  behavior, and production composition/enrichment.
- Rust formatting, clippy with warnings denied, and all four Rust tests passed,
  including generated ESP/ESM and advanced NIF fixtures.
- The optimized `wasm-pack` release build succeeded at 512,867 bytes and the
  checked-in bindings export both `parse_nif` and `parse_plugin`.
- Local HTTP smoke requests returned 200 for production Library, NIF lab,
  Service Worker, workspace controller, WASM loader, and WASM binary routes.
- The final implementation preserves static GitHub Pages operation and never
  uploads or persists selected BSA/loose-file payloads.

At the Catalog Source/local-thumbnail maintenance checkpoint on 2026-08-26:

- All Library JavaScript modules passed `node --check`; the focused Node suite
  passed, including batched loose-file progress, source persistence, source
  selection, and source-filter history.
- A local HTTP browser smoke test verified the full-page and compact popout
  Catalog Source menus, on-demand vanilla loading, idle-hidden workspace
  progress UI, and loose-file chooser indexing.

## Roadmap maintenance checklist

When handing work to another agent:

1. Change the phase status only when its exit criteria are satisfied.
2. Record newly deferred behavior in `lab/UNSUPPORTED.md` when it concerns NIF
   compatibility.
3. Add or update automated tests and fixture expectations with implementation
   changes.
4. Record any new dependency pin, browser limitation, cache schema version, or
   source-priority decision in this document.
5. Leave a short verification result under the affected phase or in the
   baseline section; do not rely only on conversation history.
