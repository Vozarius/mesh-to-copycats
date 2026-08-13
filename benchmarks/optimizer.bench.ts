import {
  GeometryOptimizer,
  type OptimizeCellResult,
  type OptimizerSettings,
} from '../packages/optimizer/src/index.js';
import {
  getFixtureCatalog,
  type PackedShapeCatalog,
} from '../packages/shapes/src/index.js';
import {
  QualityMode,
  ShapeFamily,
} from '../packages/shared/src/index.js';
import {
  AdaptiveOccupancy,
  bitIndex,
  createMask,
  setBit,
  type TargetOccupancy,
} from '../packages/voxelizer/src/index.js';

const WORKLOAD_NAMES = ['simple', 'stairs', 'byte', 'complex', 'mixed'] as const;
type WorkloadName = (typeof WORKLOAD_NAMES)[number];
type WorkloadSelection = WorkloadName | 'all';

interface BenchmarkOptions {
  cells: number;
  mode: QualityMode;
  workload: WorkloadSelection;
}

interface PreparedWorkload {
  preparationMs: number;
  targets: TargetOccupancy[];
}

interface StageTotals {
  afterMask16: number;
  afterMask4: number;
  afterMask8: number;
  candidatesGenerated: number;
  genericCandidates: number;
  postingsScanned: number;
  routedCandidates: number;
}

interface TimingTotals {
  candidateGeneration: number;
  mask16: number;
  mask4: number;
  mask8: number;
}

const DEFAULT_CELL_COUNT = 10_000;
const COMPLEX_SEED = 0x6d2b_79f5;

function usage(): string {
  return [
    'Usage: pnpm benchmark -- [options]',
    '',
    'Options:',
    '  --cells <count>       Cells per workload (default: 10000)',
    '  --workload <name>     simple|stairs|byte|complex|mixed|all (default: all)',
    '  --mode <name>         FAST|BALANCED|QUALITY (default: BALANCED)',
    '  --help                Show this help',
  ].join('\n');
}

function argumentValue(arguments_: readonly string[], index: number, name: string): string {
  const value = arguments_[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parseMode(value: string): QualityMode {
  const normalized = value.toUpperCase();
  switch (normalized) {
    case 'FAST':
      return QualityMode.FAST;
    case 'BALANCED':
      return QualityMode.BALANCED;
    case 'QUALITY':
      return QualityMode.QUALITY;
    default:
      throw new Error(`Unknown quality mode ${value}`);
  }
}

function parseWorkload(value: string): WorkloadSelection {
  const normalized = value.toLowerCase();
  if (normalized === 'all') return 'all';
  if (WORKLOAD_NAMES.includes(normalized as WorkloadName)) {
    return normalized as WorkloadName;
  }
  throw new Error(`Unknown workload ${value}`);
}

function parseArguments(arguments_: readonly string[]): BenchmarkOptions | undefined {
  const options: BenchmarkOptions = {
    cells: DEFAULT_CELL_COUNT,
    mode: QualityMode.BALANCED,
    workload: 'all',
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === '--') {
      continue;
    } else if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage()}\n`);
      return undefined;
    }
    if (argument === '--cells') {
      const rawCount = argumentValue(arguments_, index, argument);
      const count = Number(rawCount);
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error(`Invalid cell count ${rawCount}`);
      }
      options.cells = count;
      index += 1;
    } else if (argument === '--mode') {
      options.mode = parseMode(argumentValue(arguments_, index, argument));
      index += 1;
    } else if (argument === '--workload') {
      options.workload = parseWorkload(argumentValue(arguments_, index, argument));
      index += 1;
    } else {
      throw new Error(`Unknown argument ${argument}`);
    }
  }
  return options;
}

function uniqueGeometryIds(
  catalog: PackedShapeCatalog,
  families: ReadonlySet<ShapeFamily>,
): number[] {
  const seen = new Set<number>();
  for (let shapeId = 0; shapeId < catalog.shapeCount; shapeId += 1) {
    const family = catalog.shapeFamily[shapeId] as ShapeFamily;
    if (!families.has(family)) continue;
    seen.add(catalog.shapeGeometry[shapeId]!);
  }
  const ids = [...seen].sort((left, right) => left - right);
  if (ids.length === 0) throw new Error('Fixture catalog is missing benchmark geometry');
  return ids;
}

function exactTarget(catalog: PackedShapeCatalog, geometryId: number): AdaptiveOccupancy {
  return AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16).slice());
}

function hashCoordinates(seed: number, x: number, y: number, z: number): number {
  let value = seed ^ Math.imul(x + 1, 0x9e37_79b1);
  value ^= Math.imul(y + 1, 0x85eb_ca77);
  value ^= Math.imul(z + 1, 0xc2b2_ae3d);
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d);
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b);
  return (value ^ (value >>> 16)) >>> 0;
}

function complexTarget(index: number): AdaptiveOccupancy {
  const seed = (COMPLEX_SEED + Math.imul(index + 1, 0x9e37_79b9)) >>> 0;
  const mask = createMask(16);
  const axisChoice = seed % 3;
  const primaryLimit = 7 + ((seed >>> 3) % 11);
  const secondaryLimit = 12 + ((seed >>> 8) % 13);
  for (let z = 0; z < 16; z += 1) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const primary = axisChoice === 0 ? x + y : axisChoice === 1 ? y + z : x + z;
        const folded = x + y + z < secondaryLimit && ((x ^ z) & 3) !== 0;
        const sparseDetail = (hashCoordinates(seed, x, y, z) & 31) === 0;
        const occupied = (primary < primaryLimit && ((x + 2 * y + z) % 5) !== 0) ||
          folded || sparseDetail;
        if (occupied) setBit(mask, bitIndex(16, x, y, z));
      }
    }
  }
  return AdaptiveOccupancy.fromMask16(mask);
}

function geometryPools(catalog: PackedShapeCatalog): {
  byte: number[];
  simple: number[];
  stairs: number[];
} {
  return {
    byte: uniqueGeometryIds(catalog, new Set([ShapeFamily.BYTE, ShapeFamily.BYTE_PANEL])),
    simple: uniqueGeometryIds(
      catalog,
      new Set([
        ShapeFamily.AIR,
        ShapeFamily.FULL_CUBE,
        ShapeFamily.SLAB,
        ShapeFamily.LAYER,
        ShapeFamily.SLICE,
        ShapeFamily.BOARD,
      ]),
    ),
    stairs: uniqueGeometryIds(
      catalog,
      new Set([ShapeFamily.STAIRS, ShapeFamily.VERTICAL_STAIRS]),
    ),
  };
}

function prepareWorkload(
  name: WorkloadName,
  count: number,
  catalog: PackedShapeCatalog,
  pools: ReturnType<typeof geometryPools>,
): PreparedWorkload {
  const started = performance.now();
  const targets: TargetOccupancy[] = [];
  for (let index = 0; index < count; index += 1) {
    if (name === 'complex') {
      targets.push(complexTarget(index));
      continue;
    }
    const mixedKind = index % 4;
    const pool = name === 'simple'
      ? pools.simple
      : name === 'stairs'
        ? pools.stairs
        : name === 'byte'
          ? pools.byte
          : mixedKind === 0
            ? pools.simple
            : mixedKind === 1
              ? pools.stairs
              : mixedKind === 2
                ? pools.byte
                : undefined;
    if (pool === undefined) {
      targets.push(complexTarget(index));
    } else {
      const geometryId = pool[(index * 17 + 11) % pool.length]!;
      targets.push(exactTarget(catalog, geometryId));
    }
  }
  return { preparationMs: performance.now() - started, targets };
}

function emptyStageTotals(): StageTotals {
  return {
    afterMask16: 0,
    afterMask4: 0,
    afterMask8: 0,
    candidatesGenerated: 0,
    genericCandidates: 0,
    postingsScanned: 0,
    routedCandidates: 0,
  };
}

function emptyTimingTotals(): TimingTotals {
  return { candidateGeneration: 0, mask16: 0, mask4: 0, mask8: 0 };
}

function addResult(
  result: OptimizeCellResult,
  stages: StageTotals,
  timings: TimingTotals,
): void {
  stages.afterMask16 += result.debug.afterMask16;
  stages.afterMask4 += result.debug.afterMask4;
  stages.afterMask8 += result.debug.afterMask8;
  stages.candidatesGenerated += result.debug.candidatesGenerated;
  stages.genericCandidates += result.debug.genericCandidates;
  stages.postingsScanned += result.debug.postingsScanned;
  stages.routedCandidates += result.debug.routedCandidates;
  timings.candidateGeneration += result.debug.timingsMs.candidateGeneration;
  timings.mask16 += result.debug.timingsMs.mask16;
  timings.mask4 += result.debug.timingsMs.mask4;
  timings.mask8 += result.debug.timingsMs.mask8;
}

function averageStages(values: StageTotals, denominator: number): StageTotals {
  return {
    afterMask16: values.afterMask16 / denominator,
    afterMask4: values.afterMask4 / denominator,
    afterMask8: values.afterMask8 / denominator,
    candidatesGenerated: values.candidatesGenerated / denominator,
    genericCandidates: values.genericCandidates / denominator,
    postingsScanned: values.postingsScanned / denominator,
    routedCandidates: values.routedCandidates / denominator,
  };
}

function averageTimings(values: TimingTotals, denominator: number): TimingTotals {
  return {
    candidateGeneration: values.candidateGeneration / denominator,
    mask16: values.mask16 / denominator,
    mask4: values.mask4 / denominator,
    mask8: values.mask8 / denominator,
  };
}

function optionalGc(): { available: boolean; collect: () => void } {
  const collect = (globalThis as { gc?: () => void }).gc;
  return collect === undefined
    ? { available: false, collect: () => undefined }
    : { available: true, collect };
}

function runWorkload(
  name: WorkloadName,
  prepared: PreparedWorkload,
  optimizer: GeometryOptimizer,
): object {
  const stages = emptyStageTotals();
  const timings = emptyTimingTotals();
  let targetBytes = 0;
  let trackedTemporaryAllocations = 0;
  let requiring16 = 0;
  const garbageCollector = optionalGc();
  garbageCollector.collect();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (const occupancy of prepared.targets) {
    const result = optimizer.optimizeCell({ occupancy });
    addResult(result, stages, timings);
    targetBytes += occupancy.estimatedBytes();
    trackedTemporaryAllocations += result.debug.trackedTemporaryAllocations;
    if (result.usedResolution === 16) requiring16 += 1;
  }
  const optimizerTotalMs = performance.now() - started;
  garbageCollector.collect();
  const heapAfter = process.memoryUsage().heapUsed;
  const count = prepared.targets.length;
  const timingAveragesMs = averageTimings(timings, count);
  return {
    allocationsBestEffort: {
      heapDeltaBytes: heapAfter - heapBefore,
      heapMeasurement: garbageCollector.available
        ? 'before/after explicit GC'
        : 'before/after without explicit GC; noisy',
      trackedTemporaryAllocations,
      trackedTemporaryAllocationsPerCell: trackedTemporaryAllocations / count,
    },
    averageStageCounts: averageStages(stages, count),
    cells: count,
    cellsPerSecond: count / (optimizerTotalMs / 1000),
    memoryBestEffort: {
      averageMaterializedOccupancyBytesPerCell: targetBytes / count,
      heapDeltaBytesPerCell: (heapAfter - heapBefore) / count,
    },
    percentageRequiringMask16: (requiring16 / count) * 100,
    timingsMs: {
      candidateGeneration: timings.candidateGeneration,
      mask4: timings.mask4,
      mask8: timings.mask8,
      mask16: timings.mask16,
      optimizerTotal: optimizerTotalMs,
      syntheticInputPreparation: prepared.preparationMs,
      voxelization: 0,
    },
    timingsPerCellMicroseconds: {
      candidateGeneration: timingAveragesMs.candidateGeneration * 1000,
      mask4: timingAveragesMs.mask4 * 1000,
      mask8: timingAveragesMs.mask8 * 1000,
      mask16: timingAveragesMs.mask16 * 1000,
      optimizerTotal: (optimizerTotalMs / count) * 1000,
    },
    workload: name,
  };
}

function warmUp(optimizer: GeometryOptimizer, catalog: PackedShapeCatalog): void {
  const geometryCount = Math.min(catalog.geometryCount, 128);
  for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
    optimizer.optimizeCell({ occupancy: exactTarget(catalog, geometryId) });
  }
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  if (options === undefined) return;
  const catalogStarted = performance.now();
  const catalog = getFixtureCatalog();
  const catalogBuildMs = performance.now() - catalogStarted;
  const settings: Partial<OptimizerSettings> = {
    collectTimings: true,
    qualityMode: options.mode,
  };
  const optimizer = new GeometryOptimizer({ catalog, settings });
  const pools = geometryPools(catalog);
  warmUp(optimizer, catalog);

  const workloads = options.workload === 'all'
    ? WORKLOAD_NAMES
    : [options.workload] as const;
  const results: object[] = [];
  for (const workload of workloads) {
    const prepared = prepareWorkload(
      workload,
      options.cells,
      catalog,
      pools,
    );
    results.push(runWorkload(workload, prepared, optimizer));
  }

  const report = {
    caveats: {
      allocations: 'Core tracked temporaries plus process heap delta; use node --expose-gc for less noisy heap data.',
      voxelization: 'Mesh voxelization is outside milestone 1, so this field is zero; synthetic target preparation is reported separately.',
    },
    catalog: {
      buildMs: catalogBuildMs,
      estimatedBytes: catalog.estimateByteLength(),
      geometryCount: catalog.geometryCount,
      shapeCount: catalog.shapeCount,
    },
    environment: {
      architecture: process.arch,
      node: process.version,
      platform: process.platform,
    },
    results,
    schemaVersion: 1,
    settings: {
      cellsPerWorkload: options.cells,
      qualityMode: options.mode,
      seed: `0x${COMPLEX_SEED.toString(16)}`,
      workload: options.workload,
    },
  };
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
}

try {
  main();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`benchmark: ${message}\n\n${usage()}\n`);
  process.exitCode = 1;
}
