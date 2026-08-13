import type { PackedShapeCatalog } from '@mesh-to-copycats/shapes';
import type { Resolution } from '@mesh-to-copycats/shared';
import {
  popcount32,
  popcountMask,
  wordCountForResolution,
} from '@mesh-to-copycats/voxelizer';

const WEIGHT_SCALE = 4096;
const MAX_WEIGHT = 1024;

export interface QuantizedWeights {
  readonly extra: number;
  readonly missing: number;
}

export interface WeightedScore {
  readonly denominator: number;
  readonly extraCount: number;
  readonly missingCount: number;
  readonly numerator: number;
}

export interface ScoredGeometry extends WeightedScore {
  readonly geometryId: number;
}

export function quantizeWeights(missing: number, extra: number): QuantizedWeights {
  if (
    !Number.isFinite(missing) ||
    !Number.isFinite(extra) ||
    missing < 0 ||
    extra < 0 ||
    missing > MAX_WEIGHT ||
    extra > MAX_WEIGHT
  ) {
    throw new RangeError(
      `Geometry weights must be finite and in the range 0..${MAX_WEIGHT}`,
    );
  }
  if (missing === 0 && extra === 0) {
    throw new RangeError('At least one geometry weight must be positive');
  }
  return {
    extra: extra === 0 ? 0 : Math.max(1, Math.round(extra * WEIGHT_SCALE)),
    missing: missing === 0 ? 0 : Math.max(1, Math.round(missing * WEIGHT_SCALE)),
  };
}

export function compareWeightedScore(left: WeightedScore, right: WeightedScore): number {
  const crossLeft = left.numerator * right.denominator;
  const crossRight = right.numerator * left.denominator;
  return crossLeft === crossRight ? 0 : crossLeft < crossRight ? -1 : 1;
}

export function equalWeightedScore(left: WeightedScore, right: WeightedScore): boolean {
  return compareWeightedScore(left, right) === 0;
}

export function scoreToNumber(score: WeightedScore): number {
  return score.numerator / (score.denominator * WEIGHT_SCALE);
}

export function scoreMaskAtOffset(
  target: Uint32Array,
  candidatePool: Uint32Array,
  candidateOffset: number,
  resolution: Resolution,
  weights: QuantizedWeights,
  bound?: WeightedScore,
): WeightedScore | undefined {
  const words = wordCountForResolution(resolution);
  if (target.length !== words || candidateOffset < 0 || candidateOffset + words > candidatePool.length) {
    throw new RangeError('Invalid occupancy mask view');
  }

  const targetPopulation = popcountMask(target);
  let candidatePopulation = 0;
  for (let index = 0; index < words; index += 1) {
    candidatePopulation += popcount32(candidatePool[candidateOffset + index] ?? 0);
  }
  const maxFinalUnion = Math.min(
    resolution * resolution * resolution,
    targetPopulation + candidatePopulation,
  );

  let missingCount = 0;
  let extraCount = 0;
  let unionCount = 0;
  for (let index = 0; index < words; index += 1) {
    const targetWord = target[index] ?? 0;
    const candidateWord = candidatePool[candidateOffset + index] ?? 0;
    missingCount += popcount32(targetWord & ~candidateWord);
    extraCount += popcount32(candidateWord & ~targetWord);
    unionCount += popcount32(targetWord | candidateWord);

    if (bound !== undefined && (index & 7) === 7) {
      const partialNumerator =
        missingCount * weights.missing + extraCount * weights.extra;
      if (
        partialNumerator * bound.denominator >
        bound.numerator * Math.max(1, maxFinalUnion)
      ) {
        return undefined;
      }
    }
  }

  return {
    denominator: Math.max(1, unionCount),
    extraCount,
    missingCount,
    numerator: missingCount * weights.missing + extraCount * weights.extra,
  };
}

function compareScoredGeometry(
  left: ScoredGeometry,
  right: ScoredGeometry,
  catalog: PackedShapeCatalog,
): number {
  const scoreOrder = compareWeightedScore(left, right);
  if (scoreOrder !== 0) return scoreOrder;
  const leftShape = catalog.geometryRepresentativeShape[left.geometryId] ?? 0;
  const rightShape = catalog.geometryRepresentativeShape[right.geometryId] ?? 0;
  const familyOrder =
    (catalog.shapeFamilyPriority[leftShape] ?? 0) -
    (catalog.shapeFamilyPriority[rightShape] ?? 0);
  if (familyOrder !== 0) return familyOrder;
  const complexityOrder =
    (catalog.shapeComplexity[leftShape] ?? 0) -
    (catalog.shapeComplexity[rightShape] ?? 0);
  return complexityOrder !== 0 ? complexityOrder : leftShape - rightShape;
}

export function rankGeometryCandidates(
  geometryIds: readonly number[],
  target: Uint32Array,
  resolution: Resolution,
  keep: number,
  catalog: PackedShapeCatalog,
  weights: QuantizedWeights,
): ScoredGeometry[] {
  const ranked: ScoredGeometry[] = [];
  const pool = catalog.getMaskPool(resolution);
  for (const geometryId of geometryIds) {
    const bound = ranked.length >= keep ? ranked[Math.min(keep, ranked.length) - 1] : undefined;
    const score = scoreMaskAtOffset(
      target,
      pool,
      catalog.geometryMaskOffset(geometryId, resolution),
      resolution,
      weights,
      bound,
    );
    if (score === undefined) continue;
    ranked.push({ ...score, geometryId });
    ranked.sort((left, right) => compareScoredGeometry(left, right, catalog));
    if (ranked.length > keep) {
      const cutoff = ranked[keep - 1]!;
      let end = keep;
      while (end < ranked.length && equalWeightedScore(ranked[end]!, cutoff)) end += 1;
      ranked.length = end;
    }
  }
  return ranked;
}
