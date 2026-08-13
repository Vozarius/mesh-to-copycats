import { describe, expect, it } from 'vitest';

import {
  AIR_OWNER,
  ShapeFamily,
  type Aabb16,
} from '../../packages/shared/src/index.js';
import {
  bitIndex,
  getBit,
} from '../../packages/voxelizer/src/index.js';
import {
  UnsupportedExactGeometryError,
  box16,
  buildShapeCatalog,
  exactGeometryKeyFromAabbs,
  getFixtureCatalog,
  type ShapeDefinitionInput,
} from '../../packages/shapes/src/index.js';

const FULL_BOX = box16(0, 0, 0, 16, 16, 16);

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

function byteState(mask: number): Readonly<Record<string, boolean>> {
  return Object.fromEntries(
    BYTE_PART_KEYS.map((key, bit) => [key, (mask & (1 << bit)) !== 0]),
  );
}

function twoRealizations(): ShapeDefinitionInput[] {
  const lower = box16(0, 0, 0, 16, 8, 16);
  const upper = box16(0, 8, 0, 16, 16, 16);
  return [
    {
      blockId: 'test:ordinary_full',
      boxes: [FULL_BOX],
      complexity: 0,
      family: ShapeFamily.FULL_CUBE,
      familyPriority: 0,
      stableId: 'ordinary',
      state: {},
    },
    {
      blockId: 'test:multipart_full',
      boxes: [lower, upper],
      complexity: 4,
      family: ShapeFamily.BYTE,
      familyPriority: 10,
      parts: [
        { boxes: [lower], key: 'lower', materialSlot: 0 },
        { boxes: [upper], key: 'upper', materialSlot: 1 },
      ],
      stableId: 'multipart',
      state: { lower: true, upper: true },
    },
  ];
}

describe('exact integer-grid geometry identities', () => {
  it('is invariant to box order, splitting, and redundant overlaps', () => {
    const lower = box16(0, 0, 0, 16, 8, 16);
    const upper = box16(0, 8, 0, 16, 16, 16);
    const redundantInterior = box16(3, 3, 3, 13, 13, 13);

    const wholeKey = exactGeometryKeyFromAabbs([FULL_BOX]);
    expect(exactGeometryKeyFromAabbs([lower, upper])).toBe(wholeKey);
    expect(exactGeometryKeyFromAabbs([upper, lower])).toBe(wholeKey);
    expect(exactGeometryKeyFromAabbs([FULL_BOX, redundantInterior])).toBe(wholeKey);
  });

  it('distinguishes exact shapes that happen to be close geometrically', () => {
    const thicknessOne = exactGeometryKeyFromAabbs([box16(0, 0, 0, 16, 1, 16)]);
    const thicknessTwo = exactGeometryKeyFromAabbs([box16(0, 0, 0, 16, 2, 16)]);
    expect(thicknessOne).not.toBe(thicknessTwo);
  });

  it.each([
    [[box16(0.5, 0, 0, 16, 16, 16)]],
    [[box16(-1, 0, 0, 16, 16, 16)]],
    [[box16(0, 0, 0, 17, 16, 16)]],
    [[box16(2, 0, 0, 2, 16, 16)]],
  ] satisfies ReadonlyArray<readonly [readonly Aabb16[]]>)('rejects unsupported AABBs %#', (boxes) => {
    expect(() => exactGeometryKeyFromAabbs(boxes)).toThrow(
      UnsupportedExactGeometryError,
    );
  });
});

describe('packed catalog realizations and part ownership', () => {
  it('deduplicates solid geometry without losing multipart realizations', () => {
    const catalog = buildShapeCatalog(twoRealizations());
    const ordinaryId = catalog.findShapeId('test:ordinary_full', {});
    const multipartId = catalog.findShapeId('test:multipart_full', {
      lower: true,
      upper: true,
    });
    if (ordinaryId === undefined || multipartId === undefined) {
      throw new Error('Test catalog lookup failed');
    }

    expect(catalog.shapeCount).toBe(2);
    expect(catalog.geometryCount).toBe(1);
    expect(catalog.shapeGeometry[ordinaryId]).toBe(0);
    expect(catalog.shapeGeometry[multipartId]).toBe(0);
    expect(Array.from(catalog.getRealizationShapeIds(0))).toEqual(
      [ordinaryId, multipartId].sort((left, right) => left - right),
    );
    expect(catalog.geometryRepresentativeShape[0]).toBe(ordinaryId);

    expect(catalog.getShapeParts(ordinaryId)).toEqual([
      expect.objectContaining({ key: 'material', materialSlot: 0, partId: 0 }),
    ]);
    expect(catalog.getShapeParts(multipartId)).toEqual([
      expect.objectContaining({ key: 'lower', materialSlot: 0, partId: 0 }),
      expect.objectContaining({ key: 'upper', materialSlot: 1, partId: 1 }),
    ]);

    expect(catalog.getOwnerGrid16(ordinaryId)).toBeUndefined();
    const owners = catalog.getOwnerGrid16(multipartId);
    if (owners === undefined) throw new Error('Multipart owner grid was not generated');
    expect(owners).toHaveLength(4096);
    expect(owners[bitIndex(16, 0, 0, 0)]).toBe(0);
    expect(owners[bitIndex(16, 15, 7, 15)]).toBe(0);
    expect(owners[bitIndex(16, 0, 8, 0)]).toBe(1);
    expect(owners[bitIndex(16, 15, 15, 15)]).toBe(1);
    expect(owners.includes(AIR_OWNER)).toBe(false);
  });

  it('rejects a multipart realization with occupied voxels owned by no part', () => {
    const southwest = box16(0, 0, 0, 8, 8, 8);
    const northeast = box16(8, 8, 8, 16, 16, 16);
    const invalid: ShapeDefinitionInput = {
      blockId: 'test:unowned',
      boxes: [FULL_BOX],
      complexity: 2,
      family: ShapeFamily.BYTE,
      parts: [
        { boxes: [southwest], key: 'southwest', materialSlot: 0 },
        { boxes: [northeast], key: 'northeast', materialSlot: 1 },
      ],
      state: {},
    };

    expect(() => buildShapeCatalog([invalid])).toThrow(/unowned occupied voxel/u);
  });

  it('builds deterministic ids and packed arrays independently of input order', () => {
    const definitions = twoRealizations();
    const forward = buildShapeCatalog(definitions);
    const reverse = buildShapeCatalog([...definitions].reverse());

    expect(forward.geometryKeys).toEqual(reverse.geometryKeys);
    expect(forward.blockIds).toEqual(reverse.blockIds);
    expect(forward.states).toEqual(reverse.states);
    expect(Array.from(forward.masks4)).toEqual(Array.from(reverse.masks4));
    expect(Array.from(forward.masks8)).toEqual(Array.from(reverse.masks8));
    expect(Array.from(forward.masks16)).toEqual(Array.from(reverse.masks16));
    expect(Array.from(forward.geometryRealizations)).toEqual(
      Array.from(reverse.geometryRealizations),
    );
  });

  it('preserves all eight independently materialized BYTE parts', () => {
    const catalog = getFixtureCatalog();
    const byteId = catalog.findShapeId('fixture:copycat_byte', byteState(0xff));
    if (byteId === undefined) throw new Error('Full BYTE fixture is missing');

    const parts = catalog.getShapeParts(byteId);
    expect(parts).toHaveLength(8);
    expect(parts.map(({ key }) => key)).toEqual(BYTE_PART_KEYS);
    expect(parts.map(({ materialSlot }) => materialSlot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);

    const geometryId = catalog.shapeGeometry[byteId];
    if (geometryId === undefined) throw new Error('BYTE geometry id is missing');
    const realizations = Array.from(catalog.getRealizationShapeIds(geometryId));
    expect(realizations).toContain(byteId);
    expect(catalog.getShapeMetadata(catalog.geometryRepresentativeShape[geometryId]!)).toEqual(
      expect.objectContaining({ blockId: 'fixture:full_cube', family: ShapeFamily.FULL_CUBE }),
    );

    const owners = catalog.getOwnerGrid16(byteId);
    if (owners === undefined) throw new Error('BYTE owner grid is missing');
    const geometryMask = catalog.getGeometryMask(geometryId, 16);
    for (let z = 0; z < 16; z += 1) {
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          const index = bitIndex(16, x, y, z);
          expect(getBit(geometryMask, index)).toBe(true);
          const expectedOwner = (x >= 8 ? 1 : 0) | (y >= 8 ? 2 : 0) | (z >= 8 ? 4 : 0);
          expect(owners[index]).toBe(expectedOwner);
        }
      }
    }
  });
});
