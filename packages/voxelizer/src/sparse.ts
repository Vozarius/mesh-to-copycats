import type { SurfaceStatistics } from './descriptor.js';
import { bitIndex, createMask, getBit, setBit } from './mask.js';
import { AdaptiveOccupancy } from './occupancy.js';

const CELL_COORDINATE_BITS = 21;
const CELL_COORDINATE_BIAS = 1 << (CELL_COORDINATE_BITS - 1);
const CELL_COORDINATE_MIN = -CELL_COORDINATE_BIAS;
const CELL_COORDINATE_MAX = CELL_COORDINATE_BIAS - 1;
const CELL_COMPONENT_MASK = (1n << BigInt(CELL_COORDINATE_BITS)) - 1n;

export interface TriangleMeshView {
  readonly indices: Uint32Array;
  readonly positions: Float32Array;
}

export interface SparseRasterizeOptions {
  readonly epsilon?: number;
  readonly origin?: readonly [x: number, y: number, z: number];
  readonly scale?: number;
}

export interface PackedSparseSurface {
  readonly bounds: Int32Array;
  readonly cellCount: number;
  readonly cellKeys: BigUint64Array;
  readonly cellX: Int32Array;
  readonly cellY: Int32Array;
  readonly cellZ: Int32Array;
  readonly epsilon: number;
  readonly origin: Float64Array;
  readonly scale: number;
  readonly skippedDegenerateTriangles: number;
  readonly triangleIndices: Uint32Array;
  readonly triangleOffsets: Uint32Array;
}

interface GridBounds {
  readonly maximum: number;
  readonly minimum: number;
}

function growInt32(source: Int32Array): Int32Array<ArrayBuffer> {
  const result = new Int32Array(Math.max(16, source.length * 2));
  result.set(source);
  return result;
}

function growUint32(source: Uint32Array): Uint32Array<ArrayBuffer> {
  const result = new Uint32Array(Math.max(16, source.length * 2));
  result.set(source);
  return result;
}

function encodeCellKey(x: number, y: number, z: number): bigint {
  for (const coordinate of [x, y, z]) {
    if (
      !Number.isInteger(coordinate) ||
      coordinate < CELL_COORDINATE_MIN ||
      coordinate > CELL_COORDINATE_MAX
    ) {
      throw new RangeError(
        `Sparse cell coordinate ${coordinate} exceeds ${CELL_COORDINATE_BITS}-bit signed range`,
      );
    }
  }
  return (
    (BigInt(x + CELL_COORDINATE_BIAS) << 42n) |
    (BigInt(y + CELL_COORDINATE_BIAS) << 21n) |
    BigInt(z + CELL_COORDINATE_BIAS)
  );
}

export function decodeSparseCellKey(key: bigint): readonly [number, number, number] {
  if (key < 0n || key >= (1n << 63n)) throw new RangeError('Sparse cell key is out of range');
  return [
    Number((key >> 42n) & CELL_COMPONENT_MASK) - CELL_COORDINATE_BIAS,
    Number((key >> 21n) & CELL_COMPONENT_MASK) - CELL_COORDINATE_BIAS,
    Number(key & CELL_COMPONENT_MASK) - CELL_COORDINATE_BIAS,
  ];
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
    const previousIndex = (index + count - 1) % count;
    const previousU = input[previousIndex * 2] ?? 0;
    const previousV = input[previousIndex * 2 + 1] ?? 0;
    const currentU = input[index * 2] ?? 0;
    const currentV = input[index * 2 + 1] ?? 0;
    const previousValue = axis === 0 ? previousU : previousV;
    const currentValue = axis === 0 ? currentU : currentV;
    const previousInside = keepGreater
      ? previousValue >= boundary
      : previousValue <= boundary;
    const currentInside = keepGreater
      ? currentValue >= boundary
      : currentValue <= boundary;
    if (previousInside !== currentInside) {
      const denominator = currentValue - previousValue;
      const t = denominator === 0 ? 0 : (boundary - previousValue) / denominator;
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

function rasterizeTriangleCells(
  vertices: readonly number[],
  epsilon: number,
  emit: (x: number, y: number, z: number) => void,
  bounds?: GridBounds,
): boolean {
  const ax = vertices[0] ?? 0;
  const ay = vertices[1] ?? 0;
  const az = vertices[2] ?? 0;
  const abx = (vertices[3] ?? 0) - ax;
  const aby = (vertices[4] ?? 0) - ay;
  const abz = (vertices[5] ?? 0) - az;
  const acx = (vertices[6] ?? 0) - ax;
  const acy = (vertices[7] ?? 0) - ay;
  const acz = (vertices[8] ?? 0) - az;
  const normal = [
    aby * acz - abz * acy,
    abz * acx - abx * acz,
    abx * acy - aby * acx,
  ];
  const normalLengthSquared = normal[0]! ** 2 + normal[1]! ** 2 + normal[2]! ** 2;
  if (normalLengthSquared <= epsilon * epsilon) return false;
  const absolute = normal.map((component) => Math.abs(component));
  const dominant = absolute[0]! >= absolute[1]! && absolute[0]! >= absolute[2]!
    ? 0
    : absolute[1]! >= absolute[2]!
      ? 1
      : 2;
  const [uAxis, vAxis] = dominant === 0 ? [1, 2] : dominant === 1 ? [0, 2] : [0, 1];
  const vertex = (corner: number, axis: number): number => vertices[corner * 3 + axis] ?? 0;
  const u0 = vertex(0, uAxis);
  const v0 = vertex(0, vAxis);
  const projected = [
    u0,
    v0,
    vertex(1, uAxis),
    vertex(1, vAxis),
    vertex(2, uAxis),
    vertex(2, vAxis),
  ];
  let minimumU = Math.floor(Math.min(projected[0]!, projected[2]!, projected[4]!) - epsilon);
  let maximumU = Math.floor(Math.max(projected[0]!, projected[2]!, projected[4]!) + epsilon);
  let minimumV = Math.floor(Math.min(projected[1]!, projected[3]!, projected[5]!) - epsilon);
  let maximumV = Math.floor(Math.max(projected[1]!, projected[3]!, projected[5]!) + epsilon);
  if (bounds !== undefined) {
    minimumU = Math.max(minimumU, bounds.minimum);
    maximumU = Math.min(maximumU, bounds.maximum);
    minimumV = Math.max(minimumV, bounds.minimum);
    maximumV = Math.min(maximumV, bounds.maximum);
  }
  const first = new Float64Array(24);
  const second = new Float64Array(24);
  const originD = vertex(0, dominant);
  const normalD = normal[dominant]!;
  const normalU = normal[uAxis]!;
  const normalV = normal[vAxis]!;
  for (let cellV = minimumV; cellV <= maximumV; cellV += 1) {
    for (let cellU = minimumU; cellU <= maximumU; cellU += 1) {
      first.set(projected, 0);
      let count = 3;
      count = clipBoundary(first, count, second, 0, cellU - epsilon, true);
      count = clipBoundary(second, count, first, 0, cellU + 1 + epsilon, false);
      count = clipBoundary(first, count, second, 1, cellV - epsilon, true);
      count = clipBoundary(second, count, first, 1, cellV + 1 + epsilon, false);
      if (count === 0) continue;
      let minimumD = Number.POSITIVE_INFINITY;
      let maximumD = Number.NEGATIVE_INFINITY;
      for (let point = 0; point < count; point += 1) {
        const u = first[point * 2] ?? 0;
        const v = first[point * 2 + 1] ?? 0;
        const d = originD - (normalU * (u - u0) + normalV * (v - v0)) / normalD;
        minimumD = Math.min(minimumD, d);
        maximumD = Math.max(maximumD, d);
      }
      let firstD = Math.floor(minimumD - epsilon);
      let lastD = Math.floor(maximumD + epsilon);
      if (bounds !== undefined) {
        firstD = Math.max(firstD, bounds.minimum);
        lastD = Math.min(lastD, bounds.maximum);
      }
      for (let cellD = firstD; cellD <= lastD; cellD += 1) {
        const coordinates = [0, 0, 0];
        coordinates[dominant] = cellD;
        coordinates[uAxis] = cellU;
        coordinates[vAxis] = cellV;
        emit(coordinates[0]!, coordinates[1]!, coordinates[2]!);
      }
    }
  }
  return true;
}

function assertMesh(mesh: TriangleMeshView): void {
  if (mesh.positions.length % 3 !== 0 || mesh.indices.length % 3 !== 0) {
    throw new Error('Mesh positions and indices must describe indexed triangles');
  }
  const vertexCount = mesh.positions.length / 3;
  for (const index of mesh.indices) {
    if (index >= vertexCount) throw new RangeError(`Mesh index ${index} is out of range`);
  }
}

export function rasterizeSparseSurface(
  mesh: TriangleMeshView,
  options: SparseRasterizeOptions = {},
): PackedSparseSurface {
  assertMesh(mesh);
  const scale = options.scale ?? 1;
  const epsilon = options.epsilon ?? 1e-9;
  const origin = options.origin ?? [0, 0, 0];
  if (!Number.isFinite(scale) || scale === 0) throw new RangeError('scale must be finite and non-zero');
  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError('epsilon must be finite and non-negative');
  }
  let cellX = new Int32Array(1024);
  let cellY = new Int32Array(1024);
  let cellZ = new Int32Array(1024);
  let cellHead = new Int32Array(1024);
  cellHead.fill(-1);
  let linkTriangles = new Uint32Array(2048);
  let linkNext = new Int32Array(2048);
  const cellIndexes = new Map<bigint, number>();
  const cellKeys: bigint[] = [];
  let cellCount = 0;
  let linkCount = 0;
  let skippedDegenerateTriangles = 0;

  const add = (x: number, y: number, z: number, triangle: number): void => {
    const key = encodeCellKey(x, y, z);
    let cell = cellIndexes.get(key);
    if (cell === undefined) {
      cell = cellCount++;
      if (cell >= cellX.length) {
        cellX = growInt32(cellX);
        cellY = growInt32(cellY);
        cellZ = growInt32(cellZ);
        const grownHead = growInt32(cellHead);
        grownHead.fill(-1, cellHead.length);
        cellHead = grownHead;
      }
      cellIndexes.set(key, cell);
      cellKeys[cell] = key;
      cellX[cell] = x;
      cellY[cell] = y;
      cellZ[cell] = z;
      cellHead[cell] = -1;
    }
    if (linkCount >= linkTriangles.length) {
      linkTriangles = growUint32(linkTriangles);
      linkNext = growInt32(linkNext);
    }
    linkTriangles[linkCount] = triangle;
    linkNext[linkCount] = cellHead[cell] ?? -1;
    cellHead[cell] = linkCount;
    linkCount++;
  };

  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const vertices: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[triangle * 3 + corner] ?? 0;
      for (let axis = 0; axis < 3; axis += 1) {
        vertices.push((mesh.positions[index * 3 + axis] ?? 0) * scale + (origin[axis] ?? 0));
      }
    }
    if (!rasterizeTriangleCells(vertices, epsilon, (x, y, z) => {
      add(x, y, z, triangle);
    })) {
      skippedDegenerateTriangles++;
    }
  }

  const order = Array.from({ length: cellCount }, (_, index) => index).sort((left, right) => {
    const leftKey = cellKeys[left]!;
    const rightKey = cellKeys[right]!;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const outputX = new Int32Array(cellCount);
  const outputY = new Int32Array(cellCount);
  const outputZ = new Int32Array(cellCount);
  const outputKeys = new BigUint64Array(cellCount);
  const triangleOffsets = new Uint32Array(cellCount + 1);
  const outputTriangles = new Uint32Array(linkCount);
  const bounds = new Int32Array([0, 0, 0, 0, 0, 0]);
  let triangleCursor = 0;
  for (let outputCell = 0; outputCell < order.length; outputCell += 1) {
    const sourceCell = order[outputCell]!;
    const x = cellX[sourceCell] ?? 0;
    const y = cellY[sourceCell] ?? 0;
    const z = cellZ[sourceCell] ?? 0;
    outputX[outputCell] = x;
    outputY[outputCell] = y;
    outputZ[outputCell] = z;
    outputKeys[outputCell] = cellKeys[sourceCell]!;
    if (outputCell === 0) bounds.set([x, y, z, x, y, z]);
    else {
      bounds[0] = Math.min(bounds[0] ?? x, x);
      bounds[1] = Math.min(bounds[1] ?? y, y);
      bounds[2] = Math.min(bounds[2] ?? z, z);
      bounds[3] = Math.max(bounds[3] ?? x, x);
      bounds[4] = Math.max(bounds[4] ?? y, y);
      bounds[5] = Math.max(bounds[5] ?? z, z);
    }
    triangleOffsets[outputCell] = triangleCursor;
    const reversed: number[] = [];
    for (let link = cellHead[sourceCell] ?? -1; link >= 0; link = linkNext[link] ?? -1) {
      reversed.push(linkTriangles[link] ?? 0);
    }
    for (let index = reversed.length - 1; index >= 0; index -= 1) {
      outputTriangles[triangleCursor++] = reversed[index] ?? 0;
    }
  }
  triangleOffsets[cellCount] = triangleCursor;
  return {
    bounds,
    cellCount,
    cellKeys: outputKeys,
    cellX: outputX,
    cellY: outputY,
    cellZ: outputZ,
    epsilon,
    origin: Float64Array.from(origin),
    scale,
    skippedDegenerateTriangles,
    triangleIndices: outputTriangles,
    triangleOffsets,
  };
}

export function getSparseCellTriangles(
  surface: PackedSparseSurface,
  cellIndex: number,
): Uint32Array {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= surface.cellCount) {
    throw new RangeError(`Sparse cell ${cellIndex} is out of range`);
  }
  const start = surface.triangleOffsets[cellIndex] ?? 0;
  const end = surface.triangleOffsets[cellIndex + 1] ?? start;
  return surface.triangleIndices.subarray(start, end);
}

export function rasterizeSparseCellMask16(
  mesh: TriangleMeshView,
  surface: PackedSparseSurface,
  cellIndex: number,
): Uint32Array {
  assertMesh(mesh);
  const triangles = getSparseCellTriangles(surface, cellIndex);
  const cellX = surface.cellX[cellIndex] ?? 0;
  const cellY = surface.cellY[cellIndex] ?? 0;
  const cellZ = surface.cellZ[cellIndex] ?? 0;
  const cell = [cellX, cellY, cellZ];
  const mask = createMask(16);
  for (const triangle of triangles) {
    const vertices: number[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const index = mesh.indices[triangle * 3 + corner] ?? 0;
      for (let axis = 0; axis < 3; axis += 1) {
        const world = (mesh.positions[index * 3 + axis] ?? 0) * surface.scale +
          (surface.origin[axis] ?? 0);
        vertices.push((world - (cell[axis] ?? 0)) * 16);
      }
    }
    rasterizeTriangleCells(
      vertices,
      surface.epsilon * 16,
      (x, y, z) => {
        setBit(mask, bitIndex(16, x, y, z));
      },
      { maximum: 15, minimum: 0 },
    );
  }
  return mask;
}

export function createSparseCellOccupancy(
  mesh: TriangleMeshView,
  surface: PackedSparseSurface,
  cellIndex: number,
): AdaptiveOccupancy {
  return AdaptiveOccupancy.fromMask16(rasterizeSparseCellMask16(mesh, surface, cellIndex));
}

/** Expands every touched GRID16 voxel to its complete 8x8x8 octant. */
export function createSparseCellOctantOccupancy(
  mesh: TriangleMeshView,
  surface: PackedSparseSurface,
  cellIndex: number,
): AdaptiveOccupancy {
  const source = rasterizeSparseCellMask16(mesh, surface, cellIndex);
  const occupiedOctants = new Uint8Array(8);
  for (let z = 0; z < 16; z += 1) {
    for (let y = 0; y < 16; y += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (!getBit(source, bitIndex(16, x, y, z))) continue;
        occupiedOctants[(x >= 8 ? 1 : 0) | (y >= 8 ? 2 : 0) | (z >= 8 ? 4 : 0)] = 1;
      }
    }
  }
  const expanded = createMask(16);
  for (let octant = 0; octant < 8; octant += 1) {
    if (occupiedOctants[octant] === 0) continue;
    const startX = (octant & 1) === 0 ? 0 : 8;
    const startY = (octant & 2) === 0 ? 0 : 8;
    const startZ = (octant & 4) === 0 ? 0 : 8;
    for (let z = startZ; z < startZ + 8; z += 1) {
      for (let y = startY; y < startY + 8; y += 1) {
        for (let x = startX; x < startX + 8; x += 1) {
          setBit(expanded, bitIndex(16, x, y, z));
        }
      }
    }
  }
  return AdaptiveOccupancy.fromMask16(expanded);
}

function triangleUnitNormal(
  mesh: TriangleMeshView,
  triangle: number,
): readonly [x: number, y: number, z: number, area2: number] | undefined {
  const a = mesh.indices[triangle * 3] ?? 0;
  const b = mesh.indices[triangle * 3 + 1] ?? 0;
  const c = mesh.indices[triangle * 3 + 2] ?? 0;
  const ax = mesh.positions[a * 3] ?? 0;
  const ay = mesh.positions[a * 3 + 1] ?? 0;
  const az = mesh.positions[a * 3 + 2] ?? 0;
  const abx = (mesh.positions[b * 3] ?? 0) - ax;
  const aby = (mesh.positions[b * 3 + 1] ?? 0) - ay;
  const abz = (mesh.positions[b * 3 + 2] ?? 0) - az;
  const acx = (mesh.positions[c * 3] ?? 0) - ax;
  const acy = (mesh.positions[c * 3 + 1] ?? 0) - ay;
  const acz = (mesh.positions[c * 3 + 2] ?? 0) - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const area2 = Math.hypot(nx, ny, nz);
  return area2 <= 1e-15 ? undefined : [nx / area2, ny / area2, nz / area2, area2];
}

/** Area-weighted local normal statistics, with opposite winding treated as the same plane. */
export function getSparseCellSurfaceStatistics(
  mesh: TriangleMeshView,
  surface: PackedSparseSurface,
  cellIndex: number,
): SurfaceStatistics {
  const triangles = getSparseCellTriangles(surface, cellIndex);
  let reference: readonly number[] | undefined;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let total = 0;
  for (const triangle of triangles) {
    const normal = triangleUnitNormal(mesh, triangle);
    if (normal === undefined) continue;
    reference ??= normal;
    const alignment = (normal[0] * (reference[0] ?? 0) + normal[1] * (reference[1] ?? 0) +
      normal[2] * (reference[2] ?? 0)) < 0 ? -1 : 1;
    sumX += normal[0] * normal[3] * alignment;
    sumY += normal[1] * normal[3] * alignment;
    sumZ += normal[2] * normal[3] * alignment;
    total += normal[3];
  }
  const length = Math.hypot(sumX, sumY, sumZ);
  if (total === 0 || length === 0) {
    return { normalVariance: 1, normalX: 0, normalY: 0, normalZ: 0 };
  }
  const normalX = sumX / length;
  const normalY = sumY / length;
  const normalZ = sumZ / length;
  let variance = 0;
  for (const triangle of triangles) {
    const normal = triangleUnitNormal(mesh, triangle);
    if (normal === undefined) continue;
    const dot = Math.abs(normal[0] * normalX + normal[1] * normalY + normal[2] * normalZ);
    variance += (1 - Math.min(1, dot)) * normal[3];
  }
  return { normalVariance: variance / total, normalX, normalY, normalZ };
}
