import { describe, expect, it } from 'vitest';

import { finalizeMesh } from '../../packages/mesh/src/index.js';
import {
  createMaterialPalette,
  extractSurfaceSamples,
  filterMaterialPalette,
  linearSrgbToOklab,
  loadGeneratedMaterialPalette,
  resolveMaterials,
  srgbToOklab,
} from '../../packages/palette/src/index.js';
import { getFixtureCatalog } from '../../packages/shapes/src/index.js';
import { rasterizeSparseSurface } from '../../packages/voxelizer/src/index.js';

describe('OKLab material profiles', () => {
  it('converts linear and encoded sRGB deterministically', () => {
    expect(linearSrgbToOklab([0, 0, 0])).toEqual([0, 0, 0]);
    const white = srgbToOklab([1, 1, 1]);
    expect(white[0]).toBeCloseTo(1, 6);
    expect(white[1]).toBeCloseTo(0, 6);
    expect(white[2]).toBeCloseTo(0, 6);
    const red = srgbToOklab([1, 0, 0]);
    expect(red[0]).toBeCloseTo(0.627955, 5);
    expect(red[1]).toBeCloseTo(0.224863, 5);
    expect(red[2]).toBeCloseTo(0.125846, 5);
  });

  it('extracts bounded weighted samples with source material colors', () => {
    const mesh = finalizeMesh({
      indices: [0, 1, 2, 3, 4, 5],
      materialBaseColorsLinear: [1, 0, 0, 1, 0, 0, 1, 1],
      materialNames: ['red', 'blue'],
      positions: [
        0.1, 0.1, 0.5, 0.9, 0.1, 0.5, 0.1, 0.9, 0.5,
        1.1, 0.1, 0.5, 1.9, 0.1, 0.5, 1.1, 0.9, 0.5,
      ],
      triangleMaterials: [0, 1],
    });
    const surface = rasterizeSparseSurface(mesh);
    const samples = extractSurfaceSamples(mesh, surface, { maxSamplesPerCell: 4 });

    expect(surface.cellCount).toBe(2);
    expect(Array.from(samples.cellOffsets)).toEqual([0, 1, 2]);
    expect(Array.from(samples.sourceMaterialIds)).toEqual([0, 1]);
    expect(samples.weights[0]).toBeGreaterThan(0);
    expect(samples.localPositions[0]).toBeGreaterThan(0);
    expect(samples.localPositions[0]).toBeLessThan(1);
    expect(samples.oklab[1]).toBeGreaterThan(0);
    expect(samples.oklab[4]).toBeGreaterThanOrEqual(-0.1);
  });
});

describe('generated material palette', () => {
  it('validates provenance and builds packed color arrays', () => {
    const palette = loadGeneratedMaterialPalette({
      entries: [{
        blockId: 'minecraft:stone',
        canonicalBlockIds: ['minecraft:stone_slab'],
        itemId: 'minecraft:stone',
        previewRgbaBase64: '/wAA/w==',
        previewSize: 1,
        srgb: [0.5, 0.5, 0.5],
      }],
      missing: [],
      schema: 'mesh-to-copycats.material-palette',
      sources: [{ name: 'client.jar', sha256: 'a'.repeat(64) }],
      version: 1,
    });
    expect(palette.size).toBe(1);
    expect(palette.itemIds).toEqual(['minecraft:stone']);
    expect(palette.canonicalBlockIds[0]).toEqual(['minecraft:stone', 'minecraft:stone_slab']);
    expect(palette.oklab).toHaveLength(3);
    expect(Array.from(palette.previewTextureAtlas?.rgbaSrgb ?? [])).toEqual([255, 0, 0, 255]);
  });

  it('re-packs deterministic user material exclusions', () => {
    const palette = createMaterialPalette([
      { blockId: 'minecraft:stone', itemId: 'minecraft:stone', srgb: [0.5, 0.5, 0.5] },
      { blockId: 'minecraft:bricks', itemId: 'minecraft:bricks', preference: 7, srgb: [0.6, 0.3, 0.2] },
    ]);
    const paletteWithTextures = {
      ...palette,
      previewTextureAtlas: {
        heights: Uint16Array.of(1, 1),
        offsets: Uint32Array.of(0, 4, 8),
        rgbaSrgb: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8),
        widths: Uint16Array.of(1, 1),
        wrapS: Uint32Array.of(10497, 10497),
        wrapT: Uint32Array.of(10497, 10497),
      },
    };
    const filtered = filterMaterialPalette(paletteWithTextures, (itemId) => itemId !== 'minecraft:stone');
    expect(filtered.itemIds).toEqual(['minecraft:bricks']);
    expect(filtered.blockIds).toEqual(['minecraft:bricks']);
    expect(filtered.preference[0]).toBe(7);
    expect(Array.from(filtered.previewTextureAtlas?.rgbaSrgb ?? [])).toEqual([5, 6, 7, 8]);
  });
});

describe('post-material realization selection', () => {
  const samples = {
    cellOffsets: Uint32Array.from([0, 1]),
    localPositions: Float32Array.from([0.5, 0.5, 0.5]),
    normals: Int8Array.from([0, 127, 0]),
    oklab: Float32Array.from(srgbToOklab([0.5, 0.5, 0.5])),
    sourceMaterialIds: Uint32Array.from([0]),
    triangleIds: Uint32Array.from([0]),
    uvs: Float32Array.from([Number.NaN, Number.NaN]),
    weights: Float32Array.from([1]),
  };

  it('canonicalizes to an ordinary block only when its material exists', () => {
    const catalog = getFixtureCatalog();
    const fullShape = catalog.findShapeId('fixture:full_cube', {})!;
    const geometryIds = Uint32Array.from([catalog.shapeGeometry[fullShape]!]);
    const palette = createMaterialPalette([{
      blockId: 'fixture:full_cube',
      itemId: 'fixture:full_cube',
      srgb: [0.5, 0.5, 0.5],
    }]);
    const resolved = resolveMaterials({ catalog, geometryIds, palette, samples });

    expect(catalog.blockIds[resolved.shapeIds[0]!]).toBe('fixture:full_cube');
    expect(resolved.invalidCells[0]).toBe(0);
    expect(resolved.paletteIndexes[0]).toBe(0);
    expect(resolved.materialDirections[0]).toBe(4);
    expect(resolved.acceptedMaterialBlockIds[0]).toBe('fixture:full_cube');
  });

  it('keeps an exact-equivalent Copycat when only a copycat material exists', () => {
    const catalog = getFixtureCatalog();
    const fullShape = catalog.findShapeId('fixture:full_cube', {})!;
    const geometryIds = Uint32Array.from([catalog.shapeGeometry[fullShape]!]);
    const palette = createMaterialPalette([{
      blockId: 'minecraft:stone',
      itemId: 'minecraft:stone',
      srgb: [0.5, 0.5, 0.5],
    }]);
    const resolved = resolveMaterials({ catalog, geometryIds, palette, samples });

    expect(catalog.blockIds[resolved.shapeIds[0]!]).toBe('fixture:copycat_block');
    expect(resolved.invalidCells[0]).toBe(0);
    expect(resolved.paletteIndexes[0]).toBe(0);
    expect(resolved.materialDirections[0]).toBe(4);
    expect(resolved.acceptedMaterialBlockIds[0]).toBe('minecraft:stone');
  });

  it('honors a source material lock while retaining realization validation', () => {
    const catalog = getFixtureCatalog();
    const fullShape = catalog.findShapeId('fixture:full_cube', {})!;
    const geometryIds = Uint32Array.from([catalog.shapeGeometry[fullShape]!]);
    const palette = createMaterialPalette([
      { blockId: 'minecraft:stone', itemId: 'minecraft:stone', srgb: [0.5, 0.5, 0.5] },
      { blockId: 'minecraft:red_concrete', itemId: 'minecraft:red_concrete', srgb: [0.8, 0.1, 0.1] },
    ]);
    const resolved = resolveMaterials({
      catalog,
      geometryIds,
      palette,
      samples,
      sourceMaterialPaletteIndexes: Uint32Array.of(1),
    });

    expect(catalog.blockIds[resolved.shapeIds[0]!]).toMatch(/^fixture:copycat_/u);
    expect(resolved.invalidCells[0]).toBe(0);
    expect(Array.from(resolved.paletteIndexes).every((index) => index === 1)).toBe(true);
    expect(resolved.acceptedMaterialBlockIds.every((blockId) => blockId === 'minecraft:red_concrete')).toBe(true);
  });

  it('rejects an out-of-range source material lock', () => {
    const catalog = getFixtureCatalog();
    const fullShape = catalog.findShapeId('fixture:full_cube', {})!;
    const palette = createMaterialPalette([
      { blockId: 'minecraft:stone', itemId: 'minecraft:stone', srgb: [0.5, 0.5, 0.5] },
    ]);
    expect(() => resolveMaterials({
      catalog,
      geometryIds: Uint32Array.of(catalog.shapeGeometry[fullShape]!),
      palette,
      samples,
      sourceMaterialPaletteIndexes: Uint32Array.of(1),
    })).toThrow(/out of range/u);
  });
});
