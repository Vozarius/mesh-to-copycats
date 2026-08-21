#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';

import { encodeCreateSchematic, type StructureCell } from '../../../packages/minecraft-nbt/src/index.js';
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
  EVIDENCE_DIRECTIONS,
  resolveSparseNeighbors,
} from '../../../packages/shapes/src/index.js';

function readBytes(path: string): Uint8Array {
  const bytes = readFileSync(path);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

const directory = resolve(process.argv[2] ?? 'generated/catalog');
const outputFlag = process.argv.indexOf('--out');
if (outputFlag >= 0 && (process.argv[outputFlag + 1] === undefined || outputFlag + 2 < process.argv.length)) {
  throw new Error('Usage: verify-schematic [catalog-directory] [--out output.nbt]');
}
const outputPath = outputFlag >= 0 ? resolve(process.argv[outputFlag + 1]!) : undefined;
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
const neighborResolution = resolveSparseNeighbors({
  catalog: runtime.catalog,
  shapeIds: optimized.shapeIds,
  surface: optimized.surface,
  transitions: decodeNeighborTransitions(readBytes(resolve(directory, 'neighbor-transitions.bin'))),
});
const palette = loadGeneratedMaterialPalette(
  readFileSync(resolve(directory, 'material-palette.json'), 'utf8'),
);
const materials = resolveMaterials({
  catalog: runtime.catalog,
  geometryIds: neighborResolution.geometryIds,
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
let verifiedMultipart: { blockId: string; partCount: number } | undefined;
for (let shapeId = 0; shapeId < runtime.catalog.shapeCount && verifiedMultipart === undefined; shapeId += 1) {
  const blockId = runtime.catalog.blockIds[shapeId] ?? '';
  const partStart = runtime.catalog.shapePartOffsets[shapeId] ?? 0;
  const partEnd = runtime.catalog.shapePartOffsets[shapeId + 1] ?? partStart;
  if (!blockId.startsWith('copycats:') || partEnd - partStart < 2) continue;
  const parts = [];
  for (let localPart = 0; localPart < partEnd - partStart; localPart += 1) {
    const profile = runtime.getPartMaterialProfile(shapeId, localPart);
    let accepted: { blockId: string; state: string } | undefined;
    let itemId = '';
    for (const result of profile.results) {
      for (const direction of EVIDENCE_DIRECTIONS) {
        const directionResult = result.directions[direction];
        if (directionResult === null) continue;
        accepted = directionResult;
        itemId = result.itemId;
        break;
      }
      if (accepted !== undefined) break;
    }
    if (accepted === undefined) {
      parts.length = 0;
      break;
    }
    parts.push({
      blockId: accepted.blockId,
      itemId,
      key: runtime.catalog.partKeys[partStart + localPart] ?? '',
      state: accepted.state,
    });
  }
  if (parts.length !== partEnd - partStart) continue;
  cells.push({
    blockId,
    parts,
    state: runtime.catalog.states[shapeId] ?? '',
    x: 2,
    y: 0,
    z: 0,
  });
  verifiedMultipart = { blockId, partCount: parts.length };
}
if (verifiedMultipart === undefined) {
  throw new Error('No production multipart Copycat with accepted material evidence was found');
}
const schematic = encodeCreateSchematic({ cells });
if (outputPath !== undefined) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, schematic.bytes);
}
const raw = gunzipSync(schematic.bytes);
if (raw[0] !== 10 || raw.length < 32) throw new Error('Encoded schematic is not an NBT root compound');
process.stdout.write(`${JSON.stringify({
  blockCount: schematic.blockCount,
  compressedBytes: schematic.bytes.byteLength,
  paletteSize: schematic.paletteSize,
  neighborChanges: neighborResolution.changedCells,
  outputPath,
  rawBytes: raw.byteLength,
  selectedBlocks: Array.from(new Set(cells.map(({ blockId }) => blockId))),
  size: schematic.size,
  verifiedMultipart,
  valid: true,
}, undefined, 2)}\n`);
