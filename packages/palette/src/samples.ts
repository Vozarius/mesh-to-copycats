import { sampleMeshMaterialLinear, type PackedTriangleMesh } from '../../mesh/src/index.js';
import type { PackedSparseSurface } from '../../voxelizer/src/index.js';
import { getSparseCellTriangles } from '../../voxelizer/src/index.js';

import { linearSrgbToOklab } from './color.js';
import type {
  ExtractSurfaceSamplesOptions,
  PackedSurfaceSamples,
  SurfaceLinearColorSampler,
} from './types.js';

interface ClippedSample {
  readonly localX: number;
  readonly localY: number;
  readonly localZ: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly u: number;
  readonly v: number;
  readonly weight: number;
}

function clipBoundary(
  input: Float64Array,
  count: number,
  output: Float64Array,
  axis: 0 | 1,
  boundary: number,
  keepGreater: boolean,
): number {
  if (count === 0) return 0;
  let outputCount = 0;
  for (let index = 0; index < count; index += 1) {
    const previous = (index + count - 1) % count;
    const previousU = input[previous * 2] ?? 0;
    const previousV = input[previous * 2 + 1] ?? 0;
    const currentU = input[index * 2] ?? 0;
    const currentV = input[index * 2 + 1] ?? 0;
    const previousValue = axis === 0 ? previousU : previousV;
    const currentValue = axis === 0 ? currentU : currentV;
    const previousInside = keepGreater ? previousValue >= boundary : previousValue <= boundary;
    const currentInside = keepGreater ? currentValue >= boundary : currentValue <= boundary;
    if (previousInside !== currentInside) {
      const t = (boundary - previousValue) / (currentValue - previousValue);
      output[outputCount * 2] = previousU + (currentU - previousU) * t;
      output[outputCount * 2 + 1] = previousV + (currentV - previousV) * t;
      outputCount++;
    }
    if (currentInside) {
      output[outputCount * 2] = currentU;
      output[outputCount * 2 + 1] = currentV;
      outputCount++;
    }
  }
  return outputCount;
}

function barycentric(
  vertices: readonly number[],
  x: number,
  y: number,
  z: number,
): readonly [number, number, number] {
  const ab = [
    (vertices[3] ?? 0) - (vertices[0] ?? 0),
    (vertices[4] ?? 0) - (vertices[1] ?? 0),
    (vertices[5] ?? 0) - (vertices[2] ?? 0),
  ];
  const ac = [
    (vertices[6] ?? 0) - (vertices[0] ?? 0),
    (vertices[7] ?? 0) - (vertices[1] ?? 0),
    (vertices[8] ?? 0) - (vertices[2] ?? 0),
  ];
  const point = [x - (vertices[0] ?? 0), y - (vertices[1] ?? 0), z - (vertices[2] ?? 0)];
  const dot = (left: readonly number[], right: readonly number[]) =>
    (left[0] ?? 0) * (right[0] ?? 0) +
    (left[1] ?? 0) * (right[1] ?? 0) +
    (left[2] ?? 0) * (right[2] ?? 0);
  const d00 = dot(ab, ab);
  const d01 = dot(ab, ac);
  const d11 = dot(ac, ac);
  const d20 = dot(point, ab);
  const d21 = dot(point, ac);
  const denominator = d00 * d11 - d01 * d01;
  if (Math.abs(denominator) < 1e-20) return [1, 0, 0];
  const second = (d11 * d20 - d01 * d21) / denominator;
  const third = (d00 * d21 - d01 * d20) / denominator;
  return [1 - second - third, second, third];
}

function clippedSample(
  vertices: readonly number[],
  texcoords: readonly number[] | undefined,
  cellX: number,
  cellY: number,
  cellZ: number,
  minimumUFraction = 0,
  maximumUFraction = 1,
  minimumVFraction = 0,
  maximumVFraction = 1,
): ClippedSample | undefined {
  const abx = (vertices[3] ?? 0) - (vertices[0] ?? 0);
  const aby = (vertices[4] ?? 0) - (vertices[1] ?? 0);
  const abz = (vertices[5] ?? 0) - (vertices[2] ?? 0);
  const acx = (vertices[6] ?? 0) - (vertices[0] ?? 0);
  const acy = (vertices[7] ?? 0) - (vertices[1] ?? 0);
  const acz = (vertices[8] ?? 0) - (vertices[2] ?? 0);
  const normal = [aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx];
  const length = Math.hypot(normal[0] ?? 0, normal[1] ?? 0, normal[2] ?? 0);
  if (length < 1e-12) return undefined;
  const absolute = normal.map((value) => Math.abs(value));
  const dominant = absolute[0]! >= absolute[1]! && absolute[0]! >= absolute[2]!
    ? 0
    : absolute[1]! >= absolute[2]!
      ? 1
      : 2;
  const [uAxis, vAxis] = dominant === 0 ? [1, 2] : dominant === 1 ? [0, 2] : [0, 1];
  const projected = new Float64Array([
    vertices[uAxis] ?? 0,
    vertices[vAxis] ?? 0,
    vertices[3 + uAxis] ?? 0,
    vertices[3 + vAxis] ?? 0,
    vertices[6 + uAxis] ?? 0,
    vertices[6 + vAxis] ?? 0,
  ]);
  const first = new Float64Array(24);
  const second = new Float64Array(24);
  first.set(projected);
  const cell = [cellX, cellY, cellZ];
  let count = 3;
  count = clipBoundary(first, count, second, 0, (cell[uAxis] ?? 0) + minimumUFraction, true);
  count = clipBoundary(second, count, first, 0, (cell[uAxis] ?? 0) + maximumUFraction, false);
  count = clipBoundary(first, count, second, 1, (cell[vAxis] ?? 0) + minimumVFraction, true);
  count = clipBoundary(second, count, first, 1, (cell[vAxis] ?? 0) + maximumVFraction, false);
  if (count === 0) return undefined;
  let twiceArea = 0;
  let centroidU = 0;
  let centroidV = 0;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const u0 = first[index * 2] ?? 0;
    const v0 = first[index * 2 + 1] ?? 0;
    const u1 = first[next * 2] ?? 0;
    const v1 = first[next * 2 + 1] ?? 0;
    const cross = u0 * v1 - u1 * v0;
    twiceArea += cross;
    centroidU += (u0 + u1) * cross;
    centroidV += (v0 + v1) * cross;
  }
  if (Math.abs(twiceArea) < 1e-14) {
    centroidU = 0;
    centroidV = 0;
    for (let index = 0; index < count; index += 1) {
      centroidU += first[index * 2] ?? 0;
      centroidV += first[index * 2 + 1] ?? 0;
    }
    centroidU /= count;
    centroidV /= count;
  } else {
    centroidU /= 3 * twiceArea;
    centroidV /= 3 * twiceArea;
  }
  const point = [0, 0, 0];
  point[uAxis] = centroidU;
  point[vAxis] = centroidV;
  point[dominant] = (vertices[dominant] ?? 0) -
    ((normal[uAxis] ?? 0) * (centroidU - (vertices[uAxis] ?? 0)) +
      (normal[vAxis] ?? 0) * (centroidV - (vertices[vAxis] ?? 0))) /
      (normal[dominant] ?? 1);
  const weights = barycentric(vertices, point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
  const texture = texcoords === undefined
    ? [Number.NaN, Number.NaN]
    : [
        (texcoords[0] ?? 0) * weights[0] + (texcoords[2] ?? 0) * weights[1] + (texcoords[4] ?? 0) * weights[2],
        (texcoords[1] ?? 0) * weights[0] + (texcoords[3] ?? 0) * weights[1] + (texcoords[5] ?? 0) * weights[2],
      ];
  return {
    localX: (point[0] ?? 0) - cellX,
    localY: (point[1] ?? 0) - cellY,
    localZ: (point[2] ?? 0) - cellZ,
    normalX: (normal[0] ?? 0) / length,
    normalY: (normal[1] ?? 0) / length,
    normalZ: (normal[2] ?? 0) / length,
    u: texture[0] ?? Number.NaN,
    v: texture[1] ?? Number.NaN,
    weight: Math.abs(twiceArea) * 0.5 * length / Math.abs(normal[dominant] ?? 1),
  };
}

function defaultColorSampler(mesh: PackedTriangleMesh): SurfaceLinearColorSampler {
  return ({ materialId, u, v }) => sampleMeshMaterialLinear(mesh, materialId, u, v);
}

export function extractSurfaceSamples(
  mesh: PackedTriangleMesh,
  surface: PackedSparseSurface,
  options: ExtractSurfaceSamplesOptions = {},
): PackedSurfaceSamples {
  const maximum = options.maxSamplesPerCell ?? 32;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64) {
    throw new RangeError('maxSamplesPerCell must be an integer in 1..64');
  }
  const strata = options.strataPerAxis ?? 1;
  if (strata !== 1 && strata !== 2) {
    throw new RangeError('strataPerAxis must be 1 or 2');
  }
  const sampleColor = options.sampleLinearColor ?? defaultColorSampler(mesh);
  const cellOffsets = new Uint32Array(surface.cellCount + 1);
  const localPositions: number[] = [];
  const normals: number[] = [];
  const oklab: number[] = [];
  const sourceMaterialIds: number[] = [];
  const triangleIds: number[] = [];
  const uvs: number[] = [];
  const weights: number[] = [];
  for (let cellIndex = 0; cellIndex < surface.cellCount; cellIndex += 1) {
    cellOffsets[cellIndex] = weights.length;
    const candidates: Array<{ sample: ClippedSample; triangle: number }> = [];
    for (const triangle of getSparseCellTriangles(surface, cellIndex)) {
      const vertices: number[] = [];
      const texture: number[] = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = mesh.indices[triangle * 3 + corner] ?? 0;
        for (let axis = 0; axis < 3; axis += 1) {
          vertices.push((mesh.positions[vertex * 3 + axis] ?? 0) * surface.scale + (surface.origin[axis] ?? 0));
        }
        if (mesh.texcoords !== undefined) {
          texture.push(mesh.texcoords[vertex * 2] ?? 0, mesh.texcoords[vertex * 2 + 1] ?? 0);
        }
      }
      for (let stratumV = 0; stratumV < strata; stratumV += 1) {
        for (let stratumU = 0; stratumU < strata; stratumU += 1) {
          const sample = clippedSample(
            vertices,
            mesh.texcoords === undefined ? undefined : texture,
            surface.cellX[cellIndex] ?? 0,
            surface.cellY[cellIndex] ?? 0,
            surface.cellZ[cellIndex] ?? 0,
            stratumU / strata,
            (stratumU + 1) / strata,
            stratumV / strata,
            (stratumV + 1) / strata,
          );
          if (sample !== undefined) candidates.push({ sample, triangle });
        }
      }
    }
    candidates.sort((left, right) =>
      right.sample.weight - left.sample.weight || left.triangle - right.triangle);
    for (const { sample, triangle } of candidates.slice(0, maximum)) {
      const materialId = mesh.triangleMaterials[triangle] ?? 0;
      const color = sampleColor({ materialId, triangleId: triangle, u: sample.u, v: sample.v });
      const perceptual = linearSrgbToOklab(color);
      localPositions.push(sample.localX, sample.localY, sample.localZ);
      normals.push(
        Math.round(sample.normalX * 127),
        Math.round(sample.normalY * 127),
        Math.round(sample.normalZ * 127),
      );
      oklab.push(...perceptual);
      sourceMaterialIds.push(materialId);
      triangleIds.push(triangle);
      uvs.push(sample.u, sample.v);
      weights.push(Math.max(sample.weight, 1e-8));
    }
  }
  cellOffsets[surface.cellCount] = weights.length;
  return {
    cellOffsets,
    localPositions: Float32Array.from(localPositions),
    normals: Int8Array.from(normals),
    oklab: Float32Array.from(oklab),
    sourceMaterialIds: Uint32Array.from(sourceMaterialIds),
    triangleIds: Uint32Array.from(triangleIds),
    uvs: Float32Array.from(uvs),
    weights: Float32Array.from(weights),
  };
}
