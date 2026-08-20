/// <reference lib="webworker" />

import { optimizeMeshProgressive } from '@mesh-to-copycats/pipeline';
import {
  getFixtureCatalog,
  loadWebRuntimeCatalog,
  type PackedShapeCatalog,
  type WebRuntimeCatalog,
} from '@mesh-to-copycats/shapes';
import { QualityMode } from '@mesh-to-copycats/shared';

import {
  createStarterMinecraftPalette,
  extractSurfaceSamples,
  loadGeneratedMaterialPalette,
  resolveMaterials,
  type PackedMaterialPalette,
  type PackedResolvedMaterials,
} from '../../../packages/palette/src/index.js';
import type {
  CompleteResponse,
  QualityName,
  WorkerRequest,
  WorkerResponse,
} from './worker-types.js';

const scope = self as DedicatedWorkerGlobalScope;
const abortStates = new Map<number, { aborted: boolean }>();
let catalogPromise: Promise<{
  catalog: PackedShapeCatalog;
  runtime?: WebRuntimeCatalog;
  palette: PackedMaterialPalette;
  source: 'fixture' | 'production';
}> | undefined;

function qualityMode(name: QualityName): QualityMode {
  if (name === 'FAST') return QualityMode.FAST;
  if (name === 'QUALITY') return QualityMode.QUALITY;
  return QualityMode.BALANCED;
}

async function loadCatalog(): Promise<{
  catalog: PackedShapeCatalog;
  runtime?: WebRuntimeCatalog;
  palette: PackedMaterialPalette;
  source: 'fixture' | 'production';
}> {
  catalogPromise ??= Promise.all([
    loadWebRuntimeCatalog({ baseUrl: '/catalog' }),
    fetch('/catalog/material-palette.json').then(async (response) => {
      if (!response.ok) throw new Error(`Material palette request failed with HTTP ${response.status}`);
      return loadGeneratedMaterialPalette(await response.text());
    }),
  ])
    .then(([runtime, palette]) => ({ catalog: runtime.catalog, palette, runtime, source: 'production' as const }))
    .catch(() => ({
      catalog: getFixtureCatalog(),
      palette: createStarterMinecraftPalette(),
      source: 'fixture' as const,
    }));
  return catalogPromise;
}

function previewData(
  catalog: PackedShapeCatalog,
  materials: PackedResolvedMaterials,
  palette: PackedMaterialPalette,
  cellX: Int32Array,
  cellY: Int32Array,
  cellZ: Int32Array,
): { colors: Float32Array; positions: Float32Array; truncated: boolean } {
  const maximumInstances = 250_000;
  const positions = new Float32Array(maximumInstances * 3);
  const colors = new Float32Array(maximumInstances * 3);
  let instances = 0;
  for (let cell = 0; cell < materials.shapeIds.length && instances < maximumInstances; cell += 1) {
    const shapeId = materials.shapeIds[cell] ?? 0;
    const mask = catalog.getGeometryMask(catalog.shapeGeometry[shapeId] ?? 0, 4);
    const owner = catalog.getOwnerGrid16(shapeId);
    const globalPartStart = catalog.shapePartOffsets[shapeId] ?? 0;
    const assignmentStart = materials.cellPartOffsets[cell] ?? 0;
    const assignmentEnd = materials.cellPartOffsets[cell + 1] ?? assignmentStart;
    for (let bit = 0; bit < 64 && instances < maximumInstances; bit += 1) {
      if (((mask[bit >>> 5] ?? 0) & (1 << (bit & 31))) === 0) continue;
      const x = bit & 3;
      const y = (bit >>> 2) & 3;
      const z = bit >>> 4;
      positions[instances * 3] = (cellX[cell] ?? 0) + (x + 0.5) / 4;
      positions[instances * 3 + 1] = (cellY[cell] ?? 0) + (y + 0.5) / 4;
      positions[instances * 3 + 2] = (cellZ[cell] ?? 0) + (z + 0.5) / 4;
      const ownerId = owner === undefined
        ? catalog.partIds[globalPartStart] ?? 0
        : owner[(x * 4 + 2) + 16 * ((y * 4 + 2) + 16 * (z * 4 + 2))] ?? 0;
      let assignment = assignmentStart;
      for (let candidate = assignmentStart; candidate < assignmentEnd; candidate += 1) {
        if ((materials.partIds[candidate] ?? 0) === ownerId) {
          assignment = candidate;
          break;
        }
      }
      const paletteIndex = materials.paletteIndexes[assignment] ?? 0xffff_ffff;
      colors[instances * 3] = paletteIndex < palette.size
        ? palette.linearRgb[paletteIndex * 3] ?? 0.5
        : 0.85;
      colors[instances * 3 + 1] = paletteIndex < palette.size
        ? palette.linearRgb[paletteIndex * 3 + 1] ?? 0.5
        : 0.15;
      colors[instances * 3 + 2] = paletteIndex < palette.size
        ? palette.linearRgb[paletteIndex * 3 + 2] ?? 0.5
        : 0.1;
      instances++;
    }
  }
  return {
    colors: colors.slice(0, instances * 3),
    positions: positions.slice(0, instances * 3),
    truncated: instances === maximumInstances,
  };
}

scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    const state = abortStates.get(request.requestId);
    if (state !== undefined) state.aborted = true;
    return;
  }
  const abort = { aborted: false };
  abortStates.set(request.requestId, abort);
  void (async () => {
    try {
      const loaded = await loadCatalog();
      const result = await optimizeMeshProgressive({
        batchSize: 128,
        catalog: loaded.catalog,
        mesh: request.mesh,
        onProgress: ({ completed, total }) => {
          scope.postMessage({
            completed,
            requestId: request.requestId,
            total,
            type: 'progress',
          } satisfies WorkerResponse);
        },
        optimizerSettings: { qualityMode: qualityMode(request.quality) },
        rasterizer: { scale: request.scale },
        signal: abort,
      });
      const materialStarted = performance.now();
      const palette = loaded.palette;
      const samples = extractSurfaceSamples(request.mesh, result.surface);
      const materials = resolveMaterials({
        catalog: loaded.catalog,
        geometryIds: result.geometryIds,
        palette,
        ...(loaded.runtime === undefined ? {} : { runtime: loaded.runtime }),
        samples,
      });
      const materialMs = performance.now() - materialStarted;
      const preview = previewData(
        loaded.catalog,
        materials,
        palette,
        result.surface.cellX,
        result.surface.cellY,
        result.surface.cellZ,
      );
      const shapeBlockIds = Array.from(materials.shapeIds, (shapeId) =>
        loaded.catalog.blockIds[shapeId] ?? 'minecraft:air');
      const shapeStates = Array.from(materials.shapeIds, (shapeId) =>
        loaded.catalog.states[shapeId] ?? '');
      const partKeys: string[] = [];
      for (let cell = 0; cell < materials.shapeIds.length; cell += 1) {
        const shapeId = materials.shapeIds[cell] ?? 0;
        const catalogPartStart = loaded.catalog.shapePartOffsets[shapeId] ?? 0;
        const assignmentStart = materials.cellPartOffsets[cell] ?? 0;
        const assignmentEnd = materials.cellPartOffsets[cell + 1] ?? assignmentStart;
        for (let assignment = assignmentStart; assignment < assignmentEnd; assignment += 1) {
          partKeys.push(loaded.catalog.partKeys[catalogPartStart + assignment - assignmentStart] ?? 'material');
        }
      }
      const response: CompleteResponse = {
        acceptedMaterialBlockIds: materials.acceptedMaterialBlockIds,
        acceptedMaterialStates: materials.acceptedMaterialStates,
        catalog: loaded.source,
        cellPartOffsets: materials.cellPartOffsets,
        cellX: result.surface.cellX,
        cellY: result.surface.cellY,
        cellZ: result.surface.cellZ,
        errors: result.geometryErrors,
        invalidMaterialCells: materials.invalidCells.reduce((sum, value) => sum + value, 0),
        materialErrors: materials.materialErrors,
        materialDirections: materials.materialDirections,
        paletteIndexes: materials.paletteIndexes,
        paletteItemIds: palette.itemIds,
        paletteSrgb: palette.srgb,
        partIds: materials.partIds,
        partKeys,
        previewColors: preview.colors,
        previewPositions: preview.positions,
        previewTruncated: preview.truncated,
        requestId: request.requestId,
        shapeIds: materials.shapeIds,
        shapeBlockIds,
        shapeStates,
        timingsMs: {
          ...result.timingsMs,
          materials: materialMs,
          total: result.timingsMs.total + materialMs,
        },
        triangleCount: request.mesh.indices.length / 3,
        type: 'complete',
      };
      scope.postMessage(response, [
        response.cellPartOffsets.buffer,
        response.cellX.buffer,
        response.cellY.buffer,
        response.cellZ.buffer,
        response.errors.buffer,
        response.materialErrors.buffer,
        response.materialDirections.buffer,
        response.paletteIndexes.buffer,
        response.paletteSrgb.buffer,
        response.partIds.buffer,
        response.previewColors.buffer,
        response.previewPositions.buffer,
        response.shapeIds.buffer,
      ]);
    } catch (error) {
      scope.postMessage({
        message: error instanceof Error ? error.message : String(error),
        requestId: request.requestId,
        type: 'error',
      } satisfies WorkerResponse);
    } finally {
      abortStates.delete(request.requestId);
    }
  })();
});
