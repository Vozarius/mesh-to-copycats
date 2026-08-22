import { AIR_OWNER, ShapeFamily } from '../../shared/src/index.js';
import type {
  GeneratedMaterialAcceptanceProfileMetadata,
  PackedShapeCatalog,
  WebRuntimeCatalog,
} from '../../shapes/src/index.js';
import { EVIDENCE_DIRECTIONS } from '../../shapes/src/index.js';
import { bitIndex } from '../../voxelizer/src/index.js';

import { oklabDistanceSquared, type Oklab } from './color.js';
import {
  paletteOklab,
  type PackedMaterialPalette,
  type PackedResolvedMaterials,
  type PackedSurfaceSamples,
  type ResolveMaterialOptions,
} from './types.js';

const INVALID_PALETTE = 0xffff_ffff;
const profileResultIndexes = new WeakMap<
  GeneratedMaterialAcceptanceProfileMetadata,
  ReadonlyMap<string, GeneratedMaterialAcceptanceProfileMetadata['results'][number]>
>();

function materialResult(
  profile: GeneratedMaterialAcceptanceProfileMetadata,
  itemId: string,
): GeneratedMaterialAcceptanceProfileMetadata['results'][number] | undefined {
  let index = profileResultIndexes.get(profile);
  if (index === undefined) {
    index = new Map(profile.results.map((result) => [result.itemId, result]));
    profileResultIndexes.set(profile, index);
  }
  return index.get(itemId);
}

function isCopycat(blockId: string): boolean {
  return blockId.startsWith('copycats:') || blockId.includes(':copycat_');
}

interface MaterialChoice {
  readonly blockId: string;
  readonly direction: number;
  readonly state: string;
}

function materialChoice(
  palette: PackedMaterialPalette,
  paletteIndex: number,
  partCompatibility: number,
  shapeBlockId: string,
  shapeState: string,
  profile: GeneratedMaterialAcceptanceProfileMetadata | undefined,
  directionOrder: readonly number[],
): MaterialChoice | undefined {
  if (((palette.compatibility[paletteIndex] ?? 0) & partCompatibility) === 0) return undefined;
  if (profile?.status === 'SUPPORTED' && profile.coverage === 'COMPLETE_REGISTRY') {
    const result = materialResult(profile, palette.itemIds[paletteIndex] ?? '');
    if (result === undefined) return undefined;
    for (const direction of directionOrder) {
      const accepted = result.directions[EVIDENCE_DIRECTIONS[direction]!];
      if (accepted !== null) {
        return { blockId: accepted.blockId, direction, state: accepted.state };
      }
    }
    return undefined;
  }
  if (isCopycat(shapeBlockId)) {
    return profile === undefined
      ? { blockId: palette.blockIds[paletteIndex] ?? '', direction: directionOrder[0] ?? 0, state: '' }
      : undefined;
  }
  return palette.canonicalBlockIds[paletteIndex]?.includes(shapeBlockId) === true
    ? { blockId: shapeBlockId, direction: directionOrder[0] ?? 0, state: shapeState }
    : undefined;
}

function nearestOwnerGrid(catalog: PackedShapeCatalog, shapeId: number): Uint8Array {
  const start = catalog.shapePartOffsets[shapeId] ?? 0;
  const end = catalog.shapePartOffsets[shapeId + 1] ?? start;
  const owner = catalog.getOwnerGrid16(shapeId);
  if (owner === undefined) {
    return new Uint8Array(4096).fill(end > start ? catalog.partIds[start] ?? 0 : AIR_OWNER);
  }
  const nearest = owner.slice();
  const queue = new Uint16Array(4096);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < nearest.length; index += 1) {
    if (nearest[index] !== AIR_OWNER) queue[tail++] = index;
  }
  while (head < tail) {
    const index = queue[head++] ?? 0;
    const x = index & 15;
    const y = (index >>> 4) & 15;
    const z = index >>> 8;
    const adjacent = [
      x > 0 ? index - 1 : -1,
      x < 15 ? index + 1 : -1,
      y > 0 ? index - 16 : -1,
      y < 15 ? index + 16 : -1,
      z > 0 ? index - 256 : -1,
      z < 15 ? index + 256 : -1,
    ];
    for (const next of adjacent) {
      if (next < 0 || nearest[next] !== AIR_OWNER) continue;
      nearest[next] = nearest[index] ?? AIR_OWNER;
      queue[tail++] = next;
    }
  }
  return nearest;
}

function partLocalIndex(
  catalog: PackedShapeCatalog,
  shapeId: number,
  partId: number,
): number {
  const start = catalog.shapePartOffsets[shapeId] ?? 0;
  const end = catalog.shapePartOffsets[shapeId + 1] ?? start;
  for (let global = start; global < end; global += 1) {
    if ((catalog.partIds[global] ?? AIR_OWNER) === partId) return global - start;
  }
  return 0;
}

interface EvaluatedRealization {
  readonly acceptedBlockIds: string[];
  readonly acceptedStates: string[];
  readonly error: number;
  readonly materialErrors: number[];
  readonly materialDirections: number[];
  readonly paletteIndexes: number[];
  readonly partIds: number[];
  readonly safety: number;
  readonly shapeId: number;
  readonly targetAlphas: number[];
  readonly targets: number[];
  readonly valid: boolean;
}

function normalDirection(x: number, y: number, z: number): number {
  const absoluteX = Math.abs(x);
  const absoluteY = Math.abs(y);
  const absoluteZ = Math.abs(z);
  if (absoluteY >= absoluteX && absoluteY >= absoluteZ) return y >= 0 ? 4 : 0;
  if (absoluteX >= absoluteZ) return x >= 0 ? 1 : 5;
  return z >= 0 ? 3 : 2;
}

function preferredDirections(directionWeights: Float64Array, localPart: number): number[] {
  return Array.from({ length: EVIDENCE_DIRECTIONS.length }, (_value, index) => index)
    .sort((left, right) =>
      (directionWeights[localPart * 6 + right] ?? 0) -
        (directionWeights[localPart * 6 + left] ?? 0) ||
      left - right);
}

function placementRank(runtime: WebRuntimeCatalog | undefined, shapeId: number): number {
  if (runtime === undefined) return 1;
  const assessment = runtime.getPlacementProfile(shapeId).assessment;
  if (assessment === 'SAFE') return 0;
  if (assessment === 'CONDITIONAL' || assessment === 'UNEXTRACTED') return 1;
  return 2;
}

function evaluateRealization(
  catalog: PackedShapeCatalog,
  runtime: WebRuntimeCatalog | undefined,
  palette: PackedMaterialPalette,
  samples: PackedSurfaceSamples,
  cell: number,
  shapeId: number,
  ownerCache: Map<number, Uint8Array>,
  sourceMaterialPaletteIndexes: Uint32Array | undefined,
  allowedPaletteIndexes: Uint8Array | undefined,
  alphaTolerance: number,
): EvaluatedRealization {
  const start = catalog.shapePartOffsets[shapeId] ?? 0;
  const end = catalog.shapePartOffsets[shapeId + 1] ?? start;
  const partCount = end - start;
  if (partCount === 0) {
    const safety = placementRank(runtime, shapeId);
    return {
      acceptedBlockIds: [],
      acceptedStates: [],
      error: 0,
      materialErrors: [],
      materialDirections: [],
      paletteIndexes: [],
      partIds: [],
      safety,
      shapeId,
      targetAlphas: [],
      targets: [],
      valid: safety < 2,
    };
  }
  let owner = ownerCache.get(shapeId);
  if (owner === undefined) {
    owner = nearestOwnerGrid(catalog, shapeId);
    ownerCache.set(shapeId, owner);
  }
  const sums = new Float64Array(partCount * 4);
  const alphaSums = new Float64Array(partCount);
  const directionWeights = new Float64Array(partCount * EVIDENCE_DIRECTIONS.length);
  const lockedWeights = Array.from({ length: partCount }, () => new Map<number, number>());
  const overallLockedWeights = new Map<number, number>();
  const sampleStart = samples.cellOffsets[cell] ?? 0;
  const sampleEnd = samples.cellOffsets[cell + 1] ?? sampleStart;
  const overall = new Float64Array(4);
  let overallAlpha = 0;
  for (let sample = sampleStart; sample < sampleEnd; sample += 1) {
    const x = Math.min(15, Math.max(0, Math.floor((samples.localPositions[sample * 3] ?? 0) * 16)));
    const y = Math.min(15, Math.max(0, Math.floor((samples.localPositions[sample * 3 + 1] ?? 0) * 16)));
    const z = Math.min(15, Math.max(0, Math.floor((samples.localPositions[sample * 3 + 2] ?? 0) * 16)));
    const localPart = partLocalIndex(catalog, shapeId, owner[bitIndex(16, x, y, z)] ?? 0);
    const weight = samples.weights[sample] ?? 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const value = samples.oklab[sample * 3 + channel] ?? 0;
      const partSlot = localPart * 4 + channel;
      sums[partSlot] = (sums[partSlot] ?? 0) + value * weight;
      overall[channel] = (overall[channel] ?? 0) + value * weight;
    }
    const weightSlot = localPart * 4 + 3;
    sums[weightSlot] = (sums[weightSlot] ?? 0) + weight;
    overall[3] = (overall[3] ?? 0) + weight;
    const sampleAlpha = samples.alpha?.[sample] ?? 1;
    alphaSums[localPart] = (alphaSums[localPart] ?? 0) + sampleAlpha * weight;
    overallAlpha += sampleAlpha * weight;
    const direction = normalDirection(
      samples.normals[sample * 3] ?? 0,
      samples.normals[sample * 3 + 1] ?? 0,
      samples.normals[sample * 3 + 2] ?? 0,
    );
    const directionSlot = localPart * 6 + direction;
    directionWeights[directionSlot] = (directionWeights[directionSlot] ?? 0) + weight;
    const sourceMaterial = samples.sourceMaterialIds[sample] ?? INVALID_PALETTE;
    const lockedPalette = sourceMaterialPaletteIndexes?.[sourceMaterial] ?? INVALID_PALETTE;
    if (lockedPalette !== INVALID_PALETTE) {
      const weights = lockedWeights[localPart]!;
      weights.set(lockedPalette, (weights.get(lockedPalette) ?? 0) + weight);
      overallLockedWeights.set(lockedPalette, (overallLockedWeights.get(lockedPalette) ?? 0) + weight);
    }
  }
  const acceptedBlockIds: string[] = [];
  const acceptedStates: string[] = [];
  const targetAlphas: number[] = [];
  const targets: number[] = [];
  const paletteIndexes: number[] = [];
  const materialErrors: number[] = [];
  const materialDirections: number[] = [];
  const partIds: number[] = [];
  let totalError = 0;
  let totalWeight = 0;
  const blockId = catalog.blockIds[shapeId] ?? '';
  const shapeState = catalog.states[shapeId] ?? '';
  for (let localPart = 0; localPart < partCount; localPart += 1) {
    const partWeight = sums[localPart * 4 + 3] ?? 0;
    const usePart = partWeight > 0;
    const weight = usePart ? partWeight : (overall[3] ?? 0) || 1;
    const targetAlpha = (usePart ? alphaSums[localPart] ?? 0 : overallAlpha) / weight;
    const target: Oklab = [
      (usePart ? sums[localPart * 4] ?? 0 : overall[0] ?? 0) / weight,
      (usePart ? sums[localPart * 4 + 1] ?? 0 : overall[1] ?? 0) / weight,
      (usePart ? sums[localPart * 4 + 2] ?? 0 : overall[2] ?? 0) / weight,
    ];
    let best = INVALID_PALETTE;
    let bestError = Number.POSITIVE_INFINITY;
    let bestChoice: MaterialChoice | undefined;
    const profile = runtime?.getPartMaterialProfile(shapeId, localPart);
    const directionOrder = preferredDirections(directionWeights, localPart);
    const partLockedWeights = lockedWeights[localPart]!;
    const locked = [...(partLockedWeights.size > 0 ? partLockedWeights : overallLockedWeights).entries()]
      .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];
    const paletteCandidates: Iterable<number> = locked === undefined
      ? { *[Symbol.iterator]() { for (let index = 0; index < palette.size; index += 1) yield index; } }
      : [locked];
    for (const paletteIndex of paletteCandidates) {
      if (allowedPaletteIndexes !== undefined && allowedPaletteIndexes[paletteIndex] !== 1) continue;
      const alphaDifference = Math.abs((palette.alpha[paletteIndex] ?? 1) - targetAlpha);
      if (alphaDifference > alphaTolerance) continue;
      const choice = materialChoice(
        palette,
        paletteIndex,
        catalog.partCompatibility[start + localPart] ?? 0xffff_ffff,
        blockId,
        shapeState,
        profile,
        directionOrder,
      );
      if (choice === undefined) continue;
      const error = oklabDistanceSquared(target, paletteOklab(palette, paletteIndex)) +
        alphaDifference * alphaDifference * 0.25;
      const preference = palette.preference[paletteIndex] ?? 0;
      const bestPreference = best < palette.size ? palette.preference[best] ?? 0 : 0xffff;
      if (
        error < bestError ||
        (error === bestError && (preference < bestPreference ||
          (preference === bestPreference && paletteIndex < best)))
      ) {
        best = paletteIndex;
        bestError = error;
        bestChoice = choice;
      }
    }
    acceptedBlockIds.push(bestChoice?.blockId ?? '');
    acceptedStates.push(bestChoice?.state ?? '');
    targetAlphas.push(targetAlpha);
    targets.push(...target);
    paletteIndexes.push(best);
    materialErrors.push(bestError);
    materialDirections.push(bestChoice?.direction ?? 0);
    partIds.push(catalog.partIds[start + localPart] ?? localPart);
    totalError += bestError * weight;
    totalWeight += weight;
  }
  const safety = placementRank(runtime, shapeId);
  return {
    acceptedBlockIds,
    acceptedStates,
    error: totalError / Math.max(totalWeight, 1e-9),
    materialErrors,
    materialDirections,
    paletteIndexes,
    partIds,
    safety,
    shapeId,
    targetAlphas,
    targets,
    valid: safety < 2 && paletteIndexes.every((index) => index !== INVALID_PALETTE),
  };
}

function preferred(
  left: EvaluatedRealization | undefined,
  right: EvaluatedRealization,
  catalog: PackedShapeCatalog,
  preferByte: boolean,
): EvaluatedRealization {
  if (left === undefined) return right;
  if (left.valid !== right.valid) return right.valid ? right : left;
  if (preferByte) {
    const leftIsByte = catalog.shapeFamily[left.shapeId] === ShapeFamily.BYTE;
    const rightIsByte = catalog.shapeFamily[right.shapeId] === ShapeFamily.BYTE;
    if (leftIsByte !== rightIsByte) return rightIsByte ? right : left;
  }
  if (left.error !== right.error) return right.error < left.error ? right : left;
  if (left.safety !== right.safety) return right.safety < left.safety ? right : left;
  const leftComplexity = catalog.shapeComplexity[left.shapeId] ?? 0;
  const rightComplexity = catalog.shapeComplexity[right.shapeId] ?? 0;
  if (leftComplexity !== rightComplexity) return rightComplexity < leftComplexity ? right : left;
  return right.shapeId < left.shapeId ? right : left;
}

export function resolveMaterials(options: ResolveMaterialOptions): PackedResolvedMaterials {
  const {
    allowedPaletteIndexes,
    alphaTolerance = 0.15,
    catalog,
    geometryIds,
    palette,
    preferredByteCells,
    runtime,
    samples,
    sourceMaterialPaletteIndexes,
  } = options;
  if (!Number.isFinite(alphaTolerance) || alphaTolerance < 0 || alphaTolerance > 1) {
    throw new RangeError('alphaTolerance must be finite and in 0..1');
  }
  if (samples.cellOffsets.length !== geometryIds.length + 1) {
    throw new Error('Surface sample cell count does not match geometry grid');
  }
  if (allowedPaletteIndexes !== undefined && allowedPaletteIndexes.length !== palette.size) {
    throw new Error('Allowed palette mask size does not match material palette');
  }
  if (preferredByteCells !== undefined && preferredByteCells.length !== geometryIds.length) {
    throw new Error('Preferred Byte cell count does not match geometry grid');
  }
  if (sourceMaterialPaletteIndexes !== undefined) {
    for (const index of sourceMaterialPaletteIndexes) {
      if (index !== INVALID_PALETTE && index >= palette.size) {
        throw new RangeError(`Locked source material palette index ${index} is out of range`);
      }
    }
  }
  const shapeIds = new Uint32Array(geometryIds.length);
  const invalidCells = new Uint8Array(geometryIds.length);
  const cellErrors = new Float32Array(geometryIds.length);
  const cellPartOffsets = new Uint32Array(geometryIds.length + 1);
  const acceptedMaterialBlockIds: string[] = [];
  const acceptedMaterialStates: string[] = [];
  const partIds: number[] = [];
  const paletteIndexes: number[] = [];
  const materialErrors: number[] = [];
  const materialDirections: number[] = [];
  const targetOklab: number[] = [];
  const targetAlpha: number[] = [];
  const ownerCache = new Map<number, Uint8Array>();
  for (let cell = 0; cell < geometryIds.length; cell += 1) {
    cellPartOffsets[cell] = partIds.length;
    let best: EvaluatedRealization | undefined;
    for (const shapeId of catalog.getRealizationShapeIds(geometryIds[cell] ?? 0)) {
      best = preferred(
        best,
        evaluateRealization(
          catalog,
          runtime,
          palette,
          samples,
          cell,
          shapeId,
          ownerCache,
          sourceMaterialPaletteIndexes,
          allowedPaletteIndexes,
          alphaTolerance,
        ),
        catalog,
        preferredByteCells?.[cell] === 1,
      );
    }
    if (best === undefined) throw new Error(`Geometry ${geometryIds[cell]} has no realizations`);
    shapeIds[cell] = best.shapeId;
    invalidCells[cell] = best.valid ? 0 : 1;
    cellErrors[cell] = best.error;
    acceptedMaterialBlockIds.push(...best.acceptedBlockIds);
    acceptedMaterialStates.push(...best.acceptedStates);
    partIds.push(...best.partIds);
    paletteIndexes.push(...best.paletteIndexes);
    materialErrors.push(...best.materialErrors);
    materialDirections.push(...best.materialDirections);
    targetAlpha.push(...best.targetAlphas);
    targetOklab.push(...best.targets);
  }
  cellPartOffsets[geometryIds.length] = partIds.length;
  return {
    acceptedMaterialBlockIds: Object.freeze(acceptedMaterialBlockIds),
    acceptedMaterialStates: Object.freeze(acceptedMaterialStates),
    cellErrors,
    cellPartOffsets,
    invalidCells,
    materialErrors: Float32Array.from(materialErrors),
    materialDirections: Uint8Array.from(materialDirections),
    paletteIndexes: Uint32Array.from(paletteIndexes),
    partIds: Uint8Array.from(partIds),
    shapeIds,
    targetAlpha: Float32Array.from(targetAlpha),
    targetOklab: Float32Array.from(targetOklab),
  };
}
