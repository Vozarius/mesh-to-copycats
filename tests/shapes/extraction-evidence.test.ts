import { describe, expect, it } from 'vitest';

import {
  EXTRACTED_CATALOG_SCHEMA,
  compileExtractedCatalog,
  decodeGeneratedCatalog,
  encodeGeneratedCatalog,
  generatedMaterialAcceptanceProfileId,
  parseExtractedCatalog,
  type GeneratedCatalogMetadata,
} from '../../packages/shapes/src/index.js';

function placementProbes(): unknown[] {
  const neighbors = [
    ['west-stone', [-1, 0, 0]],
    ['down-stone', [0, -1, 0]],
    ['north-stone', [0, 0, -1]],
    ['south-stone', [0, 0, 1]],
    ['up-stone', [0, 1, 0]],
    ['east-stone', [1, 0, 0]],
  ] as const;
  return [
    { context: 'empty', neighbors: [], survives: false },
    ...neighbors.map(([context, offset]) => ({
      context,
      neighbors: [{ blockId: 'minecraft:stone', offset, state: {} }],
      survives: true,
    })),
  ];
}

function allSurvivePlacementProbes(): unknown[] {
  return placementProbes().map((probe) => ({
    ...(probe as Record<string, unknown>),
    survives: true,
  }));
}

function extendedDocument(): unknown {
  return {
    schema: EXTRACTED_CATALOG_SCHEMA,
    version: 1,
    sources: {
      copycats: '3.0.4+mc.1.21.1-neoforge',
      create: '6.0.10',
      extractor: '0.2.0',
      loader: 'neoforge-21.1.219',
      minecraft: '1.21.1',
    },
    shapes: [
      {
        blockId: 'example:evidenced',
        boxes: [[0, 0, 0, 16, 16, 16]],
        complexity: 2,
        family: 'GENERIC',
        neighborDependencies: {
          fingerprint: 'controlled-neighbors:v1',
          probes: [
            {
              boxes: [[0, 0, 0, 16, 16, 16]],
              changesShape: false,
              neighborBlockId: 'minecraft:air',
              neighborState: {},
              offset: [1, 0, 0],
            },
            {
              boxes: [[0, 0, 0, 8, 16, 16]],
              changesShape: true,
              neighborBlockId: 'example:evidenced',
              neighborState: { powered: false, facing: 'north' },
              offset: [-1, 0, 0],
            },
          ],
          status: 'SUPPORTED',
        },
        neighborDependent: true,
        parts: [
          {
            boxes: [[0, 0, 0, 16, 16, 16]],
            compatibility: 0x8000_0001,
            key: 'shell',
            materialAcceptance: {
              fingerprint: 'copycat-material-predicate:v1',
              probes: [
                {
                  accepted: true,
                  acceptedState: {},
                  direction: 'north',
                  material: 'minecraft:stone',
                },
                {
                  accepted: false,
                  acceptedState: null,
                  direction: 'east',
                  material: 'minecraft:chest',
                },
              ],
              status: 'SUPPORTED',
            },
            materialSlot: 3,
          },
        ],
        placementSafety: {
          assessment: 'CONDITIONAL',
          fingerprint: 'placement-simulation:v1',
          flags: ['requires-replaceable-target', 'requires-player'],
          probes: placementProbes(),
        },
        state: { powered: false, facing: 'north' },
      },
    ],
  };
}

function legacyDocument(): unknown {
  return {
    schema: EXTRACTED_CATALOG_SCHEMA,
    version: 1,
    sources: { extractor: '0.1.0' },
    shapes: [
      {
        blockId: 'example:legacy',
        boxes: [[0, 0, 0, 16, 16, 16]],
        complexity: 1,
        family: 'GENERIC',
        state: {},
      },
    ],
  };
}

function profiledDocument(): unknown {
  const directions = {
    down: null,
    east: null,
    north: { blockId: 'minecraft:stone', state: {} },
    south: { blockId: 'minecraft:stone', state: {} },
    up: null,
    west: null,
  };
  const part = {
    boxes: [[0, 0, 0, 16, 16, 16]],
    key: 'shell',
    materialAcceptanceProfileId: 'source:copycat-block-shell',
    materialSlot: 0,
  };
  return {
    schema: EXTRACTED_CATALOG_SCHEMA,
    version: 1,
    diagnostics: [],
    materialCandidates: [
      { itemId: 'minecraft:stone', materialBlockId: 'minecraft:stone' },
      { itemId: 'example:stone_alias', materialBlockId: 'minecraft:stone' },
      { itemId: 'minecraft:chest', materialBlockId: 'minecraft:chest' },
    ],
    materialAcceptanceProfiles: [
      {
        copycatBlockId: 'copycats:copycat_block',
        fingerprint: 'copycats-accepted-state:v1',
        partKey: 'shell',
        profileId: 'source:copycat-block-shell',
        results: [
          { directions, itemId: 'example:stone_alias' },
          { directions, itemId: 'minecraft:stone' },
        ],
        status: 'SUPPORTED',
      },
      {
        copycatBlockId: 'copycats:copycat_slab',
        fingerprint: 'copycats-accepted-state:v1',
        partKey: 'bottom',
        profileId: 'source:copycat-slab-bottom',
        results: [
          { directions, itemId: 'example:stone_alias' },
          { directions, itemId: 'minecraft:stone' },
        ],
        status: 'SUPPORTED',
      },
    ],
    shapes: [
      {
        blockId: 'copycats:copycat_block',
        boxes: [[0, 0, 0, 16, 16, 16]],
        complexity: 1,
        family: 'FULL_CUBE',
        parts: [part],
        state: { variant: 0 },
      },
      {
        blockId: 'copycats:copycat_block',
        boxes: [[0, 0, 0, 16, 16, 16]],
        complexity: 1,
        family: 'FULL_CUBE',
        parts: [part],
        state: { variant: 1 },
      },
      {
        blockId: 'copycats:copycat_slab',
        boxes: [[0, 0, 0, 16, 16, 16]],
        complexity: 1,
        family: 'SLAB',
        parts: [{
          boxes: [[0, 0, 0, 16, 16, 16]],
          key: 'bottom',
          materialAcceptanceProfileId: 'source:copycat-slab-bottom',
          materialSlot: 0,
        }],
        state: { type: 'double' },
      },
    ],
    sources: { extractor: 'profiles-test' },
  };
}

describe('extractor evidence contract', () => {
  it('uses a stable SHA-256 content id for generated profiles', () => {
    expect(generatedMaterialAcceptanceProfileId({
      coverage: 'LEGACY_PARTIAL',
      fingerprint: 'vector:v1',
      probes: [],
      results: [],
      status: 'UNSUPPORTED',
    }, [])).toBe(
      'sha256:8c0c4da6149286e47d8e87e52eea9cf1e17e69eb21335e220470d5288b62d426',
    );
  });

  it('deduplicates complete registry profiles and preserves explicit item/block identity', () => {
    const compiled = compileExtractedCatalog(profiledDocument());

    expect(compiled.document.materialCandidates).toEqual([
      { itemId: 'example:stone_alias', materialBlockId: 'minecraft:stone' },
      { itemId: 'minecraft:chest', materialBlockId: 'minecraft:chest' },
      { itemId: 'minecraft:stone', materialBlockId: 'minecraft:stone' },
    ]);
    expect(compiled.document.materialAcceptanceProfiles[0]?.results.map(
      (result) => result.itemId,
    )).toEqual(['example:stone_alias', 'minecraft:stone']);
    expect(compiled.extraction.materialAcceptanceProfiles).toHaveLength(1);
    const profile = compiled.extraction.materialAcceptanceProfiles[0]!;
    expect(profile).toMatchObject({
      coverage: 'COMPLETE_REGISTRY',
      fingerprint: 'copycats-accepted-state:v1',
      status: 'SUPPORTED',
    });
    expect(profile.profileId).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(compiled.extraction.shapes.map(
      (shape) => shape.parts[0]?.materialAcceptanceProfileId,
    )).toEqual([profile.profileId, profile.profileId, profile.profileId]);
    expect(profile.results.some((result) => result.itemId === 'minecraft:chest')).toBe(false);

    const artifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
      compiled.extraction,
    );
    expect(() => decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: artifacts.metadataJson,
      shapes: artifacts.shapes,
    })).not.toThrow();
  });

  it('rejects incomplete, contradictory and misowned complete material profiles', () => {
    const missingDirection = structuredClone(profiledDocument()) as {
      materialAcceptanceProfiles: Array<{
        results: Array<{ directions: Record<string, unknown> }>;
      }>;
    };
    delete missingDirection.materialAcceptanceProfiles[0]!.results[0]!.directions.west;
    expect(() => parseExtractedCatalog(missingDirection)).toThrow(/directions\.west is required/u);

    const allRejectedResult = structuredClone(profiledDocument()) as {
      materialAcceptanceProfiles: Array<{
        results: Array<{ directions: Record<string, unknown> }>;
      }>;
    };
    for (const direction of ['down', 'east', 'north', 'south', 'up', 'west']) {
      allRejectedResult.materialAcceptanceProfiles[0]!.results[0]!.directions[direction] = null;
    }
    expect(() => parseExtractedCatalog(allRejectedResult)).toThrow(/at least one accepted direction/u);

    const misowned = structuredClone(profiledDocument()) as {
      materialAcceptanceProfiles: Array<Record<string, unknown>>;
    };
    misowned.materialAcceptanceProfiles[0]!.partKey = 'wrong-part';
    expect(() => parseExtractedCatalog(misowned)).toThrow(/source does not match/u);

    const unreferenced = structuredClone(profiledDocument()) as {
      shapes: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    unreferenced.shapes[0]!.parts[0]!.materialAcceptanceProfileId = 'missing';
    expect(() => parseExtractedCatalog(unreferenced)).toThrow(/unknown material acceptance profile/u);
  });

  it('verifies generated material profile content ids', () => {
    const compiled = compileExtractedCatalog(profiledDocument());
    const artifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
      compiled.extraction,
    );
    const extraction = structuredClone(compiled.extraction);
    Reflect.set(extraction.materialAcceptanceProfiles[0]!.results[0]!.directions, 'north', {
      blockId: 'minecraft:dirt',
      state: '',
    });
    const metadata: GeneratedCatalogMetadata = { ...artifacts.metadata, extraction };
    expect(() => decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata,
      shapes: artifacts.shapes,
    })).toThrow(/profileId does not match canonical profile content/u);
  });

  it('normalizes controlled evidence and carries it through generated metadata', () => {
    const compiled = compileExtractedCatalog(extendedDocument());
    const shape = compiled.document.shapes[0]!;

    expect(shape.neighborDependent).toBe(true);
    expect(shape.neighborDependencies?.probes.map((probe) => probe.offset)).toEqual([
      [-1, 0, 0],
      [1, 0, 0],
    ]);
    expect(shape.parts?.[0]?.materialAcceptance?.probes.map((probe) => probe.materialBlockId)).toEqual([
      'minecraft:chest',
      'minecraft:stone',
    ]);
    expect(shape.parts?.[0]?.materialAcceptance?.probes[0]).toMatchObject({
      accepted: false,
      acceptedState: null,
      direction: 'east',
    });
    expect(shape.placementSafety?.flags).toEqual([
      'requires-player',
      'requires-replaceable-target',
    ]);

    const shapeId = compiled.catalog.findShapeId(
      'example:evidenced',
      '[facing=north,powered=false]',
    );
    expect(shapeId).toBeDefined();
    expect(compiled.catalog.getShapeMetadata(shapeId!).neighborDependent).toBe(true);
    expect(compiled.catalog.getShapeParts(shapeId!)).toEqual([
      {
        compatibility: 0x8000_0001,
        key: 'shell',
        materialSlot: 3,
        partId: 0,
      },
    ]);

    const artifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
      compiled.extraction,
    );
    expect(artifacts.metadata.formatVersion).toEqual({ major: 1, minor: 0 });
    expect(artifacts.metadata.extraction?.schema).toBe(
      'mesh-to-copycats.extraction-evidence',
    );
    expect(artifacts.metadata.extraction?.shapes[0]).toMatchObject({
      blockId: 'example:evidenced',
      neighborDependencies: {
        fingerprint: 'controlled-neighbors:v1',
        status: 'SUPPORTED',
      },
      parts: [
        {
          key: 'shell',
        },
      ],
      placementSafety: {
        assessment: 'CONDITIONAL',
        fingerprint: 'placement-simulation:v1',
      },
      state: '[facing=north,powered=false]',
    });
    expect(
      artifacts.metadata.extraction?.shapes[0]?.parts[0]?.materialAcceptanceProfileId,
    ).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(artifacts.metadata.extraction?.materialAcceptanceProfiles).toEqual([
      expect.objectContaining({
        coverage: 'LEGACY_PARTIAL',
        fingerprint: 'copycat-material-predicate:v1',
        status: 'SUPPORTED',
      }),
    ]);

    const decoded = decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata: artifacts.metadataJson,
      shapes: artifacts.shapes,
    });
    expect(decoded.getShapeMetadata(0).neighborDependent).toBe(true);
    expect(decoded.getShapeParts(0)[0]?.key).toBe('shell');
  });

  it('gives old version-1 inputs explicit UNEXTRACTED defaults', () => {
    const compiled = compileExtractedCatalog(legacyDocument());
    const shape = compiled.document.shapes[0]!;

    expect(shape.neighborDependencies).toEqual({ probes: [], status: 'UNEXTRACTED' });
    expect(shape.placementSafety).toEqual({
      assessment: 'UNEXTRACTED',
      flags: [],
      probes: [],
    });
    expect(compiled.extraction.diagnostics).toEqual([]);
    expect(compiled.extraction.shapes[0]).toEqual({
      blockId: 'example:legacy',
      neighborDependencies: { probes: [], status: 'UNEXTRACTED' },
      parts: [
        {
          key: 'material',
          materialAcceptanceProfileId: 'unextracted',
        },
      ],
      placementSafety: { assessment: 'UNEXTRACTED', flags: [], probes: [] },
      state: '',
    });
    expect(compiled.extraction.materialCandidates).toEqual([]);
    expect(compiled.extraction.materialAcceptanceProfiles).toEqual([
      {
        coverage: 'NONE',
        probes: [],
        profileId: 'unextracted',
        results: [],
        status: 'UNEXTRACTED',
      },
    ]);

    const legacyArtifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
    );
    expect(legacyArtifacts.metadata.extraction).toBeUndefined();
    expect(() => decodeGeneratedCatalog({
      blocks: legacyArtifacts.blocks,
      metadata: legacyArtifacts.metadata,
      shapes: legacyArtifacts.shapes,
    })).not.toThrow();
  });

  it('rejects declarations that contradict controlled neighbor probes', () => {
    const document = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    document.shapes[0]!.neighborDependent = false;
    expect(() => parseExtractedCatalog(document)).toThrow(/contradicts controlled neighbor probes/u);
  });

  it('allows a conservative dependency declaration when finite probes see no change', () => {
    const document = legacyDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    document.shapes[0]!.neighborDependent = true;
    document.shapes[0]!.neighborDependencies = {
      fingerprint: 'finite-neighbor-sample:v1',
      probes: [{
        boxes: [[0, 0, 0, 16, 16, 16]],
        changesShape: false,
        changesState: false,
        neighborBlockId: 'minecraft:stone',
        neighborState: {},
        offset: [1, 0, 0],
        resolvedBlockId: 'example:legacy',
        resolvedState: {},
      }],
      status: 'SUPPORTED',
    };
    expect(parseExtractedCatalog(document).shapes[0]!.neighborDependent).toBe(true);
  });

  it('derives neighbor dependence from resolved state changes and defaults legacy probes', () => {
    const document = legacyDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    document.shapes[0]!.neighborDependencies = {
      fingerprint: 'update-shape:v1',
      probes: [
        {
          boxes: [[0, 0, 0, 16, 16, 16]],
          changesShape: false,
          changesState: true,
          neighborBlockId: 'minecraft:stone',
          neighborState: {},
          offset: [1, 0, 0],
          resolvedBlockId: 'example:legacy',
          resolvedState: { connected: true },
        },
      ],
      status: 'SUPPORTED',
    };
    const compiled = compileExtractedCatalog(document);
    expect(compiled.document.shapes[0]!.neighborDependent).toBe(true);
    expect(compiled.extraction.shapes[0]!.neighborDependencies.probes[0]).toMatchObject({
      changesState: true,
      resolvedBlockId: 'example:legacy',
      resolvedState: '[connected=true]',
    });

    const legacyProbe = extendedDocument() as {
      shapes: Array<{ neighborDependencies: { probes: Array<Record<string, unknown>> } }>;
    };
    const parsed = parseExtractedCatalog(legacyProbe);
    expect(parsed.shapes[0]!.neighborDependencies?.probes[0]).toMatchObject({
      changesState: false,
      resolvedBlockId: 'example:evidenced',
      resolvedState: { facing: 'north', powered: false },
    });
  });

  it.each([
    [
      'missing supported fingerprint',
      {
        status: 'SUPPORTED',
        probes: [
          {
            accepted: true,
            acceptedState: {},
            direction: 'north',
            material: 'minecraft:stone',
          },
        ],
      },
    ],
    [
      'duplicate material probes',
      {
        fingerprint: 'predicate:v1',
        status: 'SUPPORTED',
        probes: [
          {
            accepted: true,
            acceptedState: {},
            direction: 'north',
            material: 'minecraft:stone',
          },
          {
            accepted: false,
            acceptedState: null,
            direction: 'north',
            material: 'minecraft:stone',
          },
        ],
      },
    ],
  ])('rejects %s', (_label, materialAcceptance) => {
    const document = extendedDocument() as {
      shapes: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    document.shapes[0]!.parts[0]!.materialAcceptance = materialAcceptance;
    expect(() => parseExtractedCatalog(document)).toThrow();
  });

  it('requires flags to explain conditional placement safety', () => {
    const document = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    document.shapes[0]!.placementSafety = {
      assessment: 'CONDITIONAL',
      fingerprint: 'placement:v1',
      flags: [],
      probes: placementProbes(),
    };
    expect(() => parseExtractedCatalog(document)).toThrow(/flags must explain/u);
  });

  it('requires raw placement probes and validates their derived assessment', () => {
    const missingContexts = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    missingContexts.shapes[0]!.placementSafety = {
      assessment: 'SAFE',
      fingerprint: 'placement:v1',
      flags: [],
      probes: [{ context: 'empty', neighbors: [], survives: true }],
    };
    expect(() => parseExtractedCatalog(missingContexts)).toThrow(/six single-stone/u);

    const contradictory = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    contradictory.shapes[0]!.placementSafety = {
      assessment: 'SAFE',
      fingerprint: 'placement:v1',
      flags: [],
      probes: placementProbes(),
    };
    expect(() => parseExtractedCatalog(contradictory)).toThrow(/contradicts controlled placement/u);

    const flagged = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    flagged.shapes[0]!.placementSafety = {
      assessment: 'CONDITIONAL',
      fingerprint: 'placement:v1',
      flags: ['placement-context-not-replayed'],
      probes: allSurvivePlacementProbes(),
    };
    expect(() => parseExtractedCatalog(flagged)).not.toThrow();

    const falselySafe = extendedDocument() as {
      shapes: Array<Record<string, unknown>>;
    };
    falselySafe.shapes[0]!.placementSafety = {
      assessment: 'SAFE',
      fingerprint: 'placement:v1',
      flags: ['placement-context-not-replayed'],
      probes: allSurvivePlacementProbes(),
    };
    expect(() => parseExtractedCatalog(falselySafe)).toThrow(/contradicts controlled placement/u);
  });

  it('sorts and carries explicit fail-closed diagnostics', () => {
    const document = legacyDocument() as Record<string, unknown>;
    document.diagnostics = [
      {
        blockId: 'example:z_cogwheel',
        code: 'COPYCATS_MULTIPART_UNSUPPORTED',
        reason: 'multipart adapter unavailable',
        state: { axis: 'x' },
      },
      {
        blockId: 'example:a_slope',
        code: 'GRID16_GEOMETRY_UNSUPPORTED',
        reason: 'outline is not GRID16 exact',
        state: {},
      },
    ];
    const compiled = compileExtractedCatalog(document);

    expect(compiled.document.diagnostics.map((diagnostic) => diagnostic.blockId)).toEqual([
      'example:a_slope',
      'example:z_cogwheel',
    ]);
    expect(compiled.extraction.diagnostics).toEqual([
      {
        blockId: 'example:a_slope',
        code: 'GRID16_GEOMETRY_UNSUPPORTED',
        reason: 'outline is not GRID16 exact',
        state: '',
      },
      {
        blockId: 'example:z_cogwheel',
        code: 'COPYCATS_MULTIPART_UNSUPPORTED',
        reason: 'multipart adapter unavailable',
        state: '[axis=x]',
      },
    ]);

    const artifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
      compiled.extraction,
    );
    expect(artifacts.metadata.extraction?.diagnostics).toEqual(
      compiled.extraction.diagnostics,
    );
  });

  it('rejects extraction evidence whose part identity does not match the binaries', () => {
    const compiled = compileExtractedCatalog(extendedDocument());
    const artifacts = encodeGeneratedCatalog(
      compiled.catalog,
      compiled.document.sources,
      compiled.extraction,
    );
    const extraction = {
      ...compiled.extraction,
      shapes: compiled.extraction.shapes.map((shape) => ({
        ...shape,
        parts: shape.parts.map((part) => ({ ...part, key: 'wrong-key' })),
      })),
    };
    const metadata: GeneratedCatalogMetadata = {
      ...artifacts.metadata,
      extraction,
    };

    expect(() => decodeGeneratedCatalog({
      blocks: artifacts.blocks,
      metadata,
      shapes: artifacts.shapes,
    })).toThrow(/part key does not match/u);
  });
});
