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
