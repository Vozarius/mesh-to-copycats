import type { Axis, Resolution } from '@mesh-to-copycats/shared';

import { bitIndex, getBit, popcountMask } from './mask.js';

export const DESCRIPTOR = {
  VOLUME: 0,
  OCTANT_0: 1,
  OCTANT_1: 2,
  OCTANT_2: 3,
  OCTANT_3: 4,
  OCTANT_4: 5,
  OCTANT_5: 6,
  OCTANT_6: 7,
  OCTANT_7: 8,
  FACE_PX: 9,
  FACE_NX: 10,
  FACE_PY: 11,
  FACE_NY: 12,
  FACE_PZ: 13,
  FACE_NZ: 14,
  CENTROID_X: 15,
  CENTROID_Y: 16,
  CENTROID_Z: 17,
  NORMAL_X: 18,
  NORMAL_Y: 19,
  NORMAL_Z: 20,
  NORMAL_VARIANCE: 21,
  LENGTH: 22,
} as const;

export type ShapeDescriptor = Float32Array;

export interface SurfaceStatistics {
  readonly normalVariance: number;
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
}

export function computeDescriptor(
  mask: Uint32Array,
  resolution: Resolution,
  surface?: SurfaceStatistics,
): ShapeDescriptor {
  const descriptor = new Float32Array(DESCRIPTOR.LENGTH);
  const occupied = popcountMask(mask);
  const total = resolution * resolution * resolution;
  descriptor[DESCRIPTOR.VOLUME] = occupied / total;
  if (occupied === 0) return descriptor;

  const half = resolution / 2;
  const octantDenominator = half * half * half;
  const faceDenominator = resolution * resolution;
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;

  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!getBit(mask, bitIndex(resolution, x, y, z))) continue;
        const octant = (x >= half ? 1 : 0) | (y >= half ? 2 : 0) | (z >= half ? 4 : 0);
        descriptor[DESCRIPTOR.OCTANT_0 + octant] =
          (descriptor[DESCRIPTOR.OCTANT_0 + octant] ?? 0) + 1 / octantDenominator;
        if (x === resolution - 1) descriptor[DESCRIPTOR.FACE_PX]! += 1 / faceDenominator;
        if (x === 0) descriptor[DESCRIPTOR.FACE_NX]! += 1 / faceDenominator;
        if (y === resolution - 1) descriptor[DESCRIPTOR.FACE_PY]! += 1 / faceDenominator;
        if (y === 0) descriptor[DESCRIPTOR.FACE_NY]! += 1 / faceDenominator;
        if (z === resolution - 1) descriptor[DESCRIPTOR.FACE_PZ]! += 1 / faceDenominator;
        if (z === 0) descriptor[DESCRIPTOR.FACE_NZ]! += 1 / faceDenominator;
        sumX += (x + 0.5) / resolution;
        sumY += (y + 0.5) / resolution;
        sumZ += (z + 0.5) / resolution;
      }
    }
  }

  descriptor[DESCRIPTOR.CENTROID_X] = sumX / occupied;
  descriptor[DESCRIPTOR.CENTROID_Y] = sumY / occupied;
  descriptor[DESCRIPTOR.CENTROID_Z] = sumZ / occupied;

  if (surface !== undefined) {
    descriptor[DESCRIPTOR.NORMAL_X] = surface.normalX;
    descriptor[DESCRIPTOR.NORMAL_Y] = surface.normalY;
    descriptor[DESCRIPTOR.NORMAL_Z] = surface.normalZ;
    descriptor[DESCRIPTOR.NORMAL_VARIANCE] = surface.normalVariance;
  } else {
    const normalX =
      (descriptor[DESCRIPTOR.FACE_PX] ?? 0) - (descriptor[DESCRIPTOR.FACE_NX] ?? 0);
    const normalY =
      (descriptor[DESCRIPTOR.FACE_PY] ?? 0) - (descriptor[DESCRIPTOR.FACE_NY] ?? 0);
    const normalZ =
      (descriptor[DESCRIPTOR.FACE_PZ] ?? 0) - (descriptor[DESCRIPTOR.FACE_NZ] ?? 0);
    const magnitude = Math.hypot(normalX, normalY, normalZ);
    if (magnitude > 0) {
      descriptor[DESCRIPTOR.NORMAL_X] = normalX / magnitude;
      descriptor[DESCRIPTOR.NORMAL_Y] = normalY / magnitude;
      descriptor[DESCRIPTOR.NORMAL_Z] = normalZ / magnitude;
    }
    const boundaryMass =
      (descriptor[DESCRIPTOR.FACE_PX] ?? 0) +
      (descriptor[DESCRIPTOR.FACE_NX] ?? 0) +
      (descriptor[DESCRIPTOR.FACE_PY] ?? 0) +
      (descriptor[DESCRIPTOR.FACE_NY] ?? 0) +
      (descriptor[DESCRIPTOR.FACE_PZ] ?? 0) +
      (descriptor[DESCRIPTOR.FACE_NZ] ?? 0);
    descriptor[DESCRIPTOR.NORMAL_VARIANCE] =
      boundaryMass === 0 ? 1 : 1 - Math.min(1, magnitude / boundaryMass);
  }
  return descriptor;
}

export function descriptorOctantMask(
  descriptor: ShapeDescriptor,
  threshold = 0.75,
): number {
  let mask = 0;
  for (let octant = 0; octant < 8; octant += 1) {
    if ((descriptor[DESCRIPTOR.OCTANT_0 + octant] ?? 0) >= threshold) {
      mask |= 1 << octant;
    }
  }
  return mask;
}

export function descriptorDominantAxis(descriptor: ShapeDescriptor): Axis {
  const x = Math.abs(descriptor[DESCRIPTOR.NORMAL_X] ?? 0);
  const y = Math.abs(descriptor[DESCRIPTOR.NORMAL_Y] ?? 0);
  const z = Math.abs(descriptor[DESCRIPTOR.NORMAL_Z] ?? 0);
  if (x >= y && x >= z) return 'x';
  return y >= z ? 'y' : 'z';
}
