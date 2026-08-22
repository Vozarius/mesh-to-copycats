# Catalog extractor pipeline

The pipeline has a deliberately narrow boundary:

```text
pinned NeoForge mod -> extracted-catalog.json -> TypeScript compiler
                    -> generated-shapes.bin
                    -> generated-blocks.bin
                    -> metadata.json
                    -> runtime-metadata.json
                    -> full extractor JSON retained as offline audit
```

The Java mod verifies its exact loaded source pins, enumerates authoritative
registry states and exact voxel-shape AABBs, certifies Copycats multipart masks,
and records material/neighbour/placement evidence. Material probing covers
every registered `BlockItem`; the document stores that universe once and emits
sparse per-part profiles containing only candidates accepted in at least one of
the six directions. The TypeScript compiler validates the interchange
document, assigns deterministic dense IDs, content-addresses and deduplicates
material profiles, builds optimizer indices, and writes versioned little-endian
SoA artifacts plus a compact browser runtime index. Production compilation uses
streaming JSON and omits the neighbour probe subtree from temporary in-memory
objects; the original extractor JSON remains the complete offline audit. The
web/runtime side never depends on Minecraft or mod Java classes and does not
download raw controlled probe evidence.

## Compile

```text
pnpm catalog:compile -- --input path/to/extracted-catalog.json --out generated/catalog
pnpm catalog:fixture -- --out generated/fixture
pnpm catalog:verify -- generated/catalog
pnpm neighbors:compile -- generated/catalog --input path/to/extracted-catalog.json
```

Both compiler commands decode and validate their output before writing it. The
verification command additionally checks the browser runtime CRC and runs every
catalog geometry through the QUALITY optimizer, requiring an exact
16³-equivalent selection. Use `--no-verify` only for low-level diagnostics.

The pinned mod scaffold and exact upstream coordinates are documented in
[`neoforge/README.md`](neoforge/README.md). The extractor output schema is
`mesh-to-copycats.extracted-catalog`, version `1`. A shape uses lattice AABBs
encoded as `[minX,minY,minZ,maxX,maxY,maxZ]`; v1 rejects any boundary outside
integer `0..16` rather than silently claiming sampled geometry is exact.
Unsupported geometry or multipart decomposition is retained as a sorted
diagnostic, so omissions are reviewable rather than silent.

The evidence boundary is deliberately fail-closed:

- neighbour probes invoke `updateShape` with air, same-state and stone
  neighbours in each direction through a controlled non-mutating accessor;
- placement probes call `canSurvive` in empty and six single-stone contexts,
  but do not replay placement or execute `setBlock`;
- material acceptance uses a version-pinned audited predicate adapter with
  controlled candidate/air shape reads; unknown override owners fail the whole
  profile closed.

`sources.environment` fingerprints the loaded mod set, block/item registries,
Copycats allow/deny tags and selected datapacks.

An unsupported neighbour/material probe is preserved with an explicit evidence
status. A non-grid shape or uncertifiable multipart realization cannot enter
the shape catalog and is instead represented by its diagnostic.
