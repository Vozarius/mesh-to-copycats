import { describe, expect, it } from 'vitest';

import { createSphereMesh, finalizeMesh } from '../../packages/mesh/src/index.js';
import {
  optimizeMesh,
  optimizeMeshProgressive,
} from '../../packages/pipeline/src/index.js';
import { getFixtureCatalog } from '../../packages/shapes/src/index.js';

function twoCellMesh() {
  return finalizeMesh({
    indices: [0, 1, 2, 3, 4, 5],
    materialNames: ['surface'],
    positions: [
      0.1, 0.1, 0.5,
      0.9, 0.1, 0.5,
      0.1, 0.9, 0.5,
      1.1, 0.1, 0.5,
      1.9, 0.1, 0.5,
      1.1, 0.9, 0.5,
    ],
    triangleMaterials: [0, 0],
  });
}

describe('sparse optimization pipeline', () => {
  it('returns a deterministic packed optimized grid', () => {
    const catalog = getFixtureCatalog();
    const first = optimizeMesh({ batchSize: 1, catalog, mesh: twoCellMesh() });
    const second = optimizeMesh({ batchSize: 2, catalog, mesh: twoCellMesh() });

    expect(first.surface.cellCount).toBe(2);
    expect(Array.from(first.surface.cellX)).toEqual([0, 1]);
    expect(Array.from(first.geometryIds)).toEqual(Array.from(second.geometryIds));
    expect(Array.from(first.shapeIds)).toEqual(Array.from(second.shapeIds));
    expect(Array.from(first.usedResolutions)).toEqual(Array.from(second.usedResolutions));
    expect(first.timingsMs.total).toBeGreaterThanOrEqual(0);
  });

  it('uses classic surface voxels when full block is the only enabled geometry', () => {
    const catalog = getFixtureCatalog();
    const fullShape = catalog.findShapeId('fixture:full_cube', {})!;
    const fullGeometry = catalog.shapeGeometry[fullShape]!;
    const allowedGeometryIds = new Uint8Array(catalog.geometryCount);
    allowedGeometryIds[fullGeometry] = 1;
    const result = optimizeMesh({
      allowedGeometryIds,
      catalog,
      mesh: createSphereMesh({ latitudeSegments: 12, longitudeSegments: 16, radius: 3 }),
    });

    expect(result.surface.cellCount).toBeGreaterThan(0);
    expect(Array.from(result.geometryIds).every((geometryId) => geometryId === fullGeometry)).toBe(true);
    const cells = new Set(Array.from({ length: result.surface.cellCount }, (_unused, cell) =>
      `${result.surface.cellX[cell]},${result.surface.cellY[cell]},${result.surface.cellZ[cell]}`));
    expect(cells.has('-3,-3,-3')).toBe(false);
    expect(cells.has('2,2,2')).toBe(false);
  });

  it('yields between batches and reports monotonic progress', async () => {
    const progress: number[] = [];
    let yields = 0;
    const result = await optimizeMeshProgressive({
      batchSize: 1,
      catalog: getFixtureCatalog(),
      mesh: twoCellMesh(),
      onProgress: ({ completed }) => progress.push(completed),
      yieldToHost: async () => {
        yields++;
        await Promise.resolve();
      },
    });

    expect(result.surface.cellCount).toBe(2);
    expect(progress).toEqual([1, 2]);
    expect(yields).toBe(1);
  });

  it('keeps thin planar geometry exact instead of inflating it to Byte octants', () => {
    const catalog = getFixtureCatalog();
    const mesh = finalizeMesh({
      indices: [0, 1, 2, 0, 2, 3],
      materialNames: ['image'],
      positions: [0.1, 0.1, 0.25, 0.9, 0.1, 0.25, 0.9, 0.9, 0.25, 0.1, 0.9, 0.25],
      texcoords: [0, 0, 1, 0, 1, 1, 0, 1],
      triangleMaterials: [0, 0],
    });
    const result = optimizeMesh({
      catalog,
      mesh,
      optimizerSettings: { missingWeight: 1024 },
      preferPlanarByteGeometry: true,
    });
    expect(result.missingCounts[0]).toBe(0);
    expect(result.planarBytePreferred[0]).toBe(0);
    const selectedBlockId = catalog.blockIds[result.shapeIds[0] ?? 0] ?? '';
    expect(selectedBlockId).not.toContain('air');
    expect(selectedBlockId).not.toContain('copycat_byte');
  });

  it('expands an imported image plane to independently materialized Byte octants', () => {
    const catalog = getFixtureCatalog();
    const mesh = finalizeMesh({
      indices: [0, 1, 2, 0, 2, 3],
      materialNames: ['image'],
      positions: [0.1, 0.1, 0.25, 0.9, 0.1, 0.25, 0.9, 0.9, 0.25, 0.1, 0.9, 0.25],
      texcoords: [0, 0, 1, 0, 1, 1, 0, 1],
      triangleMaterials: [0, 0],
    });
    const result = optimizeMesh({
      catalog,
      expandPlanarImageOctants: true,
      mesh,
      optimizerSettings: { extraWeight: 1, missingWeight: 1 },
      preferPlanarByteGeometry: true,
    });

    expect(result.planarBytePreferred[0]).toBe(1);
    expect(result.missingCounts[0]).toBe(0);
    expect(Array.from(catalog.getRealizationShapeIds(result.geometryIds[0] ?? 0))
      .map((shapeId) => catalog.blockIds[shapeId])).toContain('fixture:copycat_byte');
  });
});
