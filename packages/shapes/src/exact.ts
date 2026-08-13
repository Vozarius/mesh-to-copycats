import type { Aabb16 } from '@mesh-to-copycats/shared';
import { maskFromAabbs, maskToHex } from '@mesh-to-copycats/voxelizer';

const GRID16_PREFIX = 'GRID16_EXACT:v1:';

export class UnsupportedExactGeometryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedExactGeometryError';
  }
}

export function box16(
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): Aabb16 {
  return { maxX, maxY, maxZ, minX, minY, minZ };
}

export function validateExactAabbs(boxes: readonly Aabb16[]): void {
  for (const box of boxes) {
    const coordinates = [
      box.minX,
      box.minY,
      box.minZ,
      box.maxX,
      box.maxY,
      box.maxZ,
    ];
    if (!coordinates.every(Number.isInteger)) {
      throw new UnsupportedExactGeometryError(
        'Milestone 1 exact keys only accept integer AABBs on the 0..16 lattice',
      );
    }
    if (
      box.minX < 0 ||
      box.minY < 0 ||
      box.minZ < 0 ||
      box.maxX > 16 ||
      box.maxY > 16 ||
      box.maxZ > 16 ||
      box.minX >= box.maxX ||
      box.minY >= box.maxY ||
      box.minZ >= box.maxZ
    ) {
      throw new UnsupportedExactGeometryError('Invalid exact AABB bounds');
    }
  }
}

/**
 * An exact identity for unions of integer-lattice AABBs. The 16³ payload is
 * exact here because the builder proved that every boundary lies on the unit
 * lattice. Arbitrary sampled geometry must never be assigned this key kind.
 */
export function exactGeometryKeyFromAabbs(boxes: readonly Aabb16[]): string {
  validateExactAabbs(boxes);
  return `${GRID16_PREFIX}${maskToHex(maskFromAabbs(16, boxes))}`;
}

export function isExactGrid16Key(key: string): boolean {
  return key.startsWith(GRID16_PREFIX);
}
