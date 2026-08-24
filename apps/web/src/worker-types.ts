import type { PackedTriangleMesh } from '@mesh-to-copycats/mesh';

export type QualityName = 'BALANCED' | 'FAST' | 'QUALITY';

export interface OptimizeRequest {
  /** Imported images deliberately use independently colored Byte octants. */
  readonly highDetailImagePlane: boolean;
  readonly includedGeometryBlockIds: readonly string[];
  readonly includedMaterialItemIds?: readonly string[];
  readonly materialOverrides: readonly string[];
  readonly mesh: PackedTriangleMesh;
  readonly quality: QualityName;
  readonly requestId: number;
  readonly scale: number;
  readonly type: 'optimize';
}

export interface LoadPaletteRequest {
  readonly requestId: number;
  readonly type: 'load-palette';
}

export interface CancelRequest {
  readonly requestId: number;
  readonly type: 'cancel';
}

export type WorkerRequest = CancelRequest | LoadPaletteRequest | OptimizeRequest;

export interface PaletteResponse {
  readonly defaultGeometryBlockIds: readonly string[];
  readonly geometryBlockIds: readonly string[];
  readonly itemIds: readonly string[];
  readonly requestId: number;
  readonly srgb: Float32Array;
  readonly textureHeights: Uint16Array;
  readonly textureOffsets: Uint32Array;
  readonly textureRgbaSrgb: Uint8Array;
  readonly textureWidths: Uint16Array;
  readonly type: 'palette';
}

export interface ProgressResponse {
  readonly completed: number;
  readonly requestId: number;
  readonly total: number;
  readonly type: 'progress';
}

export interface CompleteResponse {
  readonly acceptedMaterialBlockIds: readonly string[];
  readonly acceptedMaterialStates: readonly string[];
  readonly catalog: 'fixture' | 'production';
  readonly cellPartOffsets: Uint32Array;
  readonly cellX: Int32Array;
  readonly cellY: Int32Array;
  readonly cellZ: Int32Array;
  readonly errors: Float32Array;
  readonly invalidMaterialCells: number;
  readonly neighborChangedCells: number;
  readonly neighborIterations: number;
  readonly materialErrors: Float32Array;
  readonly materialDirections: Uint8Array;
  readonly paletteIndexes: Uint32Array;
  readonly paletteItemIds: readonly string[];
  readonly partIds: Uint8Array;
  readonly partKeys: readonly string[];
  readonly previewColors: Float32Array;
  readonly previewPositions: Float32Array;
  readonly previewPaletteIndexes: Uint32Array;
  readonly previewScales: Float32Array;
  readonly previewTruncated: boolean;
  readonly requestId: number;
  readonly shapeIds: Uint32Array;
  readonly shapeBlockIds: readonly string[];
  readonly shapeStates: readonly string[];
  readonly timingsMs: {
    readonly materials: number;
    readonly neighbors: number;
    readonly optimization: number;
    readonly rasterization: number;
    readonly total: number;
  };
  readonly triangleCount: number;
  readonly unresolvedMaterialCellCoordinates: readonly string[];
  readonly type: 'complete';
}

export interface ErrorResponse {
  readonly message: string;
  readonly requestId: number;
  readonly type: 'error';
}

export type WorkerResponse = CompleteResponse | ErrorResponse | PaletteResponse | ProgressResponse;
