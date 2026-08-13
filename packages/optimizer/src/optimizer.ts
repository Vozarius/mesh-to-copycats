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
    settings.alternatives < 0
  ) {
    throw new RangeError('Invalid optimizer candidate limits');
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
    const generated = generateCandidates(mask4, descriptor, settings, this.catalog);
    timings.candidateGeneration = settings.collectTimings ? now() - started : 0;
    if (generated.geometryIds.length === 0) {
      throw new Error('Candidate generation produced no shapes');
    }

    started = now();
    let ranked = rankGeometryCandidates(
      generated.geometryIds,
      mask4,
      4,
      settings.keepAfter4,
      this.catalog,
      weights,
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
      settings.qualityMode === QualityMode.QUALITY;
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
      const mask8 = input.occupancy.getMask(8);
      started = now();
      ranked = rankGeometryCandidates(
        ranked.map(({ geometryId }) => geometryId),
        mask8,
        8,
        settings.keepAfter8,
        this.catalog,
        weights,
      );
      timings.mask8 = settings.collectTimings ? now() - started : 0;
      allocations += 2;
      afterMask8 = ranked.length;
      usedResolution = 8;

      const mask8Tied =
        ranked.length > 1 && equalWeightedScore(ranked[0]!, ranked[1]!);
      const lowMargin8 = !isUnambiguous(ranked, settings.ambiguityThreshold8);
      const needs16 =
        settings.qualityMode !== QualityMode.FAST &&
        ranked.length > 1 &&
        (mask8Tied ||
          lowMargin8 ||
          settings.qualityMode === QualityMode.QUALITY ||
          (complex && ranked[0]?.numerator !== 0));

      if (needs16) {
        if (mask8Tied) refinementReasons.push('mask8-tie');
        else if (lowMargin8) refinementReasons.push('mask8-low-margin');
        else if (complex) refinementReasons.push('surface-complexity');
        else refinementReasons.push('quality-mode');
        const mask16 = input.occupancy.getMask(16);
        started = now();
        ranked = rankGeometryCandidates(
          ranked.map(({ geometryId }) => geometryId),
          mask16,
          16,
          Math.max(1, settings.alternatives + 1),
          this.catalog,
          weights,
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
      .map((score) => this.toPublicCandidate(score, usedResolution));
    const best = publicCandidates[0]!;
    return {
      alternatives: publicCandidates.slice(1),
      best,
      debug: {
        afterMask16,
        afterMask4,
        afterMask8,
        candidatesGenerated: generated.geometryIds.length,
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
