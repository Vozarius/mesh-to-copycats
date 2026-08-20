import { describe, expect, it } from 'vitest';

import { createGeometryOptimizer } from '../../packages/optimizer/src/index.js';
import { QualityMode } from '../../packages/shared/src/index.js';
import { AdaptiveOccupancy } from '../../packages/voxelizer/src/index.js';
import {
  decodeGeneratedCatalog,
  encodeGeneratedCatalog,
  getFixtureCatalog,
  type GeneratedCatalogMetadata,
  type GeneratedCatalogSources,
  type PackedShapeCatalog,
} from '../../packages/shapes/src/index.js';

const fixture = getFixtureCatalog();

const canonicalSources: GeneratedCatalogSources = {
  copycats: 'copycats-fixture',
  create: 'create-fixture',
  environment: `m2c-environment-v1:sha256:${'b'.repeat(64)}`,
  extractor: 'extractor-fixture',
  loader: 'neoforge',
  minecraft: '1.21.1',
};

function reverseSourceInsertionOrder(
  sources: GeneratedCatalogSources,
): GeneratedCatalogSources {
  return Object.fromEntries(Object.entries(sources).reverse());
}

function expectTypedArrayEqual(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
): void {
  expect(Array.from(actual)).toEqual(Array.from(expected));
}

function expectCatalogEqual(
  actual: PackedShapeCatalog,
  expected: PackedShapeCatalog,
): void {
  expect(actual.geometryCount).toBe(expected.geometryCount);
  expect(actual.shapeCount).toBe(expected.shapeCount);
  expect(actual.geometryKeys).toEqual(expected.geometryKeys);
  expect(actual.blockIds).toEqual(expected.blockIds);
  expect(actual.states).toEqual(expected.states);
  expect(actual.partKeys).toEqual(expected.partKeys);

  expectTypedArrayEqual(actual.masks4, expected.masks4);
  expectTypedArrayEqual(actual.masks8, expected.masks8);
  expectTypedArrayEqual(actual.masks16, expected.masks16);
  expectTypedArrayEqual(actual.geometryDescriptors, expected.geometryDescriptors);
  expectTypedArrayEqual(actual.geometryPopcount4, expected.geometryPopcount4);
  expectTypedArrayEqual(actual.geometryPopcount8, expected.geometryPopcount8);
  expectTypedArrayEqual(actual.geometryPopcount16, expected.geometryPopcount16);
  expectTypedArrayEqual(
    actual.geometryRepresentativeShape,
    expected.geometryRepresentativeShape,
  );
  expectTypedArrayEqual(
    actual.geometryRealizationOffsets,
    expected.geometryRealizationOffsets,
  );
  expectTypedArrayEqual(actual.geometryRealizations, expected.geometryRealizations);

  expectTypedArrayEqual(actual.shapeGeometry, expected.shapeGeometry);
  expectTypedArrayEqual(actual.shapeFamily, expected.shapeFamily);
  expectTypedArrayEqual(actual.shapeFamilyPriority, expected.shapeFamilyPriority);
  expectTypedArrayEqual(actual.shapeComplexity, expected.shapeComplexity);
  expectTypedArrayEqual(actual.shapeStateId, expected.shapeStateId);
  expectTypedArrayEqual(
    actual.shapeNeighborDependent,
    expected.shapeNeighborDependent,
  );
  expectTypedArrayEqual(actual.shapePartOffsets, expected.shapePartOffsets);
  expectTypedArrayEqual(
    actual.shapeOwnerGridOffsets,
    expected.shapeOwnerGridOffsets,
  );

  expectTypedArrayEqual(actual.partIds, expected.partIds);
  expectTypedArrayEqual(actual.partMaterialSlots, expected.partMaterialSlots);
  expectTypedArrayEqual(actual.partCompatibility, expected.partCompatibility);
  expectTypedArrayEqual(actual.partMask16Offsets, expected.partMask16Offsets);
  expectTypedArrayEqual(actual.partMasks16, expected.partMasks16);
  expectTypedArrayEqual(actual.ownerGrid16Pool, expected.ownerGrid16Pool);

  expect([...actual.routeIndex.keys()].sort()).toEqual(
    [...expected.routeIndex.keys()].sort(),
  );
  for (const [key, expectedPostings] of expected.routeIndex) {
    const actualPostings = actual.routeIndex.get(key);
    expect(actualPostings, `route ${key}`).toBeDefined();
    expectTypedArrayEqual(actualPostings ?? new Uint32Array(), expectedPostings);
  }

  expect(actual.popcount4Buckets).toHaveLength(expected.popcount4Buckets.length);
  for (let bucket = 0; bucket < expected.popcount4Buckets.length; bucket += 1) {
    expectTypedArrayEqual(
      actual.popcount4Buckets[bucket] ?? new Uint32Array(),
      expected.popcount4Buckets[bucket] ?? new Uint32Array(),
    );
  }

  for (let shapeId = 0; shapeId < expected.shapeCount; shapeId += 1) {
    expect(actual.getShapeMetadata(shapeId)).toEqual(expected.getShapeMetadata(shapeId));
    expect(actual.getShapeParts(shapeId)).toEqual(expected.getShapeParts(shapeId));
    const actualOwners = actual.getOwnerGrid16(shapeId);
    const expectedOwners = expected.getOwnerGrid16(shapeId);
    if (expectedOwners === undefined) {
      expect(actualOwners).toBeUndefined();
    } else {
      expect(actualOwners).toBeDefined();
      expectTypedArrayEqual(actualOwners ?? new Uint8Array(), expectedOwners);
    }
  }
}

function corruptLastPayloadByte(bytes: Uint8Array): Uint8Array {
  const corrupted = bytes.slice();
  const index = corrupted.length - 1;
  corrupted[index] = (corrupted[index] ?? 0) ^ 0x01;
  return corrupted;
}

function differentChecksum(checksum: string): string {
  const first = checksum.startsWith('0') ? '1' : '0';
  return `${first}${checksum.slice(1)}`;
}

describe('generated catalog artifacts', () => {
  it('is byte-for-byte deterministic, including source key insertion order', () => {
    const forward = encodeGeneratedCatalog(fixture, canonicalSources);
    const reversed = encodeGeneratedCatalog(
      fixture,
      reverseSourceInsertionOrder(canonicalSources),
    );

    expectTypedArrayEqual(reversed.shapes, forward.shapes);
    expectTypedArrayEqual(reversed.blocks, forward.blocks);
    expect(reversed.metadata).toEqual(forward.metadata);
    expect(reversed.metadataJson).toBe(forward.metadataJson);
  });

  it('retains and validates environment provenance', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    expect(artifacts.metadata.sources.environment).toBe(canonicalSources.environment);
    expect(() => encodeGeneratedCatalog(fixture, {
      ...canonicalSources,
      environment: 'm2c-environment-v1:sha256:ABC',
    })).toThrow(/sources\.environment/u);
  });

  it('rejects malformed environment provenance while decoding metadata', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    const tampered: GeneratedCatalogMetadata = {
      ...artifacts.metadata,
      sources: {
        ...artifacts.metadata.sources,
        environment: 'm2c-environment-v1:sha256:not-hex',
      },
    };
    expect(() => decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: tampered,
      shapes: artifacts.shapes,
    })).toThrow(/sources\.environment/u);
  });

  it('round-trips every packed fixture catalog field', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    const decodedFromObject = decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: artifacts.metadata,
      shapes: artifacts.shapes,
    });
    const decodedFromJson = decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: artifacts.metadataJson,
      shapes: artifacts.shapes,
    });

    expectCatalogEqual(decodedFromObject, fixture);
    expectCatalogEqual(decodedFromJson, fixture);
  });

  it('rejects corruption in generated-shapes.bin through its payload checksum', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    expect(() =>
      decodeGeneratedCatalog({
        blocks: artifacts.blocks,
        metadata: artifacts.metadata,
        shapes: corruptLastPayloadByte(artifacts.shapes),
      }),
    ).toThrow(/payload checksum mismatch/u);
  });

  it('rejects corruption in generated-blocks.bin through its payload checksum', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    expect(() =>
      decodeGeneratedCatalog({
        blocks: corruptLastPayloadByte(artifacts.blocks),
        metadata: artifacts.metadata,
        shapes: artifacts.shapes,
      }),
    ).toThrow(/payload checksum mismatch/u);
  });

  it('rejects metadata counts that do not match the binary artifacts', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    const mismatched: GeneratedCatalogMetadata = {
      ...artifacts.metadata,
      counts: {
        ...artifacts.metadata.counts,
        shapes: artifacts.metadata.counts.shapes + 1,
      },
    };

    expect(() =>
      decodeGeneratedCatalog({
        blocks: artifacts.blocks,
        metadata: mismatched,
        shapes: artifacts.shapes,
      }),
    ).toThrow(/metadata counts do not match/u);
  });

  it('rejects a metadata checksum that does not describe the supplied binaries', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    const mismatched: GeneratedCatalogMetadata = {
      ...artifacts.metadata,
      artifacts: {
        ...artifacts.metadata.artifacts,
        shapes: {
          ...artifacts.metadata.artifacts.shapes,
          crc32: differentChecksum(artifacts.metadata.artifacts.shapes.crc32),
        },
      },
    };

    expect(() =>
      decodeGeneratedCatalog({
        blocks: artifacts.blocks,
        metadata: JSON.stringify(mismatched),
        shapes: artifacts.shapes,
      }),
    ).toThrow(/metadata artifact checksum mismatch/u);
  });

  it('still finds every exact catalog target after binary round-trip', () => {
    const artifacts = encodeGeneratedCatalog(fixture, canonicalSources);
    const decoded = decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: artifacts.metadataJson,
      shapes: artifacts.shapes,
    });
    const optimizer = createGeometryOptimizer({
      catalog: decoded,
      settings: {
        alternatives: 0,
        qualityMode: QualityMode.QUALITY,
      },
    });

    for (let geometryId = 0; geometryId < decoded.geometryCount; geometryId += 1) {
      const result = optimizer.optimizeCell({
        occupancy: AdaptiveOccupancy.fromMask16(
          decoded.getGeometryMask(geometryId, 16),
        ),
      });
      expect(result.best.geometryError, `geometry ${geometryId}`).toBe(0);
      expect(result.best.geometryKey, `geometry ${geometryId}`).toBe(
        decoded.geometryKeys[geometryId],
      );
    }
  });
});
