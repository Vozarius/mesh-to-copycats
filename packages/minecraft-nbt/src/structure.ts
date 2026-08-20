import { gzipSync } from 'fflate';

import { encodeRootCompound, nbt, type NbtValue } from './nbt.js';
import type {
  CopycatPartMaterial,
  EncodedStructure,
  EncodeStructureOptions,
  MinecraftBlockState,
  StructureCell,
} from './types.js';

export const MINECRAFT_1_21_1_DATA_VERSION = 3955;

const MULTISTATE_COPYCATS = new Set([
  'copycats:copycat_board',
  'copycats:copycat_byte',
  'copycats:copycat_byte_panel',
  'copycats:copycat_half_layer',
  'copycats:copycat_slab',
  'copycats:copycat_stacked_half_layer',
  'copycats:copycat_vertical_half_layer',
]);

const SPECIAL_COPYCAT_BLOCK_ENTITIES: Readonly<Record<string, string>> = {
  'copycats:copycat_cogwheel': 'copycats:copycat_cogwheel',
  'copycats:copycat_fluid_pipe': 'copycats:copycat_fluid_pipe',
  'copycats:copycat_folding_door': 'copycats:copycat_sliding_door',
  'copycats:copycat_glass_fluid_pipe': 'copycats:copycat_glass_fluid_pipe',
  'copycats:copycat_large_cogwheel': 'copycats:copycat_cogwheel',
  'copycats:copycat_shaft': 'copycats:copycat_shaft',
  'copycats:copycat_sliding_door': 'copycats:copycat_sliding_door',
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseState(state: MinecraftBlockState): Readonly<Record<string, NbtValue>> {
  const properties: Record<string, NbtValue> = {};
  if (state.state.length > 0) {
    if (!state.state.startsWith('[') || !state.state.endsWith(']')) {
      throw new Error(`Invalid canonical block state ${state.blockId}${state.state}`);
    }
    const body = state.state.slice(1, -1);
    if (body.length > 0) {
      for (const pair of body.split(',')) {
        const equals = pair.indexOf('=');
        if (equals <= 0 || equals === pair.length - 1) {
          throw new Error(`Invalid canonical block state ${state.blockId}${state.state}`);
        }
        const key = pair.slice(0, equals);
        const value = pair.slice(equals + 1);
        if (properties[key] !== undefined) throw new Error(`Duplicate block state property ${key}`);
        properties[key] = nbt.string(value);
      }
    }
  }
  return Object.keys(properties).length === 0
    ? { Name: nbt.string(state.blockId) }
    : { Name: nbt.string(state.blockId), Properties: nbt.compound(properties) };
}

function itemStack(itemId: string): NbtValue {
  if (itemId.length === 0) throw new Error('Copycat material item id cannot be empty');
  return nbt.compound({ count: nbt.int(1), id: nbt.string(itemId) });
}

function copycatBlockEntityId(blockId: string, multipart: boolean): string | undefined {
  const special = SPECIAL_COPYCAT_BLOCK_ENTITIES[blockId];
  if (special !== undefined) return special;
  if (MULTISTATE_COPYCATS.has(blockId) || multipart) return 'copycats:multistate_copycat';
  if (blockId.startsWith('copycats:copycat_')) return 'copycats:copycat';
  if (blockId.startsWith('create:copycat_')) return 'create:copycat';
  return undefined;
}

function singleMaterialData(part: CopycatPartMaterial): Readonly<Record<string, NbtValue>> {
  return {
    EnableCT: nbt.byte(true),
    Item: itemStack(part.itemId),
    Material: nbt.compound(parseState(part)),
  };
}

function multipartMaterialData(parts: readonly CopycatPartMaterial[]): NbtValue {
  const materialData: Record<string, NbtValue> = {};
  for (const part of [...parts].sort((left, right) => compareStrings(left.key, right.key))) {
    if (part.key.length === 0 || materialData[part.key] !== undefined) {
      throw new Error(`Invalid or duplicate Copycats part key ${part.key}`);
    }
    materialData[part.key] = nbt.compound({
      consumedItem: itemStack(part.itemId),
      enableCT: nbt.byte(true),
      material: nbt.compound(parseState(part)),
    });
  }
  return nbt.compound(materialData);
}

function blockEntity(cell: StructureCell, x: number, y: number, z: number): NbtValue | undefined {
  const parts = cell.parts ?? [];
  if (parts.length === 0) return undefined;
  const multipart = parts.length > 1 || MULTISTATE_COPYCATS.has(cell.blockId);
  const id = copycatBlockEntityId(cell.blockId, multipart);
  if (id === undefined) {
    throw new Error(`Material parts were supplied for non-Copycat block ${cell.blockId}`);
  }
  return nbt.compound({
    id: nbt.string(id),
    ...(multipart ? { material_data: multipartMaterialData(parts) } : singleMaterialData(parts[0]!)),
    x: nbt.int(x),
    y: nbt.int(y),
    z: nbt.int(z),
  });
}

function assertCoordinate(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

export function encodeCreateSchematic(options: EncodeStructureOptions): EncodedStructure {
  const cells = options.cells.filter(({ blockId }) => blockId !== 'minecraft:air');
  if (cells.length === 0) throw new Error('Cannot export an empty schematic');
  for (const cell of cells) {
    assertCoordinate(cell.x, 'Cell x');
    assertCoordinate(cell.y, 'Cell y');
    assertCoordinate(cell.z, 'Cell z');
  }
  const minX = Math.min(...cells.map(({ x }) => x));
  const minY = Math.min(...cells.map(({ y }) => y));
  const minZ = Math.min(...cells.map(({ z }) => z));
  const maxX = Math.max(...cells.map(({ x }) => x));
  const maxY = Math.max(...cells.map(({ y }) => y));
  const maxZ = Math.max(...cells.map(({ z }) => z));
  const size = [maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1] as const;

  const paletteStates = [...new Set(cells.map(({ blockId, state }) => `${blockId}${state}`))]
    .sort(compareStrings);
  const paletteIndex = new Map(paletteStates.map((identity, index) => [identity, index]));
  const palette = paletteStates.map((identity) => {
    const cell = cells.find(({ blockId, state }) => `${blockId}${state}` === identity)!;
    return nbt.compound(parseState(cell));
  });
  const sortedCells = [...cells].sort((left, right) =>
    left.y - right.y || left.z - right.z || left.x - right.x ||
    compareStrings(`${left.blockId}${left.state}`, `${right.blockId}${right.state}`));
  const blocks = sortedCells.map((cell) => {
    const x = cell.x - minX;
    const y = cell.y - minY;
    const z = cell.z - minZ;
    const entity = blockEntity(cell, x, y, z);
    return nbt.compound({
      ...(entity === undefined ? {} : { nbt: entity }),
      pos: nbt.list(nbt.tags.int, [nbt.int(x), nbt.int(y), nbt.int(z)]),
      state: nbt.int(paletteIndex.get(`${cell.blockId}${cell.state}`)!),
    });
  });
  const root = nbt.compound({
    DataVersion: nbt.int(options.dataVersion ?? MINECRAFT_1_21_1_DATA_VERSION),
    blocks: nbt.list(nbt.tags.compound, blocks),
    entities: nbt.list(nbt.tags.compound, []),
    palette: nbt.list(nbt.tags.compound, palette),
    size: nbt.list(nbt.tags.int, size.map((value) => nbt.int(value))),
  });
  return {
    blockCount: blocks.length,
    bytes: gzipSync(encodeRootCompound(root), { level: 9, mtime: 0 }),
    paletteSize: palette.length,
    size,
  };
}
