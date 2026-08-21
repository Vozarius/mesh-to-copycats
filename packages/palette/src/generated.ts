import { createMaterialPalette } from './palette.js';
import type { MaterialPaletteEntry, PackedMaterialPalette } from './types.js';
import type { PackedTextureAtlas } from '../../mesh/src/index.js';

export const GENERATED_PALETTE_SCHEMA = 'mesh-to-copycats.material-palette';
export const GENERATED_PALETTE_VERSION = 1;

export interface GeneratedPaletteDocument {
  readonly entries: readonly GeneratedPaletteEntry[];
  readonly missing: readonly string[];
  readonly schema: typeof GENERATED_PALETTE_SCHEMA;
  readonly sources: ReadonlyArray<{ readonly name: string; readonly sha256: string }>;
  readonly version: typeof GENERATED_PALETTE_VERSION;
}

export interface GeneratedPaletteEntry extends MaterialPaletteEntry {
  readonly previewRgbaBase64?: string;
  readonly previewSize?: number;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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
  const entries = root.entries.map((value, index): GeneratedPaletteEntry => {
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
    if (entry.previewRgbaBase64 !== undefined || entry.previewSize !== undefined) {
      if (typeof entry.previewRgbaBase64 !== 'string' ||
        !Number.isInteger(entry.previewSize) || (entry.previewSize as number) < 1 ||
        (entry.previewSize as number) > 256 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(entry.previewRgbaBase64)) {
        throw new Error(`entries[${index}] preview texture is invalid`);
      }
      if (decodeBase64(entry.previewRgbaBase64).length !== (entry.previewSize as number) ** 2 * 4) {
        throw new Error(`entries[${index}] preview texture length is invalid`);
      }
    }
    return {
      blockId: entry.blockId,
      ...(canonicalBlockIds === undefined ? {} : { canonicalBlockIds: canonicalBlockIds as string[] }),
      itemId: entry.itemId,
      ...(entry.preference === undefined ? {} : { preference: entry.preference as number }),
      ...(entry.previewRgbaBase64 === undefined ? {} : {
        previewRgbaBase64: entry.previewRgbaBase64,
        previewSize: entry.previewSize as number,
      }),
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
  const document = parseGeneratedPalette(input);
  const palette = createMaterialPalette(document.entries);
  if (!document.entries.every((entry) => entry.previewRgbaBase64 !== undefined)) return palette;
  const sizes = document.entries.map((entry) => entry.previewSize ?? 0);
  const offsets = new Uint32Array(document.entries.length + 1);
  let length = 0;
  const images = document.entries.map((entry, index) => {
    offsets[index] = length;
    const image = decodeBase64(entry.previewRgbaBase64!);
    length += image.length;
    return image;
  });
  offsets[images.length] = length;
  const rgbaSrgb = new Uint8Array(length);
  for (let index = 0; index < images.length; index += 1) rgbaSrgb.set(images[index]!, offsets[index]);
  const previewTextureAtlas: PackedTextureAtlas = {
    heights: Uint16Array.from(sizes),
    offsets,
    rgbaSrgb,
    widths: Uint16Array.from(sizes),
    wrapS: new Uint32Array(images.length).fill(10497),
    wrapT: new Uint32Array(images.length).fill(10497),
  };
  return { ...palette, previewTextureAtlas };
}
