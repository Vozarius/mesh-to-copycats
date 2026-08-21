# mesh-to-copycats

Deterministic, data-oriented geometry fitting for Minecraft 1.21.1, Create and
Copycats+. The repository implements an end-to-end local MVP: packed
OBJ/GLB/image meshes, sparse cell discovery, adaptive
multi-resolution scoring, a production generated catalog, multi-part geometry
candidates, exact identities, per-part material solving, neighbour resolution,
a React/Three editor, deterministic Create NBT export, typed batch APIs, tests,
a CLI harness and benchmarks.

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
pnpm neighbors:compile -- generated/catalog
pnpm schematic:verify -- generated/catalog --out verification.nbt
pnpm web:dev
pnpm web:build
```

To test the editor, run `pnpm web:dev` from the repository root and open the
local URL printed by Vite (normally `http://127.0.0.1:5173/`). Do not open
`apps/web/index.html` directly: it is a Vite entry template whose TypeScript,
Worker modules and catalog fetches require the development server. A production
smoke test can be run with `pnpm web:build` followed by
`pnpm --filter @mesh-to-copycats/web preview`.

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
are integrated. Neighbour resolution, generated texture palettes and exact
GRID16 block previews are integrated as well.

A full pinned extraction has now been exercised end to end locally: 60,479
accepted state realizations compile to 2,120 unique geometries. The browser
catalog is 43.79 MiB shapes + 8.13 MiB blocks + 5.31 MiB runtime metadata; the
core metadata is 584 bytes. Full controlled probe evidence remains available
as a separate 439.60 MiB offline audit artifact. `pnpm catalog:verify` validates
all checksums and confirms an exact optimizer selection for all 2,120 catalog
geometries.

`apps/web` is the first editor surface. It imports OBJ/GLB and browser-decodable
images locally, offers plane/circle/sphere primitives, renders the source mesh
with Three.js, loads the production web catalog inside a Worker and
progressively returns a packed sparse optimized grid. It extracts bounded
per-cell surface samples, matches per-part colors in OKLab, validates Copycats
materials against the runtime acceptance profiles, and then chooses among
exact-equivalent realizations. Original, overlay and material-colored optimized
views can be switched without sending the 439 MiB extraction audit to the
browser. Valid resolved grids can be downloaded directly as `.nbt`; Copycat
block entities include exact material BlockStates, consumed ItemStacks and
multipart storage keys required by Schematicannon material accounting.
The pinned NeoForge runtime verifier has loaded the exported multipart NBT both
through Minecraft's `StructureTemplate` and through a real Create
Schematicannon. The cannon built two Copycat Board block entities in 23
controlled ticks, consumed its own checklist (`copycat_board×8`, `stone×6`,
`acacia_window×2`), preserved all eight exported per-part materials, and then
the verifier removed the cannon and test structure.
The optimized preview greedily boxes every selected part's exact 16³ mask.
Clicking a reported material excludes it from the next solve; entries can be
restored individually or reset from the sidebar.
Each OBJ/GLB source material slot can also be locked to a specific generated
Minecraft material. Locks are checked through the same per-part compatibility,
acceptance and placement pipeline as automatic matches, support undo/redo, and
make the previous result non-exportable until it has been rebuilt.
The editor applies uniform Minecraft scale, XYZ rotation and block-space
translation to both the Three preview and the Worker input, with Center + Ground
and Reset controls. Source preview rendering preserves per-triangle material
groups, linear base-color factors, alpha and every decoded embedded texture.
The scale field accepts any positive finite value. A separate UV texture can be
attached to any imported OBJ/GLB material slot. Locally planar cells are
octantized and prefer exact Copycat Byte realizations, giving four independently
matched material quadrants on a visible face; imported images use the same path.
Coverage-constrained fitting forbids a selected non-air realization from
leaving a rasterized surface voxel uncovered, while the interior remains hollow.

Neighbour updates are compiled from the offline extraction evidence into a
7.01 MiB checksummed sparse binary (546,579 changed probes), rather than being
copied into JSON. The Worker applies exact `(center state, direction, neighbour
state)` transitions with bounded coordinate descent before material
canonicalization. Unprobed neighbour identities and multi-neighbour interactions
remain conservative: they are not generalized from `air/same/stone` evidence.

GLB `baseColorFactor` is retained as a linear material multiplier, matching the
[official glTF 2.0 contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness-basecolorfactor).
Embedded non-interlaced PNG `baseColorTexture` images are decoded into a packed
RGBA atlas and sampled through UVs before OKLab matching. A deterministic
resource-JAR generator resolves blockstates, inherited models, texture aliases,
indexed PNG palettes and exact texture signatures. It also embeds a deterministic
16×16 first-frame preview for each resolved material (759 textures / 777,216 raw
RGBA bytes; 1.24 MB JSON). The pinned production output contains 759 of 760
accepted material items (only `create:limestone` lacks a
resolvable texture). External GLB images, tint-index biome colors and resource-
pack overrides beyond the supplied JAR order remain explicit limits. Imported
image alpha is converted into greedy sparse rectangles before rasterization;
the adjustable cutoff removes transparent background from geometry while
preserving exact UVs and full-image aspect ratio.
Optimized GRID16 boxes are grouped by palette index and rendered with these
nearest-filtered Minecraft textures. Copycat face cropping, connected textures
and biome tint remain approximations in the debug preview; exported BlockStates
and material NBT are unaffected.
