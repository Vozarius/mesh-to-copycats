import { createMaterialPalette } from './palette.js';
import type { MaterialPaletteEntry, PackedMaterialPalette } from './types.js';

export const GENERATED_PALETTE_SCHEMA = 'mesh-to-copycats.material-palette';
export const GENERATED_PALETTE_VERSION = 1;

export interface GeneratedPaletteDocument {
  readonly entries: readonly MaterialPaletteEntry[];
  readonly missing: readonly string[];
  readonly schema: typeof GENERATED_PALETTE_SCHEMA;
  readonly sources: ReadonlyArray<{ readonly name: string; readonly sha256: string }>;
  readonly version: typeof GENERATED_PALETTE_VERSION;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function parseGeneratedPalette(input: unknown): GeneratedPaletteDocument {
  const root = record(typeof input === 'string' ? JSON.parse(input) as unknown : input, 'palette');
  if (root.schema !== GENERATED_PALETTE_SCHEMA || root.version !== GENERATED_PALETTE_VERSION) {
    throw new Error('Generated material palette schema/version is unsupported');
  }
  if (!Array.isArray(root.entries) || !Array.isArray(root.sources) || !Array.isArray(root.missing)) {
    throw new Error('Generated material palette arrays are missing');
  }
  const entries = root.entries.map((value, index): MaterialPaletteEntry => {
    const entry = record(value, `entries[${index}]`);
    if (typeof entry.itemId !== 'string' || typeof entry.blockId !== 'string') {
      throw new Error(`entries[${index}] identifiers are invalid`);
    }
    if (!Array.isArray(entry.srgb) || entry.srgb.length !== 3 || entry.srgb.some((component) =>
      typeof component !== 'number' || !Number.isFinite(component) || component < 0 || component > 1)) {
      throw new Error(`entries[${index}].srgb is invalid`);
    }
    const canonicalBlockIds = entry.canonicalBlockIds;
    if (canonicalBlockIds !== undefined && (
      !Array.isArray(canonicalBlockIds) || canonicalBlockIds.some((id) => typeof id !== 'string')
    )) throw new Error(`entries[${index}].canonicalBlockIds is invalid`);
    if (entry.preference !== undefined && (
      !Number.isInteger(entry.preference) || (entry.preference as number) < 0 || (entry.preference as number) > 0xffff
    )) throw new Error(`entries[${index}].preference is invalid`);
    return {
      blockId: entry.blockId,
      ...(canonicalBlockIds === undefined ? {} : { canonicalBlockIds: canonicalBlockIds as string[] }),
      itemId: entry.itemId,
      ...(entry.preference === undefined ? {} : { preference: entry.preference as number }),
      srgb: entry.srgb as unknown as readonly [number, number, number],
    };
  });
  const sources = root.sources.map((value, index) => {
    const source = record(value, `sources[${index}]`);
    if (typeof source.name !== 'string' || typeof source.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(source.sha256)) throw new Error(`sources[${index}] is invalid`);
    return { name: source.name, sha256: source.sha256 };
  });
  const missing = root.missing.map((value, index) => {
    if (typeof value !== 'string') throw new Error(`missing[${index}] is invalid`);
    return value;
  });
  return {
    entries: Object.freeze(entries),
    missing: Object.freeze(missing),
    schema: GENERATED_PALETTE_SCHEMA,
    sources: Object.freeze(sources),
    version: GENERATED_PALETTE_VERSION,
  };
}

export function loadGeneratedMaterialPalette(input: unknown): PackedMaterialPalette {
  return createMaterialPalette(parseGeneratedPalette(input).entries);
}
