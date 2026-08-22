# NeoForge catalog extractor

This directory is the pinned Minecraft-side build environment for the
catalog extractor. The current command verifies exact loaded versions,
enumerates registry states and registered material items, and exports strict
integer-lattice outline shapes plus audited evidence. It does not replace the
deterministic TypeScript fixture until the generated artifact has been reviewed.

## Pinned toolchain and mods

| Component | Pin |
| --- | --- |
| Java | 21 |
| Gradle | `8.14.3` (verified; wrapper is not committed) |
| Minecraft | `1.21.1` |
| ModDevGradle | `2.0.107` |
| NeoForge | `21.1.233` |
| Parchment | `2024.11.17` for Minecraft 1.21.1 |
| Create | `com.simibubi.create:create-1.21.1:6.0.10-280:slim` |
| Ponder | `net.createmod.ponder:ponder-neoforge:1.0.82+mc1.21.1` |
| Flywheel | `dev.engine-room.flywheel:*:1.0.6` |
| Registrate | `com.tterrag.registrate:Registrate:MC1.21-1.3.0+67` |
| Copycats+ | `maven.modrinth:UT2M39wf:kecZ0sl7` (`3.0.4+mc.1.21.1-neoforge`) |

The dependency repositories are the official NeoForge, Create, ithundxr and
Modrinth Maven endpoints. Modrinth dependencies are non-transitive, so the
Create dependency stack is declared explicitly in `build.gradle`.

The runtime descriptor accepts only the pinned compatibility lines: Minecraft
`1.21.1`, NeoForge `21.1.233` or newer, Create `6.0.x` starting at `6.0.10`,
and Copycats+ `3.0.x` starting at `3.0.4`. The build itself resolves the exact
artifact pins listed above. The extraction command is stricter than those load
ranges: it reads the loaded versions and aborts unless they are exactly
Minecraft `1.21.1`, NeoForge `21.1.233`, Create `6.0.10`, Copycats+
`3.0.4+mc.1.21.1-neoforge` and extractor `0.2.0`.

The verified addon environment additionally pins Aeronautics Bundled 1.3.0,
Create Deco 2.1.3, Steam 'n' Rails 0.3.0-beta, Create Big Cannons 5.11.7,
Farmer's Delight 1.3.2 and TFMG 1.2.0, plus Ritchie's Projectile Library 2.1.2
and Sable 2.0.1. `sources.addons` records every exact loaded addon component.

## Commands

No Gradle wrapper or binary is committed here. With Java 21 and Gradle 8.14.3,
run commands from the repository root:

```text
gradle -p tools/mod-extractor/neoforge tasks
gradle -p tools/mod-extractor/neoforge build
gradle -p tools/mod-extractor/neoforge runClient
gradle -p tools/mod-extractor/neoforge runServer
```

The first Gradle invocation needs network access to resolve the pinned
dependencies. The pinned build has been verified with Gradle 8.14.3. In an
operator-enabled integrated or dedicated server, run:

```text
/m2c_extract_catalog
/m2c_extract_catalog "review-catalog.json"
/m2c_verify_schematic "verification.nbt" 0 250 0
/m2c_verify_schematicannon "verification.nbt" 0 250 0 4 250 0
```

The output stays inside the run directory's `m2c-extractor/` folder. Compile it
from the repository root with:

```text
pnpm catalog:compile -- --input path/to/m2c-extracted-catalog.json --out generated/catalog
pnpm neighbors:compile -- generated/catalog --input path/to/m2c-extracted-catalog.json
```

The development `runServer` task forwards standard input, so the extraction
command can be entered directly in its dedicated-server console. The exporter
writes deterministic compact JSON rather than pretty-printed JSON: the complete
pinned catalog contains tens of thousands of states and raw audit probes are
too large for whitespace-expanded interchange.

`m2c_verify_schematic` accepts only a direct, non-linked `.nbt` file inside the
run directory's `m2c-extractor/` folder. It caps compressed and expanded size,
requires a fully loaded empty target volume, places through Minecraft's pinned
`StructureTemplate`, compares every block state and every explicitly supplied
Copycats material field, and clears the entire volume even after a failed
placement attempt. Copycats may canonically add default material entries for
inactive multipart slots; the verifier permits those additions but requires the
exported material subtree to survive unchanged.

`m2c_verify_schematicannon` adds the full Create integration check. It stages
the same bounded input under Create's private uploaded-schematic directory,
places a real Schematicannon, lets the cannon compute its own `MaterialChecklist`,
supplies exactly those stacks through an `IItemHandler`, consumes gunpowder,
runs the real flying-block lifecycle to completion, and then performs the same
exact state/material verification. It additionally proves that every exported
Copycats `consumedItem` appears in the cannon checklist. Staged files, cannon
and target volume are removed in `finally`, including failed runs. The verified
production sample consumed eight Copycat Board items and eight independent part
materials across two multipart block entities.

The verified addon run exported 137,695 shapes from 163,813 states, with 26,199
fail-closed diagnostics and 69 material profiles. TypeScript compilation
produced 2,482 unique geometries and 140,356 parts, with 82.11 MiB of shape data,
18.93 MiB of block data and 16.10 MiB of runtime metadata. The 1.09 GiB source
JSON remains the offline audit; it is never delivered to the browser.

The command sorts resource locations, states, properties and AABBs. It refuses
any coordinate that is not exactly on the integer `0..16` lattice; it never
snaps an approximate shape and labels it exact. Exact loaded-source validation
runs before any version-sensitive upstream adapter.

## Current extraction boundary

The Java command preserves exact property names/values and uses a table-driven
family classification with `GENERIC` fallback. For Copycats+ multi-state blocks
it reads the version-pinned public `storageProperties()` and `partExists(...)`
API. Per-part volume is accepted only when a closest same-block state isolates
exactly one storage key, the witness mask is contained by the target, and the
union of all parts exactly reconstructs the target mask. Keys are kept verbatim;
material slots are assigned in sorted-key order.

Unsupported or ambiguous multipart realizations are omitted with a deterministic
`COPYCATS_MULTIPART_UNSUPPORTED` diagnostic instead of being mislabeled as a
single-material shape. The pinned small and large cogwheel family uses its
authoritative interaction ownership instead of a singleton witness: `cogwheel`
owns the central axial GRID16 slice 6..10 and `shaft` owns the remaining two
slices. The clipped parts are accepted only when their union reconstructs the
authoritative outline exactly.

Material acceptance is evaluated for every registered `BlockItem` identity,
including distinct items that target the same block, in the explicit direction
order `down,east,north,south,up,west`. The candidate universe is stored once.
Per-block/part profiles are sparse: a candidate absent from the results was
rejected in all six directions, not skipped. The TypeScript compiler replaces
source-local references with SHA-256 content identities and deduplicates equal
profiles. An exception marks the entire affected profile `UNSUPPORTED` rather
than silently claiming complete coverage.

The material implementation is a version-pinned audited reproduction of the
Create 6.0.10 / Copycats+ 3.0.4 predicate. Candidate outline and collision
shapes see an immutable candidate-at-`BlockPos.ZERO`, air-outside getter; no
live `ServerLevel` is passed. Reflection verifies the declaring owners of both
acceptance overloads and `isAcceptedRegardless`. The known bracket, shaft and
cogwheel cases are explicit; any unknown addon or mixin override makes the
whole profile `UNSUPPORTED` with a stable reason.

The exported `sources.environment` SHA-256 covers sorted loaded mod versions,
block/item registry identities, Copycats allow/deny tag membership and selected
datapacks. This captures enumeration inputs beyond the five exact source pins.

Neighbour evidence invokes `BlockState.updateShape` for each direction with
distinct air, same-state and stone neighbours through a controlled
`LevelAccessor`, then records the resolved state and exact outline. Block,
fluid and block-entity reads come from the immutable snapshot; mutation and
unknown accessor calls fail the probe closed, while scheduled ticks are
suppressed because they cannot change the synchronous return value. The finite
air/same/stone matrix can observe dependence but cannot prove its absence, so
the runtime `neighborDependent` flag remains conservative.

Placement preflight invokes `canSurvive` in an empty controlled reader and with
one stone neighbour in each direction. It explicitly flags that no item
placement context was replayed and no `setBlock` occurred; block-entity states
also carry an initialization flag. This is conditional evidence, not a claim
that the placement flow is safe or complete.

Non-grid geometry and uncertifiable multipart states are omitted with sorted
diagnostics. Neighbour failures are retained as `UNSUPPORTED` evidence and
material failures as `UNSUPPORTED` profiles; placement failures remain
`UNEXTRACTED`. No unsupported result is guessed.

Build outputs, local run directories and Gradle caches are disposable and must
not be treated as generated catalog artifacts. Promote only a reviewed
interchange document through the TypeScript compiler into an explicit
repository artifact path.
