import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { encodeCreateSchematic } from '../../packages/minecraft-nbt/src/index.js';

class Reader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  readonly #decoder = new TextDecoder();
  #cursor = 0;

  public constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  public byte(): number {
    return this.#view.getInt8(this.#cursor++);
  }

  public int(): number {
    const value = this.#view.getInt32(this.#cursor, false);
    this.#cursor += 4;
    return value;
  }

  public string(): string {
    const length = this.#view.getUint16(this.#cursor, false);
    this.#cursor += 2;
    const value = this.#decoder.decode(this.#bytes.subarray(this.#cursor, this.#cursor + length));
    this.#cursor += length;
    return value;
  }

  public value(type: number): unknown {
    if (type === 1) return this.byte();
    if (type === 3) return this.int();
    if (type === 8) return this.string();
    if (type === 9) {
      const elementType = this.byte();
      return Array.from({ length: this.int() }, () => this.value(elementType));
    }
    if (type === 10) {
      const value: Record<string, unknown> = {};
      while (true) {
        const childType = this.byte();
        if (childType === 0) return value;
        value[this.string()] = this.value(childType);
      }
    }
    throw new Error(`Unsupported test NBT type ${type}`);
  }
}

function decode(bytes: Uint8Array): Record<string, unknown> {
  const reader = new Reader(gunzipSync(bytes));
  expect(reader.byte()).toBe(10);
  expect(reader.string()).toBe('');
  return reader.value(10) as Record<string, unknown>;
}

describe('Create schematic NBT', () => {
  it('writes deterministic StructureTemplate data and exact multipart Copycats material storage', () => {
    const options = {
      cells: [
        { blockId: 'minecraft:stone', state: '', x: 8, y: -2, z: 4 },
        {
          blockId: 'copycats:copycat_board',
          parts: [
            { blockId: 'minecraft:oak_planks', itemId: 'minecraft:oak_planks', key: 'north', state: '' },
            { blockId: 'minecraft:stone', itemId: 'minecraft:stone', key: 'south', state: '' },
          ],
          state: '[east=true,north=true,south=true,up=false,west=false]',
          x: 10,
          y: -1,
          z: 5,
        },
      ],
    } as const;
    const first = encodeCreateSchematic(options);
    const second = encodeCreateSchematic(options);
    expect(first.bytes).toEqual(second.bytes);
    expect(first.size).toEqual([3, 2, 2]);
    expect(first.paletteSize).toBe(2);
    const root = decode(first.bytes);
    expect(root.DataVersion).toBe(3955);
    expect(root.size).toEqual([3, 2, 2]);
    expect(root.entities).toEqual([]);
    const blocks = root.blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.pos).toEqual([0, 0, 0]);
    expect(blocks[1]?.pos).toEqual([2, 1, 1]);
    const entity = blocks[1]?.nbt as Record<string, unknown>;
    expect(entity.id).toBe('copycats:multistate_copycat');
    expect([entity.x, entity.y, entity.z]).toEqual([2, 1, 1]);
    const materialData = entity.material_data as Record<string, Record<string, unknown>>;
    expect(Object.keys(materialData)).toEqual(['north', 'south']);
    expect(materialData.north?.material).toEqual({ Name: 'minecraft:oak_planks' });
    expect(materialData.north?.consumedItem).toEqual({ count: 1, id: 'minecraft:oak_planks' });
    expect(materialData.north?.enableCT).toBe(1);
  });

  it('rejects empty structures and material data on ordinary blocks', () => {
    expect(() => encodeCreateSchematic({ cells: [] })).toThrow(/empty schematic/u);
    expect(() => encodeCreateSchematic({ cells: [{
      blockId: 'minecraft:stone',
      parts: [{ blockId: 'minecraft:stone', itemId: 'minecraft:stone', key: 'material', state: '' }],
      state: '', x: 0, y: 0, z: 0,
    }] })).toThrow(/non-Copycat/u);
  });
});
