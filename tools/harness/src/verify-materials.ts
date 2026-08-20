#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { finalizeMesh } from '../../../packages/mesh/src/index.js';
import {
  extractSurfaceSamples,
  loadGeneratedMaterialPalette,
  resolveMaterials,
} from '../../../packages/palette/src/index.js';
import { optimizeMesh } from '../../../packages/pipeline/src/index.js';
import { decodeWebRuntimeCatalog } from '../../../packages/shapes/src/index.js';

function readBytes(path: string): Uint8Array {
  const bytes = readFileSync(path);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const directory = resolve(process.argv[2] ?? 'generated/catalog');
const runtime = decodeWebRuntimeCatalog({
  blocks: readBytes(resolve(directory, 'generated-blocks.bin')),
  metadata: readFileSync(resolve(directory, 'metadata.json'), 'utf8'),
  runtimeMetadata: readFileSync(resolve(directory, 'runtime-metadata.json'), 'utf8'),
  shapes: readBytes(resolve(directory, 'generated-shapes.bin')),
});
const mesh = finalizeMesh({
  indices: [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ],
  materialBaseColorsLinear: [0.205, 0.205, 0.205, 1],
  materialNames: ['stone'],
  positions: [
    0.02, 0.02, 0.02,
    0.98, 0.02, 0.02,
    0.98, 0.02, 0.98,
    0.02, 0.02, 0.98,
    0.02, 0.98, 0.02,
    0.98, 0.98, 0.02,
    0.98, 0.98, 0.98,
    0.02, 0.98, 0.98,
  ],
  triangleMaterials: Array.from({ length: 12 }, () => 0),
});
const optimized = optimizeMesh({ catalog: runtime.catalog, mesh });
const samples = extractSurfaceSamples(mesh, optimized.surface);
const palette = loadGeneratedMaterialPalette(
  readFileSync(resolve(directory, 'material-palette.json'), 'utf8'),
);
const materials = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: optimized.geometryIds,
  palette,
  runtime,
  samples,
});
const invalid = materials.invalidCells.reduce((sum, value) => sum + value, 0);
if (optimized.surface.cellCount === 0 || invalid !== 0) {
  throw new Error(`Material verification failed: ${optimized.surface.cellCount} cells, ${invalid} invalid`);
}
process.stdout.write(`${JSON.stringify({
  cells: optimized.surface.cellCount,
  materials: Array.from(new Set(Array.from(materials.paletteIndexes)))
    .map((index) => palette.itemIds[index] ?? 'invalid'),
  selectedBlocks: Array.from(new Set(Array.from(materials.shapeIds)
    .map((shapeId) => runtime.catalog.blockIds[shapeId] ?? ''))),
  valid: true,
}, undefined, 2)}\n`);
