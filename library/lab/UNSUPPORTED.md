# NIF lab compatibility notes

The lab parses NetImmerse 4.0.0.2 with Greatness7/tes3 and renders static
`NiTriShape` and `NiTriStrips` geometry. The fixture corpus in
`nif-fixtures.json` covers 15 OAAB_Data models: architecture, clutter,
ingredients, weapons, doors, markers, alpha-tested meshes, collision roots,
controller-heavy lights and a particle-only model.

## Rendered now

- Scene graph transforms from `NiNode` and derived node blocks
- `NiTriShapeData` and `NiTriStripsData` vertices, indices, normals, UVs and
  vertex colors
- Base diffuse textures through the shared `AssetResolver`
- `NiMaterialProperty`, `NiAlphaProperty`, `NiVertexColorProperty`,
  `NiStencilProperty` and `NiZBufferProperty`
- DDS (DXT1/DXT3/DXT5), TGA and browser-native PNG/JPEG textures through the
  pinned Three.js loaders
- Collision-root detection; collision meshes are hidden by default and can be
  enabled in the lab

## Encountered but intentionally ignored

These blocks are parsed safely and reported in the diagnostics panel, but the
first milestone does not evaluate their runtime behavior:

- Animation: `NiKeyframeController`, `NiKeyframeData`, `NiTextKeyExtraData`,
  `NiAlphaController`, `NiFloatData`, `NiBSAnimationNode`
- Particles: `NiAutoNormalParticles`, `NiAutoNormalParticlesData`,
  `NiBSParticleNode`, `NiParticleGrowFade`, `NiParticleSystemController`
- View-dependent or selection nodes: `NiBillboardNode`, `NiLODNode`,
  `NiSwitchNode`, `NiSortAdjustNode`, `NiCollisionSwitch`
- Miscellaneous: `NiStringExtraData`, `NiAlphaAccumulator`

Skinning, morph controllers, KF animation, embedded pixel data and complex
texture effects are also deferred. A model containing only deferred geometry
(for example the blue soul-flame particle fixture) produces a valid packet with
zero renderable meshes and warnings rather than failing the worker or viewer.

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
