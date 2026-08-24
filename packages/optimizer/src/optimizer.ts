import {
  getFixtureCatalog,
  type PackedShapeCatalog,
} from '@mesh-to-copycats/shapes';
import {
  QualityMode,
  ShapeFamily,
  type Resolution,
} from '@mesh-to-copycats/shared';
import {
  DESCRIPTOR,
  computeDescriptor,
  maskToHex,
  mirrorMask,
} from '@mesh-to-copycats/voxelizer';

import {
  compareGeometryMasks,
  type GeometryComparisonDebug,
} from './debug.js';
import { generateCandidates } from './routing.js';
import {
  equalWeightedScore,
  quantizeWeights,
  rankGeometryCandidates,
  scoreToNumber,
  type ScoredGeometry,
} from './scoring.js';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  type GeometryCandidate,
  type GeometryOptimizerOptions,
  type OptimizeBatchOptions,
  type OptimizeBatchResult,
  type OptimizeCellInput,
  type OptimizeCellResult,
  type OptimizerSettings,
} from './types.js';

function now(): number {
  return performance.now();
}

function settingsWithDefaults(
  base: OptimizerSettings,
  override?: Partial<OptimizerSettings>,
): OptimizerSettings {
  const settings = { ...base, ...override };
  if (
    settings.keepAfter4 < 1 ||
    settings.keepAfter8 < 1 ||
    settings.maxGeneratedCandidates < settings.keepAfter4 ||
    settings.maxGenericCandidates < 1 ||
    settings.alternatives < 0 ||
    !Number.isFinite(settings.boundaryWeight) ||
    settings.boundaryWeight < 0 || settings.boundaryWeight > 4
  ) {
    throw new RangeError('Invalid optimizer candidate limits');
  }
  if (!Number.isFinite(settings.protrusionWeight) ||
    settings.protrusionWeight < 0 || settings.protrusionWeight > 8
  ) {
    throw new RangeError('Protrusion weight must be finite and in 0..8');
  }
  return settings;
}

function normalizedMargin(ranked: readonly ScoredGeometry[]): number {
  if (ranked.length < 2) return Number.POSITIVE_INFINITY;
  return scoreToNumber(ranked[1]!) - scoreToNumber(ranked[0]!);
}

function isUnambiguous(
  ranked: readonly ScoredGeometry[],
  threshold: number,
): boolean {
  if (ranked.length < 2) return true;
  return !equalWeightedScore(ranked[0]!, ranked[1]!) && normalizedMargin(ranked) >= threshold;
}

function coveringGeometryIds(
  geometryIds: ArrayLike<number>,
  target: Uint32Array,
  resolution: Resolution,
  catalog: PackedShapeCatalog,
): number[] {
  const pool = catalog.getMaskPool(resolution);
  const words = target.length;
  return Array.from(geometryIds).filter((geometryId) => {
    const offset = catalog.geometryMaskOffset(geometryId, resolution);
    for (let word = 0; word < words; word += 1) {
      if (((target[word] ?? 0) & ~(pool[offset + word] ?? 0)) !== 0) return false;
    }
    return true;
  });
}

function requiredCoverageCandidates(
  geometryIds: readonly number[],
  target: Uint32Array,
  resolution: Resolution,
  catalog: PackedShapeCatalog,
  isGeometryAllowed?: (geometryId: number) => boolean,
): number[] {
  const covering = coveringGeometryIds(geometryIds, target, resolution, catalog);
  if (covering.length > 0) return covering;
  const full = catalog.routeIndex.get('FULL');
  if (full !== undefined) {
    const fallback = coveringGeometryIds(full, target, resolution, catalog).filter(
      (geometryId) => isGeometryAllowed === undefined || isGeometryAllowed(geometryId),
    );
    if (fallback.length > 0) return fallback;
  }
  if (geometryIds.length > 0) return [...geometryIds];
  const allowed = Array.from({ length: catalog.geometryCount }, (_unused, geometryId) => geometryId)
    .filter((geometryId) => isGeometryAllowed === undefined || isGeometryAllowed(geometryId));
  if (allowed.length > 0) return allowed;
  throw new Error(`No enabled geometry realization exists at resolution ${resolution}`);
}

const GEOMETRY_KEY_PREFIX = 'GRID16_EXACT:v1:';
const geometryIndexes = new WeakMap<PackedShapeCatalog, ReadonlyMap<string, number>>();
const reflectedGeometryIds = new WeakMap<PackedShapeCatalog, Uint32Array[]>();

function reflectMask(mask: Uint32Array, resolution: Resolution, bits: number): Uint32Array {
  let reflected = mask;
  if ((bits & 1) !== 0) reflected = mirrorMask(reflected, resolution, 'x');
  if ((bits & 2) !== 0) reflected = mirrorMask(reflected, resolution, 'y');
  if ((bits & 4) !== 0) reflected = mirrorMask(reflected, resolution, 'z');
  return reflected;
}

function canonicalReflections(mask: Uint32Array): { mask: Uint32Array; transforms: number[] } {
  let bestMask = mask;
  let bestKey = maskToHex(mask);
  const transforms = [0];
  for (let bits = 1; bits < 8; bits += 1) {
    const candidate = reflectMask(mask, 4, bits);
    const key = maskToHex(candidate);
    if (key > bestKey) continue;
    if (key < bestKey) {
      bestKey = key;
      bestMask = candidate;
      transforms.length = 0;
    }
    transforms.push(bits);
  }
  return { mask: bestMask, transforms };
}

function reflectedGeometryId(
  catalog: PackedShapeCatalog,
  geometryId: number,
  transform: number,
): number | undefined {
  if (transform === 0) return geometryId;
  let indexes = geometryIndexes.get(catalog);
  if (indexes === undefined) {
    indexes = new Map(catalog.geometryKeys.map((key, id) => [key, id]));
    geometryIndexes.set(catalog, indexes);
  }
  let transforms = reflectedGeometryIds.get(catalog);
  if (transforms === undefined) {
    transforms = Array.from({ length: 8 }, () => new Uint32Array(catalog.geometryCount));
    reflectedGeometryIds.set(catalog, transforms);
  }
  const cache = transforms[transform]!;
  const cached = cache[geometryId] ?? 0;
  if (cached !== 0) return cached === 0xffff_ffff ? undefined : cached - 1;
  const mask = reflectMask(catalog.getGeometryMask(geometryId, 16), 16, transform);
  const reflected = indexes.get(`${GEOMETRY_KEY_PREFIX}${maskToHex(mask)}`);
  cache[geometryId] = reflected === undefined ? 0xffff_ffff : reflected + 1;
  return reflected;
}

const allowedGeometryCache = new WeakMap<
  Uint8Array,
  WeakMap<PackedShapeCatalog, Array<readonly number[] | undefined>>
>();

function allowedCanonicalGeometryIds(
  allowedGeometryIds: Uint8Array,
  catalog: PackedShapeCatalog,
  transform: number,
): readonly number[] {
  let catalogCache = allowedGeometryCache.get(allowedGeometryIds);
  if (catalogCache === undefined) {
    catalogCache = new WeakMap();
    allowedGeometryCache.set(allowedGeometryIds, catalogCache);
  }
  let transforms = catalogCache.get(catalog);
  if (transforms === undefined) {
    transforms = Array.from({ length: 8 });
    catalogCache.set(catalog, transforms);
  }
  const cached = transforms[transform];
  if (cached !== undefined) return cached;
  const selected: number[] = [];
  for (let actualId = 0; actualId < catalog.geometryCount; actualId += 1) {
    if (allowedGeometryIds[actualId] !== 1) continue;
    const canonicalId = reflectedGeometryId(catalog, actualId, transform);
    if (canonicalId !== undefined) selected.push(canonicalId);
  }
  selected.sort((left, right) => left - right);
  transforms[transform] = selected;
  return selected;
}

const octantPatternCaches = new WeakMap<PackedShapeCatalog, Int16Array>();

function geometryOctantPattern(
  catalog: PackedShapeCatalog,
  geometryId: number,
): number | undefined {
  let cache = octantPatternCaches.get(catalog);
  if (cache === undefined) {
    cache = new Int16Array(catalog.geometryCount);
    cache.fill(-2);
    octantPatternCaches.set(catalog, cache);
  }
  const cached = cache[geometryId] ?? -1;
  if (cached !== -2) return cached < 0 ? undefined : cached;
  const mask = catalog.getGeometryMask(geometryId, 16);
  let pattern = 0;
  for (let octant = 0; octant < 8; octant += 1) {
    const startX = (octant & 1) === 0 ? 0 : 8;
    const startY = (octant & 2) === 0 ? 0 : 8;
    const startZ = (octant & 4) === 0 ? 0 : 8;
    let state = -1;
    for (let z = startZ; z < startZ + 8; z += 1) {
      for (let y = startY; y < startY + 8; y += 1) {
        for (let x = startX; x < startX + 8; x += 1) {
          const bit = x + 16 * (y + 16 * z);
          const occupied = ((mask[bit >>> 5] ?? 0) & (1 << (bit & 31))) === 0 ? 0 : 1;
          if (state === -1) state = occupied;
          else if (state !== occupied) {
            cache[geometryId] = -1;
            return undefined;
          }
        }
      }
    }
    if (state === 1) pattern |= 1 << octant;
  }
  cache[geometryId] = pattern;
  return pattern;
}

function conservativeOctantPattern(mask: Uint32Array): number {
  let pattern = 0;
  for (let z = 0; z < 16; z += 1) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        const bit = x + 16 * (y + 16 * z);
        if (((mask[bit >>> 5] ?? 0) & (1 << (bit & 31))) === 0) continue;
        pattern |= 1 << ((x >= 8 ? 1 : 0) | (y >= 8 ? 2 : 0) | (z >= 8 ? 4 : 0));
      }
    }
  }
  return pattern;
}

function popcount8(value: number): number {
  let result = value & 0xff;
  result = result - ((result >>> 1) & 0x55);
  result = (result & 0x33) + ((result >>> 2) & 0x33);
  return ((result + (result >>> 4)) & 0x0f);
}

function narrowOctantLatticeCandidates(
  geometryIds: readonly number[],
  targetMask16: () => Uint32Array,
  catalog: PackedShapeCatalog,
  weights: ReturnType<typeof quantizeWeights>,
): number[] | undefined {
  const patterns: number[] = [];
  for (const geometryId of geometryIds) {
    const pattern = geometryOctantPattern(catalog, geometryId);
    if (pattern === undefined) return undefined;
    patterns.push(pattern);
  }
  const target = conservativeOctantPattern(targetMask16());
  let bestScore = Number.POSITIVE_INFINITY;
  const selected: number[] = [];
  for (let index = 0; index < geometryIds.length; index += 1) {
    const pattern = patterns[index] ?? 0;
    const score = popcount8(target & ~pattern) * weights.missing +
      popcount8(pattern & ~target) * weights.extra;
    if (score > bestScore) continue;
    if (score < bestScore) {
      bestScore = score;
      selected.length = 0;
    }
    selected.push(geometryIds[index]!);
  }
  return selected;
}

function generateCanonicalCandidates(
  mask4: Uint32Array,
  descriptor: Float32Array,
  settings: OptimizerSettings,
  catalog: PackedShapeCatalog,
): ReturnType<typeof generateCandidates> & { readonly transform: number } {
  const canonical = canonicalReflections(mask4);
  const transform = canonical.transforms[0] ?? 0;
  const canonicalDescriptor = computeDescriptor(canonical.mask, 4, {
    normalVariance: descriptor[DESCRIPTOR.NORMAL_VARIANCE] ?? 0,
    normalX: (descriptor[DESCRIPTOR.NORMAL_X] ?? 0) * ((transform & 1) === 0 ? 1 : -1),
    normalY: (descriptor[DESCRIPTOR.NORMAL_Y] ?? 0) * ((transform & 2) === 0 ? 1 : -1),
    normalZ: (descriptor[DESCRIPTOR.NORMAL_Z] ?? 0) * ((transform & 4) === 0 ? 1 : -1),
  });
  return {
    ...generateCandidates(canonical.mask, canonicalDescriptor, settings, catalog),
    transform,
  };
}

export class GeometryOptimizer {
  public readonly catalog: PackedShapeCatalog;
  readonly #settings: OptimizerSettings;

  public constructor(options: GeometryOptimizerOptions) {
    this.catalog = options.catalog;
    this.#settings = settingsWithDefaults(
      DEFAULT_OPTIMIZER_SETTINGS,
      options.settings,
    );
  }

  public optimizeCell(input: OptimizeCellInput): OptimizeCellResult {
    const settings = settingsWithDefaults(this.#settings, input.settings);
    const weights = quantizeWeights(settings.missingWeight, settings.extraWeight);
    const mask4 = input.occupancy.getMask(4);
    const descriptor = input.descriptor ?? computeDescriptor(mask4, 4);
    if (descriptor.length !== DESCRIPTOR.LENGTH) {
      throw new RangeError(`Descriptor must contain ${DESCRIPTOR.LENGTH} values`);
    }

    const refinementReasons: string[] = [];
    const timings = {
      candidateGeneration: 0,
      mask16: 0,
      mask4: 0,
      mask8: 0,
    };
    let allocations = 3;

    let started = now();
    const generated = generateCanonicalCandidates(mask4, descriptor, settings, this.catalog);
    if (input.allowedGeometryIds !== undefined && input.allowedGeometryIds.length !== this.catalog.geometryCount) {
      throw new RangeError('Allowed geometry mask size does not match catalog');
    }
    const transform = generated.transform;
    const canonicalMask4 = reflectMask(mask4, 4, transform);
    const actualGeometryId = (geometryId: number): number | undefined =>
      reflectedGeometryId(this.catalog, geometryId, transform);
    const isGeometryAllowed = (geometryId: number): boolean => {
      const actual = actualGeometryId(geometryId);
      return actual !== undefined &&
        (input.allowedGeometryIds === undefined || input.allowedGeometryIds[actual] === 1);
    };
    const selectedGeometryIds = input.allowedGeometryIds === undefined
      ? generated.geometryIds
      : allowedCanonicalGeometryIds(input.allowedGeometryIds, this.catalog, transform);
    let generatedGeometryIds = input.excludeAir === true
      ? selectedGeometryIds.filter((geometryId) => {
          const actual = actualGeometryId(geometryId);
          if (actual === undefined) return false;
          const shapeId = this.catalog.geometryRepresentativeShape[actual] ?? 0;
          return (this.catalog.shapeFamily[shapeId] ?? 0) !== 0;
        })
      : [...selectedGeometryIds];
    generatedGeometryIds = generatedGeometryIds.filter(isGeometryAllowed);
    if (generatedGeometryIds.length === 0) {
      generatedGeometryIds = Array.from({ length: this.catalog.geometryCount }, (_unused, id) => id)
        .filter((id) => {
          if (!isGeometryAllowed(id)) return false;
          if (input.excludeAir !== true) return true;
          const actual = actualGeometryId(id);
          const shapeId = actual === undefined ? 0 : this.catalog.geometryRepresentativeShape[actual] ?? 0;
          return (this.catalog.shapeFamily[shapeId] ?? 0) !== 0;
        });
    }
    if (input.allowedGeometryIds !== undefined) {
      const latticeCandidates = narrowOctantLatticeCandidates(
        generatedGeometryIds,
        () => reflectMask(input.occupancy.getMask(16), 16, transform),
        this.catalog,
        weights,
      );
      if (latticeCandidates !== undefined) {
        generatedGeometryIds = latticeCandidates;
        refinementReasons.push('octant-lattice-direct');
      }
    }
    if (input.requireCoverage === true) {
      generatedGeometryIds = requiredCoverageCandidates(
        generatedGeometryIds,
        canonicalMask4,
        4,
        this.catalog,
        isGeometryAllowed,
      );
    }
    timings.candidateGeneration = settings.collectTimings ? now() - started : 0;
    if (generatedGeometryIds.length === 0) {
      throw new Error('Candidate generation produced no shapes');
    }

    const protrusionWeight = refinementReasons.includes('octant-lattice-direct')
      ? 0
      : settings.protrusionWeight;
    started = now();
    let ranked = rankGeometryCandidates(
      generatedGeometryIds,
      canonicalMask4,
      4,
      settings.keepAfter4,
      this.catalog,
      weights,
      settings.boundaryWeight,
      protrusionWeight,
    );
    timings.mask4 = settings.collectTimings ? now() - started : 0;
    allocations += 2;
    const afterMask4 = ranked.length;
    let afterMask8 = 0;
    let afterMask16 = 0;
    let usedResolution: Resolution = 4;

    const obviousAt4 =
      ranked[0]?.numerator === 0 &&
      isUnambiguous(ranked, settings.ambiguityThreshold4);
    const complex =
      input.descriptor !== undefined &&
      (descriptor[DESCRIPTOR.NORMAL_VARIANCE] ?? 0) > settings.complexityThreshold;
    const needs8 =
      !obviousAt4 ||
      complex ||
      settings.qualityMode === QualityMode.QUALITY ||
      input.requireCoverage === true;
    if (needs8) {
      if (ranked.length > 1 && equalWeightedScore(ranked[0]!, ranked[1]!)) {
        refinementReasons.push('mask4-tie');
      } else if (complex) {
        refinementReasons.push('surface-complexity');
      } else if (settings.qualityMode === QualityMode.QUALITY && obviousAt4) {
        refinementReasons.push('quality-mode');
      } else {
        refinementReasons.push('mask4-low-margin');
      }
      const mask8 = reflectMask(input.occupancy.getMask(8), 8, transform);
      const mask8Candidates = input.requireCoverage === true
        ? requiredCoverageCandidates(
            ranked.map(({ geometryId }) => geometryId),
            mask8,
            8,
            this.catalog,
            isGeometryAllowed,
          )
        : ranked.map(({ geometryId }) => geometryId);
      started = now();
      ranked = rankGeometryCandidates(
        mask8Candidates,
        mask8,
        8,
        settings.keepAfter8,
        this.catalog,
        weights,
        settings.boundaryWeight,
        protrusionWeight,
      );
      timings.mask8 = settings.collectTimings ? now() - started : 0;
      allocations += 2;
      afterMask8 = ranked.length;
      usedResolution = 8;

      const mask8Tied =
        ranked.length > 1 && equalWeightedScore(ranked[0]!, ranked[1]!);
      const lowMargin8 = !isUnambiguous(ranked, settings.ambiguityThreshold8);
      const needs16 =
        input.requireCoverage === true ||
        (settings.qualityMode !== QualityMode.FAST &&
          ranked.length > 1 &&
          (mask8Tied ||
            lowMargin8 ||
            settings.qualityMode === QualityMode.QUALITY ||
            (complex && ranked[0]?.numerator !== 0)));

      if (needs16) {
        if (mask8Tied) refinementReasons.push('mask8-tie');
        else if (lowMargin8) refinementReasons.push('mask8-low-margin');
        else if (complex) refinementReasons.push('surface-complexity');
        else refinementReasons.push('quality-mode');
        const mask16 = reflectMask(input.occupancy.getMask(16), 16, transform);
        const mask16Candidates = input.requireCoverage === true
          ? requiredCoverageCandidates(
              ranked.map(({ geometryId }) => geometryId),
              mask16,
              16,
              this.catalog,
              isGeometryAllowed,
            )
          : ranked.map(({ geometryId }) => geometryId);
        started = now();
        ranked = rankGeometryCandidates(
          mask16Candidates,
          mask16,
          16,
          Math.max(1, settings.alternatives + 1),
          this.catalog,
          weights,
          settings.boundaryWeight,
          protrusionWeight,
        );
        timings.mask16 = settings.collectTimings ? now() - started : 0;
        allocations += 2;
        afterMask16 = ranked.length;
        usedResolution = 16;
      }
    }

    if (ranked.length === 0) throw new Error('Every geometry candidate was pruned');
    const publicCandidates = ranked
      .slice(0, settings.alternatives + 1)
      .map((score) => {
        const geometryId = actualGeometryId(score.geometryId);
        if (geometryId === undefined) throw new Error('Canonical geometry has no reflected realization');
        return this.toPublicCandidate({ ...score, geometryId }, usedResolution);
      });
    const best = publicCandidates[0]!;
    return {
      alternatives: publicCandidates.slice(1),
      best,
      debug: {
        afterMask16,
        afterMask4,
        afterMask8,
        candidatesGenerated: generatedGeometryIds.length,
        genericCandidates: generated.genericCount,
        postingsScanned: generated.postingsScanned,
        refinementReasons,
        routedCandidates: generated.routedCount,
        timingsMs: timings,
        trackedTemporaryAllocations: allocations,
      },
      usedResolution,
    };
  }

  public optimizeBatch(
    inputs: readonly OptimizeCellInput[],
    options: OptimizeBatchOptions = {},
  ): OptimizeBatchResult {
    const geometryIds = new Uint32Array(inputs.length);
    const shapeIds = new Uint32Array(inputs.length);
    const geometryErrors = new Float32Array(inputs.length);
    const missingCounts = new Uint16Array(inputs.length);
    const extraCounts = new Uint16Array(inputs.length);
    const usedResolutions = new Uint8Array(inputs.length);
    const stageTotals = {
      afterMask16: 0,
      afterMask4: 0,
      afterMask8: 0,
      candidatesGenerated: 0,
    };
    for (let index = 0; index < inputs.length; index += 1) {
      if (options.signal?.aborted === true) {
        throw new Error(`Geometry optimization aborted after ${index} cells`);
      }
      const result = this.optimizeCell(inputs[index]!);
      geometryIds[index] = result.best.geometryId;
      shapeIds[index] = result.best.shapeId;
      geometryErrors[index] = result.best.geometryError;
      missingCounts[index] = result.best.missingCount;
      extraCounts[index] = result.best.extraCount;
      usedResolutions[index] = result.usedResolution;
      stageTotals.afterMask16 += result.debug.afterMask16;
      stageTotals.afterMask4 += result.debug.afterMask4;
      stageTotals.afterMask8 += result.debug.afterMask8;
      stageTotals.candidatesGenerated += result.debug.candidatesGenerated;
      options.onProgress?.(index + 1, inputs.length);
    }
    return {
      extraCounts,
      geometryErrors,
      geometryIds,
      missingCounts,
      shapeIds,
      stageTotals,
      usedResolutions,
    };
  }

  public compare(
    input: OptimizeCellInput,
    geometryId: number,
    resolution: Resolution,
  ): GeometryComparisonDebug {
    return compareGeometryMasks(input.occupancy, this.catalog, geometryId, resolution);
  }

  private toPublicCandidate(
    score: ScoredGeometry,
    resolution: Resolution,
  ): GeometryCandidate {
    const shapeId = this.catalog.geometryRepresentativeShape[score.geometryId] ?? 0;
    const metadata = this.catalog.getShapeMetadata(shapeId);
    return {
      blockId: metadata.blockId,
      comparedResolution: resolution,
      equivalentShapeIds: Array.from(this.catalog.getRealizationShapeIds(score.geometryId)),
      extraCount: score.extraCount,
      family: metadata.family,
      geometryError: scoreToNumber(score),
      geometryId: score.geometryId,
      geometryKey: metadata.geometryKey,
      missingCount: score.missingCount,
      parts: this.catalog.getShapeParts(shapeId),
      shapeId,
      state: metadata.state,
    };
  }
}

export function createGeometryOptimizer(options: GeometryOptimizerOptions): GeometryOptimizer {
  return new GeometryOptimizer(options);
}

let defaultOptimizer: GeometryOptimizer | undefined;

export function optimizeCell(input: OptimizeCellInput): OptimizeCellResult {
  defaultOptimizer ??= new GeometryOptimizer({ catalog: getFixtureCatalog() });
  return defaultOptimizer.optimizeCell(input);
}

export function familyName(family: ShapeFamily): string {
  return ShapeFamily[family];
}
