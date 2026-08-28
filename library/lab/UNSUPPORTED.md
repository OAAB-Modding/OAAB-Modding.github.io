# NIF lab compatibility notes

The lab parses NetImmerse 4.0.0.2 with Greatness7/tes3 and renders static and
selected animated `NiTriShape`, `NiTriStrips`, and particle geometry. The fixture
corpus in `nif-fixtures.json` covers 15 OAAB_Data models: architecture, clutter,
ingredients, weapons, doors, markers, alpha-tested meshes, collision roots,
controller-heavy lights and a particle-only model.

## Rendered now

- Scene graph transforms from `NiNode` and derived node blocks
- `NiTriShapeData` and `NiTriStripsData` vertices, indices, normals, UVs and
  inherited, mode-aware vertex colors
- Base diffuse textures through the shared `AssetResolver`
- `NiMaterialProperty`, `NiAlphaProperty`, `NiVertexColorProperty`,
  `NiStencilProperty` and `NiZBufferProperty`
- DDS (DXT1/DXT3/DXT5), TGA and browser-native PNG/JPEG textures through the
  pinned Three.js loaders
- Collision-root detection; collision meshes are hidden by default and can be
  enabled in the lab
- `NiUVController`, `NiFlipController`, `NiVisController`, and
  `NiKeyframeController` playback with linear interpolation/fallbacks
- `NiParticles`, `NiAutoNormalParticles`, and `NiRotatingParticles` rendered as
  instanced camera-facing quads, including controller-reconciled active counts,
  per-particle size/color, texture apply mode, and alpha/depth state
- `NiSkinInstance`, `NiSkinData`, and `NiSkinPartition` recognition with a
  stable bind-pose fallback and bone/partition diagnostics

## Encountered but intentionally ignored

These blocks are parsed safely and reported in the diagnostics panel, but the
current implementation does not evaluate their runtime behavior:

- Animation beyond the supported controllers: `NiTextKeyExtraData`,
  `NiAlphaController`, `NiBSAnimationNode`, TCB tangent evaluation, and Euler
  rotation keys
- Particle simulation beyond the saved live-particle display: emission,
  `NiBSParticleNode` follow behavior, grow/fade, force modifiers, and colliders
- View-dependent or selection nodes: `NiBillboardNode`, `NiLODNode`,
  `NiSwitchNode`, `NiSortAdjustNode`, `NiCollisionSwitch`
- Miscellaneous: `NiStringExtraData`, `NiAlphaAccumulator`

Deformed skinning, morph controllers, external KF animation, embedded pixel
data and complex texture effects remain deferred. Skinned meshes render in bind
pose, and partially supported models continue to display all compatible static
and particle geometry rather than failing the worker or viewer.

The generated Rust regression fixture in `wasm/src/nif.rs` covers UV, flip,
visibility, and keyframe controller packets, particle data, and skin
instance/data/partition bind-pose behavior. Public corpus expectations add live
checks for representative animation and particle packets.

## Running the corpus

Open `/library/lab/` over HTTP and choose **Run 15-fixture corpus**. Each model
is fetched from the public OAAB_Data repository, parsed in the Web Worker and
checked for its expected minimum geometry and representative block types.

The committed `assets/data/library/oaab-assets.json` file maps canonical
lowercase TES3 paths to the repository's case-sensitive spelling. Refresh it
from a local OAAB_Data Git clone with:

```powershell
./scripts/generate-oaab-asset-manifest.ps1 -Repository path/to/OAAB_Data.git
```
