export interface PackedTriangleMesh {
  readonly bounds: Float32Array;
  readonly indices: Uint32Array;
  readonly materialNames: readonly string[];
  readonly positions: Float32Array;
  readonly texcoords?: Float32Array;
  readonly triangleMaterials: Uint32Array;
  readonly vertexCount: number;
}

export interface MutableMeshData {
  readonly indices: number[];
  readonly materialNames: string[];
  readonly positions: number[];
  readonly texcoords?: number[];
  readonly triangleMaterials: number[];
}

export interface MeshFinalizeOptions {
  readonly degenerateEpsilon?: number;
}

function finiteArray(values: readonly number[], label: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) throw new Error(`${label}[${index}] must be finite`);
  }
}

export function finalizeMesh(
  source: MutableMeshData,
  options: MeshFinalizeOptions = {},
): PackedTriangleMesh {
  if (source.positions.length % 3 !== 0) throw new Error('Position array must contain vec3 values');
  if (source.indices.length % 3 !== 0) throw new Error('Index array must contain triangles');
  if (source.triangleMaterials.length !== source.indices.length / 3) {
    throw new Error('triangleMaterials must contain one entry per triangle');
  }
  const vertexCount = source.positions.length / 3;
  if (source.texcoords !== undefined && source.texcoords.length !== vertexCount * 2) {
    throw new Error('Texture coordinate array must contain one vec2 per vertex');
  }
  finiteArray(source.positions, 'positions');
  if (source.texcoords !== undefined) finiteArray(source.texcoords, 'texcoords');
  const epsilon = options.degenerateEpsilon ?? 1e-12;
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('degenerateEpsilon must be finite and non-negative');
  }
  const filteredIndices: number[] = [];
  const filteredMaterials: number[] = [];
  for (let triangle = 0; triangle < source.indices.length / 3; triangle += 1) {
    const a = source.indices[triangle * 3] ?? -1;
    const b = source.indices[triangle * 3 + 1] ?? -1;
    const c = source.indices[triangle * 3 + 2] ?? -1;
    for (const index of [a, b, c]) {
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new RangeError(`Triangle ${triangle} has out-of-range vertex index ${index}`);
      }
    }
    const ax = source.positions[a * 3] ?? 0;
    const ay = source.positions[a * 3 + 1] ?? 0;
    const az = source.positions[a * 3 + 2] ?? 0;
    const abx = (source.positions[b * 3] ?? 0) - ax;
    const aby = (source.positions[b * 3 + 1] ?? 0) - ay;
    const abz = (source.positions[b * 3 + 2] ?? 0) - az;
    const acx = (source.positions[c * 3] ?? 0) - ax;
    const acy = (source.positions[c * 3 + 1] ?? 0) - ay;
    const acz = (source.positions[c * 3 + 2] ?? 0) - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz <= epsilon * epsilon) continue;
    filteredIndices.push(a, b, c);
    const material = source.triangleMaterials[triangle] ?? 0;
    if (!Number.isInteger(material) || material < 0 || material >= source.materialNames.length) {
      throw new RangeError(`Triangle ${triangle} has invalid material ${material}`);
    }
    filteredMaterials.push(material);
  }
  const bounds = new Float32Array([
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = source.positions[vertex * 3 + axis] ?? 0;
      bounds[axis] = Math.min(bounds[axis] ?? value, value);
      bounds[axis + 3] = Math.max(bounds[axis + 3] ?? value, value);
    }
  }
  if (vertexCount === 0) bounds.fill(0);
  return {
    bounds,
    indices: Uint32Array.from(filteredIndices),
    materialNames: Object.freeze([...source.materialNames]),
    positions: Float32Array.from(source.positions),
    ...(source.texcoords === undefined
      ? {}
      : { texcoords: Float32Array.from(source.texcoords) }),
    triangleMaterials: Uint32Array.from(filteredMaterials),
    vertexCount,
  };
}
