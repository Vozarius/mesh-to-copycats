import {
  AIR_OWNER,
  NO_OFFSET,
  ShapeFamily,
  type Resolution,
} from '@mesh-to-copycats/shared';
import {
  DESCRIPTOR,
  bitIndex,
  computeDescriptor,
  getBit,
  maskFromAabbs,
  popcountMask,
  wordCountForResolution,
  type ShapeDescriptor,
} from '@mesh-to-copycats/voxelizer';

import {
  exactGeometryKeyFromAabbs,
  validateExactAabbs,
} from './exact.js';
import {
  DEFAULT_PART_COMPATIBILITY,
  type ShapeDefinitionInput,
  type ShapeMetadata,
  type ShapePartDefinition,
  type ShapePartMetadata,
  type ShapeState,
} from './types.js';

interface ShapeDraft {
  readonly blockId: string;
  readonly complexity: number;
  readonly family: ShapeFamily;
  readonly familyPriority: number;
  readonly geometryId: number;
  readonly neighborDependent: boolean;
  readonly parts: readonly ShapePartDefinition[];
  readonly routeKeys: readonly string[];
  readonly state: string;
}

interface GeometryDraft {
  readonly descriptor: ShapeDescriptor;
  readonly key: string;
  readonly mask4: Uint32Array;
  readonly mask8: Uint32Array;
  readonly mask16: Uint32Array;
  readonly realizations: number[];
}

function serializeState(state: ShapeState): string {
  const entries = Object.entries(state).sort(([left], [right]) => compareStrings(left, right));
  if (entries.length === 0) return '';
  return `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(',')}]`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function arraysEqual(left: Uint32Array, right: Uint32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function assertPackedInteger(
  value: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${label} must be an integer in 0..${maximum}`);
  }
}

function preferredShape(left: ShapeDraft, right: ShapeDraft, leftId: number, rightId: number): number {
  if (left.familyPriority !== right.familyPriority) {
    return left.familyPriority < right.familyPriority ? leftId : rightId;
  }
  if (left.complexity !== right.complexity) {
    return left.complexity < right.complexity ? leftId : rightId;
  }
  return Math.min(leftId, rightId);
}

export class PackedShapeCatalog {
  public readonly geometryCount: number;
  public readonly shapeCount: number;

  public readonly masks4!: Uint32Array;
  public readonly masks8!: Uint32Array;
  public readonly masks16!: Uint32Array;
  public readonly geometryDescriptors!: Float32Array;
  public readonly geometryPopcount4!: Uint8Array;
  public readonly geometryPopcount8!: Uint16Array;
  public readonly geometryPopcount16!: Uint16Array;
  public readonly geometryKeys!: readonly string[];
  public readonly geometryRepresentativeShape!: Uint32Array;
  public readonly geometryRealizationOffsets!: Uint32Array;
  public readonly geometryRealizations!: Uint32Array;

  public readonly shapeGeometry!: Uint32Array;
  public readonly shapeFamily!: Uint8Array;
  public readonly shapeFamilyPriority!: Uint8Array;
  public readonly shapeComplexity!: Uint16Array;
  public readonly shapeStateId!: Uint32Array;
  public readonly shapeNeighborDependent!: Uint8Array;
  public readonly shapePartOffsets!: Uint32Array;
  public readonly shapeOwnerGridOffsets!: Uint32Array;
  public readonly blockIds!: readonly string[];
  public readonly states!: readonly string[];

  public readonly partIds!: Uint8Array;
  public readonly partMaterialSlots!: Uint8Array;
  public readonly partCompatibility!: Uint32Array;
  public readonly partMask16Offsets!: Uint32Array;
  public readonly partKeys!: readonly string[];
  public readonly partMasks16!: Uint32Array;
  public readonly ownerGrid16Pool!: Uint8Array;

  public readonly routeIndex!: ReadonlyMap<string, Uint32Array>;
  public readonly popcount4Buckets!: readonly Uint32Array[];

  readonly #shapeLookup: ReadonlyMap<string, number>;

  public constructor(data: PackedShapeCatalogData) {
    Object.assign(this, data);
    this.geometryCount = data.geometryKeys.length;
    this.shapeCount = data.blockIds.length;
    this.#shapeLookup = data.shapeLookup;
  }

  public getMaskPool(resolution: Resolution): Uint32Array {
    if (resolution === 4) return this.masks4;
    return resolution === 8 ? this.masks8 : this.masks16;
  }

  public geometryMaskOffset(geometryId: number, resolution: Resolution): number {
    this.assertGeometryId(geometryId);
    return geometryId * wordCountForResolution(resolution);
  }

  public getGeometryMask(geometryId: number, resolution: Resolution): Uint32Array {
    const offset = this.geometryMaskOffset(geometryId, resolution);
    return this.getMaskPool(resolution).subarray(
      offset,
      offset + wordCountForResolution(resolution),
    );
  }

  public getGeometryDescriptor(geometryId: number): ShapeDescriptor {
    this.assertGeometryId(geometryId);
    const offset = geometryId * DESCRIPTOR.LENGTH;
    return this.geometryDescriptors.subarray(offset, offset + DESCRIPTOR.LENGTH);
  }

  public getRealizationShapeIds(geometryId: number): Uint32Array {
    this.assertGeometryId(geometryId);
    const start = this.geometryRealizationOffsets[geometryId] ?? 0;
    const end = this.geometryRealizationOffsets[geometryId + 1] ?? start;
    return this.geometryRealizations.subarray(start, end);
  }

  public getShapeMetadata(shapeId: number): ShapeMetadata {
    this.assertShapeId(shapeId);
    const geometryId = this.shapeGeometry[shapeId] ?? 0;
    return {
      blockId: this.blockIds[shapeId] ?? '',
      complexity: this.shapeComplexity[shapeId] ?? 0,
      family: this.shapeFamily[shapeId] ?? ShapeFamily.AIR,
      geometryId,
      geometryKey: this.geometryKeys[geometryId] ?? '',
      neighborDependent: (this.shapeNeighborDependent[shapeId] ?? 0) !== 0,
      shapeId,
      state: this.states[shapeId] ?? '',
      stateId: this.shapeStateId[shapeId] ?? 0,
    };
  }

  public getShapeParts(shapeId: number): ShapePartMetadata[] {
    this.assertShapeId(shapeId);
    const start = this.shapePartOffsets[shapeId] ?? 0;
    const end = this.shapePartOffsets[shapeId + 1] ?? start;
    const parts: ShapePartMetadata[] = [];
    for (let index = start; index < end; index += 1) {
      parts.push({
        compatibility: this.partCompatibility[index] ?? 0,
        key: this.partKeys[index] ?? '',
        materialSlot: this.partMaterialSlots[index] ?? 0,
        partId: this.partIds[index] ?? 0,
      });
    }
    return parts;
  }

  public getOwnerGrid16(shapeId: number): Uint8Array | undefined {
    this.assertShapeId(shapeId);
    const offset = this.shapeOwnerGridOffsets[shapeId] ?? NO_OFFSET;
    return offset === NO_OFFSET
      ? undefined
      : this.ownerGrid16Pool.subarray(offset, offset + 4096);
  }

  public findShapeId(blockId: string, state: ShapeState | string): number | undefined {
    const serialized = typeof state === 'string' ? state : serializeState(state);
    return this.#shapeLookup.get(`${blockId}${serialized}`);
  }

  public estimateByteLength(): number {
    const arrays: readonly ArrayBufferView[] = [
      this.masks4,
      this.masks8,
      this.masks16,
      this.geometryDescriptors,
      this.geometryPopcount4,
      this.geometryPopcount8,
      this.geometryPopcount16,
      this.geometryRepresentativeShape,
      this.geometryRealizationOffsets,
      this.geometryRealizations,
      this.shapeGeometry,
      this.shapeFamily,
      this.shapeFamilyPriority,
      this.shapeComplexity,
      this.shapeStateId,
      this.shapeNeighborDependent,
      this.shapePartOffsets,
      this.shapeOwnerGridOffsets,
      this.partIds,
      this.partMaterialSlots,
      this.partCompatibility,
      this.partMask16Offsets,
      this.partMasks16,
      this.ownerGrid16Pool,
    ];
    return arrays.reduce((total, array) => total + array.byteLength, 0);
  }

  private assertGeometryId(geometryId: number): void {
    if (!Number.isInteger(geometryId) || geometryId < 0 || geometryId >= this.geometryCount) {
      throw new RangeError(`Invalid geometry id ${geometryId}`);
    }
  }

  private assertShapeId(shapeId: number): void {
    if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId >= this.shapeCount) {
      throw new RangeError(`Invalid shape id ${shapeId}`);
    }
  }
}

export interface PackedShapeCatalogData {
  readonly blockIds: readonly string[];
  readonly geometryDescriptors: Float32Array;
  readonly geometryKeys: readonly string[];
  readonly geometryPopcount4: Uint8Array;
  readonly geometryPopcount8: Uint16Array;
  readonly geometryPopcount16: Uint16Array;
  readonly geometryRealizationOffsets: Uint32Array;
  readonly geometryRealizations: Uint32Array;
  readonly geometryRepresentativeShape: Uint32Array;
  readonly masks4: Uint32Array;
  readonly masks8: Uint32Array;
  readonly masks16: Uint32Array;
  readonly ownerGrid16Pool: Uint8Array;
  readonly partCompatibility: Uint32Array;
  readonly partIds: Uint8Array;
  readonly partKeys: readonly string[];
  readonly partMask16Offsets: Uint32Array;
  readonly partMasks16: Uint32Array;
  readonly partMaterialSlots: Uint8Array;
  readonly popcount4Buckets: readonly Uint32Array[];
  readonly routeIndex: ReadonlyMap<string, Uint32Array>;
  readonly shapeComplexity: Uint16Array;
  readonly shapeFamily: Uint8Array;
  readonly shapeFamilyPriority: Uint8Array;
  readonly shapeGeometry: Uint32Array;
  readonly shapeLookup: ReadonlyMap<string, number>;
  readonly shapeNeighborDependent: Uint8Array;
  readonly shapeOwnerGridOffsets: Uint32Array;
  readonly shapePartOffsets: Uint32Array;
  readonly shapeStateId: Uint32Array;
  readonly states: readonly string[];
}

export function buildShapeCatalog(
  definitions: readonly ShapeDefinitionInput[],
): PackedShapeCatalog {
  const sortedDefinitions = [...definitions].sort((left, right) => {
    const leftState = serializeState(left.state);
    const rightState = serializeState(right.state);
    const leftId = left.stableId ?? `${left.blockId}${leftState}`;
    const rightId = right.stableId ?? `${right.blockId}${rightState}`;
    return compareStrings(leftId, rightId);
  });

  const geometries: GeometryDraft[] = [];
  const geometryByKey = new Map<string, number>();
  const shapes: ShapeDraft[] = [];
  const shapeIdentities = new Set<string>();

  for (const definition of sortedDefinitions) {
    const serializedState = serializeState(definition.state);
    const shapeIdentity = `${definition.blockId}${serializedState}`;
    if (definition.blockId.length === 0) throw new Error('Shape block id cannot be empty');
    if (shapeIdentities.has(shapeIdentity)) {
      throw new Error(`Duplicate shape realization ${shapeIdentity}`);
    }
    shapeIdentities.add(shapeIdentity);
    assertPackedInteger(definition.family, 0xff, 'Shape family');
    assertPackedInteger(
      definition.familyPriority ?? definition.family,
      0xff,
      'Shape family priority',
    );
    assertPackedInteger(definition.complexity, 0xffff, 'Shape complexity');

    const key = exactGeometryKeyFromAabbs(definition.boxes);
    const mask4 = maskFromAabbs(4, definition.boxes);
    const mask8 = maskFromAabbs(8, definition.boxes);
    const mask16 = maskFromAabbs(16, definition.boxes);
    let geometryId = geometryByKey.get(key);
    if (geometryId === undefined) {
      geometryId = geometries.length;
      geometryByKey.set(key, geometryId);
      geometries.push({
        // Routing starts from target mask4, so catalog descriptor bins must use
        // the same conservative coarse representation.
        descriptor: computeDescriptor(mask4, 4),
        key,
        mask4,
        mask8,
        mask16,
        realizations: [],
      });
    } else if (!arraysEqual(geometries[geometryId]!.mask16, mask16)) {
      throw new Error('Exact geometry key collision');
    }

    const parts =
      definition.parts ??
      (definition.boxes.length === 0
        ? []
        : [
            {
              boxes: definition.boxes,
              key: 'material',
              materialSlot: 0,
            },
          ]);
    const shapeId = shapes.length;
    geometries[geometryId]!.realizations.push(shapeId);
    shapes.push({
      blockId: definition.blockId,
      complexity: definition.complexity,
      family: definition.family,
      familyPriority: definition.familyPriority ?? definition.family,
      geometryId,
      neighborDependent: definition.neighborDependent ?? false,
      parts,
      routeKeys: definition.routeKeys ?? [],
      state: serializedState,
    });
  }

  const geometryCount = geometries.length;
  const shapeCount = shapes.length;
  const masks4 = new Uint32Array(geometryCount * wordCountForResolution(4));
  const masks8 = new Uint32Array(geometryCount * wordCountForResolution(8));
  const masks16 = new Uint32Array(geometryCount * wordCountForResolution(16));
  const geometryDescriptors = new Float32Array(geometryCount * DESCRIPTOR.LENGTH);
  const geometryPopcount4 = new Uint8Array(geometryCount);
  const geometryPopcount8 = new Uint16Array(geometryCount);
  const geometryPopcount16 = new Uint16Array(geometryCount);
  const geometryKeys: string[] = [];

  for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
    const geometry = geometries[geometryId]!;
    masks4.set(geometry.mask4, geometryId * wordCountForResolution(4));
    masks8.set(geometry.mask8, geometryId * wordCountForResolution(8));
    masks16.set(geometry.mask16, geometryId * wordCountForResolution(16));
    geometryDescriptors.set(geometry.descriptor, geometryId * DESCRIPTOR.LENGTH);
    geometryPopcount4[geometryId] = popcountMask(geometry.mask4);
    geometryPopcount8[geometryId] = popcountMask(geometry.mask8);
    geometryPopcount16[geometryId] = popcountMask(geometry.mask16);
    geometryKeys.push(geometry.key);
  }

  const shapeGeometry = new Uint32Array(shapeCount);
  const shapeFamily = new Uint8Array(shapeCount);
  const shapeFamilyPriority = new Uint8Array(shapeCount);
  const shapeComplexity = new Uint16Array(shapeCount);
  const shapeStateId = new Uint32Array(shapeCount);
  const shapeNeighborDependent = new Uint8Array(shapeCount);
  const shapePartOffsets = new Uint32Array(shapeCount + 1);
  const shapeOwnerGridOffsets = new Uint32Array(shapeCount);
  shapeOwnerGridOffsets.fill(NO_OFFSET);
  const blockIds: string[] = [];
  const states: string[] = [];
  const shapeLookup = new Map<string, number>();

  const partIds: number[] = [];
  const partMaterialSlots: number[] = [];
  const partCompatibility: number[] = [];
  const partMask16Offsets: number[] = [];
  const partKeys: string[] = [];
  const partMaskWords: number[] = [];
  const ownerGridBytes: number[] = [];
  const routePostings = new Map<string, Set<number>>();

  for (let shapeId = 0; shapeId < shapeCount; shapeId += 1) {
    const shape = shapes[shapeId]!;
    shapeGeometry[shapeId] = shape.geometryId;
    shapeFamily[shapeId] = shape.family;
    shapeFamilyPriority[shapeId] = shape.familyPriority;
    shapeComplexity[shapeId] = shape.complexity;
    shapeStateId[shapeId] = shapeId;
    shapeNeighborDependent[shapeId] = shape.neighborDependent ? 1 : 0;
    shapePartOffsets[shapeId] = partIds.length;
    blockIds.push(shape.blockId);
    states.push(shape.state);
    shapeLookup.set(`${shape.blockId}${shape.state}`, shapeId);

    const localPartMasks: Uint32Array[] = [];
    const localPartKeys = new Set<string>();
    if (shape.parts.length >= AIR_OWNER) {
      throw new RangeError(`Shape ${shape.blockId}${shape.state} has too many parts`);
    }
    for (let localPartId = 0; localPartId < shape.parts.length; localPartId += 1) {
      const part = shape.parts[localPartId]!;
      if (part.key.length === 0 || localPartKeys.has(part.key)) {
        throw new Error(`Shape ${shape.blockId}${shape.state} has an invalid or duplicate part key`);
      }
      localPartKeys.add(part.key);
      assertPackedInteger(part.materialSlot, 0xff, 'Part material slot');
      assertPackedInteger(
        part.compatibility ?? DEFAULT_PART_COMPATIBILITY,
        0xffff_ffff,
        'Part compatibility mask',
      );
      validateExactAabbs(part.boxes);
      const partMask = maskFromAabbs(16, part.boxes);
      localPartMasks.push(partMask);
      partIds.push(localPartId);
      partMaterialSlots.push(part.materialSlot);
      partCompatibility.push(part.compatibility ?? DEFAULT_PART_COMPATIBILITY);
      partMask16Offsets.push(partMaskWords.length);
      partMaskWords.push(...partMask);
      partKeys.push(part.key);
    }

    const geometryMask = geometries[shape.geometryId]!.mask16;
    for (let voxel = 0; voxel < 4096; voxel += 1) {
      let partOccupiesVoxel = false;
      for (const partMask of localPartMasks) {
        if (getBit(partMask, voxel)) {
          partOccupiesVoxel = true;
          break;
        }
      }
      const geometryOccupiesVoxel = getBit(geometryMask, voxel);
      if (partOccupiesVoxel && !geometryOccupiesVoxel) {
        throw new Error(`Shape ${shape.blockId}${shape.state} has a part outside its geometry`);
      }
      if (geometryOccupiesVoxel && !partOccupiesVoxel) {
        throw new Error(`Shape ${shape.blockId}${shape.state} has an unowned occupied voxel`);
      }
    }

    if (shape.parts.length > 1) {
      const ownerOffset = ownerGridBytes.length;
      shapeOwnerGridOffsets[shapeId] = ownerOffset;
      for (let voxel = 0; voxel < 4096; voxel += 1) {
        if (!getBit(geometryMask, voxel)) {
          ownerGridBytes.push(AIR_OWNER);
          continue;
        }
        let owner = AIR_OWNER;
        for (let partId = 0; partId < localPartMasks.length; partId += 1) {
          if (getBit(localPartMasks[partId]!, voxel)) {
            owner = partId;
            break;
          }
        }
        if (owner === AIR_OWNER) {
          throw new Error(`Shape ${shape.blockId}${shape.state} has an unowned occupied voxel`);
        }
        ownerGridBytes.push(owner);
      }
    }

    for (const routeKey of shape.routeKeys) {
      const postings = routePostings.get(routeKey) ?? new Set<number>();
      postings.add(shape.geometryId);
      routePostings.set(routeKey, postings);
    }
  }
  shapePartOffsets[shapeCount] = partIds.length;

  const geometryRepresentativeShape = new Uint32Array(geometryCount);
  const geometryRealizationOffsets = new Uint32Array(geometryCount + 1);
  const realizationIds: number[] = [];
  for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
    const realizations = [...geometries[geometryId]!.realizations].sort((left, right) => left - right);
    geometryRealizationOffsets[geometryId] = realizationIds.length;
    realizationIds.push(...realizations);
    let representative = realizations[0] ?? 0;
    for (const shapeId of realizations.slice(1)) {
      representative = preferredShape(
        shapes[representative]!,
        shapes[shapeId]!,
        representative,
        shapeId,
      );
    }
    geometryRepresentativeShape[geometryId] = representative;
  }
  geometryRealizationOffsets[geometryCount] = realizationIds.length;

  const routeIndex = new Map<string, Uint32Array>();
  for (const [key, postings] of [...routePostings.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    routeIndex.set(key, Uint32Array.from([...postings].sort((left, right) => left - right)));
  }

  const popcountLists = Array.from({ length: 65 }, () => [] as number[]);
  for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
    popcountLists[geometryPopcount4[geometryId] ?? 0]!.push(geometryId);
  }
  const popcount4Buckets = popcountLists.map((ids) => Uint32Array.from(ids));

  return new PackedShapeCatalog({
    blockIds,
    geometryDescriptors,
    geometryKeys,
    geometryPopcount4,
    geometryPopcount8,
    geometryPopcount16,
    geometryRealizationOffsets,
    geometryRealizations: Uint32Array.from(realizationIds),
    geometryRepresentativeShape,
    masks4,
    masks8,
    masks16,
    ownerGrid16Pool: Uint8Array.from(ownerGridBytes),
    partCompatibility: Uint32Array.from(partCompatibility),
    partIds: Uint8Array.from(partIds),
    partKeys,
    partMask16Offsets: Uint32Array.from(partMask16Offsets),
    partMasks16: Uint32Array.from(partMaskWords),
    partMaterialSlots: Uint8Array.from(partMaterialSlots),
    popcount4Buckets,
    routeIndex,
    shapeComplexity,
    shapeFamily,
    shapeFamilyPriority,
    shapeGeometry,
    shapeLookup,
    shapeNeighborDependent,
    shapeOwnerGridOffsets,
    shapePartOffsets,
    shapeStateId,
    states,
  });
}

export function voxelCoordinates(index: number): { x: number; y: number; z: number } {
  const z = Math.floor(index / 256);
  const remainder = index - z * 256;
  const y = Math.floor(remainder / 16);
  const x = remainder - y * 16;
  if (bitIndex(16, x, y, z) !== index) throw new Error('Invalid voxel index');
  return { x, y, z };
}
