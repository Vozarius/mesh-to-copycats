#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

import { encodeCreateSchematic, type StructureCell } from '../../../packages/minecraft-nbt/src/index.js';
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
    0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
  ],
  materialBaseColorsLinear: [0.205, 0.205, 0.205, 1],
  materialNames: ['stone'],
  positions: [
    0.02, 0.02, 0.02, 0.98, 0.02, 0.02, 0.98, 0.02, 0.98, 0.02, 0.02, 0.98,
    0.02, 0.98, 0.02, 0.98, 0.98, 0.02, 0.98, 0.98, 0.98, 0.02, 0.98, 0.98,
  ],
  triangleMaterials: Array.from({ length: 12 }, () => 0),
});
const optimized = optimizeMesh({ catalog: runtime.catalog, mesh });
const palette = loadGeneratedMaterialPalette(
  readFileSync(resolve(directory, 'material-palette.json'), 'utf8'),
);
const materials = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: optimized.geometryIds,
  palette,
  runtime,
  samples: extractSurfaceSamples(mesh, optimized.surface),
});
if (materials.invalidCells.some((value) => value !== 0)) {
  throw new Error('Schematic verification has unresolved material cells');
}
const cells: StructureCell[] = Array.from(materials.shapeIds, (shapeId, cell) => {
  const blockId = runtime.catalog.blockIds[shapeId] ?? 'minecraft:air';
  const copycat = blockId.startsWith('copycats:') || blockId.includes(':copycat_');
  const assignmentStart = materials.cellPartOffsets[cell] ?? 0;
  const assignmentEnd = materials.cellPartOffsets[cell + 1] ?? assignmentStart;
  const catalogPartStart = runtime.catalog.shapePartOffsets[shapeId] ?? 0;
  return {
    blockId,
    ...(copycat ? {
      parts: Array.from({ length: assignmentEnd - assignmentStart }, (_value, localPart) => {
        const assignment = assignmentStart + localPart;
        const paletteIndex = materials.paletteIndexes[assignment] ?? 0xffff_ffff;
        return {
          blockId: materials.acceptedMaterialBlockIds[assignment] ?? '',
          itemId: palette.itemIds[paletteIndex] ?? '',
          key: runtime.catalog.partKeys[catalogPartStart + localPart] ?? 'material',
          state: materials.acceptedMaterialStates[assignment] ?? '',
        };
      }),
    } : {}),
    state: runtime.catalog.states[shapeId] ?? '',
    x: optimized.surface.cellX[cell] ?? 0,
    y: optimized.surface.cellY[cell] ?? 0,
    z: optimized.surface.cellZ[cell] ?? 0,
  };
});
const schematic = encodeCreateSchematic({ cells });
const raw = gunzipSync(schematic.bytes);
if (raw[0] !== 10 || raw.length < 32) throw new Error('Encoded schematic is not an NBT root compound');
process.stdout.write(`${JSON.stringify({
  blockCount: schematic.blockCount,
  compressedBytes: schematic.bytes.byteLength,
  paletteSize: schematic.paletteSize,
  rawBytes: raw.byteLength,
  selectedBlocks: Array.from(new Set(cells.map(({ blockId }) => blockId))),
  size: schematic.size,
  valid: true,
}, undefined, 2)}\n`);
