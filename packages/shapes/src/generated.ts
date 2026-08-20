import { AIR_OWNER, NO_OFFSET } from '@mesh-to-copycats/shared';
import {
  DESCRIPTOR,
  getBit,
  maskToHex,
  popcountMask,
  wordCountForResolution,
} from '@mesh-to-copycats/voxelizer';

import {
  PackedShapeCatalog,
  type PackedShapeCatalogData,
} from './catalog.js';

const FORMAT_MAJOR = 1;
const FORMAT_MINOR = 0;
const HEADER_BYTES = 40;
const SECTION_ENTRY_BYTES = 24;
const LITTLE_ENDIAN_MARKER = 1;
const REQUIRED_SECTION_FLAG = 1;
const SHAPES_MAGIC = 'M2CSHAP\0';
const BLOCKS_MAGIC = 'M2CBLOK\0';
const METADATA_SCHEMA = 'mesh-to-copycats.generated-catalog';
export const EXTRACTION_EVIDENCE_SCHEMA = 'mesh-to-copycats.extraction-evidence';
export const EXTRACTION_EVIDENCE_VERSION = 1;
export const RUNTIME_EVIDENCE_SCHEMA = 'mesh-to-copycats.runtime-evidence';
export const RUNTIME_EVIDENCE_VERSION = 1;
export const EXTRACTION_AUDIT_SCHEMA = 'mesh-to-copycats.extraction-audit';
export const EXTRACTION_AUDIT_VERSION = 1;
const GRID16_KEY_PREFIX = 'GRID16_EXACT:v1:';
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const MAX_SECTION_COUNT = 256;

enum ElementType {
  U8 = 1,
  U16 = 2,
  U32 = 3,
  F32 = 4,
  UTF8 = 5,
}

function isElementType(value: number): value is ElementType {
  return value >= 1 && value <= 5;
}

enum ShapeSection {
  MASKS_4 = 1,
  MASKS_8 = 2,
  MASKS_16 = 3,
  DESCRIPTORS = 4,
  POPCOUNT_4 = 5,
  POPCOUNT_8 = 6,
  POPCOUNT_16 = 7,
  GEOMETRY_KEY_OFFSETS = 8,
  GEOMETRY_KEY_BYTES = 9,
  REPRESENTATIVE_SHAPES = 10,
  REALIZATION_OFFSETS = 11,
  REALIZATIONS = 12,
  PART_MASKS_16 = 13,
  OWNER_GRIDS_16 = 14,
  ROUTE_KEY_OFFSETS = 15,
  ROUTE_KEY_BYTES = 16,
  ROUTE_POSTING_OFFSETS = 17,
  ROUTE_POSTINGS = 18,
}

enum BlockSection {
  BLOCK_ID_OFFSETS = 1,
  BLOCK_ID_BYTES = 2,
  STATE_OFFSETS = 3,
  STATE_BYTES = 4,
  SHAPE_GEOMETRY = 5,
  SHAPE_FAMILY = 6,
  SHAPE_FAMILY_PRIORITY = 7,
  SHAPE_COMPLEXITY = 8,
  SHAPE_STATE_ID = 9,
  SHAPE_NEIGHBOR_DEPENDENT = 10,
  SHAPE_PART_OFFSETS = 11,
  SHAPE_OWNER_GRID_OFFSETS = 12,
  PART_IDS = 13,
  PART_MATERIAL_SLOTS = 14,
  PART_COMPATIBILITY = 15,
  PART_MASK_16_OFFSETS = 16,
  PART_KEY_OFFSETS = 17,
  PART_KEY_BYTES = 18,
}

interface EncodedSection {
  readonly bytes: Uint8Array;
  readonly elementCount: number;
  readonly id: number;
  readonly type: ElementType;
}

interface DecodedContainer {
  readonly primaryCount: number;
  readonly secondaryCount: number;
  readonly sections: ReadonlyMap<number, DecodedSection>;
  readonly tertiaryCount: number;
}

interface DecodedSection {
  readonly bytes: Uint8Array;
  readonly elementCount: number;
  readonly type: ElementType;
}

export interface GeneratedArtifactDescription {
  readonly bytes: number;
  readonly crc32: string;
}

export interface GeneratedCatalogMetadata {
  readonly artifacts: {
    readonly blocks: GeneratedArtifactDescription;
    readonly runtime?: GeneratedArtifactDescription;
    readonly shapes: GeneratedArtifactDescription;
  };
  readonly counts: {
    readonly geometries: number;
    readonly parts: number;
    readonly shapes: number;
  };
  readonly exactGeometryKinds: readonly string[];
  readonly extraction?: GeneratedCatalogExtractionMetadata;
  readonly formatVersion: {
    readonly major: number;
    readonly minor: number;
  };
  readonly schema: typeof METADATA_SCHEMA;
  readonly sources: GeneratedCatalogSources;
}

export type ExtractionEvidenceStatus = 'SUPPORTED' | 'UNSUPPORTED' | 'UNEXTRACTED';
export type PlacementSafetyAssessment =
  | 'CONDITIONAL'
  | 'SAFE'
  | 'UNEXTRACTED'
  | 'UNSAFE';
export type EvidenceDirection = 'down' | 'east' | 'north' | 'south' | 'up' | 'west';
export const EVIDENCE_DIRECTIONS = [
  'down',
  'east',
  'north',
  'south',
  'up',
  'west',
] as const satisfies readonly EvidenceDirection[];

export type GeneratedAabb16 = readonly [
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
];

export interface GeneratedMaterialProbeMetadata {
  readonly accepted: boolean;
  readonly acceptedBlockId: string | null;
  readonly acceptedState: string | null;
  readonly direction: EvidenceDirection;
  readonly itemId: string;
  readonly materialBlockId: string;
}

export interface GeneratedMaterialCandidateMetadata {
  readonly itemId: string;
  readonly materialBlockId: string;
}

export interface GeneratedAcceptedMaterialMetadata {
  readonly blockId: string;
  readonly state: string;
}

export type GeneratedMaterialDirectionResultsMetadata = Readonly<
  Record<EvidenceDirection, GeneratedAcceptedMaterialMetadata | null>
>;

export interface GeneratedMaterialResultMetadata {
  readonly directions: GeneratedMaterialDirectionResultsMetadata;
  readonly itemId: string;
}

export type MaterialAcceptanceCoverage =
  | 'COMPLETE_REGISTRY'
  | 'LEGACY_PARTIAL'
  | 'NONE';

export interface GeneratedMaterialAcceptanceProfileMetadata {
  readonly coverage: MaterialAcceptanceCoverage;
  readonly fingerprint?: string;
  readonly profileId: string;
  readonly probes: readonly GeneratedMaterialProbeMetadata[];
  readonly results: readonly GeneratedMaterialResultMetadata[];
  readonly status: ExtractionEvidenceStatus;
}

export interface GeneratedPartExtractionMetadata {
  readonly key: string;
  readonly materialAcceptanceProfileId: string;
}

export interface GeneratedNeighborProbeMetadata {
  readonly boxes: readonly GeneratedAabb16[];
  readonly changesShape: boolean;
  readonly changesState: boolean;
  readonly neighborBlockId: string;
  readonly neighborState: string;
  readonly offset: readonly [x: number, y: number, z: number];
  readonly resolvedBlockId: string;
  readonly resolvedState: string;
}

export interface GeneratedNeighborDependenciesMetadata {
  readonly fingerprint?: string;
  readonly probes: readonly GeneratedNeighborProbeMetadata[];
  readonly status: ExtractionEvidenceStatus;
}

export interface GeneratedPlacementSafetyMetadata {
  readonly assessment: PlacementSafetyAssessment;
  readonly fingerprint?: string;
  readonly flags: readonly string[];
  readonly probes: readonly GeneratedPlacementProbeMetadata[];
}

export interface GeneratedPlacementNeighborMetadata {
  readonly blockId: string;
  readonly offset: readonly [x: number, y: number, z: number];
  readonly state: string;
}

export interface GeneratedPlacementProbeMetadata {
  readonly context: string;
  readonly neighbors: readonly GeneratedPlacementNeighborMetadata[];
  readonly survives: boolean;
}

export interface GeneratedShapeExtractionMetadata {
  readonly blockId: string;
  readonly neighborDependencies: GeneratedNeighborDependenciesMetadata;
  readonly parts: readonly GeneratedPartExtractionMetadata[];
  readonly placementSafety: GeneratedPlacementSafetyMetadata;
  readonly state: string;
}

export interface GeneratedCatalogExtractionMetadata {
  readonly diagnostics?: readonly GeneratedExtractionDiagnosticMetadata[];
  readonly materialAcceptanceProfiles: readonly GeneratedMaterialAcceptanceProfileMetadata[];
  readonly materialCandidates: readonly GeneratedMaterialCandidateMetadata[];
  readonly schema: typeof EXTRACTION_EVIDENCE_SCHEMA;
  readonly shapes: readonly GeneratedShapeExtractionMetadata[];
  readonly version: typeof EXTRACTION_EVIDENCE_VERSION;
}

export interface GeneratedExtractionDiagnosticMetadata {
  readonly blockId: string;
  readonly code: string;
  readonly reason: string;
  readonly state: string;
}

export interface GeneratedCatalogSources {
  readonly copycats?: string;
  readonly create?: string;
  readonly environment?: string;
  readonly extractor?: string;
  readonly loader?: string;
  readonly minecraft?: string;
}

export interface GeneratedCatalogArtifacts {
  readonly auditMetadata?: GeneratedExtractionAuditMetadata;
  readonly auditMetadataJson?: string;
  readonly blocks: Uint8Array;
  readonly metadata: GeneratedCatalogMetadata;
  readonly metadataJson: string;
  readonly runtimeMetadata?: GeneratedRuntimeCatalogMetadata;
  readonly runtimeMetadataJson?: string;
  readonly shapes: Uint8Array;
}

export interface GeneratedCatalogEncodeOptions {
  readonly evidenceMode?: 'embedded' | 'split';
}

export interface GeneratedRuntimePlacementProfile {
  readonly assessment: PlacementSafetyAssessment;
  readonly flags: readonly string[];
}

export interface GeneratedRuntimeCatalogMetadata {
  readonly counts: {
    readonly parts: number;
    readonly shapes: number;
  };
  readonly diagnosticCounts: Readonly<Record<string, number>>;
  readonly materialAcceptanceProfiles: readonly GeneratedMaterialAcceptanceProfileMetadata[];
  readonly materialCandidates: readonly GeneratedMaterialCandidateMetadata[];
  readonly partMaterialProfileIndexes: readonly number[];
  readonly placementProfiles: readonly GeneratedRuntimePlacementProfile[];
  readonly schema: typeof RUNTIME_EVIDENCE_SCHEMA;
  readonly shapePlacementProfileIndexes: readonly number[];
  readonly version: typeof RUNTIME_EVIDENCE_VERSION;
}

export interface GeneratedExtractionAuditMetadata {
  readonly counts: {
    readonly parts: number;
    readonly shapes: number;
  };
  readonly extraction: GeneratedCatalogExtractionMetadata;
  readonly schema: typeof EXTRACTION_AUDIT_SCHEMA;
  readonly sources: GeneratedCatalogSources;
  readonly version: typeof EXTRACTION_AUDIT_VERSION;
}

export interface GeneratedCatalogInput {
  readonly blocks: Uint8Array;
  readonly metadata: GeneratedCatalogMetadata | string;
  readonly shapes: Uint8Array;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalSources(sources: GeneratedCatalogSources): GeneratedCatalogSources {
  if (typeof sources !== 'object' || sources === null || Array.isArray(sources)) {
    throw new Error('sources must be an object');
  }
  const environment = sources.environment;
  if (
    environment !== undefined &&
    (
      typeof environment !== 'string' ||
      !/^m2c-environment-v1:sha256:[0-9a-f]{64}$/u.test(environment)
    )
  ) {
    throw new Error(
      'sources.environment must be an m2c-environment-v1 SHA-256 fingerprint',
    );
  }
  return {
    ...(sources.minecraft === undefined ? {} : { minecraft: sources.minecraft }),
    ...(sources.loader === undefined ? {} : { loader: sources.loader }),
    ...(sources.create === undefined ? {} : { create: sources.create }),
    ...(sources.copycats === undefined ? {} : { copycats: sources.copycats }),
    ...(sources.extractor === undefined ? {} : { extractor: sources.extractor }),
    ...(environment === undefined ? {} : { environment }),
  };
}

function evidenceString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new Error(`${label} must be a non-empty NUL-free string`);
  }
  return value;
}

function evidenceRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function canonicalStrings(values: readonly unknown[], label: string): string[] {
  const result = values.map((value, index) => evidenceString(value, `${label}[${index}]`));
  result.sort(compareStrings);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) throw new Error(`${label} contains duplicates`);
  }
  return result;
}

function canonicalFingerprint(
  status: ExtractionEvidenceStatus,
  fingerprint: unknown,
  label: string,
): string | undefined {
  if (status === 'UNEXTRACTED') {
    if (fingerprint !== undefined) {
      throw new Error(`${label}.fingerprint is not allowed for UNEXTRACTED evidence`);
    }
    return undefined;
  }
  return evidenceString(fingerprint, `${label}.fingerprint`);
}

function canonicalEvidenceStatus(value: unknown, label: string): ExtractionEvidenceStatus {
  if (value !== 'SUPPORTED' && value !== 'UNSUPPORTED' && value !== 'UNEXTRACTED') {
    throw new Error(`${label} has an unsupported evidence status`);
  }
  return value;
}

function canonicalDirection(value: unknown, label: string): EvidenceDirection {
  if (
    value !== 'down' &&
    value !== 'east' &&
    value !== 'north' &&
    value !== 'south' &&
    value !== 'up' &&
    value !== 'west'
  ) {
    throw new Error(`${label} must be a cardinal Minecraft direction`);
  }
  return value;
}

function canonicalStateString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error(`${label} must be a NUL-free canonical state string`);
  }
  return value;
}

function canonicalOffset(value: unknown, label: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain three coordinates`);
  }
  const offset = value.map((coordinate: unknown, coordinateIndex: number) => {
    if (
      typeof coordinate !== 'number' ||
      !Number.isInteger(coordinate) ||
      coordinate < -1 ||
      coordinate > 1
    ) {
      throw new Error(`${label}[${coordinateIndex}] must be an integer in -1..1`);
    }
    return coordinate;
  });
  if (offset.every((coordinate: number) => coordinate === 0)) {
    throw new Error(`${label} cannot address the shape itself`);
  }
  return [offset[0]!, offset[1]!, offset[2]!];
}

function canonicalMaterialCandidates(
  value: unknown,
  label: string,
): GeneratedMaterialCandidateMetadata[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const candidates = value.map((rawCandidate: unknown, index: number) => {
    const candidateLabel = `${label}[${index}]`;
    const candidate = evidenceRecord(rawCandidate, candidateLabel);
    return {
      itemId: evidenceString(candidate.itemId, `${candidateLabel}.itemId`),
      materialBlockId: evidenceString(
        candidate.materialBlockId,
        `${candidateLabel}.materialBlockId`,
      ),
    };
  }).sort((left, right) => compareStrings(left.itemId, right.itemId));
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index]!.itemId === candidates[index - 1]!.itemId) {
      throw new Error(`${label} contains duplicate item ids`);
    }
  }
  return candidates;
}

function canonicalLegacyMaterialProbes(
  value: unknown,
  label: string,
  status: ExtractionEvidenceStatus,
  allowEmptySupported = false,
): GeneratedMaterialProbeMetadata[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (status !== 'SUPPORTED' && value.length !== 0) {
    throw new Error(`${label} require SUPPORTED evidence`);
  }
  if (status === 'SUPPORTED' && value.length === 0 && !allowEmptySupported) {
    throw new Error(`${label} must include at least one controlled material`);
  }
  const probes = value.map((rawProbe: unknown, index: number) => {
    const probeLabel = `${label}[${index}]`;
    const probe = evidenceRecord(rawProbe, probeLabel);
    if (typeof probe.accepted !== 'boolean') {
      throw new Error(`${probeLabel}.accepted must be boolean`);
    }
    const legacyMaterial = probe.material === undefined
      ? undefined
      : evidenceString(probe.material, `${probeLabel}.material`);
    const itemId = probe.itemId === undefined
      ? legacyMaterial
      : evidenceString(probe.itemId, `${probeLabel}.itemId`);
    const materialBlockId = probe.materialBlockId === undefined
      ? legacyMaterial
      : evidenceString(probe.materialBlockId, `${probeLabel}.materialBlockId`);
    if (itemId === undefined || materialBlockId === undefined) {
      throw new Error(`${probeLabel} must identify both itemId and materialBlockId`);
    }
    const acceptedState = probe.acceptedState === null
      ? null
      : canonicalStateString(probe.acceptedState, `${probeLabel}.acceptedState`);
    const acceptedBlockId = probe.acceptedBlockId === undefined && legacyMaterial !== undefined
      ? probe.accepted ? materialBlockId : null
      : probe.acceptedBlockId === null
        ? null
        : evidenceString(probe.acceptedBlockId, `${probeLabel}.acceptedBlockId`);
    if (
      probe.accepted !== (acceptedBlockId !== null && acceptedState !== null) ||
      (acceptedBlockId === null) !== (acceptedState === null)
    ) {
      throw new Error(`${probeLabel} accepted flag contradicts accepted result identity`);
    }
    return {
      accepted: probe.accepted,
      acceptedBlockId,
      acceptedState,
      direction: canonicalDirection(probe.direction, `${probeLabel}.direction`),
      itemId,
      materialBlockId,
    };
  }).sort((left, right) => compareStrings(
    `${left.itemId}\0${left.direction}`,
    `${right.itemId}\0${right.direction}`,
  ));
  for (let index = 1; index < probes.length; index += 1) {
    const previous = probes[index - 1]!;
    const current = probes[index]!;
    if (current.itemId === previous.itemId && current.direction === previous.direction) {
      throw new Error(`${label} contains duplicate item-direction contexts`);
    }
  }
  const materialByItem = new Map<string, string>();
  for (const probe of probes) {
    const previous = materialByItem.get(probe.itemId);
    if (previous !== undefined && previous !== probe.materialBlockId) {
      throw new Error(`${label} maps one item id to multiple material blocks`);
    }
    materialByItem.set(probe.itemId, probe.materialBlockId);
  }
  return probes;
}

function canonicalMaterialResults(
  value: unknown,
  label: string,
  status: ExtractionEvidenceStatus,
  candidates: readonly GeneratedMaterialCandidateMetadata[],
): GeneratedMaterialResultMetadata[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  if (status !== 'SUPPORTED' && value.length !== 0) {
    throw new Error(`${label} require SUPPORTED evidence`);
  }
  const candidateIds = new Set(candidates.map((candidate) => candidate.itemId));
  const results = value.map((rawResult: unknown, index: number) => {
    const resultLabel = `${label}[${index}]`;
    const result = evidenceRecord(rawResult, resultLabel);
    const itemId = evidenceString(result.itemId, `${resultLabel}.itemId`);
    if (!candidateIds.has(itemId)) {
      throw new Error(`${resultLabel}.itemId is absent from materialCandidates`);
    }
    const rawDirections = evidenceRecord(result.directions, `${resultLabel}.directions`);
    const directions = Object.fromEntries(EVIDENCE_DIRECTIONS.map((direction) => {
      const rawAccepted = rawDirections[direction];
      if (rawAccepted === undefined) {
        throw new Error(`${resultLabel}.directions.${direction} is required`);
      }
      if (rawAccepted === null) return [direction, null];
      const acceptedLabel = `${resultLabel}.directions.${direction}`;
      const accepted = evidenceRecord(rawAccepted, acceptedLabel);
      return [direction, {
        blockId: evidenceString(accepted.blockId, `${acceptedLabel}.blockId`),
        state: canonicalStateString(accepted.state, `${acceptedLabel}.state`),
      }];
    })) as Record<EvidenceDirection, GeneratedAcceptedMaterialMetadata | null>;
    if (EVIDENCE_DIRECTIONS.every((direction) => directions[direction] === null)) {
      throw new Error(`${resultLabel} must contain at least one accepted direction`);
    }
    return { directions, itemId };
  }).sort((left, right) => compareStrings(left.itemId, right.itemId));
  for (let index = 1; index < results.length; index += 1) {
    if (results[index]!.itemId === results[index - 1]!.itemId) {
      throw new Error(`${label} contains duplicate item ids`);
    }
  }
  return results;
}

const SHA256_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  const bitLength = input.length * 8;
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0, false);
  const hash = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(chunk + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const small0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const small1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16]! + small0 + words[index - 7]! + small1) >>> 0;
    }
    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const large1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + large1 + choice + SHA256_CONSTANTS[index]! + words[index]!) >>> 0;
      const large0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (large0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  return [...hash].map((word) => word.toString(16).padStart(8, '0')).join('');
}

type GeneratedMaterialProfileContent = Omit<
  GeneratedMaterialAcceptanceProfileMetadata,
  'profileId'
>;

export function generatedMaterialAcceptanceProfileId(
  profile: GeneratedMaterialProfileContent,
  candidates: readonly GeneratedMaterialCandidateMetadata[],
): string {
  if (profile.coverage === 'NONE') return 'unextracted';
  const payload = {
    candidateUniverse: profile.coverage === 'COMPLETE_REGISTRY' ? candidates : [],
    coverage: profile.coverage,
    fingerprint: profile.fingerprint ?? null,
    probes: profile.probes,
    results: profile.results,
    status: profile.status,
  };
  return `sha256:${sha256Hex(JSON.stringify(payload))}`;
}

function canonicalMaterialAcceptanceProfile(
  value: unknown,
  label: string,
  candidates: readonly GeneratedMaterialCandidateMetadata[],
): GeneratedMaterialAcceptanceProfileMetadata {
  const source = evidenceRecord(value, label);
  const status = canonicalEvidenceStatus(source.status, `${label}.status`);
  const coverage = source.coverage;
  if (
    coverage !== 'COMPLETE_REGISTRY' &&
    coverage !== 'LEGACY_PARTIAL' &&
    coverage !== 'NONE'
  ) {
    throw new Error(`${label}.coverage is unsupported`);
  }
  const probes = canonicalLegacyMaterialProbes(
    source.probes,
    `${label}.probes`,
    status,
    coverage !== 'LEGACY_PARTIAL',
  );
  const results = canonicalMaterialResults(source.results, `${label}.results`, status, candidates);
  if (coverage === 'COMPLETE_REGISTRY' && probes.length !== 0) {
    throw new Error(`${label}.probes are only valid for LEGACY_PARTIAL coverage`);
  }
  if (coverage === 'COMPLETE_REGISTRY' && status === 'SUPPORTED' && candidates.length === 0) {
    throw new Error(`${label} cannot claim complete coverage of an empty candidate universe`);
  }
  if (coverage === 'LEGACY_PARTIAL' && results.length !== 0) {
    throw new Error(`${label}.results are only valid for COMPLETE_REGISTRY coverage`);
  }
  const fingerprint = canonicalFingerprint(status, source.fingerprint, label);
  if (coverage === 'NONE') {
    if (
      status !== 'UNEXTRACTED' ||
      probes.length !== 0 ||
      results.length !== 0
    ) {
      throw new Error(`${label} NONE coverage is reserved for the UNEXTRACTED sentinel`);
    }
  } else if (status === 'UNEXTRACTED') {
    throw new Error(`${label} UNEXTRACTED evidence must use NONE coverage`);
  }
  const content: GeneratedMaterialProfileContent = {
    coverage,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    probes,
    results,
    status,
  };
  const expectedId = generatedMaterialAcceptanceProfileId(content, candidates);
  const profileId = evidenceString(source.profileId, `${label}.profileId`);
  if (profileId !== expectedId) {
    throw new Error(`${label}.profileId does not match canonical profile content`);
  }
  return { ...content, profileId };
}

function canonicalAabb(box: unknown, label: string): GeneratedAabb16 {
  if (!Array.isArray(box) || box.length !== 6) {
    throw new Error(`${label} must contain exactly six coordinates`);
  }
  const coordinates = box.map((coordinate: unknown, index: number) => {
    if (
      typeof coordinate !== 'number' ||
      !Number.isInteger(coordinate) ||
      coordinate < 0 ||
      coordinate > 16
    ) {
      throw new Error(`${label}[${index}] must be an integer in 0..16`);
    }
    return coordinate;
  });
  if (
    coordinates[0]! >= coordinates[3]! ||
    coordinates[1]! >= coordinates[4]! ||
    coordinates[2]! >= coordinates[5]!
  ) {
    throw new Error(`${label} must have positive volume`);
  }
  return [
    coordinates[0]!,
    coordinates[1]!,
    coordinates[2]!,
    coordinates[3]!,
    coordinates[4]!,
    coordinates[5]!,
  ];
}

function compareAabbs(left: GeneratedAabb16, right: GeneratedAabb16): number {
  for (let index = 0; index < 6; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function canonicalNeighborDependencies(
  value: unknown,
  label: string,
  fallbackBlockId: string,
  fallbackState: string,
): GeneratedNeighborDependenciesMetadata {
  const source = evidenceRecord(value, label);
  const status = canonicalEvidenceStatus(source.status, `${label}.status`);
  const rawProbes = source.probes;
  if (!Array.isArray(rawProbes)) throw new Error(`${label}.probes must be an array`);
  if (status !== 'SUPPORTED' && rawProbes.length !== 0) {
    throw new Error(`${label}.probes require SUPPORTED evidence`);
  }
  if (status === 'SUPPORTED' && rawProbes.length === 0) {
    throw new Error(`${label}.probes must include at least one controlled neighbor`);
  }
  const probes = rawProbes.map((rawProbe: unknown, index: number) => {
    const probeLabel = `${label}.probes[${index}]`;
    const probe = evidenceRecord(rawProbe, probeLabel);
    const offset = canonicalOffset(probe.offset, `${probeLabel}.offset`);
    if (typeof probe.changesShape !== 'boolean') {
      throw new Error(`${probeLabel}.changesShape must be boolean`);
    }
    const changesState = probe.changesState === undefined ? false : probe.changesState;
    if (typeof changesState !== 'boolean') {
      throw new Error(`${probeLabel}.changesState must be boolean`);
    }
    if (!Array.isArray(probe.boxes)) throw new Error(`${probeLabel}.boxes must be an array`);
    const neighborState = canonicalStateString(
      probe.neighborState,
      `${probeLabel}.neighborState`,
    );
    const resolvedBlockId = probe.resolvedBlockId === undefined
      ? fallbackBlockId
      : evidenceString(probe.resolvedBlockId, `${probeLabel}.resolvedBlockId`);
    const resolvedState = probe.resolvedState === undefined
      ? fallbackState
      : canonicalStateString(probe.resolvedState, `${probeLabel}.resolvedState`);
    if (changesState !== (resolvedBlockId !== fallbackBlockId || resolvedState !== fallbackState)) {
      throw new Error(`${probeLabel}.changesState contradicts resolved state identity`);
    }
    const boxes = probe.boxes.map((box: unknown, boxIndex: number) =>
      canonicalAabb(box, `${probeLabel}.boxes[${boxIndex}]`),
    ).sort(compareAabbs);
    return {
      boxes,
      changesShape: probe.changesShape,
      changesState,
      neighborBlockId: evidenceString(probe.neighborBlockId, `${probeLabel}.neighborBlockId`),
      neighborState,
      offset,
      resolvedBlockId,
      resolvedState,
    };
  }).sort((left, right) => compareStrings(
    `${left.offset.join(',')}\0${left.neighborBlockId}\0${left.neighborState}`,
    `${right.offset.join(',')}\0${right.neighborBlockId}\0${right.neighborState}`,
  ));
  for (let index = 1; index < probes.length; index += 1) {
    const previous = probes[index - 1]!;
    const current = probes[index]!;
    if (
      current.offset.join(',') === previous.offset.join(',') &&
      current.neighborBlockId === previous.neighborBlockId &&
      current.neighborState === previous.neighborState
    ) {
      throw new Error(`${label}.probes contains duplicate neighbor contexts`);
    }
  }
  const fingerprint = canonicalFingerprint(status, source.fingerprint, label);
  return {
    ...(fingerprint === undefined ? {} : { fingerprint }),
    probes,
    status,
  };
}

function canonicalPlacementSafety(
  value: unknown,
  label: string,
): GeneratedPlacementSafetyMetadata {
  const source = evidenceRecord(value, label);
  const { assessment } = source;
  if (
    assessment !== 'SAFE' &&
    assessment !== 'CONDITIONAL' &&
    assessment !== 'UNSAFE' &&
    assessment !== 'UNEXTRACTED'
  ) {
    throw new Error(`${label}.assessment is unsupported`);
  }
  const rawFlags = source.flags;
  const rawProbes = source.probes;
  if (!Array.isArray(rawFlags)) throw new Error(`${label}.flags must be an array`);
  if (!Array.isArray(rawProbes)) throw new Error(`${label}.probes must be an array`);
  const flags = canonicalStrings(rawFlags, `${label}.flags`);
  if (assessment === 'CONDITIONAL' && flags.length === 0) {
    throw new Error(`${label}.flags must explain a CONDITIONAL assessment`);
  }
  if (assessment === 'UNEXTRACTED' && (flags.length !== 0 || rawProbes.length !== 0)) {
    throw new Error(`${label}.flags and probes are not allowed for UNEXTRACTED placement safety`);
  }
  const contextKeys = new Set<string>();
  const probes = rawProbes.map((rawProbe: unknown, index: number) => {
    const probeLabel = `${label}.probes[${index}]`;
    const probe = evidenceRecord(rawProbe, probeLabel);
    const context = evidenceString(probe.context, `${probeLabel}.context`);
    if (contextKeys.has(context)) throw new Error(`${label}.probes contains duplicate contexts`);
    contextKeys.add(context);
    if (!Array.isArray(probe.neighbors)) throw new Error(`${probeLabel}.neighbors must be an array`);
    if (typeof probe.survives !== 'boolean') throw new Error(`${probeLabel}.survives must be boolean`);
    const offsets = new Set<string>();
    const neighbors = probe.neighbors.map((rawNeighbor: unknown, neighborIndex: number) => {
      const neighborLabel = `${probeLabel}.neighbors[${neighborIndex}]`;
      const neighbor = evidenceRecord(rawNeighbor, neighborLabel);
      const offset = canonicalOffset(neighbor.offset, `${neighborLabel}.offset`);
      const offsetKey = offset.join(',');
      if (offsets.has(offsetKey)) throw new Error(`${probeLabel}.neighbors contains duplicate offsets`);
      offsets.add(offsetKey);
      return {
        blockId: evidenceString(neighbor.blockId, `${neighborLabel}.blockId`),
        offset,
        state: canonicalStateString(neighbor.state, `${neighborLabel}.state`),
      };
    }).sort((left, right) => compareStrings(left.offset.join(','), right.offset.join(',')));
    return { context, neighbors, survives: probe.survives };
  }).sort((left, right) => compareStrings(left.context, right.context));
  if (assessment !== 'UNEXTRACTED') {
    const hasEmptyContext = probes.some((probe) => probe.neighbors.length === 0);
    const missingStoneDirections = new Set([
      '-1,0,0',
      '0,-1,0',
      '0,0,-1',
      '0,0,1',
      '0,1,0',
      '1,0,0',
    ]);
    for (const probe of probes) {
      if (
        probe.neighbors.length === 1 &&
        probe.neighbors[0]!.blockId === 'minecraft:stone' &&
        probe.neighbors[0]!.state === ''
      ) {
        missingStoneDirections.delete(probe.neighbors[0]!.offset.join(','));
      }
    }
    if (!hasEmptyContext || missingStoneDirections.size !== 0) {
      throw new Error(
        `${label}.probes must include empty plus six single-stone cardinal contexts`,
      );
    }
    const anySurvives = probes.some((probe) => probe.survives);
    const allSurvive = probes.every((probe) => probe.survives);
    const expectedAssessment: PlacementSafetyAssessment = !anySurvives
      ? 'UNSAFE'
      : !allSurvive || flags.length !== 0
        ? 'CONDITIONAL'
        : 'SAFE';
    if (assessment !== expectedAssessment) {
      throw new Error(`${label}.assessment contradicts controlled placement probes`);
    }
  }
  const fingerprint = assessment === 'UNEXTRACTED'
    ? canonicalFingerprint('UNEXTRACTED', source.fingerprint, label)
    : evidenceString(source.fingerprint, `${label}.fingerprint`);
  return {
    assessment,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    flags,
    probes,
  };
}

function canonicalExtractionMetadata(
  value: unknown,
  shapeCount: number,
): GeneratedCatalogExtractionMetadata {
  const source = evidenceRecord(value, 'extraction');
  const rawShapes = source.shapes;
  if (
    source.schema !== EXTRACTION_EVIDENCE_SCHEMA ||
    source.version !== EXTRACTION_EVIDENCE_VERSION ||
    !Array.isArray(rawShapes)
  ) {
    throw new Error('Generated extraction evidence schema or version is unsupported');
  }
  if (rawShapes.length !== shapeCount) {
    throw new Error('Generated extraction evidence does not cover every shape');
  }
  const materialCandidates = canonicalMaterialCandidates(
    source.materialCandidates ?? [],
    'extraction.materialCandidates',
  );
  const rawProfiles = source.materialAcceptanceProfiles ?? [];
  if (!Array.isArray(rawProfiles)) {
    throw new Error('extraction.materialAcceptanceProfiles must be an array');
  }
  const profileById = new Map<string, GeneratedMaterialAcceptanceProfileMetadata>();
  for (let index = 0; index < rawProfiles.length; index += 1) {
    const profile = canonicalMaterialAcceptanceProfile(
      rawProfiles[index],
      `extraction.materialAcceptanceProfiles[${index}]`,
      materialCandidates,
    );
    if (profileById.has(profile.profileId)) {
      throw new Error('Generated extraction evidence has duplicate material profile ids');
    }
    profileById.set(profile.profileId, profile);
  }
  const rawDiagnostics = source.diagnostics;
  if (rawDiagnostics !== undefined && !Array.isArray(rawDiagnostics)) {
    throw new Error('Generated extraction evidence diagnostics must be an array');
  }
  const diagnostics = (rawDiagnostics ?? []).map(
    (rawDiagnostic: unknown, index: number) => {
      const label = `extraction.diagnostics[${index}]`;
      const diagnostic = evidenceRecord(rawDiagnostic, label);
      return {
        blockId: evidenceString(diagnostic.blockId, `${label}.blockId`),
        code: evidenceString(diagnostic.code, `${label}.code`),
        reason: evidenceString(diagnostic.reason, `${label}.reason`),
        state: canonicalStateString(diagnostic.state, `${label}.state`),
      };
    },
  ).sort((left, right) => compareStrings(
    `${left.blockId}\0${left.state}\0${left.code}\0${left.reason}`,
    `${right.blockId}\0${right.state}\0${right.code}\0${right.reason}`,
  ));
  for (let index = 1; index < diagnostics.length; index += 1) {
    const previous = diagnostics[index - 1]!;
    const current = diagnostics[index]!;
    if (
      current.blockId === previous.blockId &&
      current.state === previous.state &&
      current.code === previous.code &&
      current.reason === previous.reason
    ) {
      throw new Error('Generated extraction evidence has duplicate diagnostics');
    }
  }
  const shapeIdentities = new Set<string>();
  const shapes = rawShapes.map((rawShape: unknown, index: number) => {
    const label = `extraction.shapes[${index}]`;
    const shape = evidenceRecord(rawShape, label);
    const state = canonicalStateString(shape.state, `${label}.state`);
    const blockId = evidenceString(shape.blockId, `${label}.blockId`);
    const rawParts = shape.parts;
    if (!Array.isArray(rawParts)) throw new Error(`${label}.parts must be an array`);
    const partKeys = new Set<string>();
    const parts = rawParts.map((rawPart: unknown, partIndex: number) => {
      const partLabel = `${label}.parts[${partIndex}]`;
      const part = evidenceRecord(rawPart, partLabel);
      const key = evidenceString(part.key, `${partLabel}.key`);
      if (partKeys.has(key)) throw new Error(`${label}.parts contains duplicate keys`);
      partKeys.add(key);
      if (
        part.materialAcceptanceProfileId !== undefined &&
        part.materialAcceptance !== undefined
      ) {
        throw new Error(`${partLabel} cannot contain both inline and referenced material evidence`);
      }
      let materialAcceptanceProfileId: string;
      if (part.materialAcceptanceProfileId !== undefined) {
        materialAcceptanceProfileId = evidenceString(
          part.materialAcceptanceProfileId,
          `${partLabel}.materialAcceptanceProfileId`,
        );
      } else {
        const inline = part.materialAcceptance === undefined
          ? { probes: [], status: 'UNEXTRACTED' }
          : evidenceRecord(part.materialAcceptance, `${partLabel}.materialAcceptance`);
        const status = canonicalEvidenceStatus(
          inline.status,
          `${partLabel}.materialAcceptance.status`,
        );
        const probes = canonicalLegacyMaterialProbes(
          inline.probes,
          `${partLabel}.materialAcceptance.probes`,
          status,
        );
        const fingerprint = canonicalFingerprint(
          status,
          inline.fingerprint,
          `${partLabel}.materialAcceptance`,
        );
        const content: GeneratedMaterialProfileContent = status === 'UNEXTRACTED'
          ? {
              coverage: 'NONE',
              probes: [],
              results: [],
              status,
            }
          : {
              coverage: 'LEGACY_PARTIAL',
              ...(fingerprint === undefined ? {} : { fingerprint }),
              probes,
              results: [],
              status,
            };
        materialAcceptanceProfileId = generatedMaterialAcceptanceProfileId(
          content,
          materialCandidates,
        );
        const previous = profileById.get(materialAcceptanceProfileId);
        const profile = { ...content, profileId: materialAcceptanceProfileId };
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(profile)) {
          throw new Error('Generated material profile id collision');
        }
        profileById.set(materialAcceptanceProfileId, profile);
      }
      return {
        key,
        materialAcceptanceProfileId,
      };
    });
    const identity = `${blockId}\0${state}`;
    if (shapeIdentities.has(identity)) {
      throw new Error('Generated extraction evidence has duplicate shape identities');
    }
    shapeIdentities.add(identity);
    return {
      blockId,
      neighborDependencies: canonicalNeighborDependencies(
        shape.neighborDependencies,
        `${label}.neighborDependencies`,
        blockId,
        state,
      ),
      parts,
      placementSafety: canonicalPlacementSafety(
        shape.placementSafety,
        `${label}.placementSafety`,
      ),
      state,
    };
  });
  const referencedProfiles = new Set<string>();
  for (const shape of shapes) {
    for (const part of shape.parts) {
      const profile = profileById.get(part.materialAcceptanceProfileId);
      if (profile === undefined) {
        throw new Error('Generated extraction evidence references an unknown material profile');
      }
      referencedProfiles.add(profile.profileId);
    }
  }
  for (const profileId of profileById.keys()) {
    if (!referencedProfiles.has(profileId)) {
      throw new Error('Generated extraction evidence contains an unreferenced material profile');
    }
  }
  const materialAcceptanceProfiles = [...profileById.values()].sort((left, right) =>
    compareStrings(left.profileId, right.profileId),
  );
  return {
    diagnostics,
    materialAcceptanceProfiles,
    materialCandidates,
    schema: EXTRACTION_EVIDENCE_SCHEMA,
    shapes,
    version: EXTRACTION_EVIDENCE_VERSION,
  };
}

function runtimePlacementProfile(
  value: unknown,
  label: string,
): GeneratedRuntimePlacementProfile {
  const source = evidenceRecord(value, label);
  const assessment = source.assessment;
  if (
    assessment !== 'CONDITIONAL' &&
    assessment !== 'SAFE' &&
    assessment !== 'UNEXTRACTED' &&
    assessment !== 'UNSAFE'
  ) {
    throw new Error(`${label}.assessment is invalid`);
  }
  if (!Array.isArray(source.flags)) throw new Error(`${label}.flags must be an array`);
  return {
    assessment,
    flags: canonicalStrings(source.flags, `${label}.flags`),
  };
}

function createRuntimeMetadata(
  catalog: PackedShapeCatalog,
  extraction: GeneratedCatalogExtractionMetadata,
): GeneratedRuntimeCatalogMetadata {
  verifyExtractionMatchesCatalog(
    extraction,
    catalog.blockIds,
    catalog.states,
    catalog.shapePartOffsets,
    catalog.partKeys,
  );
  const profileIndexes = new Map(
    extraction.materialAcceptanceProfiles.map((profile, index) => [profile.profileId, index]),
  );
  const partMaterialProfileIndexes: number[] = [];
  const placementProfiles: GeneratedRuntimePlacementProfile[] = [];
  const placementProfileIndexes = new Map<string, number>();
  const shapePlacementProfileIndexes: number[] = [];
  for (const shape of extraction.shapes) {
    for (const part of shape.parts) {
      const profileIndex = profileIndexes.get(part.materialAcceptanceProfileId);
      if (profileIndex === undefined) {
        throw new Error('Runtime metadata references an unknown material profile');
      }
      partMaterialProfileIndexes.push(profileIndex);
    }
    const placementProfile: GeneratedRuntimePlacementProfile = {
      assessment: shape.placementSafety.assessment,
      flags: shape.placementSafety.flags,
    };
    const placementKey = JSON.stringify(placementProfile);
    let placementIndex = placementProfileIndexes.get(placementKey);
    if (placementIndex === undefined) {
      placementIndex = placementProfiles.length;
      placementProfileIndexes.set(placementKey, placementIndex);
      placementProfiles.push(placementProfile);
    }
    shapePlacementProfileIndexes.push(placementIndex);
  }
  if (partMaterialProfileIndexes.length !== catalog.partIds.length) {
    throw new Error('Runtime material profile indexes do not cover every part');
  }
  const diagnosticCounts: Record<string, number> = {};
  for (const diagnostic of extraction.diagnostics ?? []) {
    diagnosticCounts[diagnostic.code] = (diagnosticCounts[diagnostic.code] ?? 0) + 1;
  }
  return {
    counts: { parts: catalog.partIds.length, shapes: catalog.shapeCount },
    diagnosticCounts: Object.fromEntries(
      Object.entries(diagnosticCounts).sort(([left], [right]) => compareStrings(left, right)),
    ),
    materialAcceptanceProfiles: extraction.materialAcceptanceProfiles,
    materialCandidates: extraction.materialCandidates,
    partMaterialProfileIndexes,
    placementProfiles,
    schema: RUNTIME_EVIDENCE_SCHEMA,
    shapePlacementProfileIndexes,
    version: RUNTIME_EVIDENCE_VERSION,
  };
}

export function parseGeneratedRuntimeMetadata(
  value: unknown,
): GeneratedRuntimeCatalogMetadata {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  const source = evidenceRecord(parsed, 'runtimeMetadata');
  if (
    source.schema !== RUNTIME_EVIDENCE_SCHEMA ||
    source.version !== RUNTIME_EVIDENCE_VERSION
  ) {
    throw new Error('Runtime evidence schema or version is unsupported');
  }
  const counts = evidenceRecord(source.counts, 'runtimeMetadata.counts');
  const shapeCount = counts.shapes;
  const partCount = counts.parts;
  if (
    !Number.isInteger(shapeCount) ||
    !Number.isInteger(partCount) ||
    (shapeCount as number) < 0 ||
    (partCount as number) < 0
  ) {
    throw new Error('Runtime evidence counts are invalid');
  }
  const materialCandidates = canonicalMaterialCandidates(
    source.materialCandidates,
    'runtimeMetadata.materialCandidates',
  );
  if (!Array.isArray(source.materialAcceptanceProfiles)) {
    throw new Error('runtimeMetadata.materialAcceptanceProfiles must be an array');
  }
  const materialAcceptanceProfiles = source.materialAcceptanceProfiles.map(
    (profile, index) => canonicalMaterialAcceptanceProfile(
      profile,
      `runtimeMetadata.materialAcceptanceProfiles[${index}]`,
      materialCandidates,
    ),
  );
  const profileIds = new Set<string>();
  for (const profile of materialAcceptanceProfiles) {
    if (profileIds.has(profile.profileId)) {
      throw new Error('Runtime evidence contains duplicate material profiles');
    }
    profileIds.add(profile.profileId);
  }
  const canonicalIndexes = (
    raw: unknown,
    count: number,
    maximum: number,
    label: string,
  ): number[] => {
    if (!Array.isArray(raw) || raw.length !== count) {
      throw new Error(`${label} does not match its catalog count`);
    }
    return raw.map((entry, index) => {
      if (!Number.isInteger(entry) || (entry as number) < 0 || (entry as number) >= maximum) {
        throw new Error(`${label}[${index}] is out of range`);
      }
      return entry as number;
    });
  };
  if (!Array.isArray(source.placementProfiles) || source.placementProfiles.length === 0) {
    throw new Error('runtimeMetadata.placementProfiles must be non-empty');
  }
  const placementProfiles = source.placementProfiles.map((profile, index) =>
    runtimePlacementProfile(profile, `runtimeMetadata.placementProfiles[${index}]`),
  );
  const diagnosticSource = evidenceRecord(
    source.diagnosticCounts,
    'runtimeMetadata.diagnosticCounts',
  );
  const diagnosticCounts: Record<string, number> = {};
  for (const [code, count] of Object.entries(diagnosticSource).sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    evidenceString(code, 'runtimeMetadata diagnostic code');
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new Error(`runtimeMetadata diagnostic count for ${code} is invalid`);
    }
    diagnosticCounts[code] = count as number;
  }
  return {
    counts: { parts: partCount as number, shapes: shapeCount as number },
    diagnosticCounts,
    materialAcceptanceProfiles,
    materialCandidates,
    partMaterialProfileIndexes: canonicalIndexes(
      source.partMaterialProfileIndexes,
      partCount as number,
      materialAcceptanceProfiles.length,
      'runtimeMetadata.partMaterialProfileIndexes',
    ),
    placementProfiles,
    schema: RUNTIME_EVIDENCE_SCHEMA,
    shapePlacementProfileIndexes: canonicalIndexes(
      source.shapePlacementProfileIndexes,
      shapeCount as number,
      placementProfiles.length,
      'runtimeMetadata.shapePlacementProfileIndexes',
    ),
    version: RUNTIME_EVIDENCE_VERSION,
  };
}

function elementSize(type: ElementType): number {
  switch (type) {
    case ElementType.U8:
    case ElementType.UTF8:
      return 1;
    case ElementType.U16:
      return 2;
    case ElementType.U32:
    case ElementType.F32:
      return 4;
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb8_8320);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function crcHex(bytes: Uint8Array): string {
  return crc32(bytes).toString(16).padStart(8, '0');
}

function encodeU16(values: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setUint16(index * 2, values[index] ?? 0, true);
  }
  return bytes;
}

function encodeU32(values: Uint32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setUint32(index * 4, values[index] ?? 0, true);
  }
  return bytes;
}

function encodeF32(values: Float32Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < values.length; index += 1) {
    view.setFloat32(index * 4, values[index] ?? 0, true);
  }
  return bytes;
}

function encodeStrings(values: readonly string[]): {
  readonly bytes: Uint8Array;
  readonly offsets: Uint32Array;
} {
  const encoder = new TextEncoder();
  const encoded = values.map((value) => encoder.encode(value));
  const offsets = new Uint32Array(values.length + 1);
  let totalBytes = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    offsets[index] = totalBytes;
    totalBytes += encoded[index]!.length;
    if (totalBytes > 0xffff_ffff) throw new RangeError('UTF-8 string pool exceeds 4 GiB');
  }
  offsets[values.length] = totalBytes;
  const bytes = new Uint8Array(totalBytes);
  let cursor = 0;
  for (const value of encoded) {
    bytes.set(value, cursor);
    cursor += value.length;
  }
  return { bytes, offsets };
}

function section(
  id: number,
  type: ElementType,
  bytes: Uint8Array,
  elementCount: number,
): EncodedSection {
  if (bytes.length !== elementCount * elementSize(type)) {
    throw new Error(`Section ${id} byte length does not match its element count`);
  }
  return { bytes, elementCount, id, type };
}

function writeMagic(target: Uint8Array, magic: string): void {
  if (magic.length !== 8) throw new Error('Binary magic must be exactly eight bytes');
  for (let index = 0; index < magic.length; index += 1) {
    target[index] = magic.charCodeAt(index);
  }
}

function encodeContainer(
  magic: string,
  sectionsInput: readonly EncodedSection[],
  primaryCount: number,
  secondaryCount: number,
  tertiaryCount: number,
): Uint8Array {
  const sections = [...sectionsInput].sort((left, right) => left.id - right.id);
  const ids = new Set<number>();
  for (const entry of sections) {
    if (ids.has(entry.id)) throw new Error(`Duplicate binary section ${entry.id}`);
    ids.add(entry.id);
  }
  const payloadStart = align4(HEADER_BYTES + sections.length * SECTION_ENTRY_BYTES);
  let totalBytes = payloadStart;
  const offsets: number[] = [];
  for (const entry of sections) {
    totalBytes = align4(totalBytes);
    offsets.push(totalBytes);
    totalBytes += entry.bytes.length;
    if (totalBytes > 0xffff_ffff) throw new RangeError('Generated artifact exceeds 4 GiB');
  }
  const output = new Uint8Array(totalBytes);
  const view = new DataView(output.buffer);
  writeMagic(output, magic);
  view.setUint16(8, FORMAT_MAJOR, true);
  view.setUint16(10, FORMAT_MINOR, true);
  view.setUint8(12, LITTLE_ENDIAN_MARKER);
  view.setUint8(13, HEADER_BYTES / 4);
  view.setUint16(14, sections.length, true);
  view.setUint32(16, totalBytes, true);
  view.setUint32(24, primaryCount, true);
  view.setUint32(28, secondaryCount, true);
  view.setUint32(32, tertiaryCount, true);

  for (let index = 0; index < sections.length; index += 1) {
    const entry = sections[index]!;
    const offset = offsets[index]!;
    output.set(entry.bytes, offset);
    const tableOffset = HEADER_BYTES + index * SECTION_ENTRY_BYTES;
    view.setUint16(tableOffset, entry.id, true);
    view.setUint8(tableOffset + 2, entry.type);
    view.setUint8(tableOffset + 3, REQUIRED_SECTION_FLAG);
    view.setUint32(tableOffset + 4, offset, true);
    view.setUint32(tableOffset + 8, entry.bytes.length, true);
    view.setUint32(tableOffset + 12, entry.elementCount, true);
    view.setUint32(tableOffset + 16, crc32(entry.bytes), true);
  }
  view.setUint32(20, crc32(output.subarray(payloadStart)), true);
  return output;
}

function readMagic(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < 8; index += 1) {
    result += String.fromCharCode(bytes[index] ?? 0);
  }
  return result;
}

function decodeContainer(bytes: Uint8Array, expectedMagic: string): DecodedContainer {
  if (bytes.length < HEADER_BYTES) throw new Error('Generated artifact header is truncated');
  if (bytes.length > MAX_ARTIFACT_BYTES) throw new Error('Generated artifact exceeds loader limits');
  if (readMagic(bytes) !== expectedMagic) throw new Error('Generated artifact magic is invalid');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(8, true);
  const minor = view.getUint16(10, true);
  if (major !== FORMAT_MAJOR || minor > FORMAT_MINOR) {
    throw new Error(`Unsupported generated artifact version ${major}.${minor}`);
  }
  if (view.getUint8(12) !== LITTLE_ENDIAN_MARKER) {
    throw new Error('Generated artifact is not explicitly little-endian');
  }
  if (view.getUint8(13) * 4 !== HEADER_BYTES) {
    throw new Error('Generated artifact header size is invalid');
  }
  if (view.getUint32(36, true) !== 0) {
    throw new Error('Generated artifact header has non-zero reserved bytes');
  }
  if (view.getUint32(16, true) !== bytes.length) {
    throw new Error('Generated artifact file length does not match its header');
  }
  const sectionCount = view.getUint16(14, true);
  if (sectionCount > MAX_SECTION_COUNT) throw new Error('Generated artifact has too many sections');
  const payloadStart = align4(HEADER_BYTES + sectionCount * SECTION_ENTRY_BYTES);
  if (payloadStart > bytes.length) throw new Error('Generated artifact section table is truncated');
  if (view.getUint32(20, true) !== crc32(bytes.subarray(payloadStart))) {
    throw new Error('Generated artifact payload checksum mismatch');
  }

  const sections = new Map<number, DecodedSection>();
  const ranges: Array<{ readonly end: number; readonly start: number }> = [];
  let previousId = -1;
  for (let index = 0; index < sectionCount; index += 1) {
    const tableOffset = HEADER_BYTES + index * SECTION_ENTRY_BYTES;
    const id = view.getUint16(tableOffset, true);
    const typeCode = view.getUint8(tableOffset + 2);
    const flags = view.getUint8(tableOffset + 3);
    const offset = view.getUint32(tableOffset + 4, true);
    const byteLength = view.getUint32(tableOffset + 8, true);
    const elementCount = view.getUint32(tableOffset + 12, true);
    const expectedCrc = view.getUint32(tableOffset + 16, true);
    if (flags !== REQUIRED_SECTION_FLAG) {
      throw new Error(`Generated artifact section ${id} has unsupported flags`);
    }
    if (id <= previousId) throw new Error('Generated artifact sections are not canonically ordered');
    previousId = id;
    if (sections.has(id)) throw new Error(`Duplicate generated artifact section ${id}`);
    if (view.getUint32(tableOffset + 20, true) !== 0) {
      throw new Error(`Generated artifact section ${id} has non-zero reserved bytes`);
    }
    if (offset < payloadStart || (offset & 3) !== 0 || offset + byteLength > bytes.length) {
      throw new Error(`Generated artifact section ${id} has invalid bounds`);
    }
    if (!isElementType(typeCode)) {
      throw new Error(`Generated artifact section ${id} has an unknown element type`);
    }
    const type = typeCode;
    if (byteLength !== elementCount * elementSize(type)) {
      throw new Error(`Generated artifact section ${id} has invalid element metadata`);
    }
    const sectionBytes = bytes.subarray(offset, offset + byteLength);
    if (crc32(sectionBytes) !== expectedCrc) {
      throw new Error(`Generated artifact section ${id} checksum mismatch`);
    }
    ranges.push({ end: offset + byteLength, start: offset });
    sections.set(id, { bytes: sectionBytes, elementCount, type });
  }
  ranges.sort((left, right) => left.start - right.start);
  let paddingCursor = payloadStart;
  for (const range of ranges) {
    for (let offset = paddingCursor; offset < range.start; offset += 1) {
      if (bytes[offset] !== 0) throw new Error('Generated artifact padding is not canonical');
    }
    paddingCursor = Math.max(paddingCursor, range.end);
  }
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new Error('Generated artifact sections overlap');
    }
  }
  for (let offset = paddingCursor; offset < bytes.length; offset += 1) {
    if (bytes[offset] !== 0) throw new Error('Generated artifact trailing padding is not canonical');
  }
  return {
    primaryCount: view.getUint32(24, true),
    secondaryCount: view.getUint32(28, true),
    sections,
    tertiaryCount: view.getUint32(32, true),
  };
}

function requiredSection(
  container: DecodedContainer,
  id: number,
  type: ElementType,
): DecodedSection {
  const value = container.sections.get(id);
  if (value === undefined) throw new Error(`Required generated artifact section ${id} is missing`);
  if (value.type !== type) throw new Error(`Generated artifact section ${id} has the wrong type`);
  return value;
}

function decodeU8(container: DecodedContainer, id: number): Uint8Array {
  return requiredSection(container, id, ElementType.U8).bytes.slice();
}

function decodeU16(container: DecodedContainer, id: number): Uint16Array {
  const source = requiredSection(container, id, ElementType.U16);
  const result = new Uint16Array(source.elementCount);
  const view = new DataView(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getUint16(index * 2, true);
  }
  return result;
}

function decodeU32(container: DecodedContainer, id: number): Uint32Array {
  const source = requiredSection(container, id, ElementType.U32);
  const result = new Uint32Array(source.elementCount);
  const view = new DataView(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getUint32(index * 4, true);
  }
  return result;
}

function decodeF32(container: DecodedContainer, id: number): Float32Array {
  const source = requiredSection(container, id, ElementType.F32);
  const result = new Float32Array(source.elementCount);
  const view = new DataView(source.bytes.buffer, source.bytes.byteOffset, source.bytes.byteLength);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = view.getFloat32(index * 4, true);
  }
  return result;
}

function decodeStrings(
  container: DecodedContainer,
  offsetsSection: number,
  bytesSection: number,
  expectedCount: number,
): string[] {
  const offsets = decodeU32(container, offsetsSection);
  const bytes = requiredSection(container, bytesSection, ElementType.UTF8).bytes;
  if (offsets.length !== expectedCount + 1 || offsets[0] !== 0) {
    throw new Error('Generated string table has invalid offsets');
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const result: string[] = [];
  for (let index = 0; index < expectedCount; index += 1) {
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? 0;
    if (end < start || end > bytes.length) throw new Error('Generated string table is corrupt');
    result.push(decoder.decode(bytes.subarray(start, end)));
  }
  if ((offsets[offsets.length - 1] ?? 0) !== bytes.length) {
    throw new Error('Generated string table has trailing or missing bytes');
  }
  return result;
}

function assertLength(value: ArrayLike<unknown>, expected: number, label: string): void {
  if (value.length !== expected) {
    throw new Error(`${label} has ${value.length} elements; expected ${expected}`);
  }
}

function assertOffsets(
  offsets: Uint32Array,
  expectedLength: number,
  poolLength: number,
  label: string,
): void {
  assertLength(offsets, expectedLength, label);
  if ((offsets[0] ?? 0) !== 0 || (offsets[offsets.length - 1] ?? 0) !== poolLength) {
    throw new Error(`${label} does not span its complete pool`);
  }
  for (let index = 1; index < offsets.length; index += 1) {
    if ((offsets[index] ?? 0) < (offsets[index - 1] ?? 0)) {
      throw new Error(`${label} is not monotonic`);
    }
  }
}

function validateGeometryData(data: {
  readonly geometryCount: number;
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
  readonly shapeCount: number;
  readonly shapeGeometry: Uint32Array;
}): void {
  const seenKeys = new Set<string>();
  const seenShapes = new Uint8Array(data.shapeCount);
  for (let geometryId = 0; geometryId < data.geometryCount; geometryId += 1) {
    const mask4Offset = geometryId * wordCountForResolution(4);
    const mask8Offset = geometryId * wordCountForResolution(8);
    const mask16Offset = geometryId * wordCountForResolution(16);
    const mask4 = data.masks4.subarray(mask4Offset, mask4Offset + wordCountForResolution(4));
    const mask8 = data.masks8.subarray(mask8Offset, mask8Offset + wordCountForResolution(8));
    const mask16 = data.masks16.subarray(
      mask16Offset,
      mask16Offset + wordCountForResolution(16),
    );
    if (
      popcountMask(mask4) !== data.geometryPopcount4[geometryId] ||
      popcountMask(mask8) !== data.geometryPopcount8[geometryId] ||
      popcountMask(mask16) !== data.geometryPopcount16[geometryId]
    ) {
      throw new Error('Generated geometry popcount does not match its mask');
    }
    const key = data.geometryKeys[geometryId] ?? '';
    if (key !== `${GRID16_KEY_PREFIX}${maskToHex(mask16)}` || seenKeys.has(key)) {
      throw new Error('Generated exact geometry keys are invalid or duplicated');
    }
    seenKeys.add(key);
    const descriptorOffset = geometryId * DESCRIPTOR.LENGTH;
    for (let slot = 0; slot < DESCRIPTOR.LENGTH; slot += 1) {
      if (!Number.isFinite(data.geometryDescriptors[descriptorOffset + slot])) {
        throw new Error('Generated geometry descriptor is not finite');
      }
    }

    const realizationStart = data.geometryRealizationOffsets[geometryId] ?? 0;
    const realizationEnd = data.geometryRealizationOffsets[geometryId + 1] ?? 0;
    const representative = data.geometryRepresentativeShape[geometryId] ?? data.shapeCount;
    let representativeFound = false;
    let previousShapeId = -1;
    for (let index = realizationStart; index < realizationEnd; index += 1) {
      const shapeId = data.geometryRealizations[index] ?? data.shapeCount;
      if (
        shapeId >= data.shapeCount ||
        shapeId <= previousShapeId ||
        data.shapeGeometry[shapeId] !== geometryId ||
        seenShapes[shapeId] !== 0
      ) {
        throw new Error('Generated geometry realizations are inconsistent');
      }
      previousShapeId = shapeId;
      seenShapes[shapeId] = 1;
      representativeFound ||= shapeId === representative;
    }
    if (!representativeFound) {
      throw new Error('Generated representative is not a realization of its geometry');
    }
  }
  if (data.geometryRealizations.length !== data.shapeCount || seenShapes.includes(0)) {
    throw new Error('Generated geometry realizations do not cover every shape exactly once');
  }
}

function validateShapeAndPartData(data: {
  readonly masks16: Uint32Array;
  readonly ownerGrid16Pool: Uint8Array;
  readonly partCount: number;
  readonly partIds: Uint8Array;
  readonly partKeys: readonly string[];
  readonly partMasks16: Uint32Array;
  readonly shapeCount: number;
  readonly shapeGeometry: Uint32Array;
  readonly shapeNeighborDependent: Uint8Array;
  readonly shapeOwnerGridOffsets: Uint32Array;
  readonly shapePartOffsets: Uint32Array;
  readonly shapeStateId: Uint32Array;
}): void {
  const maskWords = wordCountForResolution(16);
  for (let shapeId = 0; shapeId < data.shapeCount; shapeId += 1) {
    if (
      (data.shapeStateId[shapeId] ?? data.shapeCount) >= data.shapeCount ||
      (data.shapeNeighborDependent[shapeId] ?? 2) > 1
    ) {
      throw new Error('Generated shape state or flags are invalid');
    }
    const partStart = data.shapePartOffsets[shapeId] ?? 0;
    const partEnd = data.shapePartOffsets[shapeId + 1] ?? 0;
    const localPartCount = partEnd - partStart;
    const partKeySet = new Set<string>();
    for (let partIndex = partStart; partIndex < partEnd; partIndex += 1) {
      const localPartId = partIndex - partStart;
      const key = data.partKeys[partIndex] ?? '';
      if (data.partIds[partIndex] !== localPartId || key.length === 0 || partKeySet.has(key)) {
        throw new Error('Generated shape has invalid local part identities');
      }
      partKeySet.add(key);
    }

    const geometryId = data.shapeGeometry[shapeId] ?? 0;
    const geometryOffset = geometryId * maskWords;
    for (let word = 0; word < maskWords; word += 1) {
      let partUnion = 0;
      for (let partIndex = partStart; partIndex < partEnd; partIndex += 1) {
        partUnion |= data.partMasks16[partIndex * maskWords + word] ?? 0;
      }
      if ((partUnion >>> 0) !== (data.masks16[geometryOffset + word] ?? 0)) {
        throw new Error('Generated part masks do not union to their shape geometry');
      }
    }

    const ownerOffset = data.shapeOwnerGridOffsets[shapeId] ?? NO_OFFSET;
    if (localPartCount <= 1) {
      if (ownerOffset !== NO_OFFSET) throw new Error('Single-part shape has an owner grid');
      continue;
    }
    if (ownerOffset === NO_OFFSET || (ownerOffset & 4095) !== 0) {
      throw new Error('Multipart shape is missing an aligned owner grid');
    }
    for (let voxel = 0; voxel < 4096; voxel += 1) {
      const occupied = getBit(data.masks16, geometryOffset * 32 + voxel);
      const owner = data.ownerGrid16Pool[ownerOffset + voxel] ?? AIR_OWNER;
      if (!occupied) {
        if (owner !== AIR_OWNER) throw new Error('Generated owner grid assigns an air voxel');
      } else if (
        owner === AIR_OWNER ||
        owner >= localPartCount ||
        !getBit(data.partMasks16, (partStart + owner) * maskWords * 32 + voxel)
      ) {
        throw new Error('Generated owner grid does not reference an occupying part');
      }
    }
  }
  if (data.partKeys.length !== data.partCount) {
    throw new Error('Generated part key count is inconsistent');
  }
}

function parseMetadata(value: GeneratedCatalogMetadata | string): GeneratedCatalogMetadata {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Generated metadata is not an object');
  return parsed as GeneratedCatalogMetadata;
}

function validateArtifactDescription(
  artifact: GeneratedArtifactDescription,
  label: string,
): void {
  if (
    typeof artifact !== 'object' ||
    artifact === null ||
    !Number.isSafeInteger(artifact.bytes) ||
    artifact.bytes < 0 ||
    !/^[0-9a-f]{8}$/u.test(artifact.crc32)
  ) {
    throw new Error(`Generated ${label} artifact description is invalid`);
  }
}

export function verifyGeneratedRuntimeMetadataArtifact(
  metadata: GeneratedCatalogMetadata | string,
  runtimeMetadataJson: string,
): void {
  const parsed = parseMetadata(metadata);
  const artifact = parsed.artifacts?.runtime;
  if (artifact === undefined) {
    throw new Error('Generated metadata does not declare a runtime metadata artifact');
  }
  validateArtifactDescription(artifact, 'runtime metadata');
  const bytes = new TextEncoder().encode(runtimeMetadataJson);
  if (artifact.bytes !== bytes.length || artifact.crc32 !== crcHex(bytes)) {
    throw new Error('Generated runtime metadata artifact checksum mismatch');
  }
}

function verifyMetadata(
  metadata: GeneratedCatalogMetadata,
  shapes: Uint8Array,
  blocks: Uint8Array,
  geometryCount: number,
  shapeCount: number,
  partCount: number,
): void {
  if (
    typeof metadata !== 'object' ||
    metadata === null ||
    typeof metadata.formatVersion !== 'object' ||
    metadata.formatVersion === null ||
    typeof metadata.counts !== 'object' ||
    metadata.counts === null ||
    typeof metadata.artifacts !== 'object' ||
    metadata.artifacts === null ||
    typeof metadata.artifacts.shapes !== 'object' ||
    metadata.artifacts.shapes === null ||
    typeof metadata.artifacts.blocks !== 'object' ||
    metadata.artifacts.blocks === null
  ) {
    throw new Error('Generated metadata structure is invalid');
  }
  validateArtifactDescription(metadata.artifacts.shapes, 'shapes');
  validateArtifactDescription(metadata.artifacts.blocks, 'blocks');
  if (metadata.artifacts.runtime !== undefined) {
    validateArtifactDescription(metadata.artifacts.runtime, 'runtime metadata');
  }
  if (
    metadata.schema !== METADATA_SCHEMA ||
    metadata.formatVersion.major !== FORMAT_MAJOR ||
    metadata.formatVersion.minor > FORMAT_MINOR
  ) {
    throw new Error('Generated metadata schema or version is unsupported');
  }
  if (
    metadata.counts.geometries !== geometryCount ||
    metadata.counts.shapes !== shapeCount ||
    metadata.counts.parts !== partCount
  ) {
    throw new Error('Generated metadata counts do not match binary artifacts');
  }
  if (
    metadata.artifacts.shapes.bytes !== shapes.length ||
    metadata.artifacts.shapes.crc32 !== crcHex(shapes) ||
    metadata.artifacts.blocks.bytes !== blocks.length ||
    metadata.artifacts.blocks.crc32 !== crcHex(blocks)
  ) {
    throw new Error('Generated metadata artifact checksum mismatch');
  }
  if (typeof metadata.sources !== 'object' || metadata.sources === null) {
    throw new Error('Generated metadata sources are invalid');
  }
  canonicalSources(metadata.sources);
  if (metadata.extraction !== undefined) {
    canonicalExtractionMetadata(metadata.extraction, shapeCount);
  }
}

function verifyExtractionMatchesCatalog(
  extraction: GeneratedCatalogExtractionMetadata | undefined,
  blockIds: readonly string[],
  states: readonly string[],
  shapePartOffsets: Uint32Array,
  partKeys: readonly string[],
): void {
  if (extraction === undefined) return;
  const canonical = canonicalExtractionMetadata(extraction, blockIds.length);
  for (let shapeId = 0; shapeId < blockIds.length; shapeId += 1) {
    const evidence = canonical.shapes[shapeId]!;
    if (evidence.blockId !== blockIds[shapeId] || evidence.state !== states[shapeId]) {
      throw new Error('Generated extraction evidence shape identity does not match binary artifacts');
    }
    const start = shapePartOffsets[shapeId] ?? 0;
    const end = shapePartOffsets[shapeId + 1] ?? start;
    if (evidence.parts.length !== end - start) {
      throw new Error('Generated extraction evidence part count does not match binary artifacts');
    }
    for (let partIndex = 0; partIndex < evidence.parts.length; partIndex += 1) {
      if (evidence.parts[partIndex]!.key !== partKeys[start + partIndex]) {
        throw new Error('Generated extraction evidence part key does not match binary artifacts');
      }
    }
  }
}

export function encodeGeneratedCatalog(
  catalog: PackedShapeCatalog,
  sources: GeneratedCatalogSources = {},
  extraction?: GeneratedCatalogExtractionMetadata,
  options: GeneratedCatalogEncodeOptions = {},
): GeneratedCatalogArtifacts {
  const geometryKeys = encodeStrings(catalog.geometryKeys);
  const routeEntries = [...catalog.routeIndex.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  );
  const routeKeys = encodeStrings(routeEntries.map(([key]) => key));
  const routePostingOffsets = new Uint32Array(routeEntries.length + 1);
  const routePostings: number[] = [];
  for (let index = 0; index < routeEntries.length; index += 1) {
    routePostingOffsets[index] = routePostings.length;
    routePostings.push(...routeEntries[index]![1]);
  }
  routePostingOffsets[routeEntries.length] = routePostings.length;

  const partCount = catalog.partIds.length;
  const shapes = encodeContainer(
    SHAPES_MAGIC,
    [
      section(ShapeSection.MASKS_4, ElementType.U32, encodeU32(catalog.masks4), catalog.masks4.length),
      section(ShapeSection.MASKS_8, ElementType.U32, encodeU32(catalog.masks8), catalog.masks8.length),
      section(ShapeSection.MASKS_16, ElementType.U32, encodeU32(catalog.masks16), catalog.masks16.length),
      section(ShapeSection.DESCRIPTORS, ElementType.F32, encodeF32(catalog.geometryDescriptors), catalog.geometryDescriptors.length),
      section(ShapeSection.POPCOUNT_4, ElementType.U8, catalog.geometryPopcount4.slice(), catalog.geometryPopcount4.length),
      section(ShapeSection.POPCOUNT_8, ElementType.U16, encodeU16(catalog.geometryPopcount8), catalog.geometryPopcount8.length),
      section(ShapeSection.POPCOUNT_16, ElementType.U16, encodeU16(catalog.geometryPopcount16), catalog.geometryPopcount16.length),
      section(ShapeSection.GEOMETRY_KEY_OFFSETS, ElementType.U32, encodeU32(geometryKeys.offsets), geometryKeys.offsets.length),
      section(ShapeSection.GEOMETRY_KEY_BYTES, ElementType.UTF8, geometryKeys.bytes, geometryKeys.bytes.length),
      section(ShapeSection.REPRESENTATIVE_SHAPES, ElementType.U32, encodeU32(catalog.geometryRepresentativeShape), catalog.geometryRepresentativeShape.length),
      section(ShapeSection.REALIZATION_OFFSETS, ElementType.U32, encodeU32(catalog.geometryRealizationOffsets), catalog.geometryRealizationOffsets.length),
      section(ShapeSection.REALIZATIONS, ElementType.U32, encodeU32(catalog.geometryRealizations), catalog.geometryRealizations.length),
      section(ShapeSection.PART_MASKS_16, ElementType.U32, encodeU32(catalog.partMasks16), catalog.partMasks16.length),
      section(ShapeSection.OWNER_GRIDS_16, ElementType.U8, catalog.ownerGrid16Pool.slice(), catalog.ownerGrid16Pool.length),
      section(ShapeSection.ROUTE_KEY_OFFSETS, ElementType.U32, encodeU32(routeKeys.offsets), routeKeys.offsets.length),
      section(ShapeSection.ROUTE_KEY_BYTES, ElementType.UTF8, routeKeys.bytes, routeKeys.bytes.length),
      section(ShapeSection.ROUTE_POSTING_OFFSETS, ElementType.U32, encodeU32(routePostingOffsets), routePostingOffsets.length),
      section(ShapeSection.ROUTE_POSTINGS, ElementType.U32, encodeU32(Uint32Array.from(routePostings)), routePostings.length),
    ],
    catalog.geometryCount,
    catalog.shapeCount,
    partCount,
  );

  const blockIds = encodeStrings(catalog.blockIds);
  const states = encodeStrings(catalog.states);
  const partKeys = encodeStrings(catalog.partKeys);
  const blocks = encodeContainer(
    BLOCKS_MAGIC,
    [
      section(BlockSection.BLOCK_ID_OFFSETS, ElementType.U32, encodeU32(blockIds.offsets), blockIds.offsets.length),
      section(BlockSection.BLOCK_ID_BYTES, ElementType.UTF8, blockIds.bytes, blockIds.bytes.length),
      section(BlockSection.STATE_OFFSETS, ElementType.U32, encodeU32(states.offsets), states.offsets.length),
      section(BlockSection.STATE_BYTES, ElementType.UTF8, states.bytes, states.bytes.length),
      section(BlockSection.SHAPE_GEOMETRY, ElementType.U32, encodeU32(catalog.shapeGeometry), catalog.shapeGeometry.length),
      section(BlockSection.SHAPE_FAMILY, ElementType.U8, catalog.shapeFamily.slice(), catalog.shapeFamily.length),
      section(BlockSection.SHAPE_FAMILY_PRIORITY, ElementType.U8, catalog.shapeFamilyPriority.slice(), catalog.shapeFamilyPriority.length),
      section(BlockSection.SHAPE_COMPLEXITY, ElementType.U16, encodeU16(catalog.shapeComplexity), catalog.shapeComplexity.length),
      section(BlockSection.SHAPE_STATE_ID, ElementType.U32, encodeU32(catalog.shapeStateId), catalog.shapeStateId.length),
      section(BlockSection.SHAPE_NEIGHBOR_DEPENDENT, ElementType.U8, catalog.shapeNeighborDependent.slice(), catalog.shapeNeighborDependent.length),
      section(BlockSection.SHAPE_PART_OFFSETS, ElementType.U32, encodeU32(catalog.shapePartOffsets), catalog.shapePartOffsets.length),
      section(BlockSection.SHAPE_OWNER_GRID_OFFSETS, ElementType.U32, encodeU32(catalog.shapeOwnerGridOffsets), catalog.shapeOwnerGridOffsets.length),
      section(BlockSection.PART_IDS, ElementType.U8, catalog.partIds.slice(), catalog.partIds.length),
      section(BlockSection.PART_MATERIAL_SLOTS, ElementType.U8, catalog.partMaterialSlots.slice(), catalog.partMaterialSlots.length),
      section(BlockSection.PART_COMPATIBILITY, ElementType.U32, encodeU32(catalog.partCompatibility), catalog.partCompatibility.length),
      section(BlockSection.PART_MASK_16_OFFSETS, ElementType.U32, encodeU32(catalog.partMask16Offsets), catalog.partMask16Offsets.length),
      section(BlockSection.PART_KEY_OFFSETS, ElementType.U32, encodeU32(partKeys.offsets), partKeys.offsets.length),
      section(BlockSection.PART_KEY_BYTES, ElementType.UTF8, partKeys.bytes, partKeys.bytes.length),
    ],
    catalog.shapeCount,
    partCount,
    catalog.geometryCount,
  );

  const canonicalSourceMetadata = canonicalSources(sources);
  const canonicalExtraction = extraction === undefined
    ? undefined
    : canonicalExtractionMetadata(extraction, catalog.shapeCount);
  const splitEvidence = options.evidenceMode === 'split' && canonicalExtraction !== undefined;
  const runtimeMetadata = splitEvidence
    ? createRuntimeMetadata(catalog, canonicalExtraction)
    : undefined;
  const auditMetadata: GeneratedExtractionAuditMetadata | undefined = splitEvidence
    ? {
        counts: { parts: partCount, shapes: catalog.shapeCount },
        extraction: canonicalExtraction,
        schema: EXTRACTION_AUDIT_SCHEMA,
        sources: canonicalSourceMetadata,
        version: EXTRACTION_AUDIT_VERSION,
      }
    : undefined;
  const runtimeMetadataJson = runtimeMetadata === undefined
    ? undefined
    : `${JSON.stringify(runtimeMetadata)}\n`;
  const runtimeMetadataBytes = runtimeMetadataJson === undefined
    ? undefined
    : new TextEncoder().encode(runtimeMetadataJson);
  const metadata: GeneratedCatalogMetadata = {
    artifacts: {
      blocks: { bytes: blocks.length, crc32: crcHex(blocks) },
      ...(runtimeMetadataBytes === undefined
        ? {}
        : {
            runtime: {
              bytes: runtimeMetadataBytes.length,
              crc32: crcHex(runtimeMetadataBytes),
            },
          }),
      shapes: { bytes: shapes.length, crc32: crcHex(shapes) },
    },
    counts: {
      geometries: catalog.geometryCount,
      parts: partCount,
      shapes: catalog.shapeCount,
    },
    exactGeometryKinds: ['GRID16_EXACT:v1'],
    ...(canonicalExtraction === undefined || splitEvidence
      ? {}
      : { extraction: canonicalExtraction }),
    formatVersion: { major: FORMAT_MAJOR, minor: FORMAT_MINOR },
    schema: METADATA_SCHEMA,
    sources: canonicalSourceMetadata,
  };
  return {
    ...(auditMetadata === undefined
      ? {}
      : {
          auditMetadata,
          auditMetadataJson: `${JSON.stringify(auditMetadata)}\n`,
        }),
    blocks,
    metadata,
    metadataJson: `${JSON.stringify(metadata)}\n`,
    ...(runtimeMetadata === undefined || runtimeMetadataJson === undefined
      ? {}
      : {
          runtimeMetadata,
          runtimeMetadataJson,
        }),
    shapes,
  };
}

export function decodeGeneratedCatalog(input: GeneratedCatalogInput): PackedShapeCatalog {
  const shapes = decodeContainer(input.shapes, SHAPES_MAGIC);
  const blocks = decodeContainer(input.blocks, BLOCKS_MAGIC);
  const geometryCount = shapes.primaryCount;
  const shapeCount = shapes.secondaryCount;
  const partCount = shapes.tertiaryCount;
  if (
    blocks.primaryCount !== shapeCount ||
    blocks.secondaryCount !== partCount ||
    blocks.tertiaryCount !== geometryCount
  ) {
    throw new Error('Generated shape and block artifact counts disagree');
  }
  const metadata = parseMetadata(input.metadata);
  verifyMetadata(
    metadata,
    input.shapes,
    input.blocks,
    geometryCount,
    shapeCount,
    partCount,
  );

  const masks4 = decodeU32(shapes, ShapeSection.MASKS_4);
  const masks8 = decodeU32(shapes, ShapeSection.MASKS_8);
  const masks16 = decodeU32(shapes, ShapeSection.MASKS_16);
  const geometryDescriptors = decodeF32(shapes, ShapeSection.DESCRIPTORS);
  const geometryPopcount4 = decodeU8(shapes, ShapeSection.POPCOUNT_4);
  const geometryPopcount8 = decodeU16(shapes, ShapeSection.POPCOUNT_8);
  const geometryPopcount16 = decodeU16(shapes, ShapeSection.POPCOUNT_16);
  const geometryKeys = decodeStrings(
    shapes,
    ShapeSection.GEOMETRY_KEY_OFFSETS,
    ShapeSection.GEOMETRY_KEY_BYTES,
    geometryCount,
  );
  const geometryRepresentativeShape = decodeU32(shapes, ShapeSection.REPRESENTATIVE_SHAPES);
  const geometryRealizationOffsets = decodeU32(shapes, ShapeSection.REALIZATION_OFFSETS);
  const geometryRealizations = decodeU32(shapes, ShapeSection.REALIZATIONS);
  const partMasks16 = decodeU32(shapes, ShapeSection.PART_MASKS_16);
  const ownerGrid16Pool = decodeU8(shapes, ShapeSection.OWNER_GRIDS_16);
  const routeKeyCount = requiredSection(
    shapes,
    ShapeSection.ROUTE_KEY_OFFSETS,
    ElementType.U32,
  ).elementCount - 1;
  const routeKeys = decodeStrings(
    shapes,
    ShapeSection.ROUTE_KEY_OFFSETS,
    ShapeSection.ROUTE_KEY_BYTES,
    routeKeyCount,
  );
  const routePostingOffsets = decodeU32(shapes, ShapeSection.ROUTE_POSTING_OFFSETS);
  const routePostings = decodeU32(shapes, ShapeSection.ROUTE_POSTINGS);

  const blockIds = decodeStrings(
    blocks,
    BlockSection.BLOCK_ID_OFFSETS,
    BlockSection.BLOCK_ID_BYTES,
    shapeCount,
  );
  const states = decodeStrings(
    blocks,
    BlockSection.STATE_OFFSETS,
    BlockSection.STATE_BYTES,
    shapeCount,
  );
  const shapeGeometry = decodeU32(blocks, BlockSection.SHAPE_GEOMETRY);
  const shapeFamily = decodeU8(blocks, BlockSection.SHAPE_FAMILY);
  const shapeFamilyPriority = decodeU8(blocks, BlockSection.SHAPE_FAMILY_PRIORITY);
  const shapeComplexity = decodeU16(blocks, BlockSection.SHAPE_COMPLEXITY);
  const shapeStateId = decodeU32(blocks, BlockSection.SHAPE_STATE_ID);
  const shapeNeighborDependent = decodeU8(blocks, BlockSection.SHAPE_NEIGHBOR_DEPENDENT);
  const shapePartOffsets = decodeU32(blocks, BlockSection.SHAPE_PART_OFFSETS);
  const shapeOwnerGridOffsets = decodeU32(blocks, BlockSection.SHAPE_OWNER_GRID_OFFSETS);
  const partIds = decodeU8(blocks, BlockSection.PART_IDS);
  const partMaterialSlots = decodeU8(blocks, BlockSection.PART_MATERIAL_SLOTS);
  const partCompatibility = decodeU32(blocks, BlockSection.PART_COMPATIBILITY);
  const partMask16Offsets = decodeU32(blocks, BlockSection.PART_MASK_16_OFFSETS);
  const partKeys = decodeStrings(
    blocks,
    BlockSection.PART_KEY_OFFSETS,
    BlockSection.PART_KEY_BYTES,
    partCount,
  );
  verifyExtractionMatchesCatalog(
    metadata.extraction,
    blockIds,
    states,
    shapePartOffsets,
    partKeys,
  );

  assertLength(masks4, geometryCount * wordCountForResolution(4), 'mask4 pool');
  assertLength(masks8, geometryCount * wordCountForResolution(8), 'mask8 pool');
  assertLength(masks16, geometryCount * wordCountForResolution(16), 'mask16 pool');
  assertLength(geometryDescriptors, geometryCount * DESCRIPTOR.LENGTH, 'descriptor pool');
  assertLength(geometryPopcount4, geometryCount, '4^3 popcounts');
  assertLength(geometryPopcount8, geometryCount, '8^3 popcounts');
  assertLength(geometryPopcount16, geometryCount, '16^3 popcounts');
  assertLength(geometryRepresentativeShape, geometryCount, 'representative shapes');
  assertOffsets(
    geometryRealizationOffsets,
    geometryCount + 1,
    geometryRealizations.length,
    'geometry realization offsets',
  );
  assertLength(shapeGeometry, shapeCount, 'shape geometry ids');
  assertLength(shapeFamily, shapeCount, 'shape families');
  assertLength(shapeFamilyPriority, shapeCount, 'shape family priorities');
  assertLength(shapeComplexity, shapeCount, 'shape complexities');
  assertLength(shapeStateId, shapeCount, 'shape state ids');
  assertLength(shapeNeighborDependent, shapeCount, 'shape neighbor flags');
  assertOffsets(shapePartOffsets, shapeCount + 1, partCount, 'shape part offsets');
  assertLength(shapeOwnerGridOffsets, shapeCount, 'owner grid offsets');
  assertLength(partIds, partCount, 'part ids');
  assertLength(partMaterialSlots, partCount, 'part material slots');
  assertLength(partCompatibility, partCount, 'part compatibility masks');
  assertLength(partMask16Offsets, partCount, 'part mask offsets');
  assertLength(partMasks16, partCount * wordCountForResolution(16), 'part mask pool');
  assertOffsets(
    routePostingOffsets,
    routeKeyCount + 1,
    routePostings.length,
    'route posting offsets',
  );

  for (const shapeId of geometryRepresentativeShape) {
    if (shapeId >= shapeCount) throw new Error('Representative shape id is out of range');
  }
  for (const shapeId of geometryRealizations) {
    if (shapeId >= shapeCount) throw new Error('Geometry realization id is out of range');
  }
  for (const geometryId of shapeGeometry) {
    if (geometryId >= geometryCount) throw new Error('Shape geometry id is out of range');
  }
  for (let part = 0; part < partCount; part += 1) {
    if ((partMask16Offsets[part] ?? NO_OFFSET) !== part * wordCountForResolution(16)) {
      throw new Error('Part mask offsets are not densely packed');
    }
  }
  for (const offset of shapeOwnerGridOffsets) {
    if (offset !== NO_OFFSET && offset + 4096 > ownerGrid16Pool.length) {
      throw new Error('Shape owner grid offset is out of range');
    }
  }
  validateGeometryData({
    geometryCount,
    geometryDescriptors,
    geometryKeys,
    geometryPopcount4,
    geometryPopcount8,
    geometryPopcount16,
    geometryRealizationOffsets,
    geometryRealizations,
    geometryRepresentativeShape,
    masks4,
    masks8,
    masks16,
    shapeCount,
    shapeGeometry,
  });
  validateShapeAndPartData({
    masks16,
    ownerGrid16Pool,
    partCount,
    partIds,
    partKeys,
    partMasks16,
    shapeCount,
    shapeGeometry,
    shapeNeighborDependent,
    shapeOwnerGridOffsets,
    shapePartOffsets,
    shapeStateId,
  });

  const routeIndex = new Map<string, Uint32Array>();
  for (let index = 0; index < routeKeys.length; index += 1) {
    const start = routePostingOffsets[index] ?? 0;
    const end = routePostingOffsets[index + 1] ?? start;
    const postings = routePostings.slice(start, end);
    let previous = -1;
    for (const geometryId of postings) {
      if (geometryId >= geometryCount || geometryId <= previous) {
        throw new Error('Route postings are unsorted, duplicated, or out of range');
      }
      previous = geometryId;
    }
    const routeKey = routeKeys[index]!;
    if (routeIndex.has(routeKey)) throw new Error('Generated route keys are duplicated');
    routeIndex.set(routeKey, postings);
  }

  const shapeLookup = new Map<string, number>();
  for (let shapeId = 0; shapeId < shapeCount; shapeId += 1) {
    const identity = `${blockIds[shapeId] ?? ''}${states[shapeId] ?? ''}`;
    if (shapeLookup.has(identity)) throw new Error('Generated catalog has duplicate shape identities');
    shapeLookup.set(identity, shapeId);
  }
  const popcountLists = Array.from({ length: 65 }, () => [] as number[]);
  for (let geometryId = 0; geometryId < geometryCount; geometryId += 1) {
    const population = geometryPopcount4[geometryId] ?? 0;
    if (population > 64) throw new Error('Generated 4^3 popcount is invalid');
    popcountLists[population]!.push(geometryId);
  }

  const data: PackedShapeCatalogData = {
    blockIds,
    geometryDescriptors,
    geometryKeys,
    geometryPopcount4,
    geometryPopcount8,
    geometryPopcount16,
    geometryRealizationOffsets,
    geometryRealizations,
    geometryRepresentativeShape,
    masks4,
    masks8,
    masks16,
    ownerGrid16Pool,
    partCompatibility,
    partIds,
    partKeys,
    partMask16Offsets,
    partMasks16,
    partMaterialSlots,
    popcount4Buckets: popcountLists.map((ids) => Uint32Array.from(ids)),
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
  };
  return new PackedShapeCatalog(data);
}
