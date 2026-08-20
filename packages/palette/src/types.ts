import type { Oklab, Srgb } from './color.js';

export interface MaterialPaletteEntry {
  readonly blockId: string;
  readonly canonicalBlockIds?: readonly string[];
  readonly compatibility?: number;
  readonly itemId: string;
  readonly preference?: number;
  readonly srgb: Srgb;
}

export interface PackedMaterialPalette {
  readonly blockIds: readonly string[];
  readonly canonicalBlockIds: ReadonlyArray<readonly string[]>;
  readonly compatibility: Uint32Array;
  readonly itemIds: readonly string[];
  readonly linearRgb: Float32Array;
  readonly oklab: Float32Array;
  readonly preference: Uint16Array;
  readonly size: number;
  readonly srgb: Float32Array;
}

export interface SurfaceColorSampleContext {
  readonly materialId: number;
  readonly triangleId: number;
  readonly u: number;
  readonly v: number;
}

export type SurfaceLinearColorSampler = (
  context: SurfaceColorSampleContext,
) => readonly [red: number, green: number, blue: number];

export interface PackedSurfaceSamples {
  readonly cellOffsets: Uint32Array;
  readonly localPositions: Float32Array;
  readonly normals: Int8Array;
  readonly oklab: Float32Array;
  readonly sourceMaterialIds: Uint32Array;
  readonly triangleIds: Uint32Array;
  readonly uvs: Float32Array;
  readonly weights: Float32Array;
}

export interface ExtractSurfaceSamplesOptions {
  readonly maxSamplesPerCell?: number;
  readonly sampleLinearColor?: SurfaceLinearColorSampler;
}

export interface ResolveMaterialOptions {
  readonly catalog: import('../../shapes/src/index.js').PackedShapeCatalog;
  readonly geometryIds: Uint32Array;
  readonly palette: PackedMaterialPalette;
  readonly runtime?: import('../../shapes/src/index.js').WebRuntimeCatalog;
  readonly samples: PackedSurfaceSamples;
}

export interface PackedResolvedMaterials {
  readonly acceptedMaterialBlockIds: readonly string[];
  readonly acceptedMaterialStates: readonly string[];
  readonly cellErrors: Float32Array;
  readonly cellPartOffsets: Uint32Array;
  readonly invalidCells: Uint8Array;
  readonly materialErrors: Float32Array;
  readonly materialDirections: Uint8Array;
  readonly paletteIndexes: Uint32Array;
  readonly partIds: Uint8Array;
  readonly shapeIds: Uint32Array;
  readonly targetOklab: Float32Array;
}

export function paletteOklab(palette: PackedMaterialPalette, index: number): Oklab {
  if (!Number.isInteger(index) || index < 0 || index >= palette.size) {
    throw new RangeError(`Palette index ${index} is out of range`);
  }
  return [
    palette.oklab[index * 3] ?? 0,
    palette.oklab[index * 3 + 1] ?? 0,
    palette.oklab[index * 3 + 2] ?? 0,
  ];
}
