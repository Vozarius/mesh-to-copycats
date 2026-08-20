import { describe, expect, it } from 'vitest';

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
  DESCRIPTOR,
  mirrorMask,
  rotateMaskYClockwise,
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
