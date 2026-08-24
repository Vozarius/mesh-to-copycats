import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import {
  compareWeightedScore,
  quantizeWeights,
  scoreMaskAtOffset,
  scoreToNumber,
} from '../../packages/optimizer/src/index.js';

function mask2(words: readonly number[]): Uint32Array {
  if (words.length !== 2) throw new RangeError('Expected exactly two words');
  return Uint32Array.from(words);
}

function requireScore(
  score: ReturnType<typeof scoreMaskAtOffset>,
): Exclude<ReturnType<typeof scoreMaskAtOffset>, undefined> {
  if (score === undefined) throw new Error('Unbounded score was unexpectedly pruned');
  return score;
}

describe('symmetric occupancy scoring', () => {
  it('keeps missing and extra counts separate', () => {
    const target = mask2([0b0001, 0]);
    const candidate = mask2([0b0010, 0]);
    const score = requireScore(
      scoreMaskAtOffset(target, candidate, 0, 4, quantizeWeights(2, 3)),
    );

    expect(score.missingCount).toBe(1);
    expect(score.extraCount).toBe(1);
    expect(score.denominator).toBe(2);
    expect(scoreToNumber(score)).toBe(2.5);
  });

  it('is exactly symmetric when missing and extra weights are equal', () => {
    const maskArbitrary = fc
      .array(fc.integer(), { minLength: 2, maxLength: 2 })
      .map((words) => Uint32Array.from(words));
    const weights = quantizeWeights(1, 1);

    fc.assert(
      fc.property(maskArbitrary, maskArbitrary, (left, right) => {
        const leftToRight = requireScore(scoreMaskAtOffset(left, right, 0, 4, weights));
        const rightToLeft = requireScore(scoreMaskAtOffset(right, left, 0, 4, weights));

        expect(leftToRight.denominator).toBe(rightToLeft.denominator);
        expect(leftToRight.numerator).toBe(rightToLeft.numerator);
        expect(leftToRight.missingCount).toBe(rightToLeft.extraCount);
        expect(leftToRight.extraCount).toBe(rightToLeft.missingCount);
        expect(scoreToNumber(leftToRight)).toBe(scoreToNumber(rightToLeft));
      }),
      { numRuns: 500, seed: 0x5eed_1001 },
    );
  });

  it('assigns zero error exactly to equal masks, including empty/empty', () => {
    const maskArbitrary = fc
      .array(fc.integer(), { minLength: 2, maxLength: 2 })
      .map((words) => Uint32Array.from(words));
    const weights = quantizeWeights(1, 1);

    fc.assert(
      fc.property(maskArbitrary, (mask) => {
        const score = requireScore(scoreMaskAtOffset(mask, mask, 0, 4, weights));
        expect(score.numerator).toBe(0);
        expect(score.missingCount).toBe(0);
        expect(score.extraCount).toBe(0);
        expect(scoreToNumber(score)).toBe(0);
      }),
      { numRuns: 250, seed: 0x5eed_1002 },
    );

    const empty = new Uint32Array(2);
    expect(requireScore(scoreMaskAtOffset(empty, empty, 0, 4, weights))).toEqual({
      denominator: 1,
      extraCount: 0,
      missingCount: 0,
      numerator: 0,
    });
  });

  it('only early-exits candidates that cannot beat the supplied normalized bound', () => {
    const maskArbitrary = fc
      .array(fc.integer(), { minLength: 16, maxLength: 16 })
      .map((words) => Uint32Array.from(words));
    const weights = quantizeWeights(1.25, 0.75);

    fc.assert(
      fc.property(maskArbitrary, maskArbitrary, maskArbitrary, (target, candidate, boundMask) => {
        const bound = requireScore(scoreMaskAtOffset(target, boundMask, 0, 8, weights));
        const full = requireScore(scoreMaskAtOffset(target, candidate, 0, 8, weights));
        const possiblyPruned = scoreMaskAtOffset(target, candidate, 0, 8, weights, bound);

        if (possiblyPruned === undefined) {
          expect(compareWeightedScore(full, bound)).toBeGreaterThan(0);
        } else {
          expect(possiblyPruned).toEqual(full);
        }
      }),
      { numRuns: 250, seed: 0x5eed_1003 },
    );
  });

  it('penalizes a missing cell-boundary contact more than an equal interior miss', () => {
    const set = (mask: Uint32Array, x: number, y: number, z: number) => {
      const bit = x + 4 * (y + 4 * z);
      mask[bit >>> 5] = (mask[bit >>> 5] ?? 0) | (1 << (bit & 31));
    };
    const target = new Uint32Array(2);
    const missesBoundary = new Uint32Array(2);
    const missesInterior = new Uint32Array(2);
    set(target, 0, 1, 1);
    set(target, 1, 1, 1);
    set(missesBoundary, 1, 1, 1);
    set(missesInterior, 0, 1, 1);
    const weights = quantizeWeights(1, 1);
    const boundaryMiss = requireScore(
      scoreMaskAtOffset(target, missesBoundary, 0, 4, weights, undefined, 0.25),
    );
    const interiorMiss = requireScore(
      scoreMaskAtOffset(target, missesInterior, 0, 4, weights, undefined, 0.25),
    );
    expect(boundaryMiss.missingCount).toBe(interiorMiss.missingCount);
    expect(compareWeightedScore(boundaryMiss, interiorMiss)).toBeGreaterThan(0);
  });
});
