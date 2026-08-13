import type { PackedShapeCatalog, ShapePartMetadata } from '@mesh-to-copycats/shapes';
import {
  QualityMode,
  type Resolution,
  type ShapeFamily,
} from '@mesh-to-copycats/shared';
import type {
  ShapeDescriptor,
  TargetOccupancy,
} from '@mesh-to-copycats/voxelizer';

export interface OptimizerSettings {
  readonly alternatives: number;
  readonly ambiguityThreshold4: number;
  readonly ambiguityThreshold8: number;
  readonly collectTimings: boolean;
  readonly complexityThreshold: number;
  readonly extraWeight: number;
  readonly keepAfter4: number;
  readonly keepAfter8: number;
  readonly maxAmbiguousByteBits: number;
  readonly maxGeneratedCandidates: number;
  readonly maxGenericCandidates: number;
  readonly missingWeight: number;
  readonly qualityMode: QualityMode;
}

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  alternatives: 3,
  ambiguityThreshold4: 0.08,
  ambiguityThreshold8: 0.025,
  collectTimings: false,
  complexityThreshold: 0.72,
  extraWeight: 1,
  keepAfter4: 16,
  keepAfter8: 4,
  maxAmbiguousByteBits: 4,
  maxGeneratedCandidates: 64,
  maxGenericCandidates: 48,
  missingWeight: 1,
  qualityMode: QualityMode.BALANCED,
};

export interface OptimizeCellInput {
  readonly descriptor?: ShapeDescriptor;
  readonly occupancy: TargetOccupancy;
  readonly settings?: Partial<OptimizerSettings>;
}

export interface GeometryCandidatePart extends ShapePartMetadata {
  readonly visibleSurfaceMask?: Uint32Array;
}

export interface GeometryCandidate {
  readonly blockId: string;
  readonly comparedResolution: Resolution;
  readonly equivalentShapeIds: number[];
  readonly extraCount: number;
  readonly family: ShapeFamily;
  readonly geometryError: number;
  readonly geometryId: number;
  readonly geometryKey: string;
  readonly missingCount: number;
  readonly parts: GeometryCandidatePart[];
  readonly shapeId: number;
  readonly state: string;
}

export interface OptimizerStageTimings {
  readonly candidateGeneration: number;
  readonly mask16: number;
  readonly mask4: number;
  readonly mask8: number;
}

export interface OptimizeCellDebug {
  readonly afterMask16: number;
  readonly afterMask4: number;
  readonly afterMask8: number;
  readonly candidatesGenerated: number;
  readonly genericCandidates: number;
  readonly postingsScanned: number;
  readonly refinementReasons: string[];
  readonly routedCandidates: number;
  readonly timingsMs: OptimizerStageTimings;
  readonly trackedTemporaryAllocations: number;
}

export interface OptimizeCellResult {
  readonly alternatives: GeometryCandidate[];
  readonly best: GeometryCandidate;
  readonly debug: OptimizeCellDebug;
  readonly usedResolution: Resolution;
}

export interface GeometryOptimizerOptions {
  readonly catalog: PackedShapeCatalog;
  readonly settings?: Partial<OptimizerSettings>;
}
