# Milestone 1 geometry core

This milestone implements one bounded operation: choose the closest catalogued
block geometry for a single already-voxelized cell. Mesh import, triangle
rasterization, material selection, neighbour solving and NBT export deliberately
remain outside the package boundary.

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
- `voxelizer` owns packed masks, conservative resampling, transforms,
  descriptors and lazy `AdaptiveOccupancy`. It is an occupancy source in this
  milestone, not yet a triangle voxelizer.
- `shapes` owns exact keys, the packed catalog and the replaceable fixture
  definitions.
- `optimizer` owns routing, weighted missing/extra scoring, staged refinement
  and the public/debug APIs.
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
future mod-side extractor can replace the fixture builder without changing the
optimizer API or packed catalog layout.

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
const comparison = optimizer.compare(input, result.best.geometryId, 16);
```

The result contains the best candidate, alternatives, exact-equivalent shape
ids, the preferred realization's parts and debug counters. `compare` returns
hex and ASCII slices for target, candidate, missing and extra masks without
inflating every normal result.

## Future boundary

Milestone 2 should add sparse mesh-to-cell rasterization and batch/worker APIs.
After real workloads exist, profiling can justify an allocation-free
`optimizeCellInto` path or a Rust/WASM kernel. Production catalog extraction,
material compatibility, per-part texture fitting, neighbour constraints and
NBT serialization remain later independent stages.

## Current constraints

- The catalog is a replaceable fixture, not extracted Minecraft registry data.
- Exact keys accept integer-lattice AABB unions only; slopes or sampled meshes
  cannot be declared exact by this implementation.
- When multipart masks overlap (for example, boards meeting along an edge), the
  owner grid deterministically assigns the lowest local part id. The separate
  part masks retain the overlap, but one owner byte cannot represent coincident
  ownership and a material-stage policy is still required.
- `fromPredicate` is a synthetic center-sampling helper. It is not the future
  conservative triangle rasterizer; `fromMask16` does use conservative
  fine-to-coarse reduction.
- The ergonomic result API allocates JavaScript collections. Benchmark data is
  intended to guide a later scratch-backed `Into`/batch API rather than claim
  allocation-free operation today.
