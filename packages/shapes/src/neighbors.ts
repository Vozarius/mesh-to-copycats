import { NO_OFFSET } from '@mesh-to-copycats/shared';

import type { PackedSparseSurface } from '@mesh-to-copycats/voxelizer';

import type { PackedShapeCatalog } from './catalog.js';
import { exactGeometryKeyFromAabbs } from './exact.js';
import type { GeneratedCatalogExtractionMetadata } from './generated.js';

const MAGIC = Uint8Array.from([77, 50, 67, 78, 69, 73, 71, 0]);
const VERSION = 1;
const HEADER_BYTES = 32;

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function direction(offset: readonly [number, number, number]): number {
  const key = offset.join(',');
  const index = ['0,-1,0', '1,0,0', '0,0,-1', '0,0,1', '0,1,0', '-1,0,0'].indexOf(key);
  if (index < 0) throw new Error(`Invalid neighbor offset ${key}`);
  return index;
}

export interface PackedNeighborTransitionsData {
  readonly directions: Uint8Array;
  readonly neighborShapeIds: Uint32Array;
  readonly resolvedGeometryIds: Uint32Array;
  readonly resolvedShapeIds: Uint32Array;
  readonly shapeOffsets: Uint32Array;
}

export class PackedNeighborTransitions implements PackedNeighborTransitionsData {
  public readonly directions: Uint8Array;
  public readonly neighborShapeIds: Uint32Array;
  public readonly resolvedGeometryIds: Uint32Array;
  public readonly resolvedShapeIds: Uint32Array;
  public readonly shapeOffsets: Uint32Array;

  public constructor(data: PackedNeighborTransitionsData) {
    const entries = data.directions.length;
    if (
      data.neighborShapeIds.length !== entries ||
      data.resolvedGeometryIds.length !== entries ||
      data.resolvedShapeIds.length !== entries ||
      data.shapeOffsets.length === 0 ||
      data.shapeOffsets[data.shapeOffsets.length - 1] !== entries
    ) throw new Error('Neighbor transition array lengths are inconsistent');
    this.directions = data.directions;
    this.neighborShapeIds = data.neighborShapeIds;
    this.resolvedGeometryIds = data.resolvedGeometryIds;
    this.resolvedShapeIds = data.resolvedShapeIds;
    this.shapeOffsets = data.shapeOffsets;
  }

  public find(shapeId: number, directionId: number, neighborShapeId: number): number {
    const start = this.shapeOffsets[shapeId] ?? 0;
    const end = this.shapeOffsets[shapeId + 1] ?? start;
    for (let index = start; index < end; index += 1) {
      const candidateDirection = this.directions[index] ?? 0;
      if (candidateDirection > directionId) break;
      if (candidateDirection === directionId && this.neighborShapeIds[index] === neighborShapeId) return index;
    }
    return NO_OFFSET;
  }
}

export function compileNeighborTransitions(
  catalog: PackedShapeCatalog,
  extraction: GeneratedCatalogExtractionMetadata,
): PackedNeighborTransitions {
  if (extraction.shapes.length !== catalog.shapeCount) throw new Error('Neighbor evidence shape count mismatch');
  const geometryByKey = new Map(catalog.geometryKeys.map((key, index) => [key, index]));
  const directions: number[] = [];
  const neighborShapeIds: number[] = [];
  const resolvedGeometryIds: number[] = [];
  const resolvedShapeIds: number[] = [];
  const shapeOffsets = new Uint32Array(catalog.shapeCount + 1);
  for (let shapeId = 0; shapeId < catalog.shapeCount; shapeId += 1) {
    shapeOffsets[shapeId] = directions.length;
    const evidence = extraction.shapes[shapeId]!.neighborDependencies;
    const entries = evidence.status === 'SUPPORTED'
      ? evidence.probes.filter((probe) => probe.changesShape || probe.changesState).map((probe) => {
          const neighborShapeId = catalog.findShapeId(probe.neighborBlockId, probe.neighborState);
          const resolvedShapeId = catalog.findShapeId(probe.resolvedBlockId, probe.resolvedState);
          const geometryId = geometryByKey.get(exactGeometryKeyFromAabbs(probe.boxes.map((box) => ({
            maxX: box[3], maxY: box[4], maxZ: box[5],
            minX: box[0], minY: box[1], minZ: box[2],
          }))));
          if (neighborShapeId === undefined || resolvedShapeId === undefined || geometryId === undefined) {
            throw new Error(`Neighbor transition for shape ${shapeId} references an unknown shape/geometry`);
          }
          return { direction: direction(probe.offset), geometryId, neighborShapeId, resolvedShapeId };
        }).sort((left, right) =>
          left.direction - right.direction || left.neighborShapeId - right.neighborShapeId)
      : [];
    for (const entry of entries) {
      directions.push(entry.direction);
      neighborShapeIds.push(entry.neighborShapeId);
      resolvedGeometryIds.push(entry.geometryId);
      resolvedShapeIds.push(entry.resolvedShapeId);
    }
  }
  shapeOffsets[catalog.shapeCount] = directions.length;
  return new PackedNeighborTransitions({
    directions: Uint8Array.from(directions),
    neighborShapeIds: Uint32Array.from(neighborShapeIds),
    resolvedGeometryIds: Uint32Array.from(resolvedGeometryIds),
    resolvedShapeIds: Uint32Array.from(resolvedShapeIds),
    shapeOffsets,
  });
}

export function encodeNeighborTransitions(transitions: PackedNeighborTransitions): Uint8Array {
  const entries = transitions.directions.length;
  const payloadLength = transitions.shapeOffsets.byteLength + entries * 12 + entries;
  const output = new Uint8Array(HEADER_BYTES + payloadLength);
  output.set(MAGIC);
  const view = new DataView(output.buffer);
  view.setUint32(8, VERSION, true);
  view.setUint32(12, transitions.shapeOffsets.length - 1, true);
  view.setUint32(16, entries, true);
  let offset = HEADER_BYTES;
  for (const values of [
    transitions.shapeOffsets,
    transitions.neighborShapeIds,
    transitions.resolvedGeometryIds,
    transitions.resolvedShapeIds,
  ]) {
    new Uint32Array(output.buffer, offset, values.length).set(values);
    offset += values.byteLength;
  }
  output.set(transitions.directions, offset);
  view.setUint32(20, crc32(output.subarray(HEADER_BYTES)), true);
  return output;
}

export function decodeNeighborTransitions(bytes: Uint8Array): PackedNeighborTransitions {
  if (bytes.length < HEADER_BYTES || MAGIC.some((value, index) => bytes[index] !== value)) {
    throw new Error('Neighbor transition artifact magic is invalid');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8, true) !== VERSION) throw new Error('Neighbor transition version is unsupported');
  const shapeCount = view.getUint32(12, true);
  const entries = view.getUint32(16, true);
  const expected = HEADER_BYTES + (shapeCount + 1) * 4 + entries * 13;
  if (bytes.length !== expected || view.getUint32(20, true) !== crc32(bytes.subarray(HEADER_BYTES))) {
    throw new Error('Neighbor transition artifact length/checksum is invalid');
  }
  let offset = HEADER_BYTES;
  const u32 = (length: number): Uint32Array => {
    const result = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + offset, bytes.byteOffset + offset + length * 4));
    offset += length * 4;
    return result;
  };
  return new PackedNeighborTransitions({
    shapeOffsets: u32(shapeCount + 1),
    neighborShapeIds: u32(entries),
    resolvedGeometryIds: u32(entries),
    resolvedShapeIds: u32(entries),
    directions: bytes.slice(offset),
  });
}

export interface NeighborResolutionResult {
  readonly changedCells: number;
  readonly geometryIds: Uint32Array;
  readonly iterations: number;
  readonly shapeIds: Uint32Array;
}

export function resolveSparseNeighbors(options: {
  readonly catalog: PackedShapeCatalog;
  readonly maxIterations?: number;
  readonly shapeIds: Uint32Array;
  readonly surface: Pick<PackedSparseSurface, 'cellX' | 'cellY' | 'cellZ'>;
  readonly transitions: PackedNeighborTransitions;
}): NeighborResolutionResult {
  const maximum = options.maxIterations ?? 4;
  const airShapeId = options.catalog.findShapeId('minecraft:air', '') ??
    options.catalog.blockIds.findIndex((blockId, shapeId) =>
      blockId.endsWith(':air') && (options.catalog.states[shapeId] ?? '') === '');
  if (airShapeId < 0) throw new Error('Catalog contains no AIR realization');
  const cells = new Map<string, number>();
  for (let cell = 0; cell < options.shapeIds.length; cell += 1) {
    cells.set(`${options.surface.cellX[cell]},${options.surface.cellY[cell]},${options.surface.cellZ[cell]}`, cell);
  }
  let current = options.shapeIds.slice();
  const geometryIds = Uint32Array.from(current, (shapeId) => options.catalog.shapeGeometry[shapeId] ?? 0);
  let changedCells = 0;
  let iterations = 0;
  const offsets = [[0, -1, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [-1, 0, 0]] as const;
  for (; iterations < maximum; iterations += 1) {
    const next = current.slice();
    let changed = 0;
    for (let cell = 0; cell < current.length; cell += 1) {
      let shapeId = current[cell] ?? 0;
      for (let directionId = 0; directionId < offsets.length; directionId += 1) {
        const offset = offsets[directionId]!;
        const neighborCell = cells.get(`${(options.surface.cellX[cell] ?? 0) + offset[0]},${(options.surface.cellY[cell] ?? 0) + offset[1]},${(options.surface.cellZ[cell] ?? 0) + offset[2]}`);
        const neighborShapeId = neighborCell === undefined ? airShapeId : current[neighborCell] ?? airShapeId;
        const transition = options.transitions.find(shapeId, directionId, neighborShapeId);
        if (transition === NO_OFFSET) continue;
        shapeId = options.transitions.resolvedShapeIds[transition] ?? shapeId;
        geometryIds[cell] = options.transitions.resolvedGeometryIds[transition] ?? geometryIds[cell] ?? 0;
      }
      next[cell] = shapeId;
      if (shapeId !== current[cell]) changed++;
    }
    current = next;
    changedCells += changed;
    if (changed === 0) {
      iterations++;
      break;
    }
  }
  return { changedCells, geometryIds, iterations, shapeIds: current };
}
