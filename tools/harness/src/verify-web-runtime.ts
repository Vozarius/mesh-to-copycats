import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadGeneratedMaterialPalette } from '../../../packages/palette/src/index.js';
import {
  decodeNeighborTransitions,
  decodeWebRuntimeCatalog,
} from '../../../packages/shapes/src/index.js';

const catalogDirectory = resolve(process.argv[2] ?? 'generated/catalog');
const [
  blocks,
  metadata,
  runtimeMetadata,
  shapes,
  paletteText,
  neighborsBytes,
] = await Promise.all([
  readFile(resolve(catalogDirectory, 'generated-blocks.bin')),
  readFile(resolve(catalogDirectory, 'metadata.json'), 'utf8'),
  readFile(resolve(catalogDirectory, 'runtime-metadata.json'), 'utf8'),
  readFile(resolve(catalogDirectory, 'generated-shapes.bin')),
  readFile(resolve(catalogDirectory, 'material-palette.json'), 'utf8'),
  readFile(resolve(catalogDirectory, 'neighbor-transitions.bin')),
]);

const runtime = decodeWebRuntimeCatalog({
  blocks,
  metadata,
  runtimeMetadata,
  shapes,
});
const palette = loadGeneratedMaterialPalette(paletteText);
const neighbors = decodeNeighborTransitions(neighborsBytes);

if (palette.itemIds.length === 0) {
  throw new Error('The web material palette is empty');
}
if (neighbors.shapeOffsets.length !== runtime.catalog.shapeCount + 1) {
  throw new Error('Neighbor transitions do not match the web runtime catalog');
}

process.stdout.write(`${JSON.stringify({
  geometries: runtime.catalog.geometryCount,
  materials: palette.itemIds.length,
  neighborShapes: neighbors.shapeOffsets.length - 1,
  shapes: runtime.catalog.shapeCount,
})}\n`);
