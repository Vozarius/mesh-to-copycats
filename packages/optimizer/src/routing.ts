import type { PackedShapeCatalog } from '@mesh-to-copycats/shapes';
import { ShapeFamily } from '@mesh-to-copycats/shared';
import {
  DESCRIPTOR,
  axisProfile,
  bitIndex,
  getBit,
  hammingDistanceAtOffset,
  popcountMask,
  type ShapeDescriptor,
} from '@mesh-to-copycats/voxelizer';

import type { OptimizerSettings } from './types.js';

export interface CandidateGenerationResult {
  readonly genericCount: number;
  readonly geometryIds: number[];
  readonly postingsScanned: number;
  readonly routedCount: number;
}

function addRoute(
  key: string,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  const postings = catalog.routeIndex.get(key);
  if (postings === undefined) return;
  for (const geometryId of postings) output.add(geometryId);
}

function nearestLayerCounts(volume: number): number[] {
  const estimate = Math.min(8, Math.max(1, volume * 8));
  const rounded = Math.round(estimate);
  const result = new Set<number>([rounded, Math.floor(estimate), Math.ceil(estimate)]);
  if (rounded > 1) result.add(rounded - 1);
  if (rounded < 8) result.add(rounded + 1);
  return [...result].filter((value) => value >= 1 && value <= 8);
}

function routeLinearFamilies(
  descriptor: ShapeDescriptor,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  const volume = descriptor[DESCRIPTOR.VOLUME] ?? 0;
  const layerCounts = nearestLayerCounts(volume);
  const faces = [
    ['east', DESCRIPTOR.FACE_PX, 1 << 5],
    ['west', DESCRIPTOR.FACE_NX, 1 << 4],
    ['up', DESCRIPTOR.FACE_PY, 1 << 1],
    ['down', DESCRIPTOR.FACE_NY, 1 << 0],
    ['south', DESCRIPTOR.FACE_PZ, 1 << 3],
    ['north', DESCRIPTOR.FACE_NZ, 1 << 2],
  ] as const;
  let inferredBoardMask = 0;

  for (const [direction, faceSlot, boardBit] of faces) {
    const faceFill = descriptor[faceSlot] ?? 0;
    if (faceFill >= 0.75) inferredBoardMask |= boardBit;
    if (faceFill < 0.2 && volume > 0.2) continue;
    for (const layers of layerCounts) addRoute(`LAYER:${direction}:${layers}`, output, catalog);
    if (volume <= 0.2 || faceFill >= 0.8) addRoute(`BOARD:${boardBit}`, output, catalog);
  }
  if (volume <= 0.4 && inferredBoardMask !== 0) {
    addRoute(`BOARD:${inferredBoardMask}`, output, catalog);
  }

  if (Math.abs(volume - 0.5) <= 0.2) {
    for (const axis of ['x', 'y', 'z'] as const) {
      addRoute(`SLAB:${axis}:bottom`, output, catalog);
      addRoute(`SLAB:${axis}:top`, output, catalog);
    }
  }
}

function inferredHalfLayerCounts(coarseRows: number): number[] {
  if (coarseRows === 0) return [0];
  return [...new Set([coarseRows * 2 - 1, coarseRows * 2])].filter(
    (layers) => layers >= 1 && layers <= 8,
  );
}

function routeHalfLayers(
  mask4: Uint32Array,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  for (const axis of ['x', 'z'] as const) {
    for (const half of ['bottom', 'top'] as const) {
      const rowCounts = [0, 0];
      for (let side = 0; side < 2; side += 1) {
        for (let step = 0; step < 4; step += 1) {
          const y = half === 'bottom' ? step : 3 - step;
          let occupied = false;
          for (let z = 0; z < 4 && !occupied; z += 1) {
            for (let x = 0; x < 4; x += 1) {
              const coordinate = axis === 'x' ? x : z;
              if ((coordinate >= 2 ? 1 : 0) !== side) continue;
              if (getBit(mask4, bitIndex(4, x, y, z))) {
                occupied = true;
                break;
              }
            }
          }
          if (!occupied) break;
          rowCounts[side] = (rowCounts[side] ?? 0) + 1;
        }
      }
      const negativeOptions = inferredHalfLayerCounts(rowCounts[0] ?? 0);
      const positiveOptions = inferredHalfLayerCounts(rowCounts[1] ?? 0);
      for (const negative of negativeOptions) {
        for (const positive of positiveOptions) {
          if (negative === 0 && positive === 0) continue;
          addRoute(
            `HALF_LAYER:${axis}:${half}:${negative}:${positive}`,
            output,
            catalog,
          );
        }
      }
    }
  }
}

function routeBytePanels(
  mask4: Uint32Array,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  const population = popcountMask(mask4);
  if (population === 0 || population > 40) return;
  for (const facing of ['down', 'up', 'north', 'south', 'west', 'east'] as const) {
    const quadrantCounts = [0, 0, 0, 0];
    let facePopulation = 0;
    for (let z = 0; z < 4; z += 1) {
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const onFace =
            (facing === 'down' && y === 0) ||
            (facing === 'up' && y === 3) ||
            (facing === 'north' && z === 0) ||
            (facing === 'south' && z === 3) ||
            (facing === 'west' && x === 0) ||
            (facing === 'east' && x === 3);
          if (!onFace || !getBit(mask4, bitIndex(4, x, y, z))) continue;
          facePopulation += 1;
          const horizontal =
            facing === 'west' || facing === 'east' ? z : x;
          const vertical = facing === 'down' || facing === 'up' ? z : y;
          const quadrant = (horizontal >= 2 ? 1 : 0) | (vertical >= 2 ? 2 : 0);
          quadrantCounts[quadrant] = (quadrantCounts[quadrant] ?? 0) + 1;
        }
      }
    }
    if (facePopulation * 4 < population * 3) continue;
    let partMask = 0;
    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      if ((quadrantCounts[quadrant] ?? 0) >= 2) partMask |= 1 << quadrant;
    }
    if (partMask !== 0) addRoute(`BYTE_PANEL:${facing}:${partMask}`, output, catalog);
  }
}

function routeBytes(
  descriptor: ShapeDescriptor,
  settings: OptimizerSettings,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  let fixedMask = 0;
  const ambiguous: number[] = [];
  for (let octant = 0; octant < 8; octant += 1) {
    const fill = descriptor[DESCRIPTOR.OCTANT_0 + octant] ?? 0;
    if (fill >= 0.75) fixedMask |= 1 << octant;
    else if (fill > 0.25) ambiguous.push(octant);
  }

  if (ambiguous.length > settings.maxAmbiguousByteBits) {
    ambiguous.sort((left, right) => {
      const leftDistance = Math.abs((descriptor[DESCRIPTOR.OCTANT_0 + left] ?? 0) - 0.5);
      const rightDistance = Math.abs((descriptor[DESCRIPTOR.OCTANT_0 + right] ?? 0) - 0.5);
      return leftDistance - rightDistance || left - right;
    });
    for (const bit of ambiguous.splice(settings.maxAmbiguousByteBits)) {
      if ((descriptor[DESCRIPTOR.OCTANT_0 + bit] ?? 0) >= 0.5) fixedMask |= 1 << bit;
    }
  }

  const combinations = 1 << ambiguous.length;
  for (let combination = 0; combination < combinations; combination += 1) {
    let mask = fixedMask;
    for (let bit = 0; bit < ambiguous.length; bit += 1) {
      if ((combination & (1 << bit)) !== 0) mask |= 1 << ambiguous[bit]!;
    }
    if (mask !== 0) addRoute(`BYTE:${mask}`, output, catalog);
  }
}

function inferStairFacing(mask4: Uint32Array, half: 'bottom' | 'top'): string {
  const inspectUpper = half === 'bottom';
  let count = 0;
  let sumX = 0;
  let sumZ = 0;
  for (let z = 0; z < 4; z += 1) {
    for (let y = 0; y < 4; y += 1) {
      if ((y >= 2) !== inspectUpper) continue;
      for (let x = 0; x < 4; x += 1) {
        if (!getBit(mask4, bitIndex(4, x, y, z))) continue;
        count += 1;
        sumX += x + 0.5;
        sumZ += z + 0.5;
      }
    }
  }
  if (count === 0) return 'south';
  const deltaX = sumX / count - 2;
  const deltaZ = sumZ / count - 2;
  if (Math.abs(deltaX) > Math.abs(deltaZ)) return deltaX >= 0 ? 'east' : 'west';
  return deltaZ >= 0 ? 'south' : 'north';
}

function routeStairs(
  mask4: Uint32Array,
  descriptor: ShapeDescriptor,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  const volume = descriptor[DESCRIPTOR.VOLUME] ?? 0;
  if (volume < 0.2 || volume > 0.95) return;
  const yProfile = axisProfile(mask4, 4, 'y');
  const lower = (yProfile[0] ?? 0) + (yProfile[1] ?? 0);
  const upper = (yProfile[2] ?? 0) + (yProfile[3] ?? 0);
  if (Math.abs(lower - upper) < 0.3) {
    const facing = inferStairFacing(mask4, 'bottom');
    for (const side of ['left', 'right']) {
      for (const shape of ['straight', 'outer_bottom', 'outer_top', 'inner_bottom', 'inner_top']) {
        addRoute(`VERTICAL_STAIRS:${facing}:${side}:${shape}`, output, catalog);
      }
    }
    return;
  }
  const half = lower > upper ? 'bottom' : 'top';
  const facing = inferStairFacing(mask4, half);
  for (const shape of ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right']) {
    addRoute(`STAIRS:${facing}:${half}:${shape}`, output, catalog);
  }
  for (const side of ['left', 'right']) {
    for (const shape of ['straight', 'outer_bottom', 'outer_top', 'inner_bottom', 'inner_top']) {
      addRoute(`VERTICAL_STAIRS:${facing}:${side}:${shape}`, output, catalog);
    }
  }
}

function routeSlices(
  descriptor: ShapeDescriptor,
  output: Set<number>,
  catalog: PackedShapeCatalog,
): void {
  const volume = descriptor[DESCRIPTOR.VOLUME] ?? 0;
  const centroidX = descriptor[DESCRIPTOR.CENTROID_X] ?? 0.5;
  const centroidY = descriptor[DESCRIPTOR.CENTROID_Y] ?? 0.5;
  const centroidZ = descriptor[DESCRIPTOR.CENTROID_Z] ?? 0.5;
  const facing =
    Math.abs(centroidX - 0.5) > Math.abs(centroidZ - 0.5)
      ? centroidX >= 0.5
        ? 'east'
        : 'west'
      : centroidZ >= 0.5
        ? 'south'
        : 'north';
  const half = centroidY >= 0.5 ? 'top' : 'bottom';
  const squareLayers = Math.min(8, Math.max(1, Math.round(Math.sqrt(volume) * 8)));
  const cubeLayers = Math.min(8, Math.max(1, Math.round(Math.cbrt(volume) * 8)));
  for (const layers of [squareLayers - 1, squareLayers, squareLayers + 1]) {
    if (layers < 1 || layers > 8) continue;
    addRoute(`SLICE:${facing}:${half}:${layers}`, output, catalog);
    addRoute(`VERTICAL_SLICE:${facing}:${layers}`, output, catalog);
  }
  for (const layers of [cubeLayers - 1, cubeLayers, cubeLayers + 1]) {
    if (layers < 1 || layers > 8) continue;
    addRoute(`CORNER_SLICE:${facing}:${half}:${layers}`, output, catalog);
  }
}

function descriptorDistance(
  target: ShapeDescriptor,
  catalog: PackedShapeCatalog,
  geometryId: number,
): number {
  const offset = geometryId * DESCRIPTOR.LENGTH;
  let distance =
    Math.abs((target[DESCRIPTOR.VOLUME] ?? 0) - (catalog.geometryDescriptors[offset] ?? 0)) * 8;
  for (let slot = DESCRIPTOR.OCTANT_0; slot <= DESCRIPTOR.OCTANT_7; slot += 1) {
    distance += Math.abs((target[slot] ?? 0) - (catalog.geometryDescriptors[offset + slot] ?? 0));
  }
  for (let slot = DESCRIPTOR.FACE_PX; slot <= DESCRIPTOR.FACE_NZ; slot += 1) {
    distance +=
      Math.abs((target[slot] ?? 0) - (catalog.geometryDescriptors[offset + slot] ?? 0)) * 0.5;
  }
  return distance;
}

function genericFallback(
  mask4: Uint32Array,
  descriptor: ShapeDescriptor,
  settings: OptimizerSettings,
  catalog: PackedShapeCatalog,
): { geometryIds: number[]; postingsScanned: number } {
  const targetPopulation = popcountMask(mask4);
  const ranked: Array<{ descriptor: number; geometryId: number; hamming: number }> = [];
  let postingsScanned = 0;
  const seen = new Uint8Array(catalog.geometryCount);

  for (let radius = 0; radius <= 64; radius += 1) {
    const populations = radius === 0 ? [targetPopulation] : [targetPopulation - radius, targetPopulation + radius];
    for (const population of populations) {
      if (population < 0 || population > 64) continue;
      const postings = catalog.popcount4Buckets[population]!;
      for (const geometryId of postings) {
        if (seen[geometryId] !== 0) continue;
        seen[geometryId] = 1;
        postingsScanned += 1;
        ranked.push({
          descriptor: descriptorDistance(descriptor, catalog, geometryId),
          geometryId,
          hamming: hammingDistanceAtOffset(
            mask4,
            catalog.masks4,
            geometryId * mask4.length,
          ),
        });
      }
    }
    if (ranked.length >= settings.maxGenericCandidates * 3) break;
  }

  ranked.sort(
    (left, right) =>
      left.hamming - right.hamming ||
      left.descriptor - right.descriptor ||
      left.geometryId - right.geometryId,
  );
  if (ranked.length <= settings.maxGenericCandidates) {
    return { geometryIds: ranked.map(({ geometryId }) => geometryId), postingsScanned };
  }
  const cutoff = ranked[settings.maxGenericCandidates - 1]!;
  let end = settings.maxGenericCandidates;
  while (
    end < ranked.length &&
    ranked[end]!.hamming === cutoff.hamming &&
    ranked[end]!.descriptor === cutoff.descriptor
  ) {
    end += 1;
  }
  return {
    geometryIds: ranked.slice(0, end).map(({ geometryId }) => geometryId),
    postingsScanned,
  };
}

export function generateCandidates(
  mask4: Uint32Array,
  descriptor: ShapeDescriptor,
  settings: OptimizerSettings,
  catalog: PackedShapeCatalog,
): CandidateGenerationResult {
  const routed = new Set<number>();
  const volume = descriptor[DESCRIPTOR.VOLUME] ?? 0;
  if (volume <= 0.02) addRoute('AIR', routed, catalog);
  if (volume >= 0.9) addRoute('FULL', routed, catalog);
  routeLinearFamilies(descriptor, routed, catalog);
  routeHalfLayers(mask4, routed, catalog);
  routeBytes(descriptor, settings, routed, catalog);
  routeBytePanels(mask4, routed, catalog);
  routeStairs(mask4, descriptor, routed, catalog);
  routeSlices(descriptor, routed, catalog);

  // AIR and FULL are cheap safety anchors even for malformed descriptors.
  addRoute('AIR', routed, catalog);
  addRoute('FULL', routed, catalog);

  const generic = genericFallback(mask4, descriptor, settings, catalog);
  const combined = new Set<number>(routed);
  for (const geometryId of generic.geometryIds) combined.add(geometryId);

  let geometryIds = [...combined];
  if (geometryIds.length > settings.maxGeneratedCandidates) {
    geometryIds.sort((left, right) => {
      const leftDistance =
        hammingDistanceAtOffset(mask4, catalog.masks4, left * mask4.length) * 16 +
        descriptorDistance(descriptor, catalog, left);
      const rightDistance =
        hammingDistanceAtOffset(mask4, catalog.masks4, right * mask4.length) * 16 +
        descriptorDistance(descriptor, catalog, right);
      return leftDistance - rightDistance || left - right;
    });
    geometryIds = geometryIds.slice(0, settings.maxGeneratedCandidates);
  } else {
    geometryIds.sort((left, right) => left - right);
  }

  return {
    genericCount: generic.geometryIds.length,
    geometryIds,
    postingsScanned: generic.postingsScanned,
    routedCount: routed.size,
  };
}

export function candidateFamilyHistogram(
  geometryIds: readonly number[],
  catalog: PackedShapeCatalog,
): Map<ShapeFamily, number> {
  const result = new Map<ShapeFamily, number>();
  for (const geometryId of geometryIds) {
    const shapeId = catalog.geometryRepresentativeShape[geometryId] ?? 0;
    const family = catalog.shapeFamily[shapeId] ?? ShapeFamily.AIR;
    result.set(family, (result.get(family) ?? 0) + 1);
  }
  return result;
}
