# mesh-to-copycats

Deterministic, data-oriented geometry fitting for Minecraft 1.21.1, Create and
Copycats+. The repository currently implements milestone 1: packed cell
occupancy, a generated-style shape catalog, adaptive multi-resolution scoring,
multi-part geometry candidates, exact geometry identities, tests, a CLI harness
and benchmarks.

See [docs/architecture.md](docs/architecture.md) for the design and current
scope, and [docs/upstream.md](docs/upstream.md) for the upstream source audit.

## Commands

```text
pnpm test
pnpm typecheck
pnpm lint
pnpm benchmark
pnpm harness -- --preset stairs
```

The mesh importer, sparse triangle rasterizer, material solver and NBT exporter
are intentionally outside this milestone.
