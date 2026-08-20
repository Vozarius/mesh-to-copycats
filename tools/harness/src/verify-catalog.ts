#!/usr/bin/env node

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { GeometryOptimizer } from '@mesh-to-copycats/optimizer';
import { decodeWebRuntimeCatalog } from '@mesh-to-copycats/shapes';
import { QualityMode } from '@mesh-to-copycats/shared';
import { AdaptiveOccupancy } from '@mesh-to-copycats/voxelizer';

function readBytes(path: string): Uint8Array {
  const bytes = readFileSync(path);
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function masksEqual(left: Uint32Array, right: Uint32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const directory = resolve(process.argv[2] ?? 'generated/catalog');
const paths = {
  blocks: resolve(directory, 'generated-blocks.bin'),
  metadata: resolve(directory, 'metadata.json'),
  runtime: resolve(directory, 'runtime-metadata.json'),
  shapes: resolve(directory, 'generated-shapes.bin'),
};
const started = performance.now();
const webCatalog = decodeWebRuntimeCatalog({
  blocks: readBytes(paths.blocks),
  metadata: readFileSync(paths.metadata, 'utf8'),
  runtimeMetadata: readFileSync(paths.runtime, 'utf8'),
  shapes: readBytes(paths.shapes),
});
const catalog = webCatalog.catalog;
const optimizer = new GeometryOptimizer({
  catalog,
  settings: { qualityMode: QualityMode.QUALITY },
});
const inputs = Array.from({ length: catalog.geometryCount }, (_, geometryId) => ({
  occupancy: AdaptiveOccupancy.fromMask16(catalog.getGeometryMask(geometryId, 16).slice()),
}));
const batch = optimizer.optimizeBatch(inputs);
let nonExactSelections = 0;
let nonZeroErrors = 0;
for (let targetGeometryId = 0; targetGeometryId < catalog.geometryCount; targetGeometryId += 1) {
  if (batch.geometryErrors[targetGeometryId] !== 0) nonZeroErrors++;
  const selectedGeometryId = batch.geometryIds[targetGeometryId]!;
  if (!masksEqual(
    catalog.getGeometryMask(targetGeometryId, 16),
    catalog.getGeometryMask(selectedGeometryId, 16),
  )) {
    nonExactSelections++;
  }
}
if (nonZeroErrors !== 0 || nonExactSelections !== 0) {
  throw new Error(
    `Catalog verification failed: ${nonZeroErrors} non-zero errors, ` +
      `${nonExactSelections} non-exact selections`,
  );
}
process.stdout.write(`${JSON.stringify({
  catalog: directory,
  counts: {
    geometries: catalog.geometryCount,
    materialProfiles: webCatalog.runtime.materialAcceptanceProfiles.length,
    parts: catalog.partIds.length,
    placementProfiles: webCatalog.runtime.placementProfiles.length,
    shapes: catalog.shapeCount,
  },
  elapsedMs: Math.round((performance.now() - started) * 100) / 100,
  files: Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, statSync(path).size])),
  optimizer: {
    exactSelections: catalog.geometryCount,
    stageTotals: batch.stageTotals,
  },
  verified: true,
}, undefined, 2)}\n`);
