# mesh-to-copycats

Deterministic, data-oriented geometry fitting for Minecraft 1.21.1, Create and
Copycats+. The repository currently implements milestone 1: packed cell
occupancy, a generated and fixture-backed shape catalog, adaptive
multi-resolution scoring, multi-part geometry candidates, exact geometry
identities, tests, a CLI harness and benchmarks.

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

The mesh importer, sparse triangle rasterizer, material solver and NBT exporter
are intentionally outside this milestone.

A full pinned extraction has now been exercised end to end locally: 60,475
accepted state realizations compile to 2,120 unique geometries and pass the
generated-artifact decoder. The raw extraction evidence is intentionally not a
web asset: even in compact JSON it is about 478 MiB, and the generated audit
metadata is about 439 MiB. Before the browser MVP, runtime geometry/material
indexes must be split from offline neighbour/placement probe evidence.
