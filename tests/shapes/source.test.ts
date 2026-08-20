import {
  EXTRACTED_CATALOG_SCHEMA,
  compileExtractedCatalog,
  encodeGeneratedCatalog,
  parseExtractedCatalog,
} from '../../packages/shapes/src/index.js';
import { ShapeFamily } from '../../packages/shared/src/index.js';
import { describe, expect, it } from 'vitest';

function sourceDocument(): unknown {
  return {
    schema: EXTRACTED_CATALOG_SCHEMA,
    version: 1,
    sources: {
      minecraft: '1.21.1',
      loader: 'neoforge-21.1.219',
      create: '6.0.10',
      copycats: '3.0.4+mc.1.21.1-neoforge',
      environment: `m2c-environment-v1:sha256:${'a'.repeat(64)}`,
      extractor: '0.1.0',
    },
    shapes: [
      {
        blockId: 'example:two_part',
        state: { powered: false, facing: 'north' },
        family: 'GENERIC',
        complexity: 4,
        boxes: [
          [0, 0, 0, 8, 16, 16],
          [8, 0, 0, 16, 16, 16],
        ],
        parts: [
          {
            key: 'left',
            materialSlot: 0,
            boxes: [[0, 0, 0, 8, 16, 16]],
          },
          {
            key: 'right',
            materialSlot: 1,
            boxes: [[8, 0, 0, 16, 16, 16]],
          },
        ],
      },
      {
        blockId: 'example:air',
        state: {},
        family: 'AIR',
        complexity: 0,
        boxes: [],
        routeKeys: ['AIR'],
      },
    ],
  };
}

describe('extracted catalog interchange', () => {
  it('validates, canonicalizes and compiles source JSON', () => {
    const { catalog, document } = compileExtractedCatalog(sourceDocument());

    expect(document.shapes).toHaveLength(2);
    expect(catalog.shapeCount).toBe(2);
    const shapeId = catalog.findShapeId('example:two_part', '[facing=north,powered=false]');
    expect(shapeId).toBeDefined();
    expect(catalog.shapeFamily[shapeId!]).toBe(ShapeFamily.GENERIC);
    expect(catalog.getShapeParts(shapeId!)).toMatchObject([
      { key: 'left', materialSlot: 0 },
      { key: 'right', materialSlot: 1 },
    ]);
    expect(catalog.getOwnerGrid16(shapeId!)).toHaveLength(4096);

    const artifacts = encodeGeneratedCatalog(catalog, document.sources);
    expect(artifacts.metadata.sources.minecraft).toBe('1.21.1');
    expect(artifacts.metadata.sources.environment).toBe(
      `m2c-environment-v1:sha256:${'a'.repeat(64)}`,
    );
  });

  it('rejects malformed environment provenance', () => {
    const value = structuredClone(sourceDocument()) as Record<string, unknown>;
    value.sources = {
      ...(value.sources as Record<string, unknown>),
      environment: 'sha256:not-a-runtime-identity',
    };
    expect(() => parseExtractedCatalog(value)).toThrow(/sources\.environment/u);
  });

  it.each([
    ['unknown schema', { ...(sourceDocument() as object), schema: 'unknown' }],
    [
      'fractional exact coordinate',
      {
        ...(sourceDocument() as object),
        shapes: [
          {
            blockId: 'example:bad',
            state: {},
            family: 'GENERIC',
            complexity: 1,
            boxes: [[0, 0, 0, 1.5, 16, 16]],
          },
        ],
      },
    ],
    [
      'unknown family',
      {
        ...(sourceDocument() as object),
        shapes: [
          {
            blockId: 'example:bad',
            state: {},
            family: 'GUESSED_COPYCAT',
            complexity: 1,
            boxes: [],
          },
        ],
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseExtractedCatalog(value)).toThrow();
  });
});
