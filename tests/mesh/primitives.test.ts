import { describe, expect, it } from 'vitest';

import {
  applyTextureToMeshMaterial,
  createCircleMesh,
  createAlphaMaskedPlaneMesh,
  createPlaneMesh,
  createSphereMesh,
  transformMesh,
} from '../../packages/mesh/src/index.js';

describe('mesh primitives', () => {
  it('creates a dimensioned UV plane', () => {
    const mesh = createPlaneMesh({ width: 4, height: 2 });
    expect(Array.from(mesh.bounds)).toEqual([-2, -1, 0, 2, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(mesh.texcoords ?? [])).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('applies deterministic XYZ rotation followed by translation', () => {
    const mesh = transformMesh(createPlaneMesh({ width: 2, height: 2 }), {
      rotationDegrees: [90, 0, 0],
      translation: [2, 3, 4],
    });
    expect(mesh.bounds[0]).toBeCloseTo(1);
    expect(mesh.bounds[3]).toBeCloseTo(3);
    expect(mesh.bounds[1]).toBeCloseTo(3);
    expect(mesh.bounds[4]).toBeCloseTo(3);
    expect(mesh.bounds[2]).toBeCloseTo(3);
    expect(mesh.bounds[5]).toBeCloseTo(5);
  });

  it('rejects non-finite transforms', () => {
    expect(() => transformMesh(createPlaneMesh(), { translation: [0, Number.NaN, 0] }))
      .toThrow(/finite/u);
  });

  it('greedily triangulates only pixels that pass the alpha cutoff', () => {
    const atlas = {
      heights: Uint16Array.of(2),
      offsets: Uint32Array.of(0, 24),
      rgbaSrgb: Uint8Array.from([
        255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0,
        255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255,
      ]),
      widths: Uint16Array.of(3),
      wrapS: Uint32Array.of(33071),
      wrapT: Uint32Array.of(33071),
    };
    const mesh = createAlphaMaskedPlaneMesh({ height: 2, textureAtlas: atlas, width: 3 });
    expect(mesh.indices.length / 3).toBe(4);
    expect(mesh.vertexCount).toBe(8);
    expect(Array.from(mesh.bounds)).toEqual([-1.5, -1, 0, 1.5, 1, 0]);
  });

  it('places image planes inside one depth cell for planar Byte ownership', () => {
    const atlas = {
      heights: Uint16Array.of(1),
      offsets: Uint32Array.of(0, 4),
      rgbaSrgb: Uint8Array.of(255, 255, 255, 255),
      widths: Uint16Array.of(1),
      wrapS: Uint32Array.of(33071),
      wrapT: Uint32Array.of(33071),
    };
    const mesh = createAlphaMaskedPlaneMesh({ depth: 0.25, height: 1, textureAtlas: atlas, width: 1 });
    expect(Array.from(mesh.bounds)).toEqual([-0.5, -0.5, 0.25, 0.5, 0.5, 0.25]);
  });

  it('attaches a UV texture without discarding an existing texture atlas', () => {
    const mesh = createPlaneMesh({
      textureAtlas: {
        heights: Uint16Array.of(1),
        offsets: Uint32Array.of(0, 4),
        rgbaSrgb: Uint8Array.of(255, 0, 0, 255),
        widths: Uint16Array.of(1),
        wrapS: Uint32Array.of(33071),
        wrapT: Uint32Array.of(33071),
      },
    });
    const textured = applyTextureToMeshMaterial(mesh, {
      heights: Uint16Array.of(1),
      offsets: Uint32Array.of(0, 4),
      rgbaSrgb: Uint8Array.of(0, 255, 0, 255),
      widths: Uint16Array.of(1),
      wrapS: Uint32Array.of(33071),
      wrapT: Uint32Array.of(33071),
    }, 0);
    expect(Array.from(textured.textureAtlas?.rgbaSrgb ?? [])).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
    ]);
    expect(Array.from(textured.materialTextureIndexes ?? [])).toEqual([1]);
    expect(Array.from(textured.materialBaseColorsLinear ?? []).slice(0, 3)).toEqual([1, 1, 1]);
  });

  it('rejects a fully transparent image plane', () => {
    expect(() => createAlphaMaskedPlaneMesh({
      height: 1,
      textureAtlas: {
        heights: Uint16Array.of(1),
        offsets: Uint32Array.of(0, 4),
        rgbaSrgb: Uint8Array.of(0, 0, 0, 0),
        widths: Uint16Array.of(1),
        wrapS: Uint32Array.of(33071),
        wrapT: Uint32Array.of(33071),
      },
      width: 1,
    })).toThrow(/no pixels/u);
  });

  it('creates a deterministic circle fan', () => {
    const mesh = createCircleMesh({ radius: 2, segments: 8 });
    expect(mesh.indices.length / 3).toBe(8);
    expect(mesh.vertexCount).toBe(9);
    expect(mesh.bounds[0]).toBeCloseTo(-2);
    expect(mesh.bounds[3]).toBeCloseTo(2);
  });

  it('creates a closed sphere surface without degenerate pole triangles', () => {
    const mesh = createSphereMesh({ radius: 2, latitudeSegments: 4, longitudeSegments: 8 });
    expect(mesh.indices.length / 3).toBe(48);
    expect(mesh.bounds[1]).toBeCloseTo(-2);
    expect(mesh.bounds[4]).toBeCloseTo(2);
  });
});
