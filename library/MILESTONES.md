# OAAB Library modernization milestones

This is the durable implementation roadmap and agent handoff for turning the
OAAB Library into a browser-based TES3 asset explorer. Update this file whenever
a milestone changes state, scope, or verification evidence.

Last updated: 2026-08-25

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
| Phase 1 — Modularize Library | **In progress** | Shared modules and a compatibility bridge exist; most production UI logic remains in `library/index.html`. |
| Phase 2 — Asset sources | **Complete for OAAB** | Canonical paths, ordered resolver, and public OAAB source are working. |
| Phase 3 — NIF renderer lab | **Complete for static models** | The isolated lab renders supported NetImmerse 4.0.0.2 geometry. |
| Phase 4 — TES3 WASM | **In progress** | NIF parsing and worker transfer are complete; plugin parsing is not implemented. |
| Phase 5 — Textures | **Complete for the lab** | DDS, TGA, PNG, and JPEG resolution, fallbacks, and diagnostics are implemented. |
| Phase 6 — Camera/preview | **Complete for the lab** | Framing, controls, debug toggles, and hidden-by-default collision are implemented. |
| Phases 7–20 | **Not started** | Plugin import through advanced NIF support remain planned below. |

“Complete for the lab” does not mean integrated into the production Library.
Production viewer integration is deliberately Phase 12.

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

**Status: In progress.**

Move the production Library's state, data loading, catalog adapters, record
normalization, filtering, previews, and UI coordination out of
`library/index.html`. The page currently imports `src/library/app.js` as a
compatibility bridge and uses shared `fetchLibraryData` and `meshKey` helpers,
but the majority of its application logic is still inline.

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
- Search, type/tag/tileset/release filters, and the vanilla toggle are intact.
- Previews, books, container contents, enchantment/alchemy/effect data, CSSE
  drag/drop, popout mode, and existing URLs are intact.
- OAAB_Data JSON is a catalog provider rather than the core record model.
- Production logic is divided into focused modules with no new giant JS blob.

### Phase 2 — Create the asset-source abstraction

**Status: Complete for the built-in OAAB source.**

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

Future sources in Phases 9 and 10 must implement this same interface.

### Phase 3 — Create a NIF renderer proof of concept

**Status: Complete for supported static models in `/library/lab/`.**

The lab has a canvas, asset path input, load action, orbit controls, reset,
wireframe, and diagnostics. It targets NetImmerse `4.0.0.2` and renders static
`NiTriShape` and `NiTriStrips` data, including transforms, vertices, indices,
normals, UVs, vertex colors, diffuse textures, materials, alpha behavior, and
culling/stencil/depth properties where represented by the current packet.

Supported or recognized blocks and all current limitations are maintained in
[`lab/UNSUPPORTED.md`](lab/UNSUPPORTED.md). Particles, skinning, KF animation,
morph controllers, and complex texture effects remain deferred.

Exit criteria met:

- Supported OAAB NIFs render interactively from raw source bytes.
- Unknown/deferred blocks appear in diagnostics without crashing the viewer.
- A model with no supported geometry is handled as a valid empty scene.

### Phase 4 — Integrate Greatness7/tes3 through WebAssembly

**Status: NIF path complete; plugin path not started.**

The Rust crate in `wasm/` is a deliberately narrow browser boundary. It pins
Greatness7/tes3 at commit `44ea38ca389f5361229eef4800373b3df13f7063`
and `wasm-bindgen` at `0.2.117`. `parse_nif(bytes)` returns JSON describing a
render packet; the worker converts numeric arrays into transferable typed arrays
before handing it to the UI.

Remaining work:

- Add `plugin.rs` and `parse_plugin(bytes)`.
- Initially extract Library-useful fields from `STAT`, `ACTI`, `DOOR`, `CONT`,
  `LIGH`, `MISC`, `WEAP`, `APPA`, `LOCK`, `PROB`, `INGR`, `BOOK`, `ALCH`, and
  `REPA` rather than serializing every TES3 field.
- Return masters and normalized records using the generic record model.
- Keep plugin parsing in the same worker architecture and use transferable
  buffers where useful.

Exit criteria for the full phase:

- Both NIF and plugin bytes are parsed off the UI thread through small,
  browser-oriented WASM functions.
- Plugin output is directly consumable as a catalog source.

### Phase 5 — Texture resolution

**Status: Complete for the lab.**

NIF texture paths return to `AssetResolver`; the renderer never constructs an
OAAB URL. The lab uses pinned Three.js loaders for DDS and TGA plus browser-native
PNG/JPEG loading. DDS DXT1, DXT3, and DXT5, alpha, and mipmaps are delegated to
the Three.js DDS loader. Missing textures show a visible fallback material and
remain listed separately from resolved textures.

Known boundary: OAAB NIFs can reference vanilla textures. With only OAABSource
registered those textures correctly appear as missing. Phases 9 and 10 will let
the same lookup resolve them from local loose files or BSAs.

Exit criteria met:

- Supported texture formats render through resolved bytes/object URLs.
- Diagnostics list resolved and missing texture paths and counts.
- One missing texture does not prevent the rest of the model from rendering.

### Phase 6 — Proper camera framing and preview behavior

**Status: Complete for the lab.**

The viewer derives a combined bound, centers the model, frames it according to
its size, and adjusts near/far clipping. Orbit, wheel zoom, pan,
double-click/reset, grid, axes, wireframe, collision visibility, and background
controls are present. Collision geometry is hidden by default.

Exit criteria met for the lab:

- Models of different scales begin in a useful framed view.
- Morrowind orientation is consistently applied.
- Debug overlays and render modes can be toggled without re-parsing.

Production behavior will be revalidated during Phase 12.

### Phase 7 — Plugin file loading

**Status: Not started. Depends on completing Phase 4 plugin parsing and Phase 1
catalog integration.**

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

### Phase 8 — Automatic OAAB dependency resolution

**Status: Not started. Depends on Phase 7.**

For mesh and texture paths referenced by imported plugins, query the configured
resolver automatically. An imported record and its resolved asset may have
different sources, for example `MyMod.esp` and `OAAB_Data`.

Exit criteria:

- A plugin record referencing an available `oaab/...` NIF resolves without the
  user selecting or downloading OAAB_Data.
- Record source and asset source are shown independently.

### Phase 9 — Local loose-file asset source

**Status: Not started. Depends on Phase 2; supports Phases 7, 8, and 11.**

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

**Status: Not started. Depends on Phase 2.**

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

**Status: Not started. Depends on plugin import and applicable asset sources.**

Scan imported records for mesh dependencies, then parsed NIFs for textures.
Report record, mesh, unique NIF, resolved, and missing counts. Each asset should
show its winning source or a missing state, with a dependency tree from record
to NIF to textures.

Exit criteria:

- Users can identify every unresolved dependency and see every resolved
  dependency's source.
- Diagnostic scans remain responsive and use the worker/resolver boundaries.

### Phase 12 — Integrate the live viewer into Library preview

**Status: Not started. Depends on stable Phases 1–6.**

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

**Status: Not started. Depends on Phases 12 and 14.**

For records without a thumbnail, resolve and parse the NIF through the existing
pipeline, frame it with the shared renderer, render one frame, encode WebP, and
store the result in IndexedDB. Keep normal browsing image-based.

Use a stable versioned key containing the source fingerprint, normalized asset
path, asset modification timestamp/hash, and renderer version, for example
`thumbnail:v2:<source>:<hash>`.

Exit criteria:

- A generated thumbnail is reused after reload without re-rendering.
- Source or renderer changes invalidate only affected cached thumbnails.

### Phase 14 — IndexedDB storage layer

**Status: Not started. Can begin after the record/source contracts stabilize.**

Create focused stores for `plugins`, `plugin-records`, `asset-metadata`,
`thumbnails`, and `settings`. Store fingerprints, parsed record indexes,
dependency metadata, thumbnail blobs, and source settings—but never complete
Morrowind BSAs.

Provide actions to clear imported plugins, clear thumbnail cache, and clear all
Library cache.

Exit criteria:

- Stored data has explicit schema/version migration behavior.
- Each clear action removes only its documented scope and leaves built-in
  static data untouched.

### Phase 15 — HTTP cache for OAAB assets

**Status: Not started. Depends on stable public asset URLs/build assets.**

Add a Service Worker/Cache API runtime cache for requested OAAB NIFs and
textures, WASM, and Library JS. Use versioned cache names such as
`oaab-library-runtime-v1`. Do not pre-download OAAB_Data.

Exit criteria:

- Previously requested OAAB assets can be served from cache when appropriate.
- Cache version upgrades do not leave the app running incompatible JS/WASM.

### Phase 16 — Move the built-in catalog onto the same resolver architecture

**Status: Not started; Phase 1 has only laid groundwork.**

Represent the built-in experience as OAAB records plus OAAB asset source plus
OAAB metadata enrichment. Keep current pre-rendered images as fast thumbnails,
fallbacks, and support for NIFs the live renderer cannot handle.

Exit criteria:

- Built-in and imported records traverse the same catalog/resolver/viewer
  contracts.
- Existing pre-rendered Library assets remain available and browsing remains
  fast.

### Phase 17 — OAAB enrichment layer

**Status: Not started; coordinate with Phases 1 and 16.**

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

**Status: Not started. Depends on Phase 7 and a stable generic record identity.**

Allow multiple plugins in explicit load order and apply TES3 object-record
override semantics. Represent each identity with a `winningRecord` and ordered
`overrides`. Show which plugin defines the winning record and which plugins it
overrides or is overridden by.

Do not implement CELL/reference merging in this phase.

Exit criteria:

- Reordering plugins deterministically changes winning object records.
- The UI can explain the provenance/override chain for a selected record.

### Phase 19 — Cells and placed objects

**Status: Not started. Depends on stable plugin/load-order support.**

Add a data-oriented **Cells** view. Display cell name, exterior coordinates,
placed references, object IDs, position, rotation, and scale. A selected
reference should link to its resolved base object.

Do not add full 3D cell rendering yet.

Exit criteria:

- Interior/exterior cells and references are inspectable as data.
- Base-object links honor the active load order.

### Phase 20 — Advanced NIF support

**Status: Not started. Begin only after the basic application is complete.**

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

## Recommended next-agent sequence

The next implementation increment should finish the foundation before adding
new import UI:

1. Run the baseline verification below and open both production Library and the
   NIF lab.
2. Finish Phase 1's production modularization without visible behavior changes.
3. Add the Phase 4 plugin parser and unit/fixture tests for the initial
   mesh-bearing record types.
4. Implement Phase 7 plugin loading and the source-filter/catalog adapter.
5. Verify Phase 8 OAAB auto-resolution, then add Phase 9 loose local files.
6. Add BSA support and dependency diagnostics before production viewer
   integration.
7. Integrate the live viewer, then persistence/caching, built-in unification,
   load-order/cells, and finally advanced NIF features.

If the next task is specifically about renderer correctness, it is safe to work
on lab fixtures and Phase 5/6 gaps before Phase 1, but do not wire a second
renderer or parser into production.

## Implementation handoff notes

- Primary lab entry point: `library/lab/index.html`.
- Browser app entry point: `src/library/lab/app.js`.
- Shared renderer: `src/library/renderer/viewer.js`.
- Resolver ordering: higher numeric priority wins; the first source at a tied
  priority wins.
- OAAB public roots are `00 Core/meshes`, `00 Core/textures`, and
  `00 Core/icons` in OAAB_Data. The source currently tracks the `master` branch,
  while the parser dependency is commit-pinned.
- Refresh the OAAB case map with
  `./scripts/generate-oaab-asset-manifest.ps1 -Repository <OAAB_Data.git>`.
- WASM transports JSON across the binding boundary; the worker converts render
  arrays into transferable typed arrays.
- A `wasm-pack` build regenerates `wasm/pkg/.gitignore` containing `*`. Remove
  that generated file before staging refreshed checked-in package artifacts, or
  Git will silently ignore them. `wasm/.gitignore` should continue to ignore
  `/target/`.
- The release build runs wasm-opt with `-Os` and `--enable-bulk-memory`; a local
  environment may need permission to execute wasm-pack's downloaded wasm-opt.
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
