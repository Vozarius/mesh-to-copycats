import { describe, expect, it } from 'vitest';

import { importGlb, importObj } from '../../packages/mesh/src/index.js';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function triangleGlb(): Uint8Array {
  const binary = new Uint8Array(44);
  const binaryView = new DataView(binary.buffer);
  const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  positions.forEach((value, index) => {
    binaryView.setFloat32(index * 4, value, true);
  });
  binaryView.setUint16(36, 0, true);
  binaryView.setUint16(38, 1, true);
  binaryView.setUint16(40, 2, true);
  const document = {
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    asset: { version: '2.0' },
    bufferViews: [
      { buffer: 0, byteLength: 36, byteOffset: 0 },
      { buffer: 0, byteLength: 6, byteOffset: 36 },
    ],
    buffers: [{ byteLength: binary.length }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, translation: [2, 3, 4] }],
    scene: 0,
    scenes: [{ nodes: [0] }],
  };
  const encodedJson = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = align4(encodedJson.length);
  const totalLength = 12 + 8 + jsonLength + 8 + binary.length;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x4654_6c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f_534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(encodedJson, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binary.length, true);
  view.setUint32(binaryHeader + 4, 0x004e_4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

describe('OBJ importer', () => {
  it('triangulates polygons, resolves negative indices and preserves material ids', () => {
    const mesh = importObj(`
      v 0 0 0
      v 1 0 0
      v 1 1 0
      v 0 1 0
      vt 0 0
      vt 1 0
      vt 1 1
      vt 0 1
      usemtl shell
      f -4/-4 -3/-3 -2/-2 -1/-1
    `);
    expect(mesh.vertexCount).toBe(4);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(mesh.triangleMaterials)).toEqual([1, 1]);
    expect(mesh.materialNames).toEqual(['default', 'shell']);
    expect(Array.from(mesh.bounds)).toEqual([0, 0, 0, 1, 1, 0]);
    expect(mesh.texcoords).toBeInstanceOf(Float32Array);
  });

  it('drops degenerate triangles deterministically', () => {
    const mesh = importObj('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3\n');
    expect(mesh.indices).toHaveLength(0);
    expect(mesh.triangleMaterials).toHaveLength(0);
  });
});

describe('GLB importer', () => {
  it('decodes indexed primitives and applies scene-node transforms', () => {
    const mesh = importGlb(triangleGlb());
    expect(mesh.vertexCount).toBe(3);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
    expect(Array.from(mesh.positions)).toEqual([
      2, 3, 4,
      3, 3, 4,
      2, 4, 4,
    ]);
    expect(Array.from(mesh.bounds)).toEqual([2, 3, 4, 3, 4, 4]);
  });

  it('rejects malformed or unsupported containers', () => {
    const malformed = triangleGlb();
    new DataView(malformed.buffer).setUint32(4, 1, true);
    expect(() => importGlb(malformed)).toThrow(/version 2/u);
  });
});
