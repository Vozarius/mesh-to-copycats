#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  compileNeighborTransitions,
  decodeGeneratedCatalog,
  encodeNeighborTransitions,
  type GeneratedExtractionAuditMetadata,
} from '@mesh-to-copycats/shapes';

const directory = resolve(process.argv[2] ?? 'generated/catalog');
const [blocks, metadata, shapes, auditText] = await Promise.all([
  readFile(resolve(directory, 'generated-blocks.bin')),
  readFile(resolve(directory, 'metadata.json'), 'utf8'),
  readFile(resolve(directory, 'generated-shapes.bin')),
  readFile(resolve(directory, 'extraction-audit.json'), 'utf8'),
]);
const catalog = decodeGeneratedCatalog({
  blocks: new Uint8Array(blocks),
  metadata,
  shapes: new Uint8Array(shapes),
});
const audit = JSON.parse(auditText) as GeneratedExtractionAuditMetadata;
const transitions = compileNeighborTransitions(catalog, audit.extraction);
const encoded = encodeNeighborTransitions(transitions);
await writeFile(resolve(directory, 'neighbor-transitions.bin'), encoded);
process.stdout.write(`${JSON.stringify({
  bytes: encoded.byteLength,
  entries: transitions.directions.length,
  output: resolve(directory, 'neighbor-transitions.bin'),
  shapes: catalog.shapeCount,
}, undefined, 2)}\n`);
