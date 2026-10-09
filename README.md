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
pnpm palette:generate -- --catalog generated/catalog --jar minecraft-client.jar --jar create.jar --jar copycats.jar --jar addon.jar --out generated/catalog/material-palette.json
pnpm neighbors:compile -- generated/catalog --input path/to/extracted-catalog.json
pnpm schematic:verify -- generated/catalog --out verification.nbt
pnpm web:dev
pnpm web:build
pnpm web:build:pages
```

To test the editor, run `pnpm web:dev` from the repository root and open the
local URL printed by Vite (normally `http://127.0.0.1:5173/`). Do not open
`apps/web/index.html` directly: it is a Vite entry template whose TypeScript,
Worker modules and catalog fetches require the development server. A production
smoke test can be run with `pnpm web:build` followed by
`pnpm --filter @mesh-to-copycats/web preview`.

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. It builds the
editor with the project-site base path, uploads `apps/web/dist` as a Pages
artifact and deploys it from `main`. The checked-in
`.github/pages/catalog.tar.gz` contains only the six browser runtime catalog
files; the large extractor audit and mod JARs remain local.

Regenerate the archive after changing `generated/catalog`:

```text
tar -czf .github/pages/catalog.tar.gz -C generated/catalog generated-blocks.bin generated-shapes.bin metadata.json material-palette.json neighbor-transitions.bin runtime-metadata.json
```

Before the first deployment, set **Settings → Pages → Build and deployment →
Source** to **GitHub Actions**. The expected project URL is
`https://vozarius.github.io/mesh-to-copycats/`.

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

A full pinned extraction with the six supported addon JARs has been exercised
end to end locally: 137,695 accepted state realizations compile to 2,482 unique
geometries. The browser catalog is 82.11 MiB shapes + 18.93 MiB blocks +
16.10 MiB runtime metadata; the core metadata is 824 bytes. Full controlled
probe evidence remains in the 1.09 GiB extractor JSON instead of being duplicated
into browser artifacts. `pnpm catalog:verify` validates all checksums and confirms
an exact optimizer selection for every catalog geometry.

`apps/web` is the first editor surface. It imports OBJ/GLB and browser-decodable
images locally, offers plane/circle/sphere primitives, renders the source mesh
with Three.js, loads the production web catalog inside a Worker and
progressively returns a packed sparse optimized grid. It extracts bounded
per-cell surface samples, matches per-part colors in OKLab, validates Copycats
materials against the runtime acceptance profiles, and then chooses among
exact-equivalent realizations. Original, overlay and material-colored optimized
views can be switched without sending the full 1.09 GiB extraction document to
the browser. Valid resolved grids can be downloaded directly as `.nbt`; Copycat
block entities include exact material BlockStates, consumed ItemStacks and
multipart storage keys required by Schematicannon material accounting.
The pinned NeoForge runtime verifier has loaded the exported multipart NBT both
through Minecraft's `StructureTemplate` and through a real Create
Schematicannon. The cannon built two Copycat Board block entities in 23
controlled ticks, consumed its own checklist (`copycat_board×8`, `stone×6`,
`acacia_window×2`), preserved all eight exported per-part materials, and then
the verifier removed the cannon and test structure.
The optimized preview greedily boxes every selected part's exact 16³ mask.
The material sidebar loads the complete generated texture library before a
build. It supports search, Select all, Deselect all and per-block checkboxes.
The strict material pass uses only that include list; if the conjunction of
alpha, Copycats acceptance and placement evidence has no solution, a
deterministic nearest-material fallback widens the palette instead of blocking
NBT export. Each OBJ/GLB source material slot can also be locked to a specific
generated Minecraft material. Locks use the same validation and fallback order,
support undo/redo, and make the previous result stale until it is rebuilt.
The editor applies uniform Minecraft scale, XYZ rotation and block-space
translation to both the Three preview and the Worker input, with Center + Ground
and Reset controls. Source preview rendering preserves per-triangle material
groups, linear base-color factors and alpha. Embedded GLB PNG, JPEG, WebP and
other browser-decodable textures are converted to the same packed RGBA atlas.
The 3D viewport has no distance fog. Its configurable camera Clip end defaults
to 1,000,000 blocks and uses a logarithmic depth buffer for the large range.
The scale field accepts any positive finite value. A separate UV texture can be
attached to any imported OBJ/GLB material slot. Imported image planes expand
touched quadrants to the 2x2 Copycat Byte grid so each part receives an
independent material sample.

The geometry allow-list is a hard constraint. Within it the production pipeline
scores every enabled realization by equal missing/extra voxel error; it never
substitutes an unselected Copycat type. Reflection canonicalization makes
mirrored cell masks choose mirrored states, while moment and symmetry metrics
only break exact score ties. If no selected state covers the complete target,
the nearest selected state wins instead of throwing or forcing an oversized
cover. Watertight meshes use the solid side of each local surface patch, while
unscanned model interiors remain hollow.

Neighbour updates are streamed directly from the extractor JSON into a
15.58 MiB checksummed sparse binary (1,214,004 changed probes), rather than being
copied into JSON. The Worker applies exact `(center state, direction, neighbour
state)` transitions with bounded coordinate descent before material
canonicalization. Unprobed neighbour identities and multi-neighbour interactions
remain conservative: they are not generalized from `air/same/stone` evidence.

GLB `baseColorFactor` is retained as a linear material multiplier, matching the
[official glTF 2.0 contract](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#reference-material-pbrmetallicroughness-basecolorfactor).
Embedded non-interlaced PNG `baseColorTexture` images are decoded into a packed
RGBA atlas and sampled through UVs before OKLab matching. A deterministic
resource-JAR generator resolves blockstates, inherited models, texture aliases,
indexed PNG palettes and exact texture signatures. It also embeds a deterministic 16x16 first-frame preview and mean alpha for each resolved material. Nested `META-INF/jarjar` resources are traversed for bundled addons. The pinned addon output contains 2,053 accepted material items (only `create:limestone` lacks a resolvable texture): Aeronautics 18, Create Deco 173, Railways 896, Create Big Cannons 7, Farmer's Delight 14 and TFMG 185, alongside Create and Minecraft. Transparent source samples are matched only to palette entries within the configured alpha tolerance (default 0.05). External GLB images, tint-index biome colors and resource-
pack overrides beyond the supplied JAR order remain explicit limits. Imported
image alpha is converted into greedy sparse rectangles before rasterization;
the adjustable cutoff removes transparent background from geometry while
preserving exact UVs and full-image aspect ratio.
Optimized GRID16 boxes are grouped by palette index and rendered with these
nearest-filtered Minecraft textures. Copycat face cropping, connected textures
and biome tint remain approximations in the debug preview; exported BlockStates
and material NBT are unaffected.
