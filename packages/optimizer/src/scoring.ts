import type { PackedShapeCatalog } from '@mesh-to-copycats/shapes';
import type { Resolution } from '@mesh-to-copycats/shared';
import {
  mirrorMask,
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
  readonly momentError: number;
  readonly symmetryError: number;
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

interface MaskMoments {
  readonly centerX: number;
  readonly centerY: number;
  readonly centerZ: number;
  readonly varianceX: number;
  readonly varianceY: number;
  readonly varianceZ: number;
}

function maskMoments(mask: Uint32Array, offset: number, resolution: Resolution): MaskMoments {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumZ2 = 0;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        const bit = x + resolution * (y + resolution * z);
        if (((mask[offset + (bit >>> 5)] ?? 0) & (1 << (bit & 31))) === 0) continue;
        count++;
        sumX += x; sumY += y; sumZ += z;
        sumX2 += x * x; sumY2 += y * y; sumZ2 += z * z;
      }
    }
  }
  const divisor = Math.max(1, count);
  const centerX = sumX / divisor;
  const centerY = sumY / divisor;
  const centerZ = sumZ / divisor;
  const scale = Math.max(1, resolution - 1);
  return {
    centerX: centerX / scale, centerY: centerY / scale, centerZ: centerZ / scale,
    varianceX: (sumX2 / divisor - centerX * centerX) / (scale * scale),
    varianceY: (sumY2 / divisor - centerY * centerY) / (scale * scale),
    varianceZ: (sumZ2 / divisor - centerZ * centerZ) / (scale * scale),
  };
}

function compareScoredGeometry(
  left: ScoredGeometry,
  right: ScoredGeometry,
  catalog: PackedShapeCatalog,
): number {
  const scoreOrder = compareWeightedScore(left, right);
  const symmetryOrder = left.symmetryError - right.symmetryError;
  if (symmetryOrder !== 0) return symmetryOrder;
  if (scoreOrder !== 0) return scoreOrder;
  const momentOrder = left.momentError - right.momentError;
  if (momentOrder !== 0) return momentOrder;
  const leftShape = catalog.geometryRepresentativeShape[left.geometryId] ?? 0;
  const rightShape = catalog.geometryRepresentativeShape[right.geometryId] ?? 0;
  const familyOrder =
    (catalog.shapeFamilyPriority[leftShape] ?? 0) -
    (catalog.shapeFamilyPriority[rightShape] ?? 0);
  if (familyOrder !== 0) return familyOrder;
  const complexityOrder =
    (catalog.shapeComplexity[leftShape] ?? 0) -
    (catalog.shapeComplexity[rightShape] ?? 0);
  if (complexityOrder !== 0) return complexityOrder;
  return left.geometryId - right.geometryId || leftShape - rightShape;
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
  const targetMoments = maskMoments(target, 0, resolution);
  const symmetryTransforms: number[] = [];
  for (let bits = 1; bits < 8; bits += 1) {
    let reflected = target;
    if ((bits & 1) !== 0) reflected = mirrorMask(reflected, resolution, 'x');
    if ((bits & 2) !== 0) reflected = mirrorMask(reflected, resolution, 'y');
    if ((bits & 4) !== 0) reflected = mirrorMask(reflected, resolution, 'z');
    if (reflected.every((word, index) => word === target[index])) symmetryTransforms.push(bits);
  }
  for (const geometryId of geometryIds) {
    const bound = symmetryTransforms.length === 0 && ranked.length >= keep
      ? ranked[Math.min(keep, ranked.length) - 1]
      : undefined;
    const score = scoreMaskAtOffset(
      target,
      pool,
      catalog.geometryMaskOffset(geometryId, resolution),
      resolution,
      weights,
      bound,
    );
    if (score === undefined) continue;
    const candidateMoments = maskMoments(
      pool,
      catalog.geometryMaskOffset(geometryId, resolution),
      resolution,
    );
    const momentError =
      (targetMoments.centerX - candidateMoments.centerX) ** 2 +
      (targetMoments.centerY - candidateMoments.centerY) ** 2 +
      (targetMoments.centerZ - candidateMoments.centerZ) ** 2 +
      ((targetMoments.varianceX - candidateMoments.varianceX) ** 2 +
        (targetMoments.varianceY - candidateMoments.varianceY) ** 2 +
        (targetMoments.varianceZ - candidateMoments.varianceZ) ** 2) * 0.25;
    const candidateOffset = catalog.geometryMaskOffset(geometryId, resolution);
    const candidate = pool.subarray(candidateOffset, candidateOffset + target.length);
    let symmetryError = 0;
    for (const bits of symmetryTransforms) {
      let reflected = candidate;
      if ((bits & 1) !== 0) reflected = mirrorMask(reflected, resolution, 'x');
      if ((bits & 2) !== 0) reflected = mirrorMask(reflected, resolution, 'y');
      if ((bits & 4) !== 0) reflected = mirrorMask(reflected, resolution, 'z');
      for (let word = 0; word < candidate.length; word += 1) {
        symmetryError += popcount32((candidate[word] ?? 0) ^ (reflected[word] ?? 0));
      }
    }
    ranked.push({ ...score, geometryId, momentError, symmetryError });
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
