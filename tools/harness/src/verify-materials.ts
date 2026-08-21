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
import {
  decodeNeighborTransitions,
  decodeWebRuntimeCatalog,
  resolveSparseNeighbors,
} from '../../../packages/shapes/src/index.js';

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
const neighborResolution = resolveSparseNeighbors({
  catalog: runtime.catalog,
  shapeIds: optimized.shapeIds,
  surface: optimized.surface,
  transitions: decodeNeighborTransitions(readBytes(resolve(directory, 'neighbor-transitions.bin'))),
});
const samples = extractSurfaceSamples(mesh, optimized.surface);
const palette = loadGeneratedMaterialPalette(
  readFileSync(resolve(directory, 'material-palette.json'), 'utf8'),
);
const materials = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: neighborResolution.geometryIds,
  palette,
  runtime,
  samples,
});
const invalid = materials.invalidCells.reduce((sum, value) => sum + value, 0);
if (optimized.surface.cellCount === 0 || invalid !== 0) {
  throw new Error(`Material verification failed: ${optimized.surface.cellCount} cells, ${invalid} invalid`);
}
const forcedItemId = 'minecraft:red_concrete';
const forcedPaletteIndex = palette.itemIds.indexOf(forcedItemId);
if (forcedPaletteIndex < 0) throw new Error(`Production palette is missing ${forcedItemId}`);
const forced = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: neighborResolution.geometryIds,
  palette,
  runtime,
  samples,
  sourceMaterialPaletteIndexes: Uint32Array.of(forcedPaletteIndex),
});
if (
  forced.invalidCells.some((value) => value !== 0) ||
  forced.paletteIndexes.some((index) => index !== forcedPaletteIndex)
) {
  throw new Error(`Production source material lock did not resolve to ${forcedItemId}`);
}
const planarTextureMesh = finalizeMesh({
  indices: [0, 1, 2, 0, 2, 3],
  materialNames: ['uv-texture'],
  positions: [0.1, 0.1, 0.25, 0.9, 0.1, 0.25, 0.9, 0.9, 0.25, 0.1, 0.9, 0.25],
  texcoords: [0, 0, 1, 0, 1, 1, 0, 1],
  triangleMaterials: [0, 0],
});
const planarOptimized = optimizeMesh({
  catalog: runtime.catalog,
  mesh: planarTextureMesh,
  optimizerSettings: { missingWeight: 1024 },
  preferPlanarByteGeometry: true,
});
const planarSamples = extractSurfaceSamples(planarTextureMesh, planarOptimized.surface, {
  sampleLinearColor: ({ u, v }) => [u < 0.5 ? 1 : 0, v < 0.5 ? 1 : 0, u >= 0.5 && v >= 0.5 ? 1 : 0],
  strataPerAxis: 2,
});
const planarMaterials = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: planarOptimized.geometryIds,
  palette,
  preferredByteCells: planarOptimized.planarBytePreferred,
  runtime,
  samples: planarSamples,
});
const planarBlocks = Array.from(planarMaterials.shapeIds, (shapeId) =>
  runtime.catalog.blockIds[shapeId] ?? '');
const planarPartCount = planarMaterials.cellPartOffsets[1] ?? 0;
if (
  planarOptimized.surface.cellCount !== 1 ||
  planarOptimized.missingCounts[0] !== 0 ||
  planarMaterials.invalidCells[0] !== 0 ||
  planarBlocks[0] !== 'copycats:copycat_byte' ||
  planarPartCount !== 4
) {
  throw new Error(
    `Planar Byte verification failed: ${planarBlocks[0] ?? 'none'}, ${planarPartCount} parts`,
  );
}
process.stdout.write(`${JSON.stringify({
  cells: optimized.surface.cellCount,
  neighborChanges: neighborResolution.changedCells,
  forcedMaterial: forcedItemId,
  materials: Array.from(new Set(Array.from(materials.paletteIndexes)))
    .map((index) => palette.itemIds[index] ?? 'invalid'),
  selectedBlocks: Array.from(new Set(Array.from(materials.shapeIds)
    .map((shapeId) => runtime.catalog.blockIds[shapeId] ?? ''))),
  planarTexture: {
    block: planarBlocks[0],
    materials: Array.from(planarMaterials.paletteIndexes, (index) => palette.itemIds[index] ?? 'invalid'),
    parts: planarPartCount,
  },
  valid: true,
}, undefined, 2)}\n`);
