import {
  hexToSrgb,
  linearSrgbToOklab,
  srgbToLinear,
} from './color.js';
import type {
  MaterialPaletteEntry,
  PackedMaterialPalette,
} from './types.js';

export function createMaterialPalette(
  entries: readonly MaterialPaletteEntry[],
): PackedMaterialPalette {
  if (entries.length === 0) throw new Error('Material palette cannot be empty');
  const seen = new Set<string>();
  const blockIds: string[] = [];
  const canonicalBlockIds: string[][] = [];
  const itemIds: string[] = [];
  const compatibility = new Uint32Array(entries.length);
  const linearRgb = new Float32Array(entries.length * 3);
  const oklab = new Float32Array(entries.length * 3);
  const preference = new Uint16Array(entries.length);
  const srgb = new Float32Array(entries.length * 3);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.blockId.length === 0 || entry.itemId.length === 0) {
      throw new Error('Material blockId and itemId cannot be empty');
    }
    if (seen.has(entry.itemId)) throw new Error(`Duplicate material item ${entry.itemId}`);
    seen.add(entry.itemId);
    blockIds.push(entry.blockId);
    canonicalBlockIds.push([...new Set([entry.blockId, ...(entry.canonicalBlockIds ?? [])])].sort());
    itemIds.push(entry.itemId);
    const materialPreference = entry.preference ?? 0;
    if (!Number.isInteger(materialPreference) || materialPreference < 0 || materialPreference > 0xffff) {
      throw new RangeError(`Material preference for ${entry.itemId} must be an integer in 0..65535`);
    }
    preference[index] = materialPreference;
    compatibility[index] = entry.compatibility ?? 0xffff_ffff;
    const linear = srgbToLinear(entry.srgb);
    const perceptual = linearSrgbToOklab(linear);
    srgb.set(entry.srgb, index * 3);
    linearRgb.set(linear, index * 3);
    oklab.set(perceptual, index * 3);
  }
  return {
    blockIds: Object.freeze(blockIds),
    canonicalBlockIds: Object.freeze(canonicalBlockIds.map((ids) => Object.freeze(ids))),
    compatibility,
    itemIds: Object.freeze(itemIds),
    linearRgb,
    oklab,
    preference,
    size: entries.length,
    srgb,
  };
}

export function createStarterMinecraftPalette(): PackedMaterialPalette {
  const entries = [
    ['minecraft:stone', '#7d7d7d', ['minecraft:stone_slab', 'minecraft:stone_stairs']],
    ['minecraft:cobblestone', '#77736c', ['minecraft:cobblestone_slab', 'minecraft:cobblestone_stairs', 'minecraft:cobblestone_wall']],
    ['minecraft:deepslate', '#505052'],
    ['minecraft:calcite', '#ddd9ce'],
    ['minecraft:bricks', '#986052'],
    ['minecraft:oak_planks', '#b68a50', ['minecraft:oak_slab', 'minecraft:oak_stairs']],
    ['minecraft:spruce_planks', '#72502d', ['minecraft:spruce_slab', 'minecraft:spruce_stairs']],
    ['minecraft:white_concrete', '#cfd5d6'],
    ['minecraft:black_concrete', '#111619'],
    ['minecraft:red_concrete', '#8e2b25'],
    ['minecraft:blue_concrete', '#2e3d8f'],
    ['minecraft:green_concrete', '#495b24'],
    ['minecraft:glass', '#a7c4bf'],
    ['minecraft:iron_block', '#d8d8d8'],
    ['minecraft:gold_block', '#f5d03a'],
    ['minecraft:copper_block', '#c46f4d'],
    ['minecraft:oxidized_copper', '#52a18e'],
    ['minecraft:moss_block', '#596b2f'],
  ] as const satisfies ReadonlyArray<
    readonly [blockId: string, color: string, canonicalBlockIds?: readonly string[]]
  >;
  return createMaterialPalette(entries.map(([blockId, color, canonicalBlockIds]) => ({
    blockId,
    ...(canonicalBlockIds === undefined ? {} : { canonicalBlockIds }),
    itemId: blockId,
    srgb: hexToSrgb(color),
  })));
}

export function filterMaterialPalette(
  palette: PackedMaterialPalette,
  keep: (itemId: string, index: number) => boolean,
): PackedMaterialPalette {
  const entries: MaterialPaletteEntry[] = [];
  const keptIndexes: number[] = [];
  for (let index = 0; index < palette.size; index += 1) {
    const itemId = palette.itemIds[index] ?? '';
    if (!keep(itemId, index)) continue;
    keptIndexes.push(index);
    entries.push({
      blockId: palette.blockIds[index] ?? '',
      canonicalBlockIds: palette.canonicalBlockIds[index] ?? [],
      compatibility: palette.compatibility[index] ?? 0,
      itemId,
      preference: palette.preference[index] ?? 0,
      srgb: [
        palette.srgb[index * 3] ?? 0,
        palette.srgb[index * 3 + 1] ?? 0,
        palette.srgb[index * 3 + 2] ?? 0,
      ],
    });
  }
  if (entries.length === 0) throw new Error('Material exclusions removed every palette entry');
  const filtered = createMaterialPalette(entries);
  const sourceAtlas = palette.previewTextureAtlas;
  if (sourceAtlas === undefined) return filtered;
  const offsets = new Uint32Array(keptIndexes.length + 1);
  const widths = new Uint16Array(keptIndexes.length);
  const heights = new Uint16Array(keptIndexes.length);
  const wrapS = new Uint32Array(keptIndexes.length);
  const wrapT = new Uint32Array(keptIndexes.length);
  let byteLength = 0;
  for (let target = 0; target < keptIndexes.length; target += 1) {
    const source = keptIndexes[target] ?? 0;
    offsets[target] = byteLength;
    byteLength += (sourceAtlas.offsets[source + 1] ?? 0) - (sourceAtlas.offsets[source] ?? 0);
    widths[target] = sourceAtlas.widths[source] ?? 0;
    heights[target] = sourceAtlas.heights[source] ?? 0;
    wrapS[target] = sourceAtlas.wrapS[source] ?? 10497;
    wrapT[target] = sourceAtlas.wrapT[source] ?? 10497;
  }
  offsets[keptIndexes.length] = byteLength;
  const rgbaSrgb = new Uint8Array(byteLength);
  for (let target = 0; target < keptIndexes.length; target += 1) {
    const source = keptIndexes[target] ?? 0;
    const start = sourceAtlas.offsets[source] ?? 0;
    const end = sourceAtlas.offsets[source + 1] ?? start;
    rgbaSrgb.set(sourceAtlas.rgbaSrgb.subarray(start, end), offsets[target]);
  }
  return {
    ...filtered,
    previewTextureAtlas: { heights, offsets, rgbaSrgb, widths, wrapS, wrapT },
  };
}
