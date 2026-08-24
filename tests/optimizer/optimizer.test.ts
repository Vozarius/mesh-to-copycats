import { describe, expect, it } from 'vitest';
import { createSphereMesh } from '../../packages/mesh/src/index.js';

import {
  createGeometryOptimizer,
  type OptimizeCellResult,
} from '../../packages/optimizer/src/index.js';
import {
  getFixtureCatalog,
  type PackedShapeCatalog,
  type ShapeState,
} from '../../packages/shapes/src/index.js';
import {
  QualityMode,
  ShapeFamily,
} from '../../packages/shared/src/index.js';
import {
  AdaptiveOccupancy,
  bitIndex,
  createMask,
  createSparseCellSolidOccupancy,
  getMeshOrientationSign,
  popcount32,
  rasterizeSparseSurface,
  DESCRIPTOR,
  mirrorMask,
  maskToHex,
  rotateMaskYClockwise,
  setBit,
} from '../../packages/voxelizer/src/index.js';

const BYTE_PART_KEYS = [
  'bottom_northwest',
  'bottom_northeast',
  'top_northwest',
  'top_northeast',
  'bottom_southwest',
  'bottom_southeast',
  'top_southwest',
  'top_southeast',
] as const;

const BOARD_PART_KEYS = ['down', 'up', 'north', 'south', 'west', 'east'] as const;

interface FixtureExpectation {
  readonly blockId: string;
  readonly expectedFamily: ShapeFamily;
  readonly expectedState?: string;
  readonly state: ShapeState;
}

const catalog = getFixtureCatalog();
const qualityOptimizer = createGeometryOptimizer({
  catalog,
  settings: { qualityMode: QualityMode.QUALITY },
});

function byteState(mask: number): ShapeState {
  return Object.fromEntries(
    BYTE_PART_KEYS.map((key, bit) => [key, (mask & (1 << bit)) !== 0]),
  );
}

function boardState(mask: number): ShapeState {
  return Object.fromEntries(
    BOARD_PART_KEYS.map((key, bit) => [key, (mask & (1 << bit)) !== 0]),
  );
}

function requireShapeId(
  sourceCatalog: PackedShapeCatalog,
  blockId: string,
  state: ShapeState,
): number {
  const shapeId = sourceCatalog.findShapeId(blockId, state);
  if (shapeId === undefined) {
    throw new Error(`Missing fixture shape ${blockId}${JSON.stringify(state)}`);
  }
  return shapeId;
}

function optimizeFixture(expectation: FixtureExpectation): {
  readonly result: OptimizeCellResult;
  readonly shapeId: number;
} {
  const shapeId = requireShapeId(catalog, expectation.blockId, expectation.state);
  const geometryId = catalog.shapeGeometry[shapeId];
  if (geometryId === undefined) throw new Error('Fixture has no geometry id');
  const occupancy = AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16));
  return {
    result: qualityOptimizer.optimizeCell({ occupancy }),
    shapeId,
  };
}

const deterministicFixtures: readonly FixtureExpectation[] = [
  { blockId: 'fixture:air', expectedFamily: ShapeFamily.AIR, expectedState: '', state: {} },
  {
    blockId: 'fixture:full_cube',
    expectedFamily: ShapeFamily.FULL_CUBE,
    expectedState: '',
    state: {},
  },
  {
    blockId: 'fixture:copycat_slab',
    expectedFamily: ShapeFamily.SLAB,
    expectedState: '[axis=y,type=bottom]',
    state: { axis: 'y', type: 'bottom' },
  },
  {
    blockId: 'fixture:copycat_slab',
    expectedFamily: ShapeFamily.SLAB,
    expectedState: '[axis=y,type=top]',
    state: { axis: 'y', type: 'top' },
  },
  {
    blockId: 'fixture:copycat_stairs',
    expectedFamily: ShapeFamily.STAIRS,
    expectedState: '[facing=south,half=bottom,shape=straight]',
    state: { facing: 'south', half: 'bottom', shape: 'straight' },
  },
  {
    blockId: 'fixture:copycat_stairs',
    expectedFamily: ShapeFamily.STAIRS,
    expectedState: '[facing=east,half=top,shape=inner_left]',
    state: { facing: 'east', half: 'top', shape: 'inner_left' },
  },
  {
    blockId: 'fixture:copycat_vertical_stairs',
    expectedFamily: ShapeFamily.VERTICAL_STAIRS,
    expectedState:
      '[facing=east,side=left,vertical_stair_shape=outer_bottom]',
    state: {
      facing: 'east',
      side: 'left',
      vertical_stair_shape: 'outer_bottom',
    },
  },
  {
    blockId: 'fixture:copycat_half_layer',
    expectedFamily: ShapeFamily.HALF_LAYER,
    state: {
      axis: 'x',
      half: 'bottom',
      negative_layers: 0,
      positive_layers: 1,
    },
  },
  {
    blockId: 'fixture:copycat_byte',
    expectedFamily: ShapeFamily.BYTE,
    state: byteState(0x69),
  },
  {
    blockId: 'fixture:copycat_byte_panel',
    expectedFamily: ShapeFamily.BYTE_PANEL,
    state: {
      bottom_left: false,
      bottom_right: false,
      facing: 'down',
      top_left: false,
      top_right: true,
    },
  },
  {
    blockId: 'fixture:copycat_board',
    expectedFamily: ShapeFamily.BOARD,
    state: boardState(0x01),
  },
  {
    blockId: 'fixture:copycat_board',
    expectedFamily: ShapeFamily.BOARD,
    state: boardState(0x15),
  },
  {
    blockId: 'fixture:copycat_slice',
    expectedFamily: ShapeFamily.SLICE,
    expectedState: '[facing=east,half=top,layers=3]',
    state: { facing: 'east', half: 'top', layers: 3 },
  },
  {
    blockId: 'fixture:copycat_vertical_slice',
    expectedFamily: ShapeFamily.VERTICAL_SLICE,
    expectedState: '[facing=west,layers=3]',
    state: { facing: 'west', layers: 3 },
  },
  {
    blockId: 'fixture:copycat_corner_slice',
    expectedFamily: ShapeFamily.CORNER_SLICE,
    expectedState: '[facing=north,half=bottom,layers=3]',
    state: { facing: 'north', half: 'bottom', layers: 3 },
  },
];

describe('deterministic fixture optimization', () => {
  it.each(deterministicFixtures)(
    'fits $blockId $state with exact geometry',
    (expectation) => {
      const { result, shapeId } = optimizeFixture(expectation);
      const targetGeometryId = catalog.shapeGeometry[shapeId];
      if (targetGeometryId === undefined) throw new Error('Fixture has no target geometry');

      expect(result.best.geometryError).toBe(0);
      expect(result.best.missingCount).toBe(0);
      expect(result.best.extraCount).toBe(0);
      expect(result.best.geometryKey).toBe(catalog.geometryKeys[targetGeometryId]);
      expect(result.best.equivalentShapeIds).toContain(shapeId);
      expect(result.best.family).toBe(expectation.expectedFamily);
      if (expectation.expectedState !== undefined) {
        expect(result.best.state).toBe(expectation.expectedState);
      }
      expect(result.debug.candidatesGenerated).toBeGreaterThan(0);
      expect(result.debug.afterMask4).toBeGreaterThan(0);
    },
  );

  it.each([1, 2, 3, 4, 5, 6, 7])(
    'fits a downward %i/8 layer exactly',
    (layers) => {
      const expectation: FixtureExpectation = {
        blockId: 'fixture:copycat_layer',
        expectedFamily: layers === 4 ? ShapeFamily.SLAB : ShapeFamily.LAYER,
        state: { facing: 'down', layers },
      };
      const { result, shapeId } = optimizeFixture(expectation);
      expect(result.best.geometryError).toBe(0);
      expect(result.best.equivalentShapeIds).toContain(shapeId);
      expect(result.best.family).toBe(expectation.expectedFamily);
    },
  );

  it('retains a single-octant BYTE realization even when a simpler exact form wins', () => {
    const expectation: FixtureExpectation = {
      blockId: 'fixture:copycat_byte',
      expectedFamily: ShapeFamily.CORNER_SLICE,
      state: byteState(0x01),
    };
    const { result, shapeId } = optimizeFixture(expectation);
    expect(result.best.geometryError).toBe(0);
    expect(result.best.family).toBe(ShapeFamily.CORNER_SLICE);
    expect(result.best.equivalentShapeIds).toContain(shapeId);
    expect(result.best.parts).toHaveLength(1);
  });

  it('returns byte-for-byte deterministic results for repeated input', () => {
    const shapeId = requireShapeId(catalog, 'fixture:copycat_stairs', {
      facing: 'west',
      half: 'top',
      shape: 'outer_right',
    });
    const geometryId = catalog.shapeGeometry[shapeId];
    if (geometryId === undefined) throw new Error('Fixture has no geometry id');
    const mask16 = catalog.getGeometryMask(geometryId, 16);

    const first = qualityOptimizer.optimizeCell({
      occupancy: AdaptiveOccupancy.fromMask16(mask16),
    });
    const second = qualityOptimizer.optimizeCell({
      occupancy: AdaptiveOccupancy.fromMask16(mask16),
    });
    expect(second).toEqual(first);
  });
});

describe('adaptive refinement', () => {
  it('never leaves a requested surface voxel uncovered in coverage mode', () => {
    const mask16 = createMask(16);
    setBit(mask16, bitIndex(16, 3, 7, 11));
    const result = qualityOptimizer.optimizeCell({
      excludeAir: true,
      occupancy: AdaptiveOccupancy.fromMask16(mask16),
      requireCoverage: true,
    });

    expect(result.best.family).not.toBe(ShapeFamily.AIR);
    expect(result.best.missingCount).toBe(0);
  });

  it('stops at 4³ for AIR, at 8³ for a clear layer, and uses 16³ for a board alias', () => {
    const balanced = createGeometryOptimizer({
      catalog,
      settings: { qualityMode: QualityMode.BALANCED },
    });

    function optimizeAt(blockId: string, state: ShapeState): {
      readonly occupancy: AdaptiveOccupancy;
      readonly result: OptimizeCellResult;
    } {
      const shapeId = requireShapeId(catalog, blockId, state);
      const geometryId = catalog.shapeGeometry[shapeId];
      if (geometryId === undefined) throw new Error('Fixture has no geometry id');
      const occupancy = AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16));
      return { occupancy, result: balanced.optimizeCell({ occupancy }) };
    }

    const air = optimizeAt('fixture:air', {});
    expect(air.result.usedResolution).toBe(4);
    expect(air.occupancy.materializedResolutions()).toEqual([4]);

    const clearLayer = optimizeAt('fixture:copycat_layer', { facing: 'down', layers: 3 });
    expect(clearLayer.result.usedResolution).toBe(8);
    expect(clearLayer.occupancy.materializedResolutions()).toEqual([4, 8]);

    const board = optimizeAt('fixture:copycat_board', boardState(0x01));
    expect(board.result.usedResolution).toBe(16);
    expect(board.occupancy.materializedResolutions()).toEqual([4, 8, 16]);
    expect(board.result.debug.refinementReasons).toContain('mask8-tie');
  });

  it('honors QUALITY and an explicit high-complexity descriptor despite a clear 4^3 winner', () => {
    const shapeId = requireShapeId(
      catalog,
      'fixture:copycat_board',
      boardState(0x12),
    );
    const geometryId = catalog.shapeGeometry[shapeId];
    if (geometryId === undefined) throw new Error('Fixture has no geometry id');
    const mask16 = catalog.getGeometryMask(geometryId, 16);
    const descriptor = catalog.getGeometryDescriptor(geometryId).slice();
    descriptor[DESCRIPTOR.NORMAL_VARIANCE] = 1;

    const balanced = createGeometryOptimizer({
      catalog,
      settings: {
        complexityThreshold: 0.5,
        qualityMode: QualityMode.BALANCED,
      },
    }).optimizeCell({
      descriptor,
      occupancy: AdaptiveOccupancy.fromMask16(mask16),
    });
    expect(balanced.usedResolution).toBe(8);
    expect(balanced.debug.refinementReasons).toContain('surface-complexity');

    const quality = qualityOptimizer.optimizeCell({
      descriptor,
      occupancy: AdaptiveOccupancy.fromMask16(mask16),
    });
    expect(quality.usedResolution).toBe(16);
    expect(quality.best.geometryError).toBe(0);
  });
});

describe('transformed catalog targets', () => {
  const sourceState = {
    facing: 'south',
    half: 'bottom',
    shape: 'inner_left',
  } as const;

  function sourceMask(): Uint32Array {
    const shapeId = requireShapeId(catalog, 'fixture:copycat_stairs', sourceState);
    const geometryId = catalog.shapeGeometry[shapeId];
    if (geometryId === undefined) throw new Error('Fixture has no geometry id');
    return catalog.getGeometryMask(geometryId, 16);
  }

  it('finds an exact rotated stair realization after a 90-degree turn', () => {
    const expectedShapeId = requireShapeId(catalog, 'fixture:copycat_stairs', {
      ...sourceState,
      facing: 'west',
    });
    const result = qualityOptimizer.optimizeCell({
      occupancy: AdaptiveOccupancy.fromMask16(
        rotateMaskYClockwise(sourceMask(), 16),
      ),
    });

    expect(result.best.geometryError).toBe(0);
    expect(result.best.equivalentShapeIds).toContain(expectedShapeId);
  });

  it('finds the corresponding handed stair realization after mirroring', () => {
    const expectedShapeId = requireShapeId(catalog, 'fixture:copycat_stairs', {
      ...sourceState,
      shape: 'inner_right',
    });
    const result = qualityOptimizer.optimizeCell({
      occupancy: AdaptiveOccupancy.fromMask16(
        mirrorMask(sourceMask(), 16, 'x'),
      ),
    });

    expect(result.best.geometryError).toBe(0);
    expect(result.best.equivalentShapeIds).toContain(expectedShapeId);
  });
});

describe('packed batch optimization', () => {
  it('returns deterministic typed-array summaries and progress', () => {
    const geometryIds = [0, 1, Math.min(17, catalog.geometryCount - 1)];
    const progress: number[] = [];
    const batch = qualityOptimizer.optimizeBatch(
      geometryIds.map((geometryId) => ({
        occupancy: AdaptiveOccupancy.fromMask16(
          catalog.getGeometryMask(geometryId, 16),
        ),
        settings: { alternatives: 0 },
      })),
      { onProgress: (completed) => progress.push(completed) },
    );

    expect(batch.geometryIds).toBeInstanceOf(Uint32Array);
    expect(batch.shapeIds).toBeInstanceOf(Uint32Array);
    expect(batch.geometryErrors).toBeInstanceOf(Float32Array);
    expect(Array.from(batch.geometryIds)).toEqual(geometryIds);
    expect(Array.from(batch.geometryErrors)).toEqual([0, 0, 0]);
    expect(progress).toEqual([1, 2, 3]);
    expect(batch.stageTotals.candidatesGenerated).toBeGreaterThan(0);
  });

  it('honors an already-aborted batch signal', () => {
    expect(() => qualityOptimizer.optimizeBatch(
      [{ occupancy: AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(0, 16)) }],
      { signal: { aborted: true } },
    )).toThrow(/aborted after 0 cells/u);
  });
});

describe('catalog-wide exact-target property', () => {
  it('finds a zero-error exact-equivalent geometry for every catalog target', () => {
    for (let geometryId = 0; geometryId < catalog.geometryCount; geometryId += 1) {
      const result = qualityOptimizer.optimizeCell({
        occupancy: AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16)),
        settings: { alternatives: 0 },
      });
      expect(result.best.geometryError, `geometry ${geometryId}`).toBe(0);
      expect(result.best.geometryKey, `geometry ${geometryId}`).toBe(
        catalog.geometryKeys[geometryId],
      );
    }
  });
});

describe('Copycats geometry allow-list', () => {
  it('returns the nearest selected geometry when no selected state covers the target', () => {
    const byteShape = requireShapeId(catalog, 'fixture:copycat_byte', byteState(1));
    const byteGeometry = catalog.shapeGeometry[byteShape]!;
    const fullShape = requireShapeId(catalog, 'fixture:full_cube', {});
    const fullGeometry = catalog.shapeGeometry[fullShape]!;
    const allowedGeometryIds = new Uint8Array(catalog.geometryCount);
    allowedGeometryIds[byteGeometry] = 1;

    const result = qualityOptimizer.optimizeCell({
      allowedGeometryIds,
      excludeAir: true,
      occupancy: AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(fullGeometry, 16)),
      requireCoverage: true,
    });

    expect(result.best.geometryId).toBe(byteGeometry);
    expect(result.best.missingCount).toBeGreaterThan(0);
  });
  it('matches the GRID16 brute-force optimum for Byte-only targets', () => {
    const allowedGeometryIds = new Uint8Array(catalog.geometryCount);
    const byteGeometryIds: number[] = [];
    for (let geometryId = 0; geometryId < catalog.geometryCount; geometryId += 1) {
      if (!Array.from(catalog.getRealizationShapeIds(geometryId)).some(
        (shapeId) => catalog.shapeFamily[shapeId] === ShapeFamily.BYTE,
      )) continue;
      allowedGeometryIds[geometryId] = 1;
      byteGeometryIds.push(geometryId);
    }
    let seed = 0x5eed_1234;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    for (let sample = 0; sample < 16; sample += 1) {
      const target = createMask(16);
      for (let bit = 0; bit < 4096; bit += 1) {
        if (random() % 100 < 35) setBit(target, bit);
      }
      const result = qualityOptimizer.optimizeCell({
        allowedGeometryIds,
        excludeAir: true,
        occupancy: AdaptiveOccupancy.fromMask16(target),
      });
      const error = (geometryId: number): number => {
        const candidate = catalog.getGeometryMask(geometryId, 16);
        let missing = 0;
        let extra = 0;
        let union = 0;
        for (let word = 0; word < target.length; word += 1) {
          missing += popcount32((target[word] ?? 0) & ~(candidate[word] ?? 0));
          extra += popcount32((candidate[word] ?? 0) & ~(target[word] ?? 0));
          union += popcount32((target[word] ?? 0) | (candidate[word] ?? 0));
        }
        return (missing + extra) / Math.max(1, union);
      };
      const bruteForceError = Math.min(...byteGeometryIds.map(error));
      expect(error(result.best.geometryId)).toBeCloseTo(bruteForceError, 12);
    }
  });


  it('keeps Byte-only solutions reflection-equivariant', () => {
    const byteShape = requireShapeId(catalog, 'fixture:copycat_byte', byteState(0b0010_1101));
    const sourceGeometry = catalog.shapeGeometry[byteShape] ?? 0;
    const sourceMask = catalog.getGeometryMask(sourceGeometry, 16);
    const mirroredTarget = mirrorMask(sourceMask, 16, 'x');
    const allowedGeometryIds = new Uint8Array(catalog.geometryCount);
    for (let geometryId = 0; geometryId < catalog.geometryCount; geometryId += 1) {
      if (Array.from(catalog.getRealizationShapeIds(geometryId)).some(
        (shapeId) => catalog.shapeFamily[shapeId] === ShapeFamily.BYTE,
      )) allowedGeometryIds[geometryId] = 1;
    }

    const original = qualityOptimizer.optimizeCell({
      allowedGeometryIds,
      excludeAir: true,
      occupancy: AdaptiveOccupancy.fromMask16(sourceMask),
    });
    const mirrored = qualityOptimizer.optimizeCell({
      allowedGeometryIds,
      excludeAir: true,
      occupancy: AdaptiveOccupancy.fromMask16(mirroredTarget),
    });

    expect(Array.from(catalog.getGeometryMask(mirrored.best.geometryId, 16))).toEqual(
      Array.from(mirrorMask(catalog.getGeometryMask(original.best.geometryId, 16), 16, 'x')),
    );
    expect(original.best.missingCount).toBe(0);
    expect(mirrored.best.missingCount).toBe(0);
  });

  it('keeps closed-sphere choices reflection-equivariant with the full catalog', () => {
    const sphere = createSphereMesh({ latitudeSegments: 12, longitudeSegments: 16, radius: 2 });
    const surface = rasterizeSparseSurface(sphere);
    const orientation = getMeshOrientationSign(sphere, surface);
    const geometryByMask = new Map(Array.from({ length: catalog.geometryCount }, (_unused, geometryId) => [
      maskToHex(catalog.getGeometryMask(geometryId, 16)), geometryId,
    ]));
    const allowedGeometryIds = new Uint8Array(catalog.geometryCount);
    for (let geometryId = 0; geometryId < catalog.geometryCount; geometryId += 1) {
      const reflected = mirrorMask(catalog.getGeometryMask(geometryId, 16), 16, 'x');
      if (geometryByMask.has(maskToHex(reflected))) allowedGeometryIds[geometryId] = 1;
    }
    const cells = new Map(Array.from({ length: surface.cellCount }, (_unused, cell) => [
      `${surface.cellX[cell]},${surface.cellY[cell]},${surface.cellZ[cell]}`,
      cell,
    ]));
    let compared = 0;
    for (let cell = 0; cell < surface.cellCount && compared < 24; cell += 1) {
      const reflected = cells.get(
        `${-1 - (surface.cellX[cell] ?? 0)},${surface.cellY[cell]},${surface.cellZ[cell]}`,
      );
      if (reflected === undefined) continue;
      const original = qualityOptimizer.optimizeCell({
        allowedGeometryIds,
        excludeAir: true,
        occupancy: createSparseCellSolidOccupancy(sphere, surface, cell, orientation),
      });
      const mirrored = qualityOptimizer.optimizeCell({
        allowedGeometryIds,
        excludeAir: true,
        occupancy: createSparseCellSolidOccupancy(sphere, surface, reflected, orientation),
      });
      expect(
        Array.from(catalog.getGeometryMask(mirrored.best.geometryId, 16)),
        `cell ${surface.cellX[cell]},${surface.cellY[cell]},${surface.cellZ[cell]}: ${original.best.geometryId}/${original.best.missingCount}/${original.best.extraCount} -> ${mirrored.best.geometryId}/${mirrored.best.missingCount}/${mirrored.best.extraCount}`,
      ).toEqual(
        Array.from(mirrorMask(catalog.getGeometryMask(original.best.geometryId, 16), 16, 'x')),
      );
      compared++;
    }
    expect(compared).toBe(24);
  });

  it('rejects an allow-list with the wrong catalog size', () => {
    expect(() => qualityOptimizer.optimizeCell({
      allowedGeometryIds: new Uint8Array(1),
      occupancy: AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(0, 16)),
    })).toThrow(/allowed geometry mask size/iu);
  });
});
