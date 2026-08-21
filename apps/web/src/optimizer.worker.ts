/// <reference lib="webworker" />

import { optimizeMeshProgressive } from '@mesh-to-copycats/pipeline';
import {
  getFixtureCatalog,
  decodeNeighborTransitions,
  loadWebRuntimeCatalog,
  resolveSparseNeighbors,
  type PackedNeighborTransitions,
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
  PaletteResponse,
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
  neighbors?: PackedNeighborTransitions;
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
  neighbors?: PackedNeighborTransitions;
  source: 'fixture' | 'production';
}> {
  catalogPromise ??= Promise.all([
    loadWebRuntimeCatalog({ baseUrl: '/catalog' }),
    fetch('/catalog/material-palette.json').then(async (response) => {
      if (!response.ok) throw new Error(`Material palette request failed with HTTP ${response.status}`);
      return loadGeneratedMaterialPalette(await response.text());
    }),
    fetch('/catalog/neighbor-transitions.bin').then(async (response) => {
      if (!response.ok) throw new Error(`Neighbor transitions request failed with HTTP ${response.status}`);
      return decodeNeighborTransitions(new Uint8Array(await response.arrayBuffer()));
    }),
  ])
    .then(([runtime, palette, neighbors]) => ({
      catalog: runtime.catalog,
      neighbors,
      palette,
      runtime,
      source: 'production' as const,
    }))
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
): {
  colors: Float32Array;
  paletteIndexes: Uint32Array;
  positions: Float32Array;
  scales: Float32Array;
  truncated: boolean;
} {
  const maximumInstances = 250_000;
  const positions = new Float32Array(maximumInstances * 3);
  const colors = new Float32Array(maximumInstances * 3);
  const scales = new Float32Array(maximumInstances * 3);
  const paletteIndexes = new Uint32Array(maximumInstances);
  paletteIndexes.fill(0xffff_ffff);
  let instances = 0;
  for (let cell = 0; cell < materials.shapeIds.length && instances < maximumInstances; cell += 1) {
    const shapeId = materials.shapeIds[cell] ?? 0;
    const globalPartStart = catalog.shapePartOffsets[shapeId] ?? 0;
    const globalPartEnd = catalog.shapePartOffsets[shapeId + 1] ?? globalPartStart;
    const assignmentStart = materials.cellPartOffsets[cell] ?? 0;
    for (let globalPart = globalPartStart; globalPart < globalPartEnd && instances < maximumInstances; globalPart += 1) {
      const assignment = assignmentStart + globalPart - globalPartStart;
      const maskOffset = catalog.partMask16Offsets[globalPart] ?? globalPart * 128;
      const mask = catalog.partMasks16.subarray(maskOffset, maskOffset + 128);
      const visited = new Uint8Array(4096);
      const occupied = (x: number, y: number, z: number) => {
        const bit = x + 16 * (y + 16 * z);
        return visited[bit] === 0 && ((mask[bit >>> 5] ?? 0) & (1 << (bit & 31))) !== 0;
      };
      for (let z = 0; z < 16 && instances < maximumInstances; z += 1) {
        for (let y = 0; y < 16 && instances < maximumInstances; y += 1) {
          for (let x = 0; x < 16 && instances < maximumInstances; x += 1) {
            if (!occupied(x, y, z)) continue;
            let xEnd = x + 1;
            while (xEnd < 16 && occupied(xEnd, y, z)) xEnd += 1;
            let yEnd = y + 1;
            while (yEnd < 16) {
              let clear = true;
              for (let scanX = x; scanX < xEnd; scanX += 1) clear &&= occupied(scanX, yEnd, z);
              if (!clear) break;
              yEnd += 1;
            }
            let zEnd = z + 1;
            while (zEnd < 16) {
              let clear = true;
              for (let scanY = y; scanY < yEnd; scanY += 1) {
                for (let scanX = x; scanX < xEnd; scanX += 1) clear &&= occupied(scanX, scanY, zEnd);
              }
              if (!clear) break;
              zEnd += 1;
            }
            for (let markZ = z; markZ < zEnd; markZ += 1) {
              for (let markY = y; markY < yEnd; markY += 1) {
                visited.fill(1, x + 16 * (markY + 16 * markZ), xEnd + 16 * (markY + 16 * markZ));
              }
            }
            positions[instances * 3] = (cellX[cell] ?? 0) + (x + xEnd) / 32;
            positions[instances * 3 + 1] = (cellY[cell] ?? 0) + (y + yEnd) / 32;
            positions[instances * 3 + 2] = (cellZ[cell] ?? 0) + (z + zEnd) / 32;
            scales[instances * 3] = (xEnd - x) / 16;
            scales[instances * 3 + 1] = (yEnd - y) / 16;
            scales[instances * 3 + 2] = (zEnd - z) / 16;
            const paletteIndex = materials.paletteIndexes[assignment] ?? 0xffff_ffff;
            paletteIndexes[instances] = paletteIndex;
            colors[instances * 3] = paletteIndex < palette.size
              ? palette.linearRgb[paletteIndex * 3] ?? 0.5
              : 0.85;
            colors[instances * 3 + 1] = paletteIndex < palette.size
              ? palette.linearRgb[paletteIndex * 3 + 1] ?? 0.5
              : 0.15;
            colors[instances * 3 + 2] = paletteIndex < palette.size
              ? palette.linearRgb[paletteIndex * 3 + 2] ?? 0.5
              : 0.1;
            instances += 1;
          }
        }
      }
    }
  }
  return {
    colors: colors.slice(0, instances * 3),
    paletteIndexes: paletteIndexes.slice(0, instances),
    positions: positions.slice(0, instances * 3),
    scales: scales.slice(0, instances * 3),
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
  if (request.type === 'load-palette') {
    void loadCatalog().then((loaded) => {
      const response: PaletteResponse = {
        itemIds: loaded.palette.itemIds,
        requestId: request.requestId,
        srgb: loaded.palette.srgb.slice(),
        textureHeights: loaded.palette.previewTextureAtlas?.heights.slice() ?? new Uint16Array(),
        textureOffsets: loaded.palette.previewTextureAtlas?.offsets.slice() ?? new Uint32Array(),
        textureRgbaSrgb: loaded.palette.previewTextureAtlas?.rgbaSrgb.slice() ?? new Uint8Array(),
        textureWidths: loaded.palette.previewTextureAtlas?.widths.slice() ?? new Uint16Array(),
        type: 'palette',
      };
      scope.postMessage(response, [
        response.srgb.buffer,
        response.textureHeights.buffer,
        response.textureOffsets.buffer,
        response.textureRgbaSrgb.buffer,
        response.textureWidths.buffer,
      ]);
    }).catch((error: unknown) => {
      scope.postMessage({
        message: error instanceof Error ? error.message : String(error),
        requestId: request.requestId,
        type: 'error',
      } satisfies WorkerResponse);
    });
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
        optimizerSettings: {
          extraWeight: 1,
          missingWeight: 1024,
          qualityMode: qualityMode(request.quality),
        },
        preferPlanarByteGeometry: true,
        rasterizer: { scale: request.scale },
        signal: abort,
      });
      const uncoveredCells = result.missingCounts.reduce(
        (count, missing) => count + (missing > 0 ? 1 : 0),
        0,
      );
      if (uncoveredCells > 0) {
        throw new Error(`Surface coverage invariant failed for ${uncoveredCells} cells`);
      }
      const palette = loaded.palette;
      const included = request.includedMaterialItemIds === undefined
        ? undefined
        : new Set(request.includedMaterialItemIds);
      if (included?.size === 0) {
        throw new Error('Select at least one included material before building geometry');
      }
      const allowedPaletteIndexes = included === undefined
        ? undefined
        : Uint8Array.from(palette.itemIds, (itemId) => included.has(itemId) ? 1 : 0);
      const paletteIndexByItem = new Map(palette.itemIds.map((itemId, index) => [itemId, index]));
      const sourceMaterialPaletteIndexes = new Uint32Array(request.materialOverrides.length);
      sourceMaterialPaletteIndexes.fill(0xffff_ffff);
      for (let sourceMaterial = 0; sourceMaterial < request.materialOverrides.length; sourceMaterial += 1) {
        const itemId = request.materialOverrides[sourceMaterial] ?? '';
        if (itemId.length === 0) continue;
        const paletteIndex = paletteIndexByItem.get(itemId);
        if (paletteIndex === undefined) throw new Error(`Unknown material override ${itemId}`);
        sourceMaterialPaletteIndexes[sourceMaterial] = paletteIndex;
      }
      const neighborStarted = performance.now();
      const neighbors = loaded.neighbors === undefined
        ? {
            changedCells: 0,
            geometryIds: result.geometryIds,
            iterations: 0,
            shapeIds: result.shapeIds,
          }
        : resolveSparseNeighbors({
            catalog: loaded.catalog,
            shapeIds: result.shapeIds,
            surface: result.surface,
            transitions: loaded.neighbors,
          });
      const neighborMs = performance.now() - neighborStarted;
      const materialStarted = performance.now();
      const samples = extractSurfaceSamples(request.mesh, result.surface, { strataPerAxis: 2 });
      const materials = resolveMaterials({
        ...(allowedPaletteIndexes === undefined ? {} : { allowedPaletteIndexes }),
        catalog: loaded.catalog,
        geometryIds: neighbors.geometryIds,
        palette,
        preferredByteCells: result.planarBytePreferred,
        ...(loaded.runtime === undefined ? {} : { runtime: loaded.runtime }),
        samples,
        sourceMaterialPaletteIndexes,
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
        neighborChangedCells: neighbors.changedCells,
        neighborIterations: neighbors.iterations,
        materialErrors: materials.materialErrors,
        materialDirections: materials.materialDirections,
        paletteIndexes: materials.paletteIndexes,
        paletteItemIds: palette.itemIds,
        // Never transfer a buffer owned by the cached production palette. The first build would
        // otherwise detach it and make every subsequent build fail in postMessage().
        paletteSrgb: palette.srgb.slice(),
        paletteTextureHeights: palette.previewTextureAtlas?.heights.slice() ?? new Uint16Array(),
        paletteTextureOffsets: palette.previewTextureAtlas?.offsets.slice() ?? new Uint32Array(),
        paletteTextureRgbaSrgb: palette.previewTextureAtlas?.rgbaSrgb.slice() ?? new Uint8Array(),
        paletteTextureWidths: palette.previewTextureAtlas?.widths.slice() ?? new Uint16Array(),
        partIds: materials.partIds,
        partKeys,
        previewColors: preview.colors,
        previewPositions: preview.positions,
        previewPaletteIndexes: preview.paletteIndexes,
        previewScales: preview.scales,
        previewTruncated: preview.truncated,
        requestId: request.requestId,
        shapeIds: materials.shapeIds,
        shapeBlockIds,
        shapeStates,
        timingsMs: {
          ...result.timingsMs,
          materials: materialMs,
          neighbors: neighborMs,
          total: result.timingsMs.total + materialMs + neighborMs,
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
        response.paletteTextureHeights.buffer,
        response.paletteTextureOffsets.buffer,
        response.paletteTextureRgbaSrgb.buffer,
        response.paletteTextureWidths.buffer,
        response.partIds.buffer,
        response.previewColors.buffer,
        response.previewPositions.buffer,
        response.previewPaletteIndexes.buffer,
        response.previewScales.buffer,
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
