# mesh-to-copycats

Deterministic, data-oriented geometry fitting for Minecraft 1.21.1, Create and
Copycats+. The repository implements the geometry core and the non-UI portion
of milestone 2: packed OBJ/GLB meshes, sparse cell discovery, adaptive
multi-resolution scoring, a production generated catalog, multi-part geometry
candidates, exact identities, typed batch APIs, tests, a CLI harness and
benchmarks.

See [docs/architecture.md](docs/architecture.md) for the design and current
scope, and [docs/upstream.md](docs/upstream.md) for the upstream source audit.

## Commands

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm benchmark
pnpm harness -- --preset stairs
pnpm catalog:fixture -- --out generated/fixture
pnpm catalog:compile -- --input path/to/extracted-catalog.json --out generated/catalog
pnpm catalog:verify -- generated/catalog
pnpm materials:verify -- generated/catalog
pnpm palette:generate -- --catalog generated/catalog --jar minecraft-client.jar --jar create.jar --jar copycats.jar --out generated/catalog/material-palette.json
pnpm schematic:verify -- generated/catalog
pnpm web:dev
pnpm web:build
```

`tools/mod-extractor/neoforge` contains the pinned Minecraft 1.21.1 / NeoForge /
Create / Copycats+ extraction environment. Before using version-sensitive APIs,
the command verifies the exact loaded mod versions and aborts on a mismatch. It
exports strict exact outline and certified multipart geometry, evaluates every
registered `BlockItem` against the Copycats material predicate, and records
controlled neighbour and placement evidence. Material results are stored as
sparse, content-addressed profiles; candidates rejected in all six directions
are omitted from a profile, not from its complete registry coverage.

The extractor is fail-closed. Non-grid geometry and uncertifiable multipart
states are omitted with sorted diagnostics; unsupported evidence is marked as
such instead of being guessed. Material acceptance uses an audited reproduction
of the pinned Create/Copycats predicate with controlled candidate-at-center and
air-outside shape reads; an unknown override owner makes the whole profile
`UNSUPPORTED`. Placement probes call `canSurvive` only: they do not replay an
item placement context or execute `setBlock`. Metadata fingerprints the loaded
mods, registries, Copycats allow/deny tags and selected datapacks.

The repository now also includes packed OBJ/GLB import, triangle-centric sparse
surface rasterization, lazy per-cell 16³ masks, typed-array batch optimization
and a fetch-based web-runtime catalog loader. Per-part material solving, the
React/Three editor and deterministic gzip-compressed Create structure NBT export
are integrated. Neighbour resolution and exact rendered block meshes remain
later stages.

A full pinned extraction has now been exercised end to end locally: 60,475
accepted state realizations compile to 2,120 unique geometries. The browser
catalog is 43.77 MiB shapes + 8.13 MiB blocks + 4.64 MiB runtime metadata; the
core metadata is 584 bytes. Full controlled probe evidence remains available
as a separate 438.91 MiB offline audit artifact. `pnpm catalog:verify` validates
all checksums and confirms an exact optimizer selection for all 2,120 catalog
geometries.

`apps/web` is the first editor surface. It imports OBJ/GLB locally, renders the
source mesh with Three.js, loads the production web catalog inside a Worker and
progressively returns a packed sparse optimized grid. It extracts bounded
per-cell surface samples, matches per-part colors in OKLab, validates Copycats
materials against the runtime acceptance profiles, and then chooses among
exact-equivalent realizations. Original, overlay and material-colored optimized
views can be switched without sending the 439 MiB extraction audit to the
browser. Valid resolved grids can be downloaded directly as `.nbt`; Copycat
block entities include exact material BlockStates, consumed ItemStacks and
multipart storage keys required by Schematicannon material accounting.

GLB `baseColorFactor` is retained as a linear material multiplier, matching the
[official glTF 2.0 contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness-basecolorfactor).
Embedded non-interlaced PNG `baseColorTexture` images are decoded into a packed
RGBA atlas and sampled through UVs before OKLab matching. A deterministic
resource-JAR generator resolves blockstates, inherited models, texture aliases,
indexed PNG palettes and exact texture signatures. The pinned production output
contains 759 of 760 accepted material items (only `create:limestone` lacks a
resolvable texture). JPEG, external GLB images, tint-index biome colors and
resource-pack overrides beyond the supplied JAR order remain explicit limits.
