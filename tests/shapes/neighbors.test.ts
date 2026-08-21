import { describe, expect, it } from 'vitest';

import {
  decodeNeighborTransitions,
  encodeNeighborTransitions,
  getFixtureCatalog,
  PackedNeighborTransitions,
  resolveSparseNeighbors,
} from '../../packages/shapes/src/index.js';

function fixtureTransition(): {
  readonly airShapeId: number;
  readonly centerShapeId: number;
  readonly transitions: PackedNeighborTransitions;
} {
  const catalog = getFixtureCatalog();
  const airShapeId = catalog.blockIds.findIndex((blockId) => blockId === 'fixture:air');
  const centerShapeId = Array.from({ length: catalog.shapeCount }, (_value, shapeId) => shapeId)
    .find((shapeId) => shapeId !== airShapeId)!;
  const shapeOffsets = new Uint32Array(catalog.shapeCount + 1);
  for (let shapeId = centerShapeId + 1; shapeId < shapeOffsets.length; shapeId += 1) shapeOffsets[shapeId] = 1;
  return {
    airShapeId,
    centerShapeId,
    transitions: new PackedNeighborTransitions({
      directions: Uint8Array.of(0),
      neighborShapeIds: Uint32Array.of(airShapeId),
      resolvedGeometryIds: Uint32Array.of(catalog.shapeGeometry[airShapeId] ?? 0),
      resolvedShapeIds: Uint32Array.of(airShapeId),
      shapeOffsets,
    }),
  };
}

describe('packed neighbor transitions', () => {
  it('round-trips a checksummed sparse artifact and resolves until stable', () => {
    const catalog = getFixtureCatalog();
    const fixture = fixtureTransition();
    const encoded = encodeNeighborTransitions(fixture.transitions);
    const decoded = decodeNeighborTransitions(encoded);
    expect(decoded.directions).toEqual(Uint8Array.of(0));
    const resolved = resolveSparseNeighbors({
      catalog,
      shapeIds: Uint32Array.of(fixture.centerShapeId),
      surface: {
        cellX: Int32Array.of(0),
        cellY: Int32Array.of(0),
        cellZ: Int32Array.of(0),
      },
      transitions: decoded,
    });
    expect(resolved.shapeIds).toEqual(Uint32Array.of(fixture.airShapeId));
    expect(resolved.geometryIds).toEqual(Uint32Array.of(catalog.shapeGeometry[fixture.airShapeId] ?? 0));
    expect(resolved.changedCells).toBe(1);
    expect(resolved.iterations).toBe(2);
  });

  it('rejects payload corruption', () => {
    const encoded = encodeNeighborTransitions(fixtureTransition().transitions);
    const last = encoded.length - 1;
    encoded[last] = (encoded[last] ?? 0) ^ 1;
    expect(() => decodeNeighborTransitions(encoded)).toThrow(/checksum/u);
  });
});
