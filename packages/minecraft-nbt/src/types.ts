export interface MinecraftBlockState {
  readonly blockId: string;
  readonly state: string;
}

export interface CopycatPartMaterial extends MinecraftBlockState {
  readonly itemId: string;
  readonly key: string;
}

export interface StructureCell extends MinecraftBlockState {
  readonly parts?: readonly CopycatPartMaterial[];
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface EncodeStructureOptions {
  readonly cells: readonly StructureCell[];
  readonly dataVersion?: number;
}

export interface EncodedStructure {
  readonly bytes: Uint8Array;
  readonly blockCount: number;
  readonly paletteSize: number;
  readonly size: readonly [x: number, y: number, z: number];
}
