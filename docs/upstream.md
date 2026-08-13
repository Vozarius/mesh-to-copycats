# Create and Copycats+ source audit

This audit was performed before defining the milestone-1 catalog model. It is
based on source, not guessed registry/NBT data. The local research checkout is
not part of the product and the implementation deliberately uses `fixture:`
ids until a mod-side extractor produces authoritative generated assets.

## Pinned sources

Audited on 2026-08-13:

| Project | Minecraft line | Revision |
| --- | --- | --- |
| [Create: Copycats+](https://github.com/copycats-plus/copycats) | multiloader / 1.21.1 sources | [`b5e8c74fa7574ddb080a5d4268cfff104e67ec4c`](https://github.com/copycats-plus/copycats/tree/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c) |
| [Create](https://github.com/Creators-of-Create/Create) | `mc1.21.1/dev` | [`87b3c6a65fd00c023a07b37b0353144bc7e6a5bf`](https://github.com/Creators-of-Create/Create/tree/87b3c6a65fd00c023a07b37b0353144bc7e6a5bf) |

The Copycats+ README explicitly lists slabs in every orientation, normal and
vertical stairs, eight-size slice variants, layers, bytes, byte panels, boards
and half-layer variants. It also states that eight bytes form a block, four
byte-panel parts form a panel, and multiple one-pixel boards can share a block
space. See the pinned [feature list](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/README.md#features).

## Material and multipart model

Create's ordinary copycat block entity stores one `BlockState material` and a
consumed item, serializes the material under `Material`, and validates it again
while loading. Its block acceptance path honors allow/deny tags and otherwise
rejects block entities, stairs, empty/non-full shapes and empty collision
shapes. These rules are visible in pinned
[`CopycatBlockEntity`](https://github.com/Creators-of-Create/Create/blob/87b3c6a65fd00c023a07b37b0353144bc7e6a5bf/src/main/java/com/simibubi/create/content/decoration/copycat/CopycatBlockEntity.java)
and
[`CopycatBlock`](https://github.com/Creators-of-Create/Create/blob/87b3c6a65fd00c023a07b37b0353144bc7e6a5bf/src/main/java/com/simibubi/create/content/decoration/copycat/CopycatBlock.java).

Copycats+ extends this to a map from a string part property to `MaterialItem`.
Each item stores `material`, `consumedItem` and `enableCT`; the block entity
persists the map below `material_data`. The relevant contracts expose
`storageProperties()`, `defaultProperty()`, `partExists(...)` and mappings
between a property and its part vector. Evidence:

- [`MaterialItemStorage`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/foundation/copycat/multistate/MaterialItemStorage.java)
- [`IMultiStateCopycatBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/foundation/copycat/multistate/IMultiStateCopycatBlock.java)
- [`IMultiStateCopycatBlockEntity`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/foundation/copycat/multistate/IMultiStateCopycatBlockEntity.java)

This is why the TypeScript catalog treats parts and material slots as
first-class data. It also explains why geometry deduplication cannot discard
shape realizations: a full cube, double slab and eight-part byte can have one
solid `geometryId` but materially different `shapeId` layouts.

## Confirmed state and part vocabulary

The fixture mirrors the following source-level vocabulary while retaining its
honest `fixture:` namespace:

| Family | Confirmed state/part facts | Source |
| --- | --- | --- |
| `SLAB` | `axis`, serialized state key `type`; multipart storage keys `bottom` and `top` for a double slab | [`CopycatSlabBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/slab/CopycatSlabBlock.java) |
| `LAYER` | six-direction `facing`, `layers` 1..8 | [`CopycatLayerBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/layer/CopycatLayerBlock.java) |
| `HALF_LAYER` | horizontal `axis`, `half`, and independent `positive_layers` / `negative_layers` values 0..8; those names are material-storage keys | [`CopycatHalfLayerBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/half_layer/CopycatHalfLayerBlock.java) |
| `STAIRS` | vanilla stair `facing`, `half` and `shape` vocabulary | [`CopycatStairsBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/stairs/CopycatStairsBlock.java) |
| `VERTICAL_STAIRS` | horizontal `facing`, `side`, and `vertical_stair_shape` | [`CopycatVerticalStairBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/vertical_stairs/CopycatVerticalStairBlock.java) |
| `SLICE` | horizontal `facing`, `half`, `layers`; shape selected from `CCShapes.SLICE` | [`CopycatSliceBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/slice/CopycatSliceBlock.java) |
| `VERTICAL_SLICE` | horizontal `facing`, `layers`; `CCShapes.VERTICAL_SLICE` | [`CopycatVerticalSliceBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/vertical_slice/CopycatVerticalSliceBlock.java) |
| `CORNER_SLICE` | horizontal `facing`, `half`, `layers`; `CCShapes.CORNER_SLICE` | [`CopycatCornerSliceBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/corner_slice/CopycatCornerSliceBlock.java) |
| `BYTE` | eight boolean/storage keys: top/bottom × northeast/northwest/southeast/southwest; each active key is an independently addressable part | [`CopycatByteBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/bytes/CopycatByteBlock.java) |
| `BYTE_PANEL` | `facing` plus `bottom_left`, `bottom_right`, `top_left`, `top_right`; four independent storage parts | [`CopycatBytePanelBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/byte_panel/CopycatBytePanelBlock.java) |
| `BOARD` | six boolean/storage properties named for directions; multiple face parts may coexist | [`CopycatBoardBlock`](https://github.com/copycats-plus/copycats/blob/b5e8c74fa7574ddb080a5d4268cfff104e67ec4c/common/src/main/java/com/copycatsplus/copycats/content/copycat/board/CopycatBoardBlock.java) |

## What the fixture does not claim

The current catalog is a deterministic geometry/test fixture. It does not
claim production registry names, exhaustive block states, authoritative
voxel-shape extraction, material allow/deny tags, neighbour dependencies,
model/render data, NBT emission or compatibility with arbitrary future mod
versions. Some shapes are integer-AABB approximations selected to exercise the
optimizer architecture.

A production `tools/mod-extractor` should run inside a pinned 1.21.1 NeoForge
environment and emit deterministic `generated-shapes.bin`,
`generated-blocks.bin` and `metadata.json`. It must preserve every state and
part storage property, validate material rules, derive owner/visible-surface
data, and attach exact geometry representations rather than silently treating
a sampled 16^3 mask as exact.
