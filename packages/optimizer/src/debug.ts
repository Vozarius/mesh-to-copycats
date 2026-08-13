import type { PackedShapeCatalog } from '@mesh-to-copycats/shapes';
import type { Resolution } from '@mesh-to-copycats/shared';
import {
  bitIndex,
  getBit,
  maskDifference,
  maskToHex,
  popcountMask,
  type TargetOccupancy,
} from '@mesh-to-copycats/voxelizer';

export interface DebugMaskView {
  readonly hex: string;
  readonly slices: string[];
  readonly voxels: number;
}

export interface GeometryComparisonDebug {
  readonly candidate: DebugMaskView;
  readonly extra: DebugMaskView;
  readonly missing: DebugMaskView;
  readonly resolution: Resolution;
  readonly target: DebugMaskView;
}

export function formatMaskSlices(mask: Uint32Array, resolution: Resolution): string[] {
  const slices: string[] = [];
  for (let z = 0; z < resolution; z += 1) {
    const rows: string[] = [];
    for (let y = resolution - 1; y >= 0; y -= 1) {
      let row = '';
      for (let x = 0; x < resolution; x += 1) {
        row += getBit(mask, bitIndex(resolution, x, y, z)) ? '#' : '.';
      }
      rows.push(row);
    }
    slices.push(rows.join('\n'));
  }
  return slices;
}

function maskView(mask: Uint32Array, resolution: Resolution): DebugMaskView {
  return {
    hex: maskToHex(mask),
    slices: formatMaskSlices(mask, resolution),
    voxels: popcountMask(mask),
  };
}

export function compareGeometryMasks(
  occupancy: TargetOccupancy,
  catalog: PackedShapeCatalog,
  geometryId: number,
  resolution: Resolution,
): GeometryComparisonDebug {
  const target = occupancy.getMask(resolution);
  const candidate = catalog.getGeometryMask(geometryId, resolution);
  const { extra, missing } = maskDifference(target, candidate);
  return {
    candidate: maskView(candidate, resolution),
    extra: maskView(extra, resolution),
    missing: maskView(missing, resolution),
    resolution,
    target: maskView(target, resolution),
  };
}
