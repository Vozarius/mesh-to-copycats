# Geometry core and sparse mesh pipeline

The implemented core imports packed triangle meshes, discovers only
surface-intersected Minecraft cells, builds local occupancy lazily, and chooses
the closest catalogued block geometry. Material selection, neighbour solving,
the editor UI and NBT export remain outside the current package boundary.

```text
target occupancy + descriptor
            |
            v
parametric routes + generic coarse fallback
            |
            v
       unique geometryIds
            |
            v
 score 4^3 -> optional 8^3 -> optional 16^3
            |
            v
geometry result + every exact-equivalent shape realization
```

## Packages

- `shared` owns stable enums and small cross-package value types.
- `mesh` imports packed OBJ/GLB triangle data, triangulates faces, applies GLB
  scene transforms and removes degenerate triangles.
- `voxelizer` owns packed masks, conservative resampling, transforms,
  descriptors, triangle-centric sparse surface rasterization and lazy
  `AdaptiveOccupancy` materialization per intersected cell.
- `shapes` owns exact keys, the packed catalog, generated-artifact codec,
  extractor interchange schema and the replaceable fixture definitions.
- `optimizer` owns routing, weighted missing/extra scoring, staged refinement,
  packed batch results and the public/debug APIs.
- `tools/harness` and `benchmarks` are consumers of the same public API.

Dependencies point toward data packages only; the catalog has no dependency on
the optimizer.

## Packed occupancy

Masks use `Uint32Array` and the x-fast index
`i = x + R * (y + R * z)`. A 4^3 mask is 2 words/8 bytes, 8^3 is 16
words/64 bytes, and 16^3 is 128 words/512 bytes. This layout avoids BigInt in
the JavaScript hot path and can cross a future Rust/WASM boundary as a plain
little-endian word buffer.

`AdaptiveOccupancy` holds 4^3 eagerly and calls providers for 8^3 and 16^3 at
most once. Fine-to-coarse conversion is a conservative 2x2x2 OR reduction: a
thin occupied voxel is never erased. As a consequence, nearby thin forms can
alias at a coarse level; staged refinement is responsible for separating them.

The current descriptor is a packed 22-float view containing volume, eight
octant fills, six face fills, centroid, a coarse normal and normal variance.
The normal is a routing hint and is not part of the geometry error.

## Catalog identity and realizations

The catalog separates two identities:

- `geometryId` is one unique exact solid volume and is scored once;
- `shapeId` is a concrete block/state/part layout which realizes that volume.

This is required because a full cube, a double Copycat slab and a Copycat byte
with all octants can occupy the same volume while providing different material
slots. `geometryRealizationOffsets` and `geometryRealizations` retain all of
them. The public `shapeId` is only a deterministic preferred realization;
future material solving must inspect `equivalentShapeIds`.

Geometry masks, popcounts and descriptors are geometry-indexed SoA arrays.
Families, state ids, complexity and part offsets are shape-indexed typed arrays.
Part masks are held in one packed pool. Multipart shapes additionally have a
16^3 owner grid (`255` means air); single-part ownership is implicit.

Fixture ids begin with `fixture:`. They model confirmed upstream families and
property/part names but are not claimed to be production registry data. A
pinned mod-side extractor can replace the fixture builder without changing the
optimizer API or packed catalog layout once its output has been reviewed and
promoted.

## Generated catalog boundary

The production boundary is a deterministic two-stage pipeline:

```text
pinned NeoForge process
  -> extracted-catalog.json (reviewable registry/state/AABB interchange)
  -> TypeScript catalog compiler
  -> generated-shapes.bin + generated-blocks.bin + metadata.json
  -> runtime-metadata.json (browser material/placement indexes)
  -> extraction-audit.json (offline controlled probe evidence)
```

Both binary files are versioned, explicitly little-endian SoA containers with
per-section and payload CRC32 checks. They preserve `geometryId` deduplication
without discarding concrete `shapeId` realizations or part ownership. Loading
performs bounds, offsets, ID, posting-order, metadata and checksum validation
before constructing `PackedShapeCatalog`. The compiler decodes its output by
default, and byte-for-byte determinism is covered against the complete fixture.

The interchange schema accepts only exact integer-lattice AABBs. Unknown real
blocks use `ShapeFamily.GENERIC`, so the family-independent coarse-mask index
can route them without pretending that a Java class name implies a supported
parametric family. Dedicated family mapping and Copycats part extraction are
version-pinned adapter responsibilities.

Extraction evidence remains metadata rather than optimizer hot-path data. The
document contains one sorted universe of every registered `BlockItem` and
sparse per-part material-acceptance profiles. A sparse profile stores only
items accepted in at least one of the six directions; absence means all six
directions were rejected because the profile's coverage is
`COMPLETE_REGISTRY`. The compiler replaces source-local profile references with
SHA-256 content identities and deduplicates identical behavior without tying
the identity to a block or part owner.

The generated boundary has an explicit runtime/audit split. Core metadata
checksums the browser runtime file, which contains numeric part-to-material and
shape-to-placement profile indexes. Raw neighbour, placement and diagnostic
evidence is retained only in the audit file. In the measured production catalog
this reduces browser metadata from 438.91 MiB to 4.64 MiB.

## Sparse mesh processing

OBJ and embedded-buffer GLB 2.0 import produce typed position/index/UV/material
arrays. The sparse rasterizer projects each triangle along its dominant axis,
clips it against projected cell squares and emits only actually intersected
cells. Biased 63-bit keys give deterministic ordering for signed coordinates;
packed offset/posting arrays retain local triangle sets without per-cell object
graphs. A cell's conservative 16³ surface mask is built on demand and wrapped
as `AdaptiveOccupancy`, so empty model interiors are never volume-scanned or
solid-filled.

## Exact geometry keys

`GRID16_EXACT:v1` is assigned only to unions of axis-aligned boxes whose six
coordinates are validated integers in the `0..16` lattice. For that restricted
domain the 4096 occupancy bits are an exact canonical union, so box ordering,
splitting and overlap do not affect identity. Arbitrary sampled meshes are not
allowed to acquire this key; a later extractor must add another exact tagged
representation or reject unsupported shapes.

## Candidate generation and scoring

Parametric routes infer plausible linear thicknesses, faces, byte octants,
stairs and slice parameters. A family-independent fallback searches nearby
4^3 population buckets and ranks them by coarse Hamming and descriptor distance.
Both streams are merged and deduplicated by `geometryId`, keeping a bounded
candidate set while allowing a new catalog family to work before it gets a
special router.

For every resolution the scorer separately counts

```text
missing = target & ~candidate
extra   = candidate & ~target
```

and minimizes

```text
(missingWeight * popcount(missing) + extraWeight * popcount(extra))
------------------------------------------------------------------
                    popcount(target | candidate)
```

Weights are converted to Q12 integers. Scores are ordered by cross
multiplication rather than floating-point division; empty/empty has denominator
one and zero error. A conservative denominator bound permits early exit while
scanning mask words. Equal-score candidates at a cutoff are retained for the
next level. Final ordering is error, family priority, complexity, then stable
shape id.

`FAST` uses 4^3 and at most 8^3. `BALANCED` reaches 16^3 only for a tie, small
margin or complex ambiguous surface. `QUALITY` favors final 16^3 comparison for
ambiguous survivors. The result reports its actual resolution, stage counts,
routing statistics and optional timings.

## Public surface

```ts
const optimizer = createGeometryOptimizer({ catalog, settings });
const result = optimizer.optimizeCell({ occupancy, descriptor, settings });
const batch = optimizer.optimizeBatch(inputs, { onProgress, signal });
const comparison = optimizer.compare(input, result.best.geometryId, 16);
```

The result contains the best candidate, alternatives, exact-equivalent shape
ids, the preferred realization's parts and debug counters. `compare` returns
hex and ASCII slices for target, candidate, missing and extra masks without
inflating every normal result.

## Future boundary

The next boundary is worker/chunk orchestration from an imported mesh through
all sparse cells into a progressive optimized grid. Per-part surface sampling,
texture/material solving, exact post-material canonicalization, neighbour
constraint solving, NBT serialization and the React/Three editor remain later
independent stages. Profiling can still justify a scratch-backed
`optimizeCellInto` path or a Rust/WASM kernel.

## Current constraints

- The fixture is still the default catalog. The pinned extractor has completed
  a local end-to-end production run (60,475 shapes, 2,120 geometries, 63
  material profiles) and its binaries pass decode/CRC verification, but no
  reviewed production artifact is committed yet.
- Full raw extraction evidence remains an offline audit artifact. The measured
  compact interchange is about 478 MiB and generated audit 438.91 MiB. Browser
  loading uses only 4.64 MiB runtime metadata plus the two packed binaries and
  verifies the runtime file against the CRC stored in core metadata.
- The extraction command verifies the exact loaded Minecraft, NeoForge, Create,
  Copycats+ and extractor versions before calling upstream APIs. A missing or
  mismatched pin aborts extraction rather than producing mixed-version data.
- The Java exporter certifies Copycats multipart masks only when isolated
  singleton-state witnesses are contained by the target and their union exactly
  reconstructs the total GRID16 mask. Ambiguous or non-grid states are omitted
  with deterministic diagnostics. Copycats cogwheel `shaft` and `cogwheel`
  parts currently have no singleton witnesses and are therefore omitted with
  `COPYCATS_MULTIPART_UNSUPPORTED`.
- Material acceptance covers the complete loaded registry universe of
  `BlockItem` identities in six directions and preserves the accepted result
  state. Its profiles are sparse and content-addressed. A version-pinned audited
  adapter reproduces the predicate with candidate-at-center, air-outside shape
  reads and explicitly supported overrides; an unknown declaring owner fails
  the complete profile closed instead of exposing a live `ServerLevel`.
- Neighbour evidence invokes `updateShape` for air, the same state and stone in
  every direction through a controlled, non-mutating `LevelAccessor`, then
  records the resolved state and exact outline. Unknown accessor operations
  fail the evidence closed; scheduled ticks are suppressed because they cannot
  affect the synchronous result. Absence of change in this finite sample does
  not prove independence, so extracted runtime flags remain conservative.
- Placement evidence invokes `canSurvive` in an empty controlled context and
  with one stone neighbour in each direction. It does not construct the real
  item placement context, initialize required block entities or execute
  `setBlock`, and therefore remains conditional preflight evidence.
- `sources.environment` fingerprints loaded mod identities, block/item
  registries, Copycats allow/deny tags and selected datapacks, so equal version
  labels cannot hide different enumeration inputs.
- Exact keys accept integer-lattice AABB unions only; slopes or sampled meshes
  cannot be declared exact by this implementation.
- When multipart masks overlap (for example, boards meeting along an edge), the
  owner grid deterministically assigns the lowest local part id. The separate
  part masks retain the overlap, but one owner byte cannot represent coincident
  ownership and a material-stage policy is still required.
- The sparse rasterizer conservatively marks the triangle surface. It does not
  perform closed-volume parity filling; by design, cells and microvoxels not
  crossed by model surface remain air.
- `optimizeBatch` returns packed typed arrays, while each internal cell call
  still uses the ergonomic allocating result API. A future scratch-backed
  `optimizeCellInto` or WASM kernel can remove those remaining hot-path objects.
