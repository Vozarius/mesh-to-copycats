export const RESOLUTIONS = [4, 8, 16] as const;

export type Resolution = (typeof RESOLUTIONS)[number];

export type Axis = 'x' | 'y' | 'z';

export type Direction =
  | 'down'
  | 'east'
  | 'north'
  | 'south'
  | 'up'
  | 'west';

export enum ShapeFamily {
  AIR = 0,
  FULL_CUBE = 1,
  SLAB = 2,
  STAIRS = 3,
  VERTICAL_STAIRS = 4,
  LAYER = 5,
  HALF_LAYER = 6,
  SLICE = 7,
  VERTICAL_SLICE = 8,
  CORNER_SLICE = 9,
  BYTE = 10,
  BYTE_PANEL = 11,
  BOARD = 12,
}

export enum QualityMode {
  FAST = 'FAST',
  BALANCED = 'BALANCED',
  QUALITY = 'QUALITY',
}

export enum MaterialCompatibility {
  GENERAL_COPYCAT = 1,
  FENCE_COPYCAT = 2,
  WALL_COPYCAT = 4,
  DOOR_COPYCAT = 8,
  FUNCTIONAL_COPYCAT = 16,
}

export interface Aabb16 {
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
}

export const AIR_OWNER = 0xff;
export const NO_OFFSET = 0xffff_ffff;

export function unreachable(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
