import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { Axis } from '../../packages/shared/src/index.js';
import {
  AdaptiveOccupancy,
  bitIndex,
  clearBit,
  createMask,
  getBit,
  hammingDistanceAtOffset,
  mirrorMask,
  popcount32,
  popcountMask,
  resampleMaskNearest,
  rotateMaskYClockwise,
  setBit,
  wordCountForResolution,
} from '../../packages/voxelizer/src/index.js';

function referencePopcount32(value: number): number {
  const bits = value >>> 0;
  let count = 0;
  for (let bit = 0; bit < 32; bit += 1) count += (bits >>> bit) & 1;
  return count;
}

function mask4FromIndices(indices: readonly number[]): Uint32Array {
  const mask = createMask(4);
  for (const index of indices) setBit(mask, index);
  return mask;
}

describe('packed occupancy masks', () => {
  it('uses an x-fast layout with stable 32-bit word boundaries', () => {
    expect(wordCountForResolution(4)).toBe(2);
    expect(wordCountForResolution(8)).toBe(16);
    expect(wordCountForResolution(16)).toBe(128);

    expect(bitIndex(4, 0, 0, 0)).toBe(0);
    expect(bitIndex(4, 3, 0, 0)).toBe(3);
    expect(bitIndex(4, 0, 1, 0)).toBe(4);
    expect(bitIndex(4, 0, 0, 1)).toBe(16);
    expect(bitIndex(4, 3, 3, 3)).toBe(63);
    expect(bitIndex(8, 7, 7, 7)).toBe(511);
    expect(bitIndex(16, 15, 15, 15)).toBe(4095);

    const mask = createMask(16);
    for (const index of [0, 31, 32, 4095]) setBit(mask, index);

    expect(mask[0]).toBe(0x8000_0001);
    expect(mask[1]).toBe(1);
    expect(mask[127]).toBe(0x8000_0000);
    expect([0, 31, 32, 4095].every((index) => getBit(mask, index))).toBe(true);

    clearBit(mask, 31);
    expect(getBit(mask, 31)).toBe(false);
    expect(popcountMask(mask)).toBe(3);
  });

  it('matches a bit-by-bit popcount reference for every signed word pattern', () => {
    fc.assert(
      fc.property(fc.integer(), (word) => {
        expect(popcount32(word)).toBe(referencePopcount32(word));
      }),
      { numRuns: 1_000, seed: 0x5eed_0001 },
    );

    expect(popcount32(0)).toBe(0);
    expect(popcount32(-1)).toBe(32);
    expect(popcount32(0x5555_5555)).toBe(16);
    expect(popcount32(0x8000_0000)).toBe(1);
  });

  it('conservatively downsamples every occupied fine voxel', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        (x, y, z) => {
          const fine = createMask(16);
          setBit(fine, bitIndex(16, x, y, z));

          const medium = resampleMaskNearest(fine, 16, 8);
          const coarse = resampleMaskNearest(fine, 16, 4);

          expect(popcountMask(medium)).toBe(1);
          expect(popcountMask(coarse)).toBe(1);
          expect(
            getBit(
              medium,
              bitIndex(8, Math.floor(x / 2), Math.floor(y / 2), Math.floor(z / 2)),
            ),
          ).toBe(true);
          expect(
            getBit(
              coarse,
              bitIndex(4, Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4)),
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 250, seed: 0x5eed_0002 },
    );
  });

  it('OR-reduces fine voxels that land in the same coarse voxel', () => {
    const fine = createMask(16);
    setBit(fine, bitIndex(16, 0, 0, 0));
    setBit(fine, bitIndex(16, 3, 3, 3));
    setBit(fine, bitIndex(16, 4, 0, 0));

    const coarse = resampleMaskNearest(fine, 16, 4);
    expect(popcountMask(coarse)).toBe(2);
    expect(getBit(coarse, bitIndex(4, 0, 0, 0))).toBe(true);
    expect(getBit(coarse, bitIndex(4, 1, 0, 0))).toBe(true);
  });

  it('compares a target directly against an offset in a packed mask pool', () => {
    const target = mask4FromIndices([0, 31, 32]);
    const candidate = mask4FromIndices([0, 31, 63]);
    const pool = new Uint32Array(6);
    pool.set(candidate, 4);

    expect(hammingDistanceAtOffset(target, pool, 4)).toBe(2);
    expect(() => hammingDistanceAtOffset(target, pool, 5)).toThrow(RangeError);
  });
});

describe('mask transforms', () => {
  it('rotates coordinates clockwise around Y', () => {
    const source = createMask(4);
    setBit(source, bitIndex(4, 0, 1, 2));

    const rotated = rotateMaskYClockwise(source, 4);
    expect(getBit(rotated, bitIndex(4, 1, 1, 0))).toBe(true);
    expect(popcountMask(rotated)).toBe(1);
  });

  it('preserves occupancy under the transform group identities', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 0, max: 63 }), { maxLength: 64 }),
        (indices) => {
          const source = mask4FromIndices(indices);
          let rotated = source;
          for (let turn = 0; turn < 4; turn += 1) {
            rotated = rotateMaskYClockwise(rotated, 4);
          }
          expect(Array.from(rotated)).toEqual(Array.from(source));

          for (const axis of ['x', 'y', 'z'] as const satisfies readonly Axis[]) {
            const mirroredTwice = mirrorMask(mirrorMask(source, 4, axis), 4, axis);
            expect(Array.from(mirroredTwice)).toEqual(Array.from(source));
            expect(popcountMask(mirroredTwice)).toBe(popcountMask(source));
          }
        },
      ),
      { numRuns: 200, seed: 0x5eed_0003 },
    );
  });
});

describe('adaptive occupancy', () => {
  it('materializes each fine resolution at most once and only on demand', () => {
    let calls8 = 0;
    let calls16 = 0;
    const occupancy = new AdaptiveOccupancy(
      createMask(4),
      () => {
        calls8 += 1;
        return createMask(8);
      },
      () => {
        calls16 += 1;
        return createMask(16);
      },
    );

    expect(occupancy.materializedResolutions()).toEqual([4]);
    occupancy.getMask(8);
    occupancy.getMask(8);
    expect(calls8).toBe(1);
    expect(calls16).toBe(0);
    expect(occupancy.materializedResolutions()).toEqual([4, 8]);

    occupancy.getMask(16);
    occupancy.getMask(16);
    expect(calls16).toBe(1);
    expect(occupancy.materializedResolutions()).toEqual([4, 8, 16]);
  });
});
