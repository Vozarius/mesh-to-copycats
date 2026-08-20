import type { PackedTriangleMesh } from '@mesh-to-copycats/mesh';

export type QualityName = 'BALANCED' | 'FAST' | 'QUALITY';

export interface OptimizeRequest {
  readonly mesh: PackedTriangleMesh;
  readonly quality: QualityName;
  readonly requestId: number;
  readonly scale: number;
  readonly type: 'optimize';
}

export interface CancelRequest {
  readonly requestId: number;
  readonly type: 'cancel';
}

export type WorkerRequest = CancelRequest | OptimizeRequest;

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
  readonly materialErrors: Float32Array;
  readonly materialDirections: Uint8Array;
  readonly paletteIndexes: Uint32Array;
  readonly paletteItemIds: readonly string[];
  readonly paletteSrgb: Float32Array;
  readonly partIds: Uint8Array;
  readonly partKeys: readonly string[];
  readonly previewColors: Float32Array;
  readonly previewPositions: Float32Array;
  readonly previewTruncated: boolean;
  readonly requestId: number;
  readonly shapeIds: Uint32Array;
  readonly shapeBlockIds: readonly string[];
  readonly shapeStates: readonly string[];
  readonly timingsMs: {
    readonly materials: number;
    readonly optimization: number;
    readonly rasterization: number;
    readonly total: number;
  };
  readonly triangleCount: number;
  readonly type: 'complete';
}

export interface ErrorResponse {
  readonly message: string;
  readonly requestId: number;
  readonly type: 'error';
}

export type WorkerResponse = CompleteResponse | ErrorResponse | ProgressResponse;
