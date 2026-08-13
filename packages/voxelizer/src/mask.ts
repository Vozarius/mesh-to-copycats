import type { Aabb16, Axis, Resolution } from '@mesh-to-copycats/shared';

export type OccupancyPredicate = (x16: number, y16: number, z16: number) => boolean;

export function wordCountForResolution(resolution: Resolution): number {
  return (resolution * resolution * resolution) >>> 5;
}

export function createMask(resolution: Resolution): Uint32Array {
  return new Uint32Array(wordCountForResolution(resolution));
}

export function bitIndex(
  resolution: Resolution,
  x: number,
  y: number,
  z: number,
): number {
  return x + resolution * (y + resolution * z);
}

export function getBit(mask: Uint32Array, index: number): boolean {
  const word = mask[index >>> 5] ?? 0;
  return ((word >>> (index & 31)) & 1) !== 0;
}

export function setBit(mask: Uint32Array, index: number): void {
  const wordIndex = index >>> 5;
  mask[wordIndex] = (mask[wordIndex] ?? 0) | (1 << (index & 31));
}

export function clearBit(mask: Uint32Array, index: number): void {
  const wordIndex = index >>> 5;
  mask[wordIndex] = (mask[wordIndex] ?? 0) & ~(1 << (index & 31));
}

export function maskFromPredicate(
  resolution: Resolution,
  predicate: OccupancyPredicate,
): Uint32Array {
  const mask = createMask(resolution);
  const scale = 16 / resolution;
  for (let z = 0; z < resolution; z += 1) {
    const z16 = (z + 0.5) * scale;
    for (let y = 0; y < resolution; y += 1) {
      const y16 = (y + 0.5) * scale;
      for (let x = 0; x < resolution; x += 1) {
        const x16 = (x + 0.5) * scale;
        if (predicate(x16, y16, z16)) {
          setBit(mask, bitIndex(resolution, x, y, z));
        }
      }
    }
  }
  return mask;
}

export function pointInsideAabb(x: number, y: number, z: number, box: Aabb16): boolean {
  return (
    x >= box.minX &&
    x < box.maxX &&
    y >= box.minY &&
    y < box.maxY &&
    z >= box.minZ &&
    z < box.maxZ
  );
}

export function maskFromAabbs(
  resolution: Resolution,
  boxes: readonly Aabb16[],
): Uint32Array {
  const mask = createMask(resolution);
  const scale = 16 / resolution;
  for (let z = 0; z < resolution; z += 1) {
    const minZ = z * scale;
    const maxZ = minZ + scale;
    for (let y = 0; y < resolution; y += 1) {
      const minY = y * scale;
      const maxY = minY + scale;
      for (let x = 0; x < resolution; x += 1) {
        const minX = x * scale;
        const maxX = minX + scale;
        const intersects = boxes.some(
          (box) =>
            box.maxX > minX &&
            box.minX < maxX &&
            box.maxY > minY &&
            box.minY < maxY &&
            box.maxZ > minZ &&
            box.minZ < maxZ,
        );
        if (intersects) setBit(mask, bitIndex(resolution, x, y, z));
      }
    }
  }
  return mask;
}

export function popcount32(value: number): number {
  let bits = value >>> 0;
  bits -= (bits >>> 1) & 0x5555_5555;
  bits = (bits & 0x3333_3333) + ((bits >>> 2) & 0x3333_3333);
  return (((bits + (bits >>> 4)) & 0x0f0f_0f0f) * 0x0101_0101) >>> 24;
}

export function popcountMask(mask: Uint32Array): number {
  let count = 0;
  for (const word of mask) {
    count += popcount32(word);
  }
  return count;
}

export function hammingDistance(
  left: Uint32Array,
  right: Uint32Array,
): number {
  if (left.length !== right.length) {
    throw new RangeError('Cannot compare occupancy masks of different sizes');
  }
  let count = 0;
  for (let index = 0; index < left.length; index += 1) {
    count += popcount32((left[index] ?? 0) ^ (right[index] ?? 0));
  }
  return count;
}

export function hammingDistanceAtOffset(
  target: Uint32Array,
  candidatePool: Uint32Array,
  candidateOffset: number,
): number {
  if (
    !Number.isInteger(candidateOffset) ||
    candidateOffset < 0 ||
    candidateOffset + target.length > candidatePool.length
  ) {
    throw new RangeError('Candidate mask offset is outside the packed pool');
  }
  let count = 0;
  for (let index = 0; index < target.length; index += 1) {
    count += popcount32(
      (target[index] ?? 0) ^ (candidatePool[candidateOffset + index] ?? 0),
    );
  }
  return count;
}

export function resampleMaskNearest(
  source: Uint32Array,
  sourceResolution: Resolution,
  targetResolution: Resolution,
): Uint32Array {
  if (source.length !== wordCountForResolution(sourceResolution)) {
    throw new RangeError('Source mask length does not match its resolution');
  }
  const result = createMask(targetResolution);
  if (sourceResolution > targetResolution) {
    const factor = sourceResolution / targetResolution;
    for (let z = 0; z < targetResolution; z += 1) {
      for (let y = 0; y < targetResolution; y += 1) {
        for (let x = 0; x < targetResolution; x += 1) {
          let occupied = false;
          for (let fineZ = z * factor; fineZ < (z + 1) * factor && !occupied; fineZ += 1) {
            for (let fineY = y * factor; fineY < (y + 1) * factor && !occupied; fineY += 1) {
              for (let fineX = x * factor; fineX < (x + 1) * factor; fineX += 1) {
                if (
                  getBit(
                    source,
                    bitIndex(sourceResolution, fineX, fineY, fineZ),
                  )
                ) {
                  occupied = true;
                  break;
                }
              }
            }
          }
          if (occupied) setBit(result, bitIndex(targetResolution, x, y, z));
        }
      }
    }
    return result;
  }
  for (let z = 0; z < targetResolution; z += 1) {
    const sourceZ = Math.floor(((z + 0.5) * sourceResolution) / targetResolution);
    for (let y = 0; y < targetResolution; y += 1) {
      const sourceY = Math.floor(((y + 0.5) * sourceResolution) / targetResolution);
      for (let x = 0; x < targetResolution; x += 1) {
        const sourceX = Math.floor(((x + 0.5) * sourceResolution) / targetResolution);
        if (getBit(source, bitIndex(sourceResolution, sourceX, sourceY, sourceZ))) {
          setBit(result, bitIndex(targetResolution, x, y, z));
        }
      }
    }
  }
  return result;
}

export function maskDifference(
  target: Uint32Array,
  candidate: Uint32Array,
): { extra: Uint32Array; missing: Uint32Array } {
  if (target.length !== candidate.length) {
    throw new RangeError('Cannot diff occupancy masks of different sizes');
  }
  const missing = new Uint32Array(target.length);
  const extra = new Uint32Array(target.length);
  for (let index = 0; index < target.length; index += 1) {
    const targetWord = target[index] ?? 0;
    const candidateWord = candidate[index] ?? 0;
    missing[index] = targetWord & ~candidateWord;
    extra[index] = candidateWord & ~targetWord;
  }
  return { extra, missing };
}

export function maskToHex(mask: Uint32Array): string {
  return Array.from(mask, (word) => word.toString(16).padStart(8, '0')).join('');
}

export function maskFromHex(hex: string, resolution: Resolution): Uint32Array {
  const wordCount = wordCountForResolution(resolution);
  if (hex.length !== wordCount * 8 || !/^[0-9a-f]+$/iu.test(hex)) {
    throw new RangeError(`Expected ${wordCount * 8} hexadecimal characters`);
  }
  const mask = createMask(resolution);
  for (let index = 0; index < wordCount; index += 1) {
    mask[index] = Number.parseInt(hex.slice(index * 8, index * 8 + 8), 16);
  }
  return mask;
}

export function rotateMaskYClockwise(
  mask: Uint32Array,
  resolution: Resolution,
): Uint32Array {
  const result = createMask(resolution);
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!getBit(mask, bitIndex(resolution, x, y, z))) continue;
        const nextX = resolution - 1 - z;
        const nextZ = x;
        setBit(result, bitIndex(resolution, nextX, y, nextZ));
      }
    }
  }
  return result;
}

export function mirrorMask(
  mask: Uint32Array,
  resolution: Resolution,
  axis: Axis,
): Uint32Array {
  const result = createMask(resolution);
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!getBit(mask, bitIndex(resolution, x, y, z))) continue;
        const nextX = axis === 'x' ? resolution - 1 - x : x;
        const nextY = axis === 'y' ? resolution - 1 - y : y;
        const nextZ = axis === 'z' ? resolution - 1 - z : z;
        setBit(result, bitIndex(resolution, nextX, nextY, nextZ));
      }
    }
  }
  return result;
}

export function axisProfile(
  mask: Uint32Array,
  resolution: Resolution,
  axis: Axis,
): Float32Array {
  const profile = new Float32Array(resolution);
  const denominator = resolution * resolution;
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        if (!getBit(mask, bitIndex(resolution, x, y, z))) continue;
        const coordinate = axis === 'x' ? x : axis === 'y' ? y : z;
        profile[coordinate] = (profile[coordinate] ?? 0) + 1 / denominator;
      }
    }
  }
  return profile;
}

export function validateMask(mask: Uint32Array, resolution: Resolution): void {
  if (mask.length !== wordCountForResolution(resolution)) {
    throw new RangeError(
      `Resolution ${resolution} requires ${wordCountForResolution(resolution)} words, got ${mask.length}`,
    );
  }
}
