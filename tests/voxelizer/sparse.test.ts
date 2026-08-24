import { describe, expect, it } from 'vitest';
import { createSphereMesh } from '../../packages/mesh/src/index.js';

import {
  createSparseCellOccupancy,
  createSparseCellSolidOccupancy,
  decodeSparseCellKey,
  getMeshOrientationSign,
  getSparseCellTriangles,
  mirrorMask,
  popcountMask,
  rasterizeSparseCellMask16,
  rasterizeSparseSurface,
} from '../../packages/voxelizer/src/index.js';

function mesh(positions: readonly number[], indices: readonly number[]) {
  return {
    indices: Uint32Array.from(indices),
    positions: Float32Array.from(positions),
  };
}

describe('sparse surface rasterizer', () => {
  it('stores only intersected cells and materializes a local 16³ mask lazily', () => {
    const triangle = mesh(
      [0.1, 0.1, 0.5, 0.9, 0.1, 0.5, 0.1, 0.9, 0.5],
      [0, 1, 2],
    );
    const surface = rasterizeSparseSurface(triangle);

    expect(surface.cellCount).toBe(1);
    expect(Array.from(surface.cellX)).toEqual([0]);
    expect(Array.from(surface.cellY)).toEqual([0]);
    expect(Array.from(surface.cellZ)).toEqual([0]);
    expect(Array.from(getSparseCellTriangles(surface, 0))).toEqual([0]);
    expect(decodeSparseCellKey(surface.cellKeys[0]!)).toEqual([0, 0, 0]);

    const mask16 = rasterizeSparseCellMask16(triangle, surface, 0);
    expect(popcountMask(mask16)).toBeGreaterThan(0);
    const occupancy = createSparseCellOccupancy(triangle, surface, 0);
    expect(occupancy.isMaterialized(16)).toBe(false);
    expect(popcountMask(occupancy.getMask(16))).toBe(popcountMask(mask16));
  });

  it('keeps deterministic triangle postings for shared and negative cells', () => {
    const triangles = mesh(
      [
        -0.9, -0.9, -0.5,
        -0.1, -0.9, -0.5,
        -0.9, -0.1, -0.5,
        -0.8, -0.8, -0.25,
        -0.2, -0.8, -0.25,
        -0.8, -0.2, -0.25,
      ],
      [0, 1, 2, 3, 4, 5],
    );
    const first = rasterizeSparseSurface(triangles);
    const second = rasterizeSparseSurface(triangles);

    expect(first.cellCount).toBe(1);
    expect(decodeSparseCellKey(first.cellKeys[0]!)).toEqual([-1, -1, -1]);
    expect(Array.from(getSparseCellTriangles(first, 0))).toEqual([0, 1]);
    expect(Array.from(second.cellKeys)).toEqual(Array.from(first.cellKeys));
    expect(Array.from(second.triangleIndices)).toEqual(Array.from(first.triangleIndices));
  });

  it('scales with projected triangle area instead of its 3D bounding-box volume', () => {
    const diagonal = mesh(
      [0.25, 0.25, 0.25, 100.25, 0.25, 100.25, 0.25, 100.25, 100.25],
      [0, 1, 2],
    );
    const surface = rasterizeSparseSurface(diagonal);

    expect(surface.cellCount).toBeGreaterThan(1_000);
    expect(surface.cellCount).toBeLessThan(25_000);
    expect(surface.cellCount).toBeLessThan(101 ** 3 / 20);
  });

  it('classifies the solid side of a sphere independently of triangle-sheet diagonals', () => {
    const sphere = createSphereMesh({ latitudeSegments: 12, longitudeSegments: 16, radius: 2 });
    const surface = rasterizeSparseSurface(sphere);
    const orientation = getMeshOrientationSign(sphere, surface);
    expect(orientation).not.toBe(0);
    const cells = new Map(Array.from({ length: surface.cellCount }, (_value, cell) => [
      `${surface.cellX[cell]},${surface.cellY[cell]},${surface.cellZ[cell]}`,
      cell,
    ]));
    let compared = 0;
    for (let cell = 0; cell < surface.cellCount; cell += 1) {
      const reflected = cells.get(
        `${-1 - (surface.cellX[cell] ?? 0)},${surface.cellY[cell]},${surface.cellZ[cell]}`,
      );
      if (reflected === undefined) continue;
      const left = createSparseCellSolidOccupancy(sphere, surface, cell, orientation).getMask(16);
      const right = createSparseCellSolidOccupancy(sphere, surface, reflected, orientation).getMask(16);
      expect(Array.from(right)).toEqual(Array.from(mirrorMask(left, 16, 'x')));
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('keeps an open offset surface in triangle-sheet mode', () => {
    const open = mesh([0, 0, 2, 1, 0, 2, 0, 1, 2], [0, 1, 2]);
    const surface = rasterizeSparseSurface(open);
    expect(getMeshOrientationSign(open, surface)).toBe(0);
    const sheet = createSparseCellOccupancy(open, surface, 0).getMask(16);
    const guardedSolid = createSparseCellSolidOccupancy(open, surface, 0).getMask(16);
    expect(Array.from(guardedSolid)).toEqual(Array.from(sheet));
  });

  it('reports degenerate triangles without allocating cells', () => {
    const degenerate = mesh([0, 0, 0, 1, 1, 1, 2, 2, 2], [0, 1, 2]);
    const surface = rasterizeSparseSurface(degenerate);
    expect(surface.cellCount).toBe(0);
    expect(surface.skippedDegenerateTriangles).toBe(1);
    expect(surface.triangleIndices).toHaveLength(0);
  });
});
