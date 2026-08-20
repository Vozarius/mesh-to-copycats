import {
  ShapeFamily,
  type Aabb16,
} from '@mesh-to-copycats/shared';

import { buildShapeCatalog, type PackedShapeCatalog } from './catalog.js';
import { validateExactAabbs } from './exact.js';
import {
  EXTRACTION_EVIDENCE_SCHEMA,
  EXTRACTION_EVIDENCE_VERSION,
  EVIDENCE_DIRECTIONS,
  generatedMaterialAcceptanceProfileId,
  type EvidenceDirection,
  type ExtractionEvidenceStatus,
  type GeneratedMaterialAcceptanceProfileMetadata,
  type GeneratedMaterialCandidateMetadata,
  type GeneratedCatalogExtractionMetadata,
  type GeneratedCatalogSources,
  type PlacementSafetyAssessment,
} from './generated.js';
import type {
  ShapeDefinitionInput,
  ShapePartDefinition,
  ShapeStateValue,
} from './types.js';

export const EXTRACTED_CATALOG_SCHEMA = 'mesh-to-copycats.extracted-catalog';
export const EXTRACTED_CATALOG_VERSION = 1;

export type ExtractedAabb16 = readonly [
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
];

export interface ExtractedPart {
  readonly boxes: readonly ExtractedAabb16[];
  readonly compatibility?: number;
  readonly key: string;
  readonly materialAcceptance?: ExtractedMaterialAcceptance;
  readonly materialAcceptanceProfileId?: string;
  readonly materialSlot: number;
}

export interface ExtractedMaterialProbe {
  readonly accepted: boolean;
  readonly acceptedBlockId: string | null;
  readonly acceptedState: Readonly<Record<string, ShapeStateValue>> | null;
  readonly direction: EvidenceDirection;
  readonly itemId: string;
  readonly materialBlockId: string;
}

export interface ExtractedMaterialAcceptance {
  readonly fingerprint?: string;
  readonly probes: readonly ExtractedMaterialProbe[];
  readonly status: ExtractionEvidenceStatus;
}

export interface ExtractedMaterialCandidate {
  readonly itemId: string;
  readonly materialBlockId: string;
}

export interface ExtractedAcceptedMaterial {
  readonly blockId: string;
  readonly state: Readonly<Record<string, ShapeStateValue>>;
}

export type ExtractedMaterialDirectionResults = Readonly<
  Record<EvidenceDirection, ExtractedAcceptedMaterial | null>
>;

export interface ExtractedMaterialResult {
  readonly directions: ExtractedMaterialDirectionResults;
  readonly itemId: string;
}

export interface ExtractedMaterialAcceptanceProfile {
  readonly copycatBlockId?: string;
  readonly fingerprint?: string;
  readonly partKey?: string;
  readonly profileId: string;
  readonly results: readonly ExtractedMaterialResult[];
  readonly status: ExtractionEvidenceStatus;
}

export interface ExtractedNeighborProbe {
  readonly boxes: readonly ExtractedAabb16[];
  readonly changesShape: boolean;
  readonly changesState: boolean;
  readonly neighborBlockId: string;
  readonly neighborState: Readonly<Record<string, ShapeStateValue>>;
  readonly offset: readonly [x: number, y: number, z: number];
  readonly resolvedBlockId: string;
  readonly resolvedState: Readonly<Record<string, ShapeStateValue>>;
}

export interface ExtractedNeighborDependencies {
  readonly fingerprint?: string;
  readonly probes: readonly ExtractedNeighborProbe[];
  readonly status: ExtractionEvidenceStatus;
}

export interface ExtractedPlacementNeighbor {
  readonly blockId: string;
  readonly offset: readonly [x: number, y: number, z: number];
  readonly state: Readonly<Record<string, ShapeStateValue>>;
}

export interface ExtractedPlacementProbe {
  readonly context: string;
  readonly neighbors: readonly ExtractedPlacementNeighbor[];
  readonly survives: boolean;
}

export interface ExtractedPlacementSafety {
  readonly assessment: PlacementSafetyAssessment;
  readonly fingerprint?: string;
  readonly flags: readonly string[];
  readonly probes: readonly ExtractedPlacementProbe[];
}

export interface ExtractedShape {
  readonly blockId: string;
  readonly boxes: readonly ExtractedAabb16[];
  readonly complexity: number;
  readonly family: keyof typeof ShapeFamily;
  readonly familyPriority?: number;
  readonly neighborDependencies?: ExtractedNeighborDependencies;
  readonly neighborDependent?: boolean;
  readonly parts?: readonly ExtractedPart[];
  readonly placementSafety?: ExtractedPlacementSafety;
  readonly routeKeys?: readonly string[];
  readonly stableId?: string;
  readonly state: Readonly<Record<string, ShapeStateValue>>;
}

export interface ExtractedCatalogDocument {
  readonly diagnostics: readonly ExtractedCatalogDiagnostic[];
  readonly materialAcceptanceProfiles: readonly ExtractedMaterialAcceptanceProfile[];
  readonly materialCandidates: readonly ExtractedMaterialCandidate[];
  readonly schema: typeof EXTRACTED_CATALOG_SCHEMA;
  readonly shapes: readonly ExtractedShape[];
  readonly sources: GeneratedCatalogSources;
  readonly version: typeof EXTRACTED_CATALOG_VERSION;
}

export interface ExtractedCatalogDiagnostic {
  readonly blockId: string;
  readonly code: string;
  readonly reason: string;
  readonly state: Readonly<Record<string, ShapeStateValue>>;
}

export interface CompiledExtractedCatalog {
  readonly catalog: PackedShapeCatalog;
  readonly document: ExtractedCatalogDocument;
  readonly extraction: GeneratedCatalogExtractionMetadata;
}

type JsonRecord = Record<string, unknown>;

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function string(value: unknown, label: string, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be ${allowEmpty ? 'a' : 'a non-empty'} NUL-free string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : string(value, label);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`);
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer in ${minimum}..${maximum}`);
  }
  return value as number;
}

function parseBoxes(value: unknown, label: string): ExtractedAabb16[] {
  return array(value, label).map((rawBox, index) => {
    const coordinates = array(rawBox, `${label}[${index}]`);
    if (coordinates.length !== 6) {
      throw new Error(`${label}[${index}] must contain exactly six coordinates`);
    }
    const parsed = coordinates.map((coordinate, coordinateIndex) =>
      integer(coordinate, 0, 16, `${label}[${index}][${coordinateIndex}]`),
    );
    const box: ExtractedAabb16 = [
      parsed[0]!,
      parsed[1]!,
      parsed[2]!,
      parsed[3]!,
      parsed[4]!,
      parsed[5]!,
    ];
    validateExactAabbs([tupleToAabb(box)]);
    return box;
  });
}

function parseStringArray(value: unknown, label: string): string[] {
  const result = array(value, label).map((entry, index) => string(entry, `${label}[${index}]`));
  result.sort(compareStrings);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) throw new Error(`${label} contains duplicates`);
  }
  return result;
}

function parseState(value: unknown, label: string): Readonly<Record<string, ShapeStateValue>> {
  const source = record(value, label);
  const result: Record<string, ShapeStateValue> = {};
  for (const key of Object.keys(source).sort()) {
    string(key, `${label} property name`);
    const stateValue = source[key];
    if (
      typeof stateValue !== 'boolean' &&
      typeof stateValue !== 'string' &&
      (typeof stateValue !== 'number' || !Number.isFinite(stateValue))
    ) {
      throw new Error(`${label}.${key} must be a finite number, boolean or string`);
    }
    result[key] = stateValue;
  }
  return result;
}

function parseFamily(value: unknown, label: string): keyof typeof ShapeFamily {
  const name = string(value, label);
  const enumValue: unknown = ShapeFamily[name as keyof typeof ShapeFamily];
  if (typeof enumValue !== 'number') throw new Error(`${label} has unknown family ${name}`);
  return name as keyof typeof ShapeFamily;
}

function parseEvidenceStatus(value: unknown, label: string): ExtractionEvidenceStatus {
  if (value !== 'SUPPORTED' && value !== 'UNSUPPORTED' && value !== 'UNEXTRACTED') {
    throw new Error(`${label} must be SUPPORTED, UNSUPPORTED or UNEXTRACTED`);
  }
  return value;
}

function parseEvidenceFingerprint(
  source: JsonRecord,
  status: ExtractionEvidenceStatus,
  label: string,
): string | undefined {
  const fingerprint = optionalString(source.fingerprint, `${label}.fingerprint`);
  if (status === 'UNEXTRACTED') {
    if (fingerprint !== undefined) {
      throw new Error(`${label}.fingerprint is not allowed for UNEXTRACTED evidence`);
    }
    return undefined;
  }
  if (fingerprint === undefined) {
    throw new Error(`${label}.fingerprint is required for ${status} evidence`);
  }
  return fingerprint;
}

function parseDirection(value: unknown, label: string): EvidenceDirection {
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

function unextractedMaterialAcceptance(): ExtractedMaterialAcceptance {
  return { probes: [], status: 'UNEXTRACTED' };
}

function parseMaterialAcceptance(
  value: unknown,
  label: string,
): ExtractedMaterialAcceptance {
  if (value === undefined) return unextractedMaterialAcceptance();
  const source = record(value, label);
  const status = parseEvidenceStatus(source.status, `${label}.status`);
  const probes = source.probes === undefined
      ? []
      : array(source.probes, `${label}.probes`).map((rawProbe, index) => {
        const probeLabel = `${label}.probes[${index}]`;
        const probe = record(rawProbe, probeLabel);
        const accepted = boolean(probe.accepted, `${probeLabel}.accepted`);
        const legacyMaterial = probe.material === undefined
          ? undefined
          : string(probe.material, `${probeLabel}.material`);
        const itemId = probe.itemId === undefined
          ? legacyMaterial
          : string(probe.itemId, `${probeLabel}.itemId`);
        const materialBlockId = probe.materialBlockId === undefined
          ? legacyMaterial
          : string(probe.materialBlockId, `${probeLabel}.materialBlockId`);
        if (itemId === undefined || materialBlockId === undefined) {
          throw new Error(`${probeLabel} must identify both itemId and materialBlockId`);
        }
        const acceptedState = probe.acceptedState === null
          ? null
          : parseState(probe.acceptedState, `${probeLabel}.acceptedState`);
        const acceptedBlockId = probe.acceptedBlockId === undefined && legacyMaterial !== undefined
          ? accepted ? materialBlockId : null
          : probe.acceptedBlockId === null
            ? null
            : string(probe.acceptedBlockId, `${probeLabel}.acceptedBlockId`);
        if (
          accepted !== (acceptedBlockId !== null && acceptedState !== null) ||
          (acceptedBlockId === null) !== (acceptedState === null)
        ) {
          throw new Error(
            `${probeLabel} accepted flag contradicts accepted result identity`,
          );
        }
        return {
          accepted,
          acceptedBlockId,
          acceptedState,
          direction: parseDirection(probe.direction, `${probeLabel}.direction`),
          itemId,
          materialBlockId,
        };
      }).sort((left, right) => compareStrings(
        `${left.itemId}\0${left.direction}`,
        `${right.itemId}\0${right.direction}`,
      ));
  if (status !== 'SUPPORTED' && probes.length !== 0) {
    throw new Error(`${label}.probes require SUPPORTED evidence`);
  }
  if (status === 'SUPPORTED' && probes.length === 0) {
    throw new Error(`${label}.probes must include at least one controlled material`);
  }
  for (let index = 1; index < probes.length; index += 1) {
    if (
      probes[index]!.itemId === probes[index - 1]!.itemId &&
      probes[index]!.direction === probes[index - 1]!.direction
    ) {
      throw new Error(`${label}.probes contains duplicate item-direction contexts`);
    }
  }
  const materialByItem = new Map<string, string>();
  for (const probe of probes) {
    const previous = materialByItem.get(probe.itemId);
    if (previous !== undefined && previous !== probe.materialBlockId) {
      throw new Error(`${label}.probes maps one item id to multiple material blocks`);
    }
    materialByItem.set(probe.itemId, probe.materialBlockId);
  }
  const fingerprint = parseEvidenceFingerprint(source, status, label);
  return {
    ...(fingerprint === undefined ? {} : { fingerprint }),
    probes,
    status,
  };
}

function parseMaterialCandidates(value: unknown): ExtractedMaterialCandidate[] {
  if (value === undefined) return [];
  const candidates = array(value, 'materialCandidates').map((rawCandidate, index) => {
    const label = `materialCandidates[${index}]`;
    const candidate = record(rawCandidate, label);
    return {
      itemId: string(candidate.itemId, `${label}.itemId`),
      materialBlockId: string(candidate.materialBlockId, `${label}.materialBlockId`),
    };
  }).sort((left, right) => compareStrings(left.itemId, right.itemId));
  for (let index = 1; index < candidates.length; index += 1) {
    if (candidates[index]!.itemId === candidates[index - 1]!.itemId) {
      throw new Error('materialCandidates contains duplicate item ids');
    }
  }
  return candidates;
}

function parseMaterialAcceptanceProfiles(
  value: unknown,
  candidates: readonly ExtractedMaterialCandidate[],
): ExtractedMaterialAcceptanceProfile[] {
  if (value === undefined) return [];
  const candidateIds = new Set(candidates.map((candidate) => candidate.itemId));
  const profiles = array(value, 'materialAcceptanceProfiles').map((rawProfile, index) => {
    const label = `materialAcceptanceProfiles[${index}]`;
    const source = record(rawProfile, label);
    const status = parseEvidenceStatus(source.status, `${label}.status`);
    const results = source.results === undefined
      ? []
      : array(source.results, `${label}.results`).map((rawResult, resultIndex) => {
          const resultLabel = `${label}.results[${resultIndex}]`;
          const result = record(rawResult, resultLabel);
          const itemId = string(result.itemId, `${resultLabel}.itemId`);
          if (!candidateIds.has(itemId)) {
            throw new Error(`${resultLabel}.itemId is absent from materialCandidates`);
          }
          const rawDirections = record(result.directions, `${resultLabel}.directions`);
          const directions = Object.fromEntries(EVIDENCE_DIRECTIONS.map((direction) => {
            const rawAccepted = rawDirections[direction];
            if (rawAccepted === undefined) {
              throw new Error(`${resultLabel}.directions.${direction} is required`);
            }
            if (rawAccepted === null) return [direction, null];
            const acceptedLabel = `${resultLabel}.directions.${direction}`;
            const accepted = record(rawAccepted, acceptedLabel);
            return [direction, {
              blockId: string(accepted.blockId, `${acceptedLabel}.blockId`),
              state: parseState(accepted.state, `${acceptedLabel}.state`),
            }];
          })) as Record<EvidenceDirection, ExtractedAcceptedMaterial | null>;
          if (EVIDENCE_DIRECTIONS.every((direction) => directions[direction] === null)) {
            throw new Error(`${resultLabel} must contain at least one accepted direction`);
          }
          return { directions, itemId };
        }).sort((left, right) => compareStrings(left.itemId, right.itemId));
    if (status !== 'SUPPORTED' && results.length !== 0) {
      throw new Error(`${label}.results require SUPPORTED evidence`);
    }
    if (status === 'SUPPORTED' && candidates.length === 0) {
      throw new Error(`${label} cannot claim complete coverage of an empty candidate universe`);
    }
    for (let resultIndex = 1; resultIndex < results.length; resultIndex += 1) {
      if (results[resultIndex]!.itemId === results[resultIndex - 1]!.itemId) {
        throw new Error(`${label}.results contains duplicate item ids`);
      }
    }
    const fingerprint = parseEvidenceFingerprint(source, status, label);
    const copycatBlockId = optionalString(source.copycatBlockId, `${label}.copycatBlockId`);
    const partKey = optionalString(source.partKey, `${label}.partKey`);
    if (status === 'UNEXTRACTED') {
      if (copycatBlockId !== undefined || partKey !== undefined || results.length !== 0) {
        throw new Error(`${label} UNEXTRACTED profile cannot claim a source or results`);
      }
    } else if (copycatBlockId === undefined || partKey === undefined) {
      throw new Error(`${label} must identify its source copycat block and part key`);
    }
    return {
      ...(copycatBlockId === undefined ? {} : { copycatBlockId }),
      ...(fingerprint === undefined ? {} : { fingerprint }),
      ...(partKey === undefined ? {} : { partKey }),
      profileId: string(source.profileId, `${label}.profileId`),
      results,
      status,
    };
  }).sort((left, right) => compareStrings(left.profileId, right.profileId));
  for (let index = 1; index < profiles.length; index += 1) {
    if (profiles[index]!.profileId === profiles[index - 1]!.profileId) {
      throw new Error('materialAcceptanceProfiles contains duplicate profile ids');
    }
  }
  return profiles;
}

function unextractedNeighborDependencies(): ExtractedNeighborDependencies {
  return { probes: [], status: 'UNEXTRACTED' };
}

function parseOffset(value: unknown, label: string): readonly [number, number, number] {
  const coordinates = array(value, label);
  if (coordinates.length !== 3) throw new Error(`${label} must contain three coordinates`);
  const result = coordinates.map((coordinate, index) =>
    integer(coordinate, -1, 1, `${label}[${index}]`),
  );
  if (result.every((coordinate) => coordinate === 0)) {
    throw new Error(`${label} cannot address the shape itself`);
  }
  return [result[0]!, result[1]!, result[2]!];
}

function serializedState(state: Readonly<Record<string, ShapeStateValue>>): string {
  const entries = Object.entries(state).sort(([left], [right]) => compareStrings(left, right));
  return entries.length === 0
    ? ''
    : `[${entries.map(([key, value]) => `${key}=${String(value)}`).join(',')}]`;
}

function neighborProbeIdentity(probe: ExtractedNeighborProbe): string {
  return `${probe.offset.join(',')}\0${probe.neighborBlockId}\0${serializedState(probe.neighborState)}`;
}

function parseNeighborDependencies(
  value: unknown,
  label: string,
  fallbackBlockId: string,
  fallbackState: Readonly<Record<string, ShapeStateValue>>,
): ExtractedNeighborDependencies {
  if (value === undefined) return unextractedNeighborDependencies();
  const source = record(value, label);
  const status = parseEvidenceStatus(source.status, `${label}.status`);
  const probes = source.probes === undefined
    ? []
    : array(source.probes, `${label}.probes`).map((rawProbe, index) => {
        const probeLabel = `${label}.probes[${index}]`;
        const probe = record(rawProbe, probeLabel);
        const changesState = probe.changesState === undefined
          ? false
          : boolean(probe.changesState, `${probeLabel}.changesState`);
        const resolvedBlockId = probe.resolvedBlockId === undefined
          ? fallbackBlockId
          : string(probe.resolvedBlockId, `${probeLabel}.resolvedBlockId`);
        const resolvedState = probe.resolvedState === undefined
          ? fallbackState
          : parseState(probe.resolvedState, `${probeLabel}.resolvedState`);
        const identityChanged = resolvedBlockId !== fallbackBlockId ||
          serializedState(resolvedState) !== serializedState(fallbackState);
        if (changesState !== identityChanged) {
          throw new Error(`${probeLabel}.changesState contradicts resolved state identity`);
        }
        return {
          boxes: parseBoxes(probe.boxes, `${probeLabel}.boxes`),
          changesShape: boolean(probe.changesShape, `${probeLabel}.changesShape`),
          changesState,
          neighborBlockId: string(probe.neighborBlockId, `${probeLabel}.neighborBlockId`),
          neighborState: parseState(probe.neighborState, `${probeLabel}.neighborState`),
          offset: parseOffset(probe.offset, `${probeLabel}.offset`),
          resolvedBlockId,
          resolvedState,
        };
      }).sort((left, right) => compareStrings(neighborProbeIdentity(left), neighborProbeIdentity(right)));
  if (status !== 'SUPPORTED' && probes.length !== 0) {
    throw new Error(`${label}.probes require SUPPORTED evidence`);
  }
  if (status === 'SUPPORTED' && probes.length === 0) {
    throw new Error(`${label}.probes must include at least one controlled neighbor`);
  }
  for (let index = 1; index < probes.length; index += 1) {
    if (neighborProbeIdentity(probes[index]!) === neighborProbeIdentity(probes[index - 1]!)) {
      throw new Error(`${label}.probes contains duplicate neighbor contexts`);
    }
  }
  const fingerprint = parseEvidenceFingerprint(source, status, label);
  return {
    ...(fingerprint === undefined ? {} : { fingerprint }),
    probes,
    status,
  };
}

function unextractedPlacementSafety(): ExtractedPlacementSafety {
  return { assessment: 'UNEXTRACTED', flags: [], probes: [] };
}

function parsePlacementSafety(
  value: unknown,
  label: string,
): ExtractedPlacementSafety {
  if (value === undefined) return unextractedPlacementSafety();
  const source = record(value, label);
  const assessment = source.assessment;
  if (
    assessment !== 'SAFE' &&
    assessment !== 'CONDITIONAL' &&
    assessment !== 'UNSAFE' &&
    assessment !== 'UNEXTRACTED'
  ) {
    throw new Error(`${label}.assessment is unsupported`);
  }
  const flags = source.flags === undefined ? [] : parseStringArray(source.flags, `${label}.flags`);
  const contexts = new Set<string>();
  const probes = source.probes === undefined
    ? []
    : array(source.probes, `${label}.probes`).map((rawProbe, index) => {
        const probeLabel = `${label}.probes[${index}]`;
        const probe = record(rawProbe, probeLabel);
        const context = string(probe.context, `${probeLabel}.context`);
        if (contexts.has(context)) throw new Error(`${label}.probes contains duplicate contexts`);
        contexts.add(context);
        const offsets = new Set<string>();
        const neighbors = array(probe.neighbors, `${probeLabel}.neighbors`).map(
          (rawNeighbor, neighborIndex) => {
            const neighborLabel = `${probeLabel}.neighbors[${neighborIndex}]`;
            const neighbor = record(rawNeighbor, neighborLabel);
            const offset = parseOffset(neighbor.offset, `${neighborLabel}.offset`);
            const offsetKey = offset.join(',');
            if (offsets.has(offsetKey)) {
              throw new Error(`${probeLabel}.neighbors contains duplicate offsets`);
            }
            offsets.add(offsetKey);
            return {
              blockId: string(neighbor.blockId, `${neighborLabel}.blockId`),
              offset,
              state: parseState(neighbor.state, `${neighborLabel}.state`),
            };
          },
        ).sort((left, right) => compareStrings(left.offset.join(','), right.offset.join(',')));
        return {
          context,
          neighbors,
          survives: boolean(probe.survives, `${probeLabel}.survives`),
        };
      }).sort((left, right) => compareStrings(left.context, right.context));
  if (assessment === 'CONDITIONAL' && flags.length === 0) {
    throw new Error(`${label}.flags must explain a CONDITIONAL assessment`);
  }
  if (assessment === 'UNEXTRACTED' && (flags.length !== 0 || probes.length !== 0)) {
    throw new Error(`${label}.flags and probes are not allowed for UNEXTRACTED placement safety`);
  }
  const fingerprint = optionalString(source.fingerprint, `${label}.fingerprint`);
  if (assessment === 'UNEXTRACTED' && fingerprint !== undefined) {
    throw new Error(`${label}.fingerprint is not allowed for UNEXTRACTED placement safety`);
  }
  if (assessment !== 'UNEXTRACTED' && fingerprint === undefined) {
    throw new Error(`${label}.fingerprint is required for ${assessment} placement safety`);
  }
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
        Object.keys(probe.neighbors[0]!.state).length === 0
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
  return {
    assessment,
    ...(fingerprint === undefined ? {} : { fingerprint }),
    flags,
    probes,
  };
}

function parsePart(value: unknown, label: string): ExtractedPart {
  const source = record(value, label);
  if (
    source.materialAcceptance !== undefined &&
    source.materialAcceptanceProfileId !== undefined
  ) {
    throw new Error(`${label} cannot contain both inline and referenced material evidence`);
  }
  const materialAcceptanceProfileId = optionalString(
    source.materialAcceptanceProfileId,
    `${label}.materialAcceptanceProfileId`,
  );
  return {
    boxes: parseBoxes(source.boxes, `${label}.boxes`),
    ...(source.compatibility === undefined
      ? {}
      : { compatibility: integer(source.compatibility, 0, 0xffff_ffff, `${label}.compatibility`) }),
    key: string(source.key, `${label}.key`),
    ...(materialAcceptanceProfileId === undefined
      ? {
          materialAcceptance: parseMaterialAcceptance(
            source.materialAcceptance,
            `${label}.materialAcceptance`,
          ),
        }
      : { materialAcceptanceProfileId }),
    materialSlot: integer(source.materialSlot, 0, 0xff, `${label}.materialSlot`),
  };
}

function parseShape(value: unknown, index: number): ExtractedShape {
  const label = `shapes[${index}]`;
  const source = record(value, label);
  const blockId = string(source.blockId, `${label}.blockId`);
  const state = parseState(source.state, `${label}.state`);
  const family = parseFamily(source.family, `${label}.family`);
  const neighborDependencies = parseNeighborDependencies(
    source.neighborDependencies,
    `${label}.neighborDependencies`,
    blockId,
    state,
  );
  const probedNeighborDependent =
    neighborDependencies.status === 'SUPPORTED' &&
    neighborDependencies.probes.some((probe) => probe.changesShape || probe.changesState);
  const declaredNeighborDependent = source.neighborDependent === undefined
    ? undefined
    : boolean(source.neighborDependent, `${label}.neighborDependent`);
  if (
    neighborDependencies.status === 'SUPPORTED' &&
    probedNeighborDependent &&
    declaredNeighborDependent === false
  ) {
    throw new Error(`${label}.neighborDependent contradicts controlled neighbor probes`);
  }
  return {
    blockId,
    boxes: parseBoxes(source.boxes, `${label}.boxes`),
    complexity: integer(source.complexity, 0, 0xffff, `${label}.complexity`),
    family,
    ...(source.familyPriority === undefined
      ? {}
      : { familyPriority: integer(source.familyPriority, 0, 0xff, `${label}.familyPriority`) }),
    neighborDependencies,
    // A finite controlled sample can prove that a dependency was observed, but no change for
    // air/same/stone cannot prove independence from every other registered neighbour. An
    // extractor may therefore conservatively declare true even when these probes saw no change.
    neighborDependent: declaredNeighborDependent ?? probedNeighborDependent,
    ...(source.parts === undefined
      ? {}
      : {
          parts: array(source.parts, `${label}.parts`).map((part, partIndex) =>
            parsePart(part, `${label}.parts[${partIndex}]`),
          ),
        }),
    placementSafety: parsePlacementSafety(source.placementSafety, `${label}.placementSafety`),
    ...(source.routeKeys === undefined
      ? {}
      : { routeKeys: parseStringArray(source.routeKeys, `${label}.routeKeys`) }),
    ...(source.stableId === undefined
      ? {}
      : { stableId: string(source.stableId, `${label}.stableId`) }),
    state,
  };
}

function parseSources(value: unknown): GeneratedCatalogSources {
  const source = record(value, 'sources');
  const minecraft = optionalString(source.minecraft, 'sources.minecraft');
  const loader = optionalString(source.loader, 'sources.loader');
  const create = optionalString(source.create, 'sources.create');
  const copycats = optionalString(source.copycats, 'sources.copycats');
  const extractor = optionalString(source.extractor, 'sources.extractor');
  const environment = optionalString(source.environment, 'sources.environment');
  if (
    environment !== undefined &&
    !/^m2c-environment-v1:sha256:[0-9a-f]{64}$/u.test(environment)
  ) {
    throw new Error(
      'sources.environment must be an m2c-environment-v1 SHA-256 fingerprint',
    );
  }
  return {
    ...(minecraft === undefined ? {} : { minecraft }),
    ...(loader === undefined ? {} : { loader }),
    ...(create === undefined ? {} : { create }),
    ...(copycats === undefined ? {} : { copycats }),
    ...(extractor === undefined ? {} : { extractor }),
    ...(environment === undefined ? {} : { environment }),
  };
}

function parseDiagnostics(value: unknown): ExtractedCatalogDiagnostic[] {
  if (value === undefined) return [];
  const diagnostics = array(value, 'diagnostics').map((rawDiagnostic, index) => {
    const label = `diagnostics[${index}]`;
    const diagnostic = record(rawDiagnostic, label);
    return {
      blockId: string(diagnostic.blockId, `${label}.blockId`),
      code: string(diagnostic.code, `${label}.code`),
      reason: string(diagnostic.reason, `${label}.reason`),
      state: parseState(diagnostic.state, `${label}.state`),
    };
  }).sort((left, right) => compareStrings(
    `${left.blockId}\0${serializedState(left.state)}\0${left.code}\0${left.reason}`,
    `${right.blockId}\0${serializedState(right.state)}\0${right.code}\0${right.reason}`,
  ));
  for (let index = 1; index < diagnostics.length; index += 1) {
    const previous = diagnostics[index - 1]!;
    const current = diagnostics[index]!;
    if (
      current.blockId === previous.blockId &&
      serializedState(current.state) === serializedState(previous.state) &&
      current.code === previous.code &&
      current.reason === previous.reason
    ) {
      throw new Error('diagnostics contains duplicate entries');
    }
  }
  return diagnostics;
}

function tupleToAabb(box: ExtractedAabb16): Aabb16 {
  return {
    maxX: box[3],
    maxY: box[4],
    maxZ: box[5],
    minX: box[0],
    minY: box[1],
    minZ: box[2],
  };
}

function toDefinition(shape: ExtractedShape): ShapeDefinitionInput {
  const familyValue = ShapeFamily[shape.family];
  if (typeof familyValue !== 'number') throw new Error(`Unknown shape family ${shape.family}`);
  const parts: readonly ShapePartDefinition[] | undefined = shape.parts?.map((part) => ({
    boxes: part.boxes.map(tupleToAabb),
    ...(part.compatibility === undefined ? {} : { compatibility: part.compatibility }),
    key: part.key,
    materialSlot: part.materialSlot,
  }));
  return {
    blockId: shape.blockId,
    boxes: shape.boxes.map(tupleToAabb),
    complexity: shape.complexity,
    family: familyValue,
    ...(shape.familyPriority === undefined ? {} : { familyPriority: shape.familyPriority }),
    ...(shape.neighborDependent === undefined
      ? {}
      : { neighborDependent: shape.neighborDependent }),
    ...(parts === undefined ? {} : { parts }),
    ...(shape.routeKeys === undefined ? {} : { routeKeys: shape.routeKeys }),
    ...(shape.stableId === undefined ? {} : { stableId: shape.stableId }),
    state: shape.state,
  };
}

function shapeIdentity(shape: ExtractedShape): string {
  return `${shape.blockId}${serializedState(shape.state)}`;
}

export function createGeneratedExtractionMetadata(
  document: ExtractedCatalogDocument,
): GeneratedCatalogExtractionMetadata {
  const orderedShapes = [...document.shapes].sort((left, right) => compareStrings(
    left.stableId ?? shapeIdentity(left),
    right.stableId ?? shapeIdentity(right),
  ));
  const materialCandidates: GeneratedMaterialCandidateMetadata[] =
    document.materialCandidates.map((candidate) => ({ ...candidate }));
  const sourceProfiles = new Map(
    document.materialAcceptanceProfiles.map((profile) => [profile.profileId, profile] as const),
  );
  const generatedProfiles = new Map<string, GeneratedMaterialAcceptanceProfileMetadata>();
  const registerProfile = (
    content: Omit<GeneratedMaterialAcceptanceProfileMetadata, 'profileId'>,
  ): string => {
    const profileId = generatedMaterialAcceptanceProfileId(content, materialCandidates);
    const profile = { ...content, profileId };
    const previous = generatedProfiles.get(profileId);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(profile)) {
      throw new Error('Generated material acceptance profile id collision');
    }
    generatedProfiles.set(profileId, profile);
    return profileId;
  };
  const completeProfile = (profile: ExtractedMaterialAcceptanceProfile): string => {
    if (profile.status === 'UNEXTRACTED') {
      return registerProfile({
        coverage: 'NONE',
        probes: [],
        results: [],
        status: 'UNEXTRACTED',
      });
    }
    return registerProfile({
      coverage: 'COMPLETE_REGISTRY',
      ...(profile.fingerprint === undefined ? {} : { fingerprint: profile.fingerprint }),
      probes: [],
      results: profile.results.map((result) => ({
        directions: Object.fromEntries(EVIDENCE_DIRECTIONS.map((direction) => {
          const accepted = result.directions[direction];
          return [direction, accepted === null
            ? null
            : { blockId: accepted.blockId, state: serializedState(accepted.state) }];
        })) as GeneratedMaterialAcceptanceProfileMetadata['results'][number]['directions'],
        itemId: result.itemId,
      })),
      status: profile.status,
    });
  };
  const legacyProfile = (acceptance: ExtractedMaterialAcceptance): string => {
    if (acceptance.status === 'UNEXTRACTED') {
      return registerProfile({
        coverage: 'NONE',
        probes: [],
        results: [],
        status: 'UNEXTRACTED',
      });
    }
    return registerProfile({
      coverage: 'LEGACY_PARTIAL',
      ...(acceptance.fingerprint === undefined ? {} : { fingerprint: acceptance.fingerprint }),
      probes: acceptance.probes.map((probe) => ({
        accepted: probe.accepted,
        acceptedBlockId: probe.acceptedBlockId,
        acceptedState: probe.acceptedState === null
          ? null
          : serializedState(probe.acceptedState),
        direction: probe.direction,
        itemId: probe.itemId,
        materialBlockId: probe.materialBlockId,
      })),
      results: [],
      status: acceptance.status,
    });
  };
  const shapes = orderedShapes.map((shape) => {
    const parts = shape.parts ?? (shape.boxes.length === 0
      ? []
      : [{
          boxes: shape.boxes,
          key: 'material',
          materialAcceptance: unextractedMaterialAcceptance(),
          materialSlot: 0,
        }]);
    const neighborDependencies = shape.neighborDependencies
      ?? unextractedNeighborDependencies();
    const placementSafety = shape.placementSafety ?? unextractedPlacementSafety();
    return {
      blockId: shape.blockId,
      neighborDependencies: {
        ...(neighborDependencies.fingerprint === undefined
          ? {}
          : { fingerprint: neighborDependencies.fingerprint }),
        probes: neighborDependencies.probes.map((probe) => ({
          boxes: probe.boxes,
          changesShape: probe.changesShape,
          changesState: probe.changesState,
          neighborBlockId: probe.neighborBlockId,
          neighborState: serializedState(probe.neighborState),
          offset: probe.offset,
          resolvedBlockId: probe.resolvedBlockId,
          resolvedState: serializedState(probe.resolvedState),
        })),
        status: neighborDependencies.status,
      },
      parts: parts.map((part) => {
        let materialAcceptanceProfileId: string;
        if (part.materialAcceptanceProfileId !== undefined) {
          const profile = sourceProfiles.get(part.materialAcceptanceProfileId);
          if (profile === undefined) {
            throw new Error(`Unknown material acceptance profile ${part.materialAcceptanceProfileId}`);
          }
          materialAcceptanceProfileId = completeProfile(profile);
        } else {
          materialAcceptanceProfileId = legacyProfile(
            part.materialAcceptance ?? unextractedMaterialAcceptance(),
          );
        }
        return { key: part.key, materialAcceptanceProfileId };
      }),
      placementSafety: {
        assessment: placementSafety.assessment,
        ...(placementSafety.fingerprint === undefined
          ? {}
          : { fingerprint: placementSafety.fingerprint }),
        flags: placementSafety.flags,
        probes: placementSafety.probes.map((probe) => ({
          context: probe.context,
          neighbors: probe.neighbors.map((neighbor) => ({
            blockId: neighbor.blockId,
            offset: neighbor.offset,
            state: serializedState(neighbor.state),
          })),
          survives: probe.survives,
        })),
      },
      state: serializedState(shape.state),
    };
  });
  return {
    diagnostics: document.diagnostics.map((diagnostic) => ({
      blockId: diagnostic.blockId,
      code: diagnostic.code,
      reason: diagnostic.reason,
      state: serializedState(diagnostic.state),
    })),
    materialAcceptanceProfiles: [...generatedProfiles.values()].sort((left, right) =>
      compareStrings(left.profileId, right.profileId),
    ),
    materialCandidates,
    schema: EXTRACTION_EVIDENCE_SCHEMA,
    shapes,
    version: EXTRACTION_EVIDENCE_VERSION,
  };
}

export function parseExtractedCatalog(value: unknown): ExtractedCatalogDocument {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  const source = record(parsed, 'Extracted catalog');
  if (source.schema !== EXTRACTED_CATALOG_SCHEMA) {
    throw new Error(`Extracted catalog schema must be ${EXTRACTED_CATALOG_SCHEMA}`);
  }
  if (source.version !== EXTRACTED_CATALOG_VERSION) {
    throw new Error(`Unsupported extracted catalog version ${String(source.version)}`);
  }
  const materialCandidates = parseMaterialCandidates(source.materialCandidates);
  const materialAcceptanceProfiles = parseMaterialAcceptanceProfiles(
    source.materialAcceptanceProfiles,
    materialCandidates,
  );
  const shapes = array(source.shapes, 'shapes').map(parseShape);
  const profileById = new Map(
    materialAcceptanceProfiles.map((profile) => [profile.profileId, profile] as const),
  );
  const referencedProfiles = new Set<string>();
  for (const shape of shapes) {
    for (const part of shape.parts ?? []) {
      if (part.materialAcceptanceProfileId === undefined) continue;
      const profile = profileById.get(part.materialAcceptanceProfileId);
      if (profile === undefined) {
        throw new Error(
          `Part ${shape.blockId}/${part.key} references unknown material acceptance profile`,
        );
      }
      referencedProfiles.add(profile.profileId);
      if (
        profile.status !== 'UNEXTRACTED' &&
        (profile.copycatBlockId !== shape.blockId || profile.partKey !== part.key)
      ) {
        throw new Error(
          `Material acceptance profile ${profile.profileId} source does not match ${shape.blockId}/${part.key}`,
        );
      }
    }
  }
  for (const profile of materialAcceptanceProfiles) {
    if (!referencedProfiles.has(profile.profileId)) {
      throw new Error(`Material acceptance profile ${profile.profileId} is not referenced`);
    }
  }
  return {
    diagnostics: parseDiagnostics(source.diagnostics),
    materialAcceptanceProfiles,
    materialCandidates,
    schema: EXTRACTED_CATALOG_SCHEMA,
    shapes,
    sources: parseSources(source.sources),
    version: EXTRACTED_CATALOG_VERSION,
  };
}

export function compileExtractedCatalog(value: unknown): CompiledExtractedCatalog {
  const document = parseExtractedCatalog(value);
  return {
    catalog: buildShapeCatalog(document.shapes.map(toDefinition)),
    document,
    extraction: createGeneratedExtractionMetadata(document),
  };
}
