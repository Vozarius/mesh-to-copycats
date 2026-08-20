import { describe, expect, it } from 'vitest';

import type { PackedShapeCatalog } from '../../packages/shapes/src/index.js';
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  generateCandidates,
} from '../../packages/optimizer/src/index.js';
import {
  computeDescriptor,
  createMask,
  DESCRIPTOR,
} from '../../packages/voxelizer/src/index.js';

describe('candidate routing', () => {
  it('keeps every coarse-score tie at the generated-candidate cutoff', () => {
    const geometryCount = 70;
    const mask4 = createMask(4);
    const descriptor = computeDescriptor(mask4, 4);
    const geometryDescriptors = new Float32Array(geometryCount * DESCRIPTOR.LENGTH);
    for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
      geometryDescriptors.set(descriptor, geometryId * DESCRIPTOR.LENGTH);
    }
    const popcount4Buckets = Array.from(
      { length: 65 },
      (_, population) => population === 0
        ? Uint32Array.from({ length: geometryCount }, (_value, index) => index)
        : new Uint32Array(),
    );
    const catalog = {
      geometryCount,
      geometryDescriptors,
      masks4: new Uint32Array(geometryCount * mask4.length),
      popcount4Buckets,
      routeIndex: new Map(),
    } as unknown as PackedShapeCatalog;

    const generated = generateCandidates(
      mask4,
      descriptor,
      { ...DEFAULT_OPTIMIZER_SETTINGS, maxGeneratedCandidates: 64 },
      catalog,
    );

    expect(generated.geometryIds).toHaveLength(geometryCount);
    expect(generated.geometryIds).toEqual(
      Array.from({ length: geometryCount }, (_value, index) => index),
    );
  });
});
