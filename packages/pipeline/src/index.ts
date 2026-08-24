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
  createSparseCellSolidOccupancy,
  getSparseCellSurfaceStatistics,
  maskToHex,
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
  /** Geometry allow-list derived from enabled Copycats block types. */
  readonly allowedGeometryIds?: Uint8Array;
  readonly batchSize?: number;
  readonly catalog: PackedShapeCatalog;
  /** Expands planar image cells to independently materialized Byte octants. */
  readonly expandPlanarImageOctants?: boolean;
  readonly mesh: PackedTriangleMesh;
  readonly onProgress?: (progress: SparsePipelineProgress) => void;
  readonly optimizerSettings?: Partial<OptimizerSettings>;
  /** Prefers Byte realizations only for planar cells already equal to exact 8x8x8 octant unions. */
  readonly preferPlanarByteGeometry?: boolean;
  readonly planarNormalVarianceThreshold?: number;
  readonly rasterizer?: SparseRasterizeOptions;
  readonly signal?: OptimizerAbortSignal;
  /** Uses the filled side of a closed mesh instead of its triangle sheet. Defaults true. */
  readonly useSolidOccupancy?: boolean;
}

export interface ProgressiveOptimizeMeshOptions extends OptimizeMeshOptions {
  readonly yieldToHost?: () => Promise<void>;
}

export interface PackedOptimizedSparseGrid {
  readonly extraCounts: Uint16Array;
  readonly geometryErrors: Float32Array;
  readonly geometryIds: Uint32Array;
  readonly missingCounts: Uint16Array;
  /** One for planar cells whose original GRID16 mask is an exact Byte octant union. */
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

interface CachedGeometryResult {
  readonly extraCount: number;
  readonly geometryError: number;
  readonly geometryId: number;
  readonly missingCount: number;
  readonly shapeId: number;
  readonly usedResolution: number;
}

interface PipelineState {
  readonly batchSize: number;
  readonly extraCounts: Uint16Array;
  readonly geometryCache: Map<string, CachedGeometryResult>;
  readonly geometryErrors: Float32Array;
  readonly geometryIds: Uint32Array;
  readonly missingCounts: Uint16Array;
  readonly orientationSign: -1 | 0 | 1;
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
      geometryCache: new Map(),
      geometryErrors: new Float32Array(surface.cellCount),
      geometryIds: new Uint32Array(surface.cellCount),
      missingCounts: new Uint16Array(surface.cellCount),
      orientationSign: options.useSolidOccupancy === false ? 0 : surface.orientationSign,
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

function isExactOctantUnion(occupancy: ReturnType<typeof createSparseCellOccupancy>): boolean {
  const mask = occupancy.getMask(16);
  const counts = new Uint16Array(8);
  for (let z = 0; z < 16; z += 1) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const bit = x + 16 * (y + 16 * z);
        if (((mask[bit >>> 5] ?? 0) & (1 << (bit & 31))) === 0) continue;
        counts[(x >= 8 ? 1 : 0) | (y >= 8 ? 2 : 0) | (z >= 8 ? 4 : 0)]! += 1;
      }
    }
  }
  return counts.every((count) => count === 0 || count === 512);
}

function applyCachedGeometry(
  state: PipelineState,
  cell: number,
  cached: CachedGeometryResult,
): void {
  state.extraCounts[cell] = cached.extraCount;
  state.geometryErrors[cell] = cached.geometryError;
  state.geometryIds[cell] = cached.geometryId;
  state.missingCounts[cell] = cached.missingCount;
  state.shapeIds[cell] = cached.shapeId;
  state.usedResolutions[cell] = cached.usedResolution;
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
  const pendingInputs: Array<{
    readonly allowedGeometryIds?: Uint8Array;
    readonly excludeAir: boolean;
    readonly occupancy: ReturnType<typeof createSparseCellOccupancy>;
  }> = [];
  const pendingKeys: string[] = [];
  const pendingCells = new Map<string, number[]>();
  for (let cell = start; cell < end; cell += 1) {
    const sourceOccupancy = state.orientationSign === 0
      ? createSparseCellOccupancy(options.mesh, state.surface, cell)
      : createSparseCellSolidOccupancy(options.mesh, state.surface, cell, state.orientationSign);
    const planar = getSparseCellSurfaceStatistics(options.mesh, state.surface, cell).normalVariance <=
      (options.planarNormalVarianceThreshold ?? 0.025);
    const occupancy = options.expandPlanarImageOctants === true && planar
      ? createSparseCellOctantOccupancy(options.mesh, state.surface, cell)
      : sourceOccupancy;
    const mask16 = occupancy.getMask(16);
    const preferByte = options.preferPlanarByteGeometry === true &&
      planar &&
      isExactOctantUnion(occupancy);
    state.planarBytePreferred[cell] = preferByte ? 1 : 0;
    const visible = popcountMask(mask16) > 0;
    const key = maskToHex(mask16);
    const cached = state.geometryCache.get(key);
    if (cached !== undefined) {
      applyCachedGeometry(state, cell, cached);
      continue;
    }
    const cells = pendingCells.get(key);
    if (cells !== undefined) {
      cells.push(cell);
      continue;
    }
    pendingCells.set(key, [cell]);
    pendingKeys.push(key);
    pendingInputs.push({
      ...(options.allowedGeometryIds === undefined ? {} : { allowedGeometryIds: options.allowedGeometryIds }),
      excludeAir: visible,
      occupancy,
    });
  }
  if (pendingInputs.length > 0) {
    const result = state.optimizer.optimizeBatch(pendingInputs, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    for (let index = 0; index < pendingInputs.length; index += 1) {
      const key = pendingKeys[index]!;
      const cached: CachedGeometryResult = {
        extraCount: result.extraCounts[index] ?? 0,
        geometryError: result.geometryErrors[index] ?? 0,
        geometryId: result.geometryIds[index] ?? 0,
        missingCount: result.missingCounts[index] ?? 0,
        shapeId: result.shapeIds[index] ?? 0,
        usedResolution: result.usedResolutions[index] ?? 0,
      };
      state.geometryCache.set(key, cached);
      for (const cell of pendingCells.get(key) ?? []) {
        applyCachedGeometry(state, cell, cached);
      }
    }
  }
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
