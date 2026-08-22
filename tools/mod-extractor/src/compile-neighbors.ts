#!/usr/bin/env node

import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { finished } from 'node:stream/promises';

import parserStream from 'stream-json';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';

import {
  compileNeighborTransitions,
  decodeGeneratedCatalog,
  encodeNeighborTransitions,
  exactGeometryKeyFromAabbs,
  PackedNeighborTransitions,
  type GeneratedExtractionAuditMetadata,
  type PackedShapeCatalog,
} from '@mesh-to-copycats/shapes';

type Json = Record<string, unknown>;

interface TransitionEntry {
  readonly direction: number;
  readonly geometryId: number;
  readonly neighborShapeId: number;
  readonly resolvedShapeId: number;
}

function record(value: unknown, label: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Json;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function serializedState(value: unknown, label: string): string {
  const state = record(value, label);
  const entries = Object.entries(state).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0);
  for (const [key, stateValue] of entries) {
    if (
      key.length === 0 ||
      (
        typeof stateValue !== 'boolean' &&
        typeof stateValue !== 'number' &&
        typeof stateValue !== 'string'
      )
    ) {
      throw new Error(`${label} contains an invalid property`);
    }
  }
  return entries.length === 0
    ? ''
    : `[${entries.map(([key, stateValue]) => `${key}=${String(stateValue)}`).join(',')}]`;
}

function direction(value: unknown, label: string): number {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain three coordinates`);
  }
  const key = value.join(',');
  const index = ['0,-1,0', '1,0,0', '0,0,-1', '0,0,1', '0,1,0', '-1,0,0']
    .indexOf(key);
  if (index < 0) throw new Error(`${label} is not cardinal`);
  return index;
}

function geometryId(
  boxesValue: unknown,
  geometryByKey: ReadonlyMap<string, number>,
  label: string,
): number {
  if (!Array.isArray(boxesValue)) throw new Error(`${label} must be an array`);
  const boxes = boxesValue.map((boxValue, index) => {
    if (
      !Array.isArray(boxValue) ||
      boxValue.length !== 6 ||
      boxValue.some((coordinate) =>
        typeof coordinate !== 'number' ||
        !Number.isInteger(coordinate) ||
        coordinate < 0 ||
        coordinate > 16)
    ) {
      throw new Error(`${label}[${index}] must be an exact GRID16 AABB`);
    }
    return {
      maxX: boxValue[3] as number,
      maxY: boxValue[4] as number,
      maxZ: boxValue[5] as number,
      minX: boxValue[0] as number,
      minY: boxValue[1] as number,
      minZ: boxValue[2] as number,
    };
  });
  const id = geometryByKey.get(exactGeometryKeyFromAabbs(boxes));
  if (id === undefined) throw new Error(`${label} references unknown geometry`);
  return id;
}

async function compileStreaming(
  catalog: PackedShapeCatalog,
  inputPath: string,
): Promise<PackedNeighborTransitions> {
  const geometryByKey = new Map(catalog.geometryKeys.map((key, index) => [key, index]));
  const entriesByShape = Array.from(
    { length: catalog.shapeCount },
    () => [] as TransitionEntry[],
  );
  const seen = new Uint8Array(catalog.shapeCount);
  const shapes = createReadStream(inputPath)
    .pipe(parserStream({
      streamKeys: false,
      streamNumbers: false,
      streamStrings: false,
    }))
    .pipe(pick.asStream({
      filter: 'shapes',
      packKeys: true,
      streamKeys: false,
      streamValues: false,
    }))
    .pipe(streamArray.asStream());

  shapes.on('data', (item: unknown) => {
    const sourceItem = record(item, 'streamed shape item');
    const shape = record(sourceItem.value, 'shape');
    const blockId = string(shape.blockId, 'shape.blockId');
    const state = serializedState(shape.state, 'shape.state');
    const shapeId = catalog.findShapeId(blockId, state);
    if (shapeId === undefined) {
      throw new Error(`Neighbor evidence references unknown shape ${blockId}${state}`);
    }
    if (seen[shapeId] !== 0) throw new Error(`Duplicate neighbor evidence for shape ${shapeId}`);
    seen[shapeId] = 1;
    const evidenceValue = shape.neighborDependencies;
    if (evidenceValue === undefined) return;
    const evidence = record(evidenceValue, 'shape.neighborDependencies');
    if (evidence.status !== 'SUPPORTED') return;
    if (!Array.isArray(evidence.probes)) {
      throw new Error('shape.neighborDependencies.probes must be an array');
    }
    const entries = entriesByShape[shapeId]!;
    for (let index = 0; index < evidence.probes.length; index += 1) {
      const probe = record(evidence.probes[index], `neighbor probe ${index}`);
      if (probe.changesShape !== true && probe.changesState !== true) continue;
      const neighborBlockId = string(probe.neighborBlockId, 'probe.neighborBlockId');
      const neighborState = serializedState(probe.neighborState, 'probe.neighborState');
      const neighborShapeId = catalog.findShapeId(neighborBlockId, neighborState);
      const resolvedBlockId = string(probe.resolvedBlockId, 'probe.resolvedBlockId');
      const resolvedState = serializedState(probe.resolvedState, 'probe.resolvedState');
      const resolvedShapeId = catalog.findShapeId(resolvedBlockId, resolvedState);
      if (neighborShapeId === undefined || resolvedShapeId === undefined) {
        throw new Error(`Neighbor probe for shape ${shapeId} references an unknown state`);
      }
      entries.push({
        direction: direction(probe.offset, 'probe.offset'),
        geometryId: geometryId(probe.boxes, geometryByKey, 'probe.boxes'),
        neighborShapeId,
        resolvedShapeId,
      });
    }
    entries.sort((left, right) =>
      left.direction - right.direction || left.neighborShapeId - right.neighborShapeId);
  });
  await finished(shapes);

  const directions: number[] = [];
  const neighborShapeIds: number[] = [];
  const resolvedGeometryIds: number[] = [];
  const resolvedShapeIds: number[] = [];
  const shapeOffsets = new Uint32Array(catalog.shapeCount + 1);
  for (let shapeId = 0; shapeId < entriesByShape.length; shapeId += 1) {
    shapeOffsets[shapeId] = directions.length;
    for (const entry of entriesByShape[shapeId]!) {
      directions.push(entry.direction);
      neighborShapeIds.push(entry.neighborShapeId);
      resolvedGeometryIds.push(entry.geometryId);
      resolvedShapeIds.push(entry.resolvedShapeId);
    }
  }
  shapeOffsets[catalog.shapeCount] = directions.length;
  return new PackedNeighborTransitions({
    directions: Uint8Array.from(directions),
    neighborShapeIds: Uint32Array.from(neighborShapeIds),
    resolvedGeometryIds: Uint32Array.from(resolvedGeometryIds),
    resolvedShapeIds: Uint32Array.from(resolvedShapeIds),
    shapeOffsets,
  });
}

const values = process.argv.slice(2);
const directory = resolve(values[0] ?? 'generated/catalog');
const inputIndex = values.indexOf('--input');
const inputPath = inputIndex < 0 ? undefined : resolve(values[inputIndex + 1] ?? '');
if (inputIndex >= 0 && inputPath === resolve('')) {
  throw new Error('--input needs an extracted catalog path');
}
const [blocks, metadata, shapes] = await Promise.all([
  readFile(resolve(directory, 'generated-blocks.bin')),
  readFile(resolve(directory, 'metadata.json'), 'utf8'),
  readFile(resolve(directory, 'generated-shapes.bin')),
]);
const catalog = decodeGeneratedCatalog({
  blocks: new Uint8Array(blocks),
  metadata,
  shapes: new Uint8Array(shapes),
});
const transitions = inputPath === undefined
  ? await (async () => {
      const auditText = await readFile(resolve(directory, 'extraction-audit.json'), 'utf8');
      const audit = JSON.parse(auditText) as GeneratedExtractionAuditMetadata;
      return compileNeighborTransitions(catalog, audit.extraction);
    })()
  : await compileStreaming(catalog, inputPath);
const encoded = encodeNeighborTransitions(transitions);
await writeFile(resolve(directory, 'neighbor-transitions.bin'), encoded);
process.stdout.write(`${JSON.stringify({
  bytes: encoded.byteLength,
  entries: transitions.directions.length,
  input: inputPath ?? resolve(directory, 'extraction-audit.json'),
  output: resolve(directory, 'neighbor-transitions.bin'),
  shapes: catalog.shapeCount,
}, undefined, 2)}\n`);
