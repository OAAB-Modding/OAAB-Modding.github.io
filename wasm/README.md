# OAAB Library WASM parser

The project-wide implementation status and remaining phases are tracked in
[`../library/MILESTONES.md`](../library/MILESTONES.md).

This crate is the deliberately small browser-facing boundary around
[Greatness7/tes3](https://github.com/Greatness7/tes3). It is pinned to commit
`44ea38ca389f5361229eef4800373b3df13f7063` because the upstream API is
explicitly unstable.

Build the checked-in GitHub Pages artifacts from the repository root:

```powershell
wasm-pack build wasm --release --target web --out-dir pkg
```

`parse_nif(bytes)` accepts only NetImmerse 4.0.0.2 NIF data and returns a
render-oriented packet. It intentionally does not expose the upstream object
graph or any plugin/BSA parsing API yet. The browser invokes it exclusively in
`src/library/workers/tes3-worker.js` so binary parsing stays off the UI thread.

For local fixture inspection, the host-side example accepts one or more NIF
files (or `-` for stdin) and prints the same render packet as JSON:

```powershell
cargo run --manifest-path wasm/Cargo.toml --example inspect -- path/to/model.nif
```
