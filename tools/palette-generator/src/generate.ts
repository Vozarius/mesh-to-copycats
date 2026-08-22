#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { unzipSync } from 'fflate';

import { decodePng } from '../../../packages/mesh/src/index.js';
import { decodeGeneratedCatalog } from '../../../packages/shapes/src/index.js';

type Json = Record<string, unknown>;

function usage(): never {
  throw new Error('Usage: generate.ts --catalog <dir> --jar <resources.jar> [--jar ...] --out <palette.json>');
}

const arguments_ = process.argv.slice(2);
let catalogDirectory = '';
let outputPath = '';
const jarPaths: string[] = [];
for (let index = 0; index < arguments_.length; index += 1) {
  const name = arguments_[index];
  const value = arguments_[index + 1];
  if (value === undefined) usage();
  if (name === '--catalog') catalogDirectory = value;
  else if (name === '--out') outputPath = value;
  else if (name === '--jar') jarPaths.push(value);
  else usage();
  index++;
}
if (catalogDirectory.length === 0 || outputPath.length === 0 || jarPaths.length === 0) usage();

function json(bytes: Uint8Array | undefined, label: string): Json | undefined {
  if (bytes === undefined) return undefined;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('not an object');
    return value as Json;
  } catch (error) {
    throw new Error(`Could not parse ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function identifier(value: string, defaultNamespace: string): [namespace: string, path: string] {
  const colon = value.indexOf(':');
  return colon < 0 ? [defaultNamespace, value] : [value.slice(0, colon), value.slice(colon + 1)];
}

const resources = new Map<string, Uint8Array>();

function loadArchiveAssets(bytes: Uint8Array, label: string, depth = 0): void {
  if (depth > 4) throw new Error(`Nested archive depth exceeded at ${label}`);
  const archive = unzipSync(bytes);
  for (const [name, data] of Object.entries(archive)) {
    if (name.startsWith('assets/')) resources.set(name, data);
    else if (/^META-INF\/jarjar\/[^/]+\.jar$/u.test(name)) {
      loadArchiveAssets(data, `${label}!/${name}`, depth + 1);
    }
  }
}

const sources = jarPaths.map((path) => {
  const absolute = resolve(path);
  const bytes = readFileSync(absolute);
  loadArchiveAssets(bytes, basename(path));
  return { name: basename(path), sha256: createHash('sha256').update(bytes).digest('hex') };
});

function modelResource(modelId: string, defaultNamespace: string): string {
  const [namespace, path] = identifier(modelId, defaultNamespace);
  return `assets/${namespace}/models/${path}.json`;
}

function defaultModel(blockId: string): string {
  const [namespace, path] = identifier(blockId, 'minecraft');
  const state = json(resources.get(`assets/${namespace}/blockstates/${path}.json`), `${blockId} blockstate`);
  if (state !== undefined) {
    const variants = state.variants;
    if (typeof variants === 'object' && variants !== null && !Array.isArray(variants)) {
      const keys = Object.keys(variants).sort();
      const selected = Reflect.get(variants, keys.includes('') ? '' : keys[0] ?? '') as unknown;
      const apply = Array.isArray(selected) ? (selected as unknown[])[0] : selected;
      if (typeof apply === 'object' && apply !== null && !Array.isArray(apply) &&
        typeof (apply as Json).model === 'string') return (apply as Json).model as string;
    }
    if (Array.isArray(state.multipart)) {
      for (const entry of state.multipart as unknown[]) {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
        const applyValue = (entry as Json).apply;
        const apply = Array.isArray(applyValue) ? (applyValue as unknown[])[0] : applyValue;
        if (typeof apply === 'object' && apply !== null && !Array.isArray(apply) &&
          typeof (apply as Json).model === 'string') return (apply as Json).model as string;
      }
    }
  }
  return `${namespace}:block/${path}`;
}

interface ResolvedModel {
  readonly elements?: unknown[];
  readonly namespace: string;
  readonly textures: Json;
}

function resolveModel(modelId: string, ancestry = new Set<string>()): ResolvedModel | undefined {
  const [namespace] = identifier(modelId, 'minecraft');
  const resource = modelResource(modelId, namespace);
  if (ancestry.has(resource)) throw new Error(`Model parent cycle at ${resource}`);
  const model = json(resources.get(resource), resource);
  if (model === undefined) return undefined;
  const parent = typeof model.parent === 'string'
    ? resolveModel(model.parent, new Set(ancestry).add(resource))
    : undefined;
  const ownTextures = typeof model.textures === 'object' && model.textures !== null && !Array.isArray(model.textures)
    ? model.textures as Json
    : {};
  return {
    ...(Array.isArray(model.elements) ? { elements: model.elements } : parent?.elements === undefined ? {} : { elements: parent.elements }),
    namespace,
    textures: { ...(parent?.textures ?? {}), ...ownTextures },
  };
}

function resolveTexture(reference: string, textures: Json, namespace: string): string | undefined {
  let current = reference;
  const seen = new Set<string>();
  while (current.startsWith('#')) {
    const key = current.slice(1);
    if (seen.has(key)) return undefined;
    seen.add(key);
    const next = textures[key];
    if (typeof next !== 'string') return undefined;
    current = next;
  }
  const [textureNamespace, path] = identifier(current, namespace);
  return `assets/${textureNamespace}/textures/${path}.png`;
}

function textureReferences(model: ResolvedModel): string[] {
  const references = new Set<string>();
  for (const element of model.elements ?? []) {
    if (typeof element !== 'object' || element === null || Array.isArray(element)) continue;
    const faces = (element as Json).faces;
    if (typeof faces !== 'object' || faces === null || Array.isArray(faces)) continue;
    for (const face of Object.values(faces as Json)) {
      if (typeof face === 'object' && face !== null && !Array.isArray(face) && typeof (face as Json).texture === 'string') {
        references.add((face as Json).texture as string);
      }
    }
  }
  if (references.size === 0) {
    for (const key of ['all', 'side', 'top', 'end', 'texture', 'particle']) {
      const value = model.textures[key];
      if (typeof value === 'string') references.add(value);
    }
  }
  return [...new Set([...references]
    .map((reference) => resolveTexture(reference, model.textures, model.namespace))
    .filter((value): value is string => value !== undefined))]
    .sort();
}

const textureSignatureCache = new Map<string, string>();
function textureSignature(blockId: string): string {
  const cached = textureSignatureCache.get(blockId);
  if (cached !== undefined) return cached;
  const model = resolveModel(defaultModel(blockId));
  const signature = model === undefined ? '' : textureReferences(model).join('|');
  textureSignatureCache.set(blockId, signature);
  return signature;
}

const decodedTextureCache = new Map<string, ReturnType<typeof decodePng> | undefined>();
function decodedTexture(path: string): ReturnType<typeof decodePng> | undefined {
  if (decodedTextureCache.has(path)) return decodedTextureCache.get(path);
  const bytes = resources.get(path);
  if (bytes === undefined) {
    decodedTextureCache.set(path, undefined);
    return undefined;
  }
  try {
    const image = decodePng(bytes);
    decodedTextureCache.set(path, image);
    return image;
  } catch {
    decodedTextureCache.set(path, undefined);
    return undefined;
  }
}

function averageTexture(path: string): readonly [number, number, number, number] | undefined {
  const image = decodedTexture(path);
  if (image === undefined) return undefined;
  try {
    let red = 0;
    let green = 0;
    let blue = 0;
    let weight = 0;
    let alphaSum = 0;
    for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
      const alpha = (image.rgba[pixel * 4 + 3] ?? 0) / 255;
      alphaSum += alpha;
      if (alpha === 0) continue;
      red += (image.rgba[pixel * 4] ?? 0) / 255 * alpha;
      green += (image.rgba[pixel * 4 + 1] ?? 0) / 255 * alpha;
      blue += (image.rgba[pixel * 4 + 2] ?? 0) / 255 * alpha;
      weight += alpha;
    }
    return weight === 0 ? undefined : [
      red / weight, green / weight, blue / weight, alphaSum / (image.width * image.height),
    ];
  } catch {
    return undefined;
  }
}

function previewTexture(paths: readonly string[]): string | undefined {
  const image = paths.map(decodedTexture).find((value) => value !== undefined);
  if (image === undefined) return undefined;
  const size = 16;
  const frameHeight = image.height > image.width && image.height % image.width === 0
    ? image.width
    : image.height;
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.min(frameHeight - 1, Math.floor((y + 0.5) * frameHeight / size));
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / size));
      const source = (sourceY * image.width + sourceX) * 4;
      const target = (y * size + x) * 4;
      rgba.set(image.rgba.subarray(source, source + 4), target);
    }
  }
  return Buffer.from(rgba).toString('base64');
}

const runtime = JSON.parse(readFileSync(resolve(catalogDirectory, 'runtime-metadata.json'), 'utf8')) as Json;
const catalog = decodeGeneratedCatalog({
  blocks: new Uint8Array(readFileSync(resolve(catalogDirectory, 'generated-blocks.bin'))),
  metadata: readFileSync(resolve(catalogDirectory, 'metadata.json'), 'utf8'),
  shapes: new Uint8Array(readFileSync(resolve(catalogDirectory, 'generated-shapes.bin'))),
});
const ordinaryCatalogBlocks = [...new Set(catalog.blockIds)]
  .filter((blockId) => !blockId.startsWith('copycats:') && !blockId.includes(':copycat_'))
  .sort();
if (!Array.isArray(runtime.materialCandidates) || !Array.isArray(runtime.materialAcceptanceProfiles)) {
  throw new Error('Runtime catalog contains no material candidates/profiles');
}
const candidates = new Map<string, string>();
for (const value of runtime.materialCandidates) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
  const itemId = (value as Json).itemId;
  const blockId = (value as Json).materialBlockId;
  if (typeof itemId === 'string' && typeof blockId === 'string') candidates.set(itemId, blockId);
}
const acceptedItems = new Set<string>();
for (const profile of runtime.materialAcceptanceProfiles) {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) continue;
  const results = (profile as Json).results;
  if (!Array.isArray(results)) continue;
  for (const result of results) {
    if (typeof result === 'object' && result !== null && !Array.isArray(result) && typeof (result as Json).itemId === 'string') {
      acceptedItems.add((result as Json).itemId as string);
    }
  }
}
const entries: Json[] = [];
const missing: string[] = [];
const CANONICAL_SUFFIXES = [
  'button', 'door', 'fence', 'fence_gate', 'pressure_plate',
  'slab', 'stairs', 'trapdoor', 'wall',
] as const;

function canonicalNames(materialBlockId: string): Set<string> {
  const [namespace, path] = identifier(materialBlockId, 'minecraft');
  const roots = new Set([path]);
  if (path.endsWith('_planks')) roots.add(path.slice(0, -'_planks'.length));
  if (path === 'bricks') roots.add('brick');
  else if (path.endsWith('_bricks')) roots.add(path.slice(0, -1));
  if (path.endsWith('_block')) roots.add(path.slice(0, -'_block'.length));
  return new Set([
    materialBlockId,
    ...[...roots].flatMap((root) => CANONICAL_SUFFIXES.map((suffix) => `${namespace}:${root}_${suffix}`)),
  ]);
}

function materialPreference(itemId: string): number {
  const path = itemId.slice(itemId.indexOf(':') + 1);
  if (path.startsWith('infested_')) return 1000;
  if (/^(?:barrier|bedrock|command_block|end_portal_frame|jigsaw|light|moving_piston|reinforced_deepslate|repeating_command_block|spawner|structure_block|structure_void|trial_spawner|vault)$/u.test(path)) {
    return 2000;
  }
  if (path.startsWith('waxed_')) return 20;
  return 0;
}
for (const itemId of [...acceptedItems].sort()) {
  const blockId = candidates.get(itemId);
  if (blockId === undefined) continue;
  const model = resolveModel(defaultModel(blockId));
  const texturePaths = model === undefined ? [] : textureReferences(model);
  const colors = texturePaths
    .map(averageTexture)
    .filter((value): value is readonly [number, number, number, number] => value !== undefined);
  if (colors.length === 0) {
    missing.push(itemId);
    continue;
  }
  const previewRgbaBase64 = previewTexture(texturePaths);
  if (previewRgbaBase64 === undefined) {
    missing.push(itemId);
    continue;
  }
  entries.push({
    alpha: colors.reduce((sum, color) => sum + color[3], 0) / colors.length,
    blockId,
    canonicalBlockIds: ordinaryCatalogBlocks.filter((candidate) =>
      canonicalNames(blockId).has(candidate) &&
      texturePaths.length > 0 && textureSignature(candidate) === texturePaths.join('|')),
    itemId,
    preference: materialPreference(itemId),
    previewRgbaBase64,
    previewSize: 16,
    srgb: [0, 1, 2].map((channel) =>
      colors.reduce((sum, color) => sum + color[channel]!, 0) / colors.length),
  });
}
const document = {
  entries,
  missing,
  schema: 'mesh-to-copycats.material-palette',
  sources,
  version: 1,
};
writeFileSync(resolve(outputPath), `${JSON.stringify(document)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ entries: entries.length, missing: missing.length, output: resolve(outputPath), sources }, undefined, 2)}\n`);
