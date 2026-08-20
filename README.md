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
and a fetch-based web-runtime catalog loader. Material solving, the React/Three
editor, neighbour resolution and NBT export remain later stages.

A full pinned extraction has now been exercised end to end locally: 60,475
accepted state realizations compile to 2,120 unique geometries. The browser
catalog is 43.77 MiB shapes + 8.13 MiB blocks + 4.64 MiB runtime metadata; the
core metadata is 584 bytes. Full controlled probe evidence remains available
as a separate 438.91 MiB offline audit artifact. `pnpm catalog:verify` validates
all checksums and confirms an exact optimizer selection for all 2,120 catalog
geometries.
