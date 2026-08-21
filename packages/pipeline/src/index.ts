import type { PackedTriangleMesh } from '../../mesh/src/index.js';
import {
  GeometryOptimizer,
  type OptimizerAbortSignal,
  type OptimizerSettings,
} from '../../optimizer/src/index.js';
import type { PackedShapeCatalog } from '../../shapes/src/index.js';
import {
  createSparseCellOccupancy,
  createSparseCellOctantOccupancy,
  getSparseCellSurfaceStatistics,
  popcountMask,
  rasterizeSparseSurface,
  type PackedSparseSurface,
  type SparseRasterizeOptions,
} from '../../voxelizer/src/index.js';

export interface SparsePipelineProgress {
  readonly completed: number;
  readonly total: number;
}

export interface OptimizeMeshOptions {
  readonly batchSize?: number;
  readonly catalog: PackedShapeCatalog;
  readonly mesh: PackedTriangleMesh;
  readonly onProgress?: (progress: SparsePipelineProgress) => void;
  readonly optimizerSettings?: Partial<OptimizerSettings>;
  /** Converts locally planar surface cells to exact 2x2x2 octant targets. */
  readonly preferPlanarByteGeometry?: boolean;
  readonly planarNormalVarianceThreshold?: number;
  readonly rasterizer?: SparseRasterizeOptions;
  readonly signal?: OptimizerAbortSignal;
}

export interface ProgressiveOptimizeMeshOptions extends OptimizeMeshOptions {
  readonly yieldToHost?: () => Promise<void>;
}

export interface PackedOptimizedSparseGrid {
  readonly extraCounts: Uint16Array;
  readonly geometryErrors: Float32Array;
  readonly geometryIds: Uint32Array;
  readonly missingCounts: Uint16Array;
  /** One for cells whose locally planar geometry can use Copycat Byte material quadrants. */
  readonly planarBytePreferred: Uint8Array;
  readonly shapeIds: Uint32Array;
  readonly surface: PackedSparseSurface;
  readonly timingsMs: {
    readonly optimization: number;
    readonly rasterization: number;
    readonly total: number;
  };
  readonly usedResolutions: Uint8Array;
}

interface PipelineState {
  readonly batchSize: number;
  readonly extraCounts: Uint16Array;
  readonly geometryErrors: Float32Array;
  readonly geometryIds: Uint32Array;
  readonly missingCounts: Uint16Array;
  readonly planarBytePreferred: Uint8Array;
  readonly optimizer: GeometryOptimizer;
  readonly shapeIds: Uint32Array;
  readonly surface: PackedSparseSurface;
  readonly usedResolutions: Uint8Array;
}

function batchSize(value: number | undefined): number {
  const resolved = value ?? 256;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > 65_536) {
    throw new RangeError('batchSize must be an integer in the range 1..65536');
  }
  return resolved;
}

function begin(options: OptimizeMeshOptions): {
  readonly rasterizationMs: number;
  readonly state: PipelineState;
} {
  const started = performance.now();
  const surface = rasterizeSparseSurface(options.mesh, options.rasterizer);
  const rasterizationMs = performance.now() - started;
  return {
    rasterizationMs,
    state: {
      batchSize: batchSize(options.batchSize),
      extraCounts: new Uint16Array(surface.cellCount),
      geometryErrors: new Float32Array(surface.cellCount),
      geometryIds: new Uint32Array(surface.cellCount),
      missingCounts: new Uint16Array(surface.cellCount),
      planarBytePreferred: new Uint8Array(surface.cellCount),
      optimizer: new GeometryOptimizer({
        catalog: options.catalog,
        ...(options.optimizerSettings === undefined
          ? {}
          : { settings: options.optimizerSettings }),
      }),
      shapeIds: new Uint32Array(surface.cellCount),
      surface,
      usedResolutions: new Uint8Array(surface.cellCount),
    },
  };
}

function optimizeBatchRange(
  options: OptimizeMeshOptions,
  state: PipelineState,
  start: number,
  end: number,
): void {
  if (options.signal?.aborted === true) {
    throw new Error(`Mesh optimization aborted after ${start} cells`);
  }
  const inputs = Array.from({ length: end - start }, (_value, offset) => {
    const cell = start + offset;
    const preferByte = options.preferPlanarByteGeometry === true &&
      getSparseCellSurfaceStatistics(options.mesh, state.surface, cell).normalVariance <=
        (options.planarNormalVarianceThreshold ?? 0.025);
    state.planarBytePreferred[cell] = preferByte ? 1 : 0;
    const occupancy = preferByte
      ? createSparseCellOctantOccupancy(options.mesh, state.surface, start + offset)
      : createSparseCellOccupancy(options.mesh, state.surface, start + offset);
    const visible = popcountMask(occupancy.getMask(16)) > 0;
    return {
      excludeAir: visible,
      occupancy,
      requireCoverage: visible,
    };
  });
  const result = state.optimizer.optimizeBatch(inputs, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  state.extraCounts.set(result.extraCounts, start);
  state.geometryErrors.set(result.geometryErrors, start);
  state.geometryIds.set(result.geometryIds, start);
  state.missingCounts.set(result.missingCounts, start);
  state.shapeIds.set(result.shapeIds, start);
  state.usedResolutions.set(result.usedResolutions, start);
  options.onProgress?.({ completed: end, total: state.surface.cellCount });
}

function finish(
  state: PipelineState,
  rasterizationMs: number,
  optimizationMs: number,
): PackedOptimizedSparseGrid {
  return {
    extraCounts: state.extraCounts,
    geometryErrors: state.geometryErrors,
    geometryIds: state.geometryIds,
    missingCounts: state.missingCounts,
    planarBytePreferred: state.planarBytePreferred,
    shapeIds: state.shapeIds,
    surface: state.surface,
    timingsMs: {
      optimization: optimizationMs,
      rasterization: rasterizationMs,
      total: rasterizationMs + optimizationMs,
    },
    usedResolutions: state.usedResolutions,
  };
}

export function optimizeMesh(options: OptimizeMeshOptions): PackedOptimizedSparseGrid {
  const { rasterizationMs, state } = begin(options);
  const optimizationStarted = performance.now();
  for (let start = 0; start < state.surface.cellCount; start += state.batchSize) {
    optimizeBatchRange(
      options,
      state,
      start,
      Math.min(state.surface.cellCount, start + state.batchSize),
    );
  }
  return finish(state, rasterizationMs, performance.now() - optimizationStarted);
}

function defaultYieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export async function optimizeMeshProgressive(
  options: ProgressiveOptimizeMeshOptions,
): Promise<PackedOptimizedSparseGrid> {
  const { rasterizationMs, state } = begin(options);
  const optimizationStarted = performance.now();
  const yieldToHost = options.yieldToHost ?? defaultYieldToHost;
  for (let start = 0; start < state.surface.cellCount; start += state.batchSize) {
    optimizeBatchRange(
      options,
      state,
      start,
      Math.min(state.surface.cellCount, start + state.batchSize),
    );
    if (start + state.batchSize < state.surface.cellCount) await yieldToHost();
  }
  return finish(state, rasterizationMs, performance.now() - optimizationStarted);
}
